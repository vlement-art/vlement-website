import { env } from 'cloudflare:workers';
import { expect, it, vi } from 'vitest';
import worker from '../src';
import type { Env } from '../src/types';

it('keeps a print-only UID in its immutable version without registering a tag', async () => {
  const authorizedEnv = Object.assign(Object.create(env), { ALLOWED_GITHUB_USER_ID: '12345' }) as Env;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
    String(input).endsWith('/user')
      ? Response.json({ id: 12345 })
      : Response.json({ permissions: { push: true } })));
  try {
    const headers = { Authorization: ['Bearer', 'print-only-uid'].join(' ') };
    const artwork = {
      slug: `print-only-${crypto.randomUUID().slice(0, 8)}`,
      title: 'Test artwork', year: 2024, medium: 'Oil', dimensions: '40 x 50 cm',
      image: '/images/artwork/test-artwork.jpg',
    };
    const issueForm = (uid: string, reason?: string) => {
      const form = new FormData();
      form.append('request', JSON.stringify({ artwork, certificateType: 'original', nfcTagUid: uid, ...(reason ? { reason } : {}) }));
      form.append('originalImage', new File(['image'], 'artwork.jpg', { type: 'image/jpeg' }));
      return form;
    };
    const issued = await worker.fetch(new Request('https://certificates.test/api/admin/certificates/issue', {
      method: 'POST', headers, body: issueForm(' 04:8B:22:25 '),
    }), authorizedEnv);
    expect(issued.status).toBe(201);
    const { certificate } = await issued.json() as { certificate: {
      id: string; version_id: string; verification_token: string; snapshot: { nfcTagUid: string; artworkCode?: string };
    } };
    expect(certificate.snapshot.nfcTagUid).toBe('04:8B:22:25');
    expect(certificate.snapshot.artworkCode).toBeUndefined();
    const pdf = new FormData();
    pdf.append('certificatePdf', new File(['%PDF-1.7\nfixture\n%%EOF'], 'certificate.pdf', { type: 'application/pdf' }));
    const finalized = await worker.fetch(new Request(
      `https://certificates.test/api/admin/certificates/${certificate.id}/versions/${certificate.version_id}/finalize`,
      { method: 'POST', headers, body: pdf },
    ), authorizedEnv);
    expect(finalized.status).toBe(200);
    const tags = await worker.fetch(new Request(
      `https://certificates.test/api/admin/certificates/${certificate.id}/tags`,
      { headers },
    ), authorizedEnv);
    expect((await tags.json() as { tags: unknown[] }).tags).toEqual([]);

    await env.DB.prepare(
      `INSERT INTO artwork_codes (id, artwork_slug, artwork_code, type, status, created_at)
       VALUES (?, ?, ?, 'O', 'active', ?)`,
    ).bind(crypto.randomUUID(), artwork.slug, 'VL-O-A1988', new Date().toISOString()).run();
    const reissued = await worker.fetch(new Request(
      `https://certificates.test/api/admin/certificates/${certificate.id}/reissue`,
      { method: 'POST', headers, body: issueForm('04:8B:22:26', 'Updated NFC UID') },
    ), authorizedEnv);
    expect(reissued.status).toBe(201);
    const { certificate: next } = await reissued.json() as { certificate: {
      version_id: string; snapshot: { nfcTagUid: string; artworkCode?: string };
    } };
    expect(next.snapshot.nfcTagUid).toBe('04:8B:22:26');
    expect(next.snapshot.artworkCode).toBeUndefined();
    const old = await env.DB.prepare('SELECT snapshot_json, status FROM certificate_versions WHERE id = ?')
      .bind(certificate.version_id).first<{ snapshot_json: string; status: string }>();
    expect(old?.status).toBe('valid');
    expect(JSON.parse(old!.snapshot_json).nfcTagUid).toBe('04:8B:22:25');
  } finally {
    vi.unstubAllGlobals();
  }
});
