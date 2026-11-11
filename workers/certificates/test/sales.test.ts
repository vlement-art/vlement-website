import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import worker from '../src';
import type { Env } from '../src/types';

type TestArtwork = {
  title: string;
  category: string;
  available?: boolean;
  editionType?: string;
  editionSize?: number;
  price?: string;
};

function authorizedEnv(): Env {
  return Object.assign(Object.create(env), {
    ALLOWED_GITHUB_USER_ID: '12345',
  }) as Env;
}

function githubApi(artworks: Record<string, TestArtwork>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/user') return Response.json({ id: 12345 });
    if (url.pathname === '/repos/vlement-art/vlement-website') {
      return Response.json({ permissions: { push: true } });
    }
    if (url.pathname === '/repos/vlement-art/vlement-website/contents/src/content/artworks') {
      return Response.json(Object.keys(artworks).map(slug => ({
        name: `${slug}.md`,
        type: 'file',
      })));
    }
    const file = /^\/repos\/vlement-art\/vlement-website\/contents\/src\/content\/artworks\/([a-z0-9-]+)\.md$/.exec(url.pathname);
    if (file) {
      const artwork = artworks[file[1]];
      if (!artwork) return Response.json({ message: 'Not found' }, { status: 404 });
      const fields = [
        `title: ${artwork.title}`,
        `category: ${artwork.category}`,
        `available: ${artwork.available === false ? 'false' : 'true'}`,
        ...(artwork.editionType ? [`editionType: ${artwork.editionType}`] : []),
        ...(artwork.editionSize ? [`editionSize: ${artwork.editionSize}`] : []),
        `price: ${artwork.price || '£100'}`,
      ];
      const markdown = `---\n${fields.join('\n')}\n---\n`;
      return Response.json({
        name: `${file[1]}.md`,
        type: 'file',
        content: btoa(markdown),
      });
    }
    return Response.json({ message: 'Not found' }, { status: 404 });
  });
}

function headers() {
  return {
    Authorization: `Bearer sales-test-${crypto.randomUUID()}`,
    Origin: 'https://vlement.com',
    'Content-Type': 'application/json',
  };
}

function saleBody(
  artworkSlug: string,
  itemType: 'original' | 'limited_edition' | 'open_edition',
  overrides: Record<string, unknown> = {},
) {
  return {
    artworkSlug,
    itemType,
    editionNumber: itemType === 'limited_edition' ? 1 : null,
    buyerName: 'Test buyer',
    buyerEmail: 'buyer@example.com',
    saleDate: '2026-11-04',
    price: 100,
    currency: 'GBP',
    notes: '',
    ...overrides,
  };
}

async function postSale(requestHeaders: Record<string, string>, body: Record<string, unknown>) {
  return worker.fetch(new Request('https://certificates.test/api/admin/sales', {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(body),
  }), authorizedEnv());
}

