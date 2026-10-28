import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import worker, { certificateTypes, validateIssueRequest } from '../src';
import type { Env } from '../src/types';

const artwork = {
  slug: 'test-artwork',
  title: 'Test artwork',
  year: 2024,
  medium: 'Oil',
  dimensions: '40 x 50 cm',
  image: '/images/artwork/test-artwork.jpg',
};

function certificateValues(type: string, slug: string, editionNumber: number | null, editionSize: number | null) {
  const suffix = crypto.randomUUID();
  return [
    suffix,
    type,
    `VL-${suffix}`,
    `token-${suffix}`,
    slug,
    editionNumber,
    editionSize,
    'valid',
    new Date().toISOString(),
  ];
}

describe('certificate requests', () => {
  it('accepts a valid original certificate request', () => {
    const request = validateIssueRequest({ artwork, certificateType: 'original' });
    expect(request.certificateType).toBe('original');
    expect(request.artwork.title).toBe(artwork.title);
    expect(certificateTypes.original.uniquePerArtwork).toBe(true);
  });

  it('rejects invalid edition numbers, mismatched types, and unsafe image paths', () => {
    expect(() => validateIssueRequest({
      artwork,
      certificateType: 'limited_edition',
      editionNumber: 0,
      editionSize: 5,
    })).toThrow('Limited editions require');
    expect(() => validateIssueRequest({
      artwork: { ...artwork, editionType: 'limited' },
      certificateType: 'original',
    })).toThrow('Certificate type must match');
    expect(() => validateIssueRequest({
      artwork: { ...artwork, image: '/images/artwork/../private.jpg' },
      certificateType: 'original',
    })).toThrow('artwork image path is invalid');
    expect(() => validateIssueRequest({
      artwork: { ...artwork, editionType: 'limited', editionSize: 10 },
      certificateType: 'limited_edition',
      editionNumber: 1,
      editionSize: 9,
    })).toThrow('Limited edition size must match');
  });

  it('denies admin API calls without a GitHub access token', async () => {
    const response = await worker.fetch(
      new Request('https://certificates.test/api/admin/certificates'),
      env,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Not authorized.' });
  });

  it('issues a pending certificate, finalizes its PDF, and verifies its integrity', async () => {
    const authorizedEnv = Object.assign(Object.create(env), {
      ALLOWED_GITHUB_USER_ID: '12345',
    }) as Env;
    const githubFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/user')) {
        return Response.json({ id: 12345 });
      }
      return Response.json({ permissions: { push: true } });
    });
    vi.stubGlobal('fetch', githubFetch);
    try {
      const headers = {
        Authorization: 'Bearer test-github-token',
        Origin: 'https://vlement.com',
      };
      const formData = new FormData();
      formData.append('request', JSON.stringify({ artwork, certificateType: 'original' }));
      formData.append('originalImage', new File(['image-bytes'], 'artwork.jpg', { type: 'image/jpeg' }));
      const issueResponse = await worker.fetch(new Request(
        'https://certificates.test/api/admin/certificates/issue',
        { method: 'POST', headers, body: formData },
      ), authorizedEnv);
      expect(issueResponse.status).toBe(201);
      const { certificate } = await issueResponse.json() as { certificate: {
        id: string;
        version_id: string;
        certificate_number: string;
        verification_token: string;
        verificationUrl: string;
        version_status: string;
        snapshot: { title: string };
      } };
      expect(certificate.version_status).toBe('pending');
      expect(certificate.snapshot.title).toBe(artwork.title);

      const pendingResponse = await worker.fetch(new Request(
        `https://certificates.test/api/verify?t=${certificate.verification_token}`,
      ), authorizedEnv);
      expect((await pendingResponse.json() as { status: string }).status).toBe('pending');

      const pdfForm = new FormData();
      pdfForm.append('certificatePdf', new File(['%PDF-1.7\ncertificate\n%%EOF'], 'certificate.pdf', {
        type: 'application/pdf',
      }));
      const finalizeResponse = await worker.fetch(new Request(
        `https://certificates.test/api/admin/certificates/${certificate.id}/versions/${certificate.version_id}/finalize`,
        { method: 'POST', headers, body: pdfForm },
      ), authorizedEnv);
      expect(finalizeResponse.status).toBe(200);

      const validResponse = await worker.fetch(new Request(
        `https://certificates.test/api/verify?t=${certificate.verification_token}`,
      ), authorizedEnv);
      const verification = await validResponse.json() as {
        status: string;
        certificateNumber: string;
        artwork: { title: string };
        pdf: string;
      };
      expect(verification.status).toBe('valid');
      expect(verification.certificateNumber).toBe(certificate.certificate_number);
      expect(verification.artwork.title).toBe(artwork.title);
      expect(verification.pdf).toContain('/api/verify/pdf?t=');

      const pdfResponse = await worker.fetch(new Request(
        `https://certificates.test/api/verify/pdf?t=${certificate.verification_token}`,
      ), authorizedEnv);
      expect(pdfResponse.status).toBe(200);
      expect(pdfResponse.headers.get('Content-Type')).toBe('application/pdf');
      expect(new TextDecoder().decode(await pdfResponse.arrayBuffer())).toContain('certificate');

      const reissueForm = new FormData();
      reissueForm.append('request', JSON.stringify({
        artwork,
        certificateType: 'original',
        reason: 'Corrected certificate details',
      }));
      reissueForm.append('originalImage', new File(['replacement-image'], 'artwork.jpg', {
        type: 'image/jpeg',
      }));
      const reissueResponse = await worker.fetch(new Request(
        `https://certificates.test/api/admin/certificates/${certificate.id}/reissue`,
        { method: 'POST', headers, body: reissueForm },
      ), authorizedEnv);
      expect(reissueResponse.status).toBe(201);
      const { certificate: pendingReissue } = await reissueResponse.json() as {
        certificate: { version_id: string; version_number: number; verification_token: string };
      };
      expect(pendingReissue.version_number).toBe(2);
      const beforeReissue = await worker.fetch(new Request(
        `https://certificates.test/api/verify?t=${pendingReissue.verification_token}`,
      ), authorizedEnv);
      expect((await beforeReissue.json() as { version: number }).version).toBe(1);

      const reissuePdf = new FormData();
      reissuePdf.append('certificatePdf', new File(['%PDF-1.7\nreissue\n%%EOF'], 'certificate.pdf', {
        type: 'application/pdf',
      }));
      const finalizeReissue = await worker.fetch(new Request(
        `https://certificates.test/api/admin/certificates/${certificate.id}/versions/${pendingReissue.version_id}/finalize`,
        { method: 'POST', headers, body: reissuePdf },
      ), authorizedEnv);
      expect(finalizeReissue.status).toBe(200);
      const afterReissue = await worker.fetch(new Request(
        `https://certificates.test/api/verify?t=${pendingReissue.verification_token}`,
      ), authorizedEnv);
      expect((await afterReissue.json() as { version: number }).version).toBe(2);
      const historyResponse = await worker.fetch(new Request(
        `https://certificates.test/api/admin/certificates/${certificate.id}/versions`,
        { headers },
      ), authorizedEnv);
      expect(historyResponse.status).toBe(200);
      expect((await historyResponse.json() as {
        versions: Array<{ version_number: number; reissue_reason: string | null }>;
      }).versions.map(version => [version.version_number, version.reissue_reason])).toEqual([
        [2, 'Corrected certificate details'],
        [1, null],
      ]);

      const tagsPath = `/api/admin/certificates/${certificate.id}/tags`;
      const tagResponse = await worker.fetch(new Request(
        `https://certificates.test${tagsPath}`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ tagReference: '04:AB:CD:01', placement: 'Reverse lower edge' }),
        },
      ), authorizedEnv);
      expect(tagResponse.status).toBe(201);
      const tag = await tagResponse.json() as { id: string; tagReference: string };
      expect(tag.tagReference).toBe('04:AB:CD:01');
      const testTag = await worker.fetch(new Request(
        `https://certificates.test${tagsPath}/${tag.id}/test`,
        { method: 'POST', headers, body: '{}' },
      ), authorizedEnv);
      expect(testTag.status).toBe(200);
      const replaceTag = await worker.fetch(new Request(
        `https://certificates.test${tagsPath}/${tag.id}/replace`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ tagReference: '04:AB:CD:02', placement: 'Reverse upper edge' }),
        },
      ), authorizedEnv);
      expect(replaceTag.status).toBe(201);
      const replacement = await replaceTag.json() as { id: string };
      const revokeTag = await worker.fetch(new Request(
        `https://certificates.test${tagsPath}/${replacement.id}/revoke`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Test tag revoke' }),
        },
      ), authorizedEnv);
      expect(revokeTag.status).toBe(200);

      const revokeResponse = await worker.fetch(new Request(
        `https://certificates.test/api/admin/certificates/${certificate.id}/revoke`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Test revocation' }),
        },
      ), authorizedEnv);
      expect(revokeResponse.status).toBe(200);
      const revoked = await worker.fetch(new Request(
        `https://certificates.test/api/verify?t=${pendingReissue.verification_token}`,
      ), authorizedEnv);
      expect((await revoked.json() as { status: string }).status).toBe('revoked');

      const backupResponse = await worker.fetch(new Request(
        'https://certificates.test/api/admin/backup',
        { method: 'POST', headers },
      ), authorizedEnv);
      expect(backupResponse.status).toBe(200);
      const backup = await backupResponse.json() as {
        backupId: string;
        objects: Array<{ key: string }>;
        snapshot: { tables: { certificates: unknown[]; nfcTags: unknown[] } };
      };
      expect(backup.snapshot.tables.certificates).toHaveLength(1);
      expect(backup.snapshot.tables.nfcTags).toHaveLength(2);
      expect(backup.objects.length).toBeGreaterThanOrEqual(3);
      const firstObject = await worker.fetch(new Request(
        `https://certificates.test/api/admin/backup/file?key=${encodeURIComponent(backup.objects[0].key)}`,
        { headers },
      ), authorizedEnv);
      expect(firstObject.status).toBe(200);
      const completeBackup = await worker.fetch(new Request(
        `https://certificates.test/api/admin/backup/${backup.backupId}/complete`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sha256: 'a'.repeat(64), objectCount: backup.objects.length }),
        },
      ), authorizedEnv);
      expect(completeBackup.status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('voids a pending limited edition without reusing its edition number', async () => {
    const authorizedEnv = Object.assign(Object.create(env), {
      ALLOWED_GITHUB_USER_ID: '12345',
    }) as Env;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/user')
        ? Response.json({ id: 12345 })
        : Response.json({ permissions: { push: true } })));
    try {
      const slug = `limited-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const limitedArtwork = { ...artwork, slug, editionType: 'limited', editionSize: 5 };
      const issue = async () => {
        const formData = new FormData();
        formData.append('request', JSON.stringify({
          artwork: limitedArtwork,
          certificateType: 'limited_edition',
          editionNumber: 1,
          editionSize: 5,
        }));
        formData.append('originalImage', new File(['image'], 'artwork.jpg', { type: 'image/jpeg' }));
        return worker.fetch(new Request('https://certificates.test/api/admin/certificates/issue', {
          method: 'POST',
          headers: { Authorization: 'Bearer another-test-token', Origin: 'https://vlement.com' },
          body: formData,
        }), authorizedEnv);
      };
      const response = await issue();
      expect(response.status).toBe(201);
      const { certificate } = await response.json() as {
        certificate: { id: string; version_id: string };
      };
      const voidResponse = await worker.fetch(new Request(
        `https://certificates.test/api/admin/certificates/${certificate.id}/versions/${certificate.version_id}/void`,
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer another-test-token',
            Origin: 'https://vlement.com',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reason: 'Test void' }),
        },
      ), authorizedEnv);
      expect(voidResponse.status).toBe(200);
      expect((await issue()).status).toBe(409);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('D1 certificate constraints', () => {
  it('does not present an unfinalized issue as valid publicly', async () => {
    const certificateId = crypto.randomUUID();
    const verificationToken = crypto.randomUUID().replaceAll('-', '').padEnd(43, 'x').slice(0, 43);
    const versionId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO certificates
       (id, certificate_type, certificate_number, verification_token, artwork_slug,
        edition_number, edition_size, status, created_at)
       VALUES (?, 'original', ?, ?, ?, NULL, NULL, 'pending', ?)`,
    ).bind(certificateId, `VL-${certificateId}`, verificationToken, `pending-${certificateId}`, now).run();
    await env.DB.prepare(
      `INSERT INTO certificate_versions
       (id, certificate_id, version_number, issued_at, snapshot_json, original_image_path, status, created_at)
       VALUES (?, ?, 1, ?, ?, 'test/pending.jpg', 'pending', ?)`,
    ).bind(versionId, certificateId, now, JSON.stringify(artwork), now).run();

    const response = await worker.fetch(
      new Request(`https://certificates.test/api/verify?t=${verificationToken}`),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'pending',
      certificateNumber: `VL-${certificateId}`,
    });
  });

  it('allocates unique consecutive counter values under concurrent writes', async () => {
    const year = 2100;
    const next = () => env.DB.batch([
      env.DB.prepare(
        'INSERT OR IGNORE INTO counters (certificate_type, year, value) VALUES (?, ?, 0)',
      ).bind('open_edition', year),
      env.DB.prepare(
        'UPDATE counters SET value = value + 1 WHERE certificate_type = ? AND year = ? RETURNING value',
      ).bind('open_edition', year),
    ]).then(results => {
      const row = results[1].results[0] as { value: number } | undefined;
      if (!row) throw new Error('D1 did not return the incremented counter.');
      return Number(row.value);
    });

    const values = await Promise.all(Array.from({ length: 12 }, next));
    expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it('enforces one original per artwork and an immutable limited-edition size', async () => {
    const originalSlug = `original-${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO certificates
       (id, certificate_type, certificate_number, verification_token, artwork_slug,
        edition_number, edition_size, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(...certificateValues('original', originalSlug, null, null)).run();

    await expect(env.DB.prepare(
      `INSERT INTO certificates
       (id, certificate_type, certificate_number, verification_token, artwork_slug,
        edition_number, edition_size, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(...certificateValues('original', originalSlug, null, null)).run()).rejects.toThrow();

    const limitedSlug = `limited-${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO certificates
       (id, certificate_type, certificate_number, verification_token, artwork_slug,
        edition_number, edition_size, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(...certificateValues('limited_edition', limitedSlug, 1, 5)).run();

    await expect(env.DB.prepare(
      `INSERT INTO certificates
       (id, certificate_type, certificate_number, verification_token, artwork_slug,
        edition_number, edition_size, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(...certificateValues('limited_edition', limitedSlug, 2, 6)).run()).rejects.toThrow(
      'limited edition size cannot change',
    );
  });

  it('keeps certificate snapshots immutable and allows only one pending version', async () => {
    const [certificateId] = certificateValues('open_edition', `version-${crypto.randomUUID()}`, null, null);
    const versionId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO certificates
       (id, certificate_type, certificate_number, verification_token, artwork_slug,
        edition_number, edition_size, status, created_at)
       VALUES (?, 'open_edition', ?, ?, ?, NULL, NULL, 'valid', ?)`,
    ).bind(certificateId, `VL-${certificateId}`, `token-${certificateId}`, `version-${certificateId}`, now).run();
    await env.DB.prepare(
      `INSERT INTO certificate_versions
       (id, certificate_id, version_number, issued_at, snapshot_json, original_image_path, status, created_at)
       VALUES (?, ?, 1, ?, '{}', 'test/image.jpg', 'pending', ?)`,
    ).bind(versionId, certificateId, now, now).run();

    await expect(env.DB.prepare(
      'UPDATE certificate_versions SET snapshot_json = ? WHERE id = ?',
    ).bind('{"changed":true}', versionId).run()).rejects.toThrow('snapshots are immutable');
    await expect(env.DB.prepare(
      `INSERT INTO certificate_versions
       (id, certificate_id, version_number, issued_at, snapshot_json, original_image_path, status, created_at)
       VALUES (?, ?, 2, ?, '{}', 'test/image-2.jpg', 'pending', ?)`,
    ).bind(crypto.randomUUID(), certificateId, now, now).run()).rejects.toThrow();
  });
});