describe('sales endpoints', () => {
  it('rejects unauthenticated and unauthorized users and never accepts a query token', async () => {
    const unauthenticated = await worker.fetch(
      new Request('https://certificates.test/api/admin/sales?token=secret'),
      authorizedEnv(),
    );
    expect(unauthenticated.status).toBe(401);

    const misconfiguredEnv = Object.assign(Object.create(env), {
      ALLOWED_GITHUB_USER_ID: '',
    }) as Env;
    const misconfigured = await worker.fetch(new Request(
      'https://certificates.test/api/admin/sales',
      { headers: headers() },
    ), misconfiguredEnv);
    expect(misconfigured.status).toBe(503);

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/user')) return Response.json({ id: 99999 });
      return Response.json({ permissions: { push: true } });
    }));
    try {
      const response = await worker.fetch(new Request(
        'https://certificates.test/api/admin/sales',
        { headers: headers() },
      ), authorizedEnv());
      expect(response.status).toBe(403);

      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/user')
          ? Response.json({ id: 12345 })
          : Response.json({ permissions: { push: false } })));
      const noPushPermission = await worker.fetch(new Request(
        'https://certificates.test/api/admin/sales',
        { headers: headers() },
      ), authorizedEnv());
      expect(noPushPermission.status).toBe(403);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('lets a signed-in allowed repository writer retrieve recent sales', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/user')
        ? Response.json({ id: 12345 })
        : Response.json({ permissions: { push: true } })));
    try {
      const response = await worker.fetch(new Request(
        'https://certificates.test/api/admin/sales?page=1&per_page=20',
        { headers: headers() },
      ), authorizedEnv());

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        page: 1,
        perPage: 20,
        total: expect.any(Number),
        sales: expect.any(Array),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('validates sale fields before reading artwork metadata', async () => {
    const api = githubApi({});
    vi.stubGlobal('fetch', api);
    try {
      const invalid = await postSale(headers(), saleBody('valid-art', 'original', {
        saleDate: '2026-02-30',
      }));
      expect(invalid.status).toBe(400);

      const invalidEmail = await postSale(headers(), saleBody('valid-art', 'original', {
        buyerEmail: 'not-an-email',
      }));
      expect(invalidEmail.status).toBe(400);
      expect(api).toHaveBeenCalledTimes(4);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('allocates distinct open-edition numbers concurrently and never reuses a cancelled number', async () => {
    const slug = `open-${crypto.randomUUID().slice(0, 8)}`;
    vi.stubGlobal('fetch', githubApi({
      [slug]: { title: 'Open artwork', category: 'Print', editionType: 'open' },
    }));
    try {
      const [first, second] = await Promise.all([
        postSale(headers(), saleBody(slug, 'open_edition', { buyerName: 'First buyer' })),
        postSale(headers(), saleBody(slug, 'open_edition', { buyerName: 'Second buyer' })),
      ]);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const firstSale = (await first.json() as { sale: { id: string; sale_number: string; open_edition_number: number } }).sale;
      const secondSale = (await second.json() as { sale: { id: string; sale_number: string; open_edition_number: number } }).sale;
      expect(new Set([firstSale.sale_number, secondSale.sale_number]).size).toBe(2);
      expect([firstSale.open_edition_number, secondSale.open_edition_number].sort()).toEqual([1, 2]);

      const cancel = await worker.fetch(new Request(
        'https://certificates.test/api/admin/sales/cancel',
        {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ saleNumber: firstSale.sale_number }),
        },
      ), authorizedEnv());
      expect(cancel.status).toBe(200);
      const third = await postSale(headers(), saleBody(slug, 'open_edition'));
      expect(third.status).toBe(201);
      const thirdSale = (await third.json() as { sale: { sale_number: string; open_edition_number: number } }).sale;
      expect(thirdSale.sale_number).not.toBe(firstSale.sale_number);
      expect(thirdSale.open_edition_number).toBe(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects duplicate limited-edition numbers and reports sold-out availability', async () => {
    const slug = `limited-${crypto.randomUUID().slice(0, 8)}`;
    vi.stubGlobal('fetch', githubApi({
      [slug]: { title: 'Limited artwork', category: 'Print', editionType: 'limited', editionSize: 2 },
    }));
    try {
      const first = await postSale(headers(), saleBody(slug, 'limited_edition', { editionNumber: 1 }));
      expect(first.status).toBe(201);
      const duplicate = await postSale(headers(), saleBody(slug, 'limited_edition', { editionNumber: 1 }));
      expect(duplicate.status).toBe(409);

      const last = await postSale(headers(), saleBody(slug, 'limited_edition', { editionNumber: 2 }));
      expect(last.status).toBe(201);
      expect((await last.json() as { artworkAvailable: boolean }).artworkAvailable).toBe(false);

      const listed = await worker.fetch(new Request(
        'https://certificates.test/api/admin/sales/artworks',
        { headers: headers() },
      ), authorizedEnv());
      const artwork = ((await listed.json()) as {
        artworks: Array<{ slug: string; available: boolean; soldEditionNumbers: number[] }>;
      }).artworks.find(item => item.slug === slug);
      expect(artwork).toMatchObject({
        slug,
        available: false,
        soldEditionNumbers: [1, 2],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('marks originals unavailable, prevents duplicate sales, and restores availability on cancel', async () => {
    const slug = `original-${crypto.randomUUID().slice(0, 8)}`;
    vi.stubGlobal('fetch', githubApi({
      [slug]: { title: 'Original artwork', category: 'Original painting' },
    }));
    try {
      const first = await postSale(headers(), saleBody(slug, 'original'));
      expect(first.status).toBe(201);
      const firstData = await first.json() as { sale: { sale_number: string }; artworkAvailable: boolean };
      expect(firstData.artworkAvailable).toBe(false);
      const duplicate = await postSale(headers(), saleBody(slug, 'original'));
      expect(duplicate.status).toBe(409);

      const cancel = await worker.fetch(new Request(
        'https://certificates.test/api/admin/sales/cancel',
        {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ saleNumber: firstData.sale.sale_number }),
        },
      ), authorizedEnv());
      expect(cancel.status).toBe(200);
      expect((await cancel.json() as { artworkAvailable: boolean }).artworkAvailable).toBe(true);

      const retry = await postSale(headers(), saleBody(slug, 'original'));
      expect(retry.status).toBe(201);
      const audit = await env.DB.prepare(
        'SELECT action FROM sales_audit_log WHERE sale_number = ? ORDER BY occurred_at',
      ).bind(firstData.sale.sale_number).all<{ action: string }>();
      expect(audit.results.map(row => row.action)).toEqual(['sale_recorded', 'sale_cancelled']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('links a later certificate to its active sale and reuses the sale number', async () => {
    const slug = `linked-${crypto.randomUUID().slice(0, 8)}`;
    vi.stubGlobal('fetch', githubApi({
      [slug]: { title: 'Linked original', category: 'Original painting' },
    }));
    try {
      const requestHeaders = headers();
      const saleResponse = await postSale(requestHeaders, saleBody(slug, 'original'));
      expect(saleResponse.status).toBe(201);
      const { sale } = await saleResponse.json() as { sale: { sale_number: string } };

      const formData = new FormData();
      formData.append('request', JSON.stringify({
        artwork: {
          slug,
          title: 'Linked original',
          year: 2026,
          medium: 'Oil',
          dimensions: '40 x 50 cm',
          image: `/images/artwork/${slug}.jpg`,
        },
        certificateType: 'original',
      }));
      formData.append('originalImage', new File(['image-bytes'], 'artwork.jpg', { type: 'image/jpeg' }));
      const certificateResponse = await worker.fetch(new Request(
        'https://certificates.test/api/admin/certificates/issue',
        {
          method: 'POST',
          headers: {
            Authorization: requestHeaders.Authorization,
            Origin: requestHeaders.Origin,
          },
          body: formData,
        },
      ), authorizedEnv());
      expect(certificateResponse.status).toBe(201);
      const { certificate } = await certificateResponse.json() as {
        certificate: { id: string; certificate_number: string };
      };
      expect(certificate.certificate_number).toBe(sale.sale_number);

      const linkedSale = await env.DB.prepare(
        'SELECT certificate_id FROM sales WHERE sale_number = ?',
      ).bind(sale.sale_number).first<{ certificate_id: string }>();
      expect(linkedSale?.certificate_id).toBe(certificate.id);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects invalid price, item type, email and overlong notes', async () => {
    const slug = `validation-${crypto.randomUUID().slice(0, 8)}`;
    vi.stubGlobal('fetch', githubApi({
      [slug]: { title: 'Validation artwork', category: 'Original painting' },
    }));
    try {
      for (const override of [
        { price: Number.NaN },
        { itemType: 'limited_edition', editionNumber: 1 },
        { buyerEmail: 'invalid' },
        { notes: 'x'.repeat(1001) },
      ]) {
        const response = await postSale(headers(), saleBody(slug, 'original', override));
        expect(response.status).toBe(400);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders escaped receipts, records print and email actions, and protects cancelled receipts', async () => {
    const slug = `receipt-${crypto.randomUUID().slice(0, 8)}`;
    const github = githubApi({
      [slug]: { title: 'Limited & artwork', category: 'Print', editionType: 'limited', editionSize: 5 },
    });
    const provider = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ id: 'provider-id' }));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === 'https://api.resend.com/emails' ? provider(input, init) : github(input)));
    const receiptEnv = Object.assign(Object.create(authorizedEnv()), {
      SELLER_NAME: 'Vlement',
      SELLER_WEBSITE: 'https://vlement.com',
      SELLER_EMAIL: 'sales@example.com',
      RESEND_API_KEY: 'test-key',
      RECEIPT_FROM_ADDRESS: 'Vlement <sales@example.com>',
      VERIFY_LIMITER: { limit: async () => ({ success: true }) },
    }) as Env;
    const get = (path: string, authenticated = true) => worker.fetch(new Request(
      `https://certificates.test${path}`, authenticated ? { headers: headers() } : {},
    ), receiptEnv);
    const post = (path: string, body: Record<string, unknown>) => worker.fetch(new Request(
      `https://certificates.test${path}`,
      { method: 'POST', headers: headers(), body: JSON.stringify(body) },
    ), receiptEnv);
    try {
      expect((await get('/api/admin/sales/receipt?saleNumber=test', false)).status).toBe(401);
      const created = await postSale(headers(), saleBody(slug, 'limited_edition', {
        buyerName: '<script>buyer</script>', buyerEmail: null, notes: '<img src=x onerror=alert(1)>',
      }));
      expect(created.status).toBe(201);
      const { sale } = await created.json() as { sale: { sale_number: string } };
      const number = sale.sale_number;
      const receiptUrl = `/api/admin/sales/receipt?saleNumber=${encodeURIComponent(number)}`;
      const hidden = await (await get(receiptUrl)).text();
      expect(hidden).toContain('&lt;script&gt;buyer&lt;/script&gt;');
      expect(hidden).toContain('Limited &amp; artwork');
      expect(hidden).toContain('Edition 1 of 5');
      expect(hidden).not.toContain('onerror');
      const visible = await (await get(`${receiptUrl}&includeNotes=1`)).text();
      expect(visible).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(visible).not.toContain('<img src=x onerror');

      expect((await post('/api/admin/sales/receipt/email', { saleNumber: number })).status).toBe(400);
      expect((await post('/api/admin/sales/receipt/email', { saleNumber: number, buyerEmail: 'bad' })).status).toBe(400);
      expect((await post('/api/admin/sales/receipt/email', { saleNumber: number, buyerEmail: `${'a'.repeat(250)}@example.com` })).status).toBe(400);
      expect((await post('/api/admin/sales/receipt/printed', { saleNumber: number })).status).toBe(200);
      provider.mockResolvedValueOnce(new Response('provider secret detail', { status: 500 }));
      const failed = await post('/api/admin/sales/receipt/email', { saleNumber: number, buyerEmail: 'buyer@example.com' });
      expect(failed.status).toBe(502);
      expect(await failed.text()).not.toContain('provider secret detail');
      const beforeRetry = await env.DB.prepare('SELECT receipt_emailed_at, buyer_email FROM sales WHERE sale_number = ?')
        .bind(number).first<{ receipt_emailed_at: string | null; buyer_email: string | null }>();
      expect(beforeRetry).toEqual({ receipt_emailed_at: null, buyer_email: null });
      expect((await post('/api/admin/sales/receipt/email', { saleNumber: number, buyerEmail: 'buyer@example.com' })).status).toBe(200);
      expect(provider).toHaveBeenCalledTimes(2);
      const sent = JSON.parse(String(provider.mock.calls[1][1]?.body)) as { html: string; text: string };
      expect(sent.html).toContain('Edition 1 of 5');
      expect(sent.text).toContain('Edition 1 of 5');
      expect(sent.html).not.toContain('onerror');
      const listed = await (await get('/api/admin/sales?per_page=100')).json() as {
        sales: Array<{ sale_number: string; buyer_email: string; receipt_printed_at: string; receipt_emailed_at: string }>;
      };
      expect(listed.sales.find(item => item.sale_number === number)).toMatchObject({
        buyer_email: 'buyer@example.com',
        receipt_printed_at: expect.any(String),
        receipt_emailed_at: expect.any(String),
      });
      expect((await post('/api/admin/sales/cancel', { saleNumber: number })).status).toBe(200);
      expect(await (await get(receiptUrl)).text()).toContain('CANCELLED');
      expect((await post('/api/admin/sales/receipt/email', { saleNumber: number })).status).toBe(400);
      expect((await post('/api/admin/sales/receipt/email', { saleNumber: number, confirmCancelled: true })).status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
