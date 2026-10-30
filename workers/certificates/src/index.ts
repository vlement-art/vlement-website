import certificateConfig from '../../../shared/certificate-config.json';
import type { CertificateType, Env, IssueRequest } from './types';
import { D1BackupWorkflow } from './backup-workflow';
export { D1BackupWorkflow };

const certificateTypes = certificateConfig.certificateTypes as Record<
  CertificateType,
  {
    prefix: string;
    requiresEdition: boolean;
    uniquePerArtwork: boolean;
    nfcDefault: boolean;
    pdfTitle: string;
    pdfWording: string;
    editionBlock: string | null;
  }
>;
const identityCache = new Map<string, { expiresAt: number; allowed: boolean }>();
const maxImageBytes = 8 * 1024 * 1024;
const allowedTypes = new Set(Object.keys(certificateTypes));

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      ...headers,
    },
  });
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
  });
  if (request.headers.get('Origin') === env.ALLOWED_ORIGIN) {
    headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN);
  }
  return headers;
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  corsHeaders(request, env).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, headers });
}

function errorResponse(
  request: Request,
  env: Env,
  status: number,
  message: string,
): Response {
  return withCors(jsonResponse({ error: message }, status), request, env);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Bytes(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', value);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const authorization = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match || !/^\d+$/.test(env.ALLOWED_GITHUB_USER_ID || '')) return false;

  const githubToken = match[1];
  const tokenHash = await sha256(githubToken);
  const cached = identityCache.get(tokenHash);
  if (cached && cached.expiresAt > Date.now()) return cached.allowed;

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${githubToken}`,
    'User-Agent': 'Vlement-Certificates',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  let userResponse: Response;
  let repositoryResponse: Response;
  try {
    [userResponse, repositoryResponse] = await Promise.all([
      fetch('https://api.github.com/user', { headers, cache: 'no-store' }),
      fetch(`https://api.github.com/repos/${env.ARTWORK_REPOSITORY}`, { headers, cache: 'no-store' }),
    ]);
  } catch {
    throw new Error('GitHub authorization could not be verified.');
  }
  if ([401, 403, 404].includes(userResponse.status) || [401, 403, 404].includes(repositoryResponse.status)) {
    return false;
  }
  if (!userResponse.ok || !repositoryResponse.ok) {
    throw new Error('GitHub authorization could not be verified.');
  }

  const [user, repository] = await Promise.all([
    userResponse.json() as Promise<{ id?: number }>,
    repositoryResponse.json() as Promise<{ permissions?: { push?: boolean } }>,
  ]);
  const allowed = String(user.id) === env.ALLOWED_GITHUB_USER_ID && repository.permissions?.push === true;
  identityCache.set(tokenHash, { expiresAt: Date.now() + 60_000, allowed });
  if (identityCache.size > 100) {
    const oldestHash = identityCache.keys().next().value;
    if (oldestHash) identityCache.delete(oldestHash);
  }
  return allowed;
}

function requiredText(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`Enter a valid ${field}.`);
  }
  return value.trim();
}

function validateIssueRequest(input: unknown): IssueRequest {
  if (!input || typeof input !== 'object') throw new Error('Invalid certificate request.');
  const candidate = input as Partial<IssueRequest>;
  if (!candidate.artwork || typeof candidate.artwork !== 'object') {
    throw new Error('Choose an artwork before issuing a certificate.');
  }
  if (!allowedTypes.has(candidate.certificateType || '')) {
    throw new Error('Choose a valid certificate type.');
  }

  const artwork = candidate.artwork;
  const slug = requiredText(artwork.slug, 'artwork ID', 120);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('The artwork ID is invalid.');
  const year = Number(artwork.year);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) throw new Error('The artwork year is invalid.');
  const image = requiredText(artwork.image, 'artwork image path', 500);
  if (!image.startsWith('/images/artwork/') || image.includes('..')) {
    throw new Error('The artwork image path is invalid.');
  }
  if (artwork.editionType != null && !['original', 'limited', 'open'].includes(artwork.editionType)) {
    throw new Error('Choose a valid artwork edition type.');
  }
  if (artwork.editionSize != null
    && (!Number.isInteger(artwork.editionSize) || Number(artwork.editionSize) < 1)) {
    throw new Error('Enter a valid artwork edition size.');
  }

  const normalized: IssueRequest = {
    certificateType: candidate.certificateType!,
    artwork: {
      slug,
      title: requiredText(artwork.title, 'artwork title'),
      year,
      medium: requiredText(artwork.medium, 'medium'),
      dimensions: requiredText(artwork.dimensions, 'dimensions'),
      image,
      ...(typeof artwork.support === 'string' && artwork.support.trim()
        ? { support: artwork.support.trim().slice(0, 200) }
        : {}),
      ...(typeof artwork.printDate === 'string' && artwork.printDate.trim()
        ? { printDate: artwork.printDate.trim().slice(0, 100) }
        : {}),
      ...(typeof artwork.signed === 'boolean' ? { signed: artwork.signed } : {}),
      ...(typeof artwork.editionType === 'string' ? { editionType: artwork.editionType } : {}),
      ...(Number.isInteger(artwork.editionSize) ? { editionSize: Number(artwork.editionSize) } : {}),
      ...(typeof artwork.altText === 'string' ? { altText: artwork.altText.slice(0, 1000) } : {}),
    },
  };

  const expectedType = normalized.artwork.editionType
    ? {
      original: 'original',
      limited: 'limited_edition',
      open: 'open_edition',
    }[normalized.artwork.editionType]
    : undefined;
  if (expectedType && expectedType !== normalized.certificateType) {
    throw new Error('Certificate type must match the artwork edition type.');
  }

  if (certificateTypes[normalized.certificateType].requiresEdition) {
    const editionNumber = Number(candidate.editionNumber);
    const editionSize = Number(candidate.editionSize ?? artwork.editionSize);
    if (!Number.isInteger(editionNumber) || !Number.isInteger(editionSize)
      || editionNumber < 1 || editionSize < 1 || editionNumber > editionSize) {
      throw new Error('Limited editions require an edition number between 1 and the edition size.');
    }
    normalized.editionNumber = editionNumber;
    normalized.editionSize = editionSize;
    if (normalized.artwork.editionSize != null && normalized.artwork.editionSize !== editionSize) {
      throw new Error('Limited edition size must match the artwork record.');
    }
  } else if (candidate.editionNumber != null || candidate.editionSize != null) {
    throw new Error('Edition number and size are only used for limited edition certificates.');
  }
  return normalized;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function extensionFor(file: File): string {
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
  };
  return extensions[file.type] || '';
}

async function parseImage(formData: FormData): Promise<File> {
  const image = formData.get('originalImage');
  if (!(image instanceof File) || !image.size || image.size > maxImageBytes || !extensionFor(image)) {
    throw new Error('Upload an artwork image in JPEG, PNG, WebP or AVIF format (up to 8 MB).');
  }
  return image;
}

async function parsePdf(formData: FormData): Promise<{ file: File; bytes: ArrayBuffer }> {
  const file = formData.get('certificatePdf');
  if (!(file instanceof File) || !file.size || file.size > 12 * 1024 * 1024) {
    throw new Error('Upload a certificate PDF (up to 12 MB).');
  }
  const bytes = await file.arrayBuffer();
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') {
    throw new Error('The certificate file is not a valid PDF.');
  }
  return { file, bytes };
}

async function createPendingVersion(
  env: Env,
  request: IssueRequest,
  image: File,
  reissue?: { certificateId: string; reason: string },
): Promise<Record<string, unknown>> {
  const id = reissue?.certificateId || crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const token = reissue ? null : randomToken();
  const versionNumber = reissue
    ? Number((await env.DB.prepare(
      'SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM certificate_versions WHERE certificate_id = ?',
    ).bind(id).first<{ next_version: number }>())?.next_version || 0)
    : 1;
  if (!versionNumber) throw new Error('Could not allocate a certificate version.');

  const now = new Date().toISOString();
  const year = new Date(now).getUTCFullYear();
  const type = certificateTypes[request.certificateType];
  const prefix = type.prefix;
  const originalImagePath = `certificates/${id}/v${versionNumber}/artwork-original.${extensionFor(image)}`;
  const snapshot = {
    ...request.artwork,
    artist: certificateConfig.artist,
    certificateType: request.certificateType,
    certificateTypeTitle: type.pdfTitle,
    certificateWording: type.pdfWording,
    nfcSuggested: type.nfcDefault,
    ...(request.certificateType === 'limited_edition'
      ? { editionNumber: request.editionNumber, editionSize: request.editionSize }
      : request.certificateType === 'open_edition'
        ? { editionStatement: 'Open edition, no limit on quantity' }
        : {}),
  };

  await env.CERTIFICATE_FILES.put(originalImagePath, image.stream(), {
    httpMetadata: { contentType: image.type },
    customMetadata: { certificateId: id, versionNumber: String(versionNumber) },
  });

  try {
    if (reissue) {
      const current = await env.DB.prepare(
        `SELECT c.certificate_type, c.artwork_slug, c.edition_number, c.edition_size,
                v.id AS previous_version_id
           FROM certificates c
           LEFT JOIN certificate_versions v
             ON v.certificate_id = c.id AND v.status = 'valid'
          WHERE c.id = ? AND c.status = 'valid'`,
      ).bind(id).first<{
        certificate_type: CertificateType;
        artwork_slug: string;
        edition_number: number | null;
        edition_size: number | null;
        previous_version_id: string | null;
      }>();
      if (!current) throw new Error('Certificate not found or revoked.');
      if (current.certificate_type !== request.certificateType
        || current.artwork_slug !== request.artwork.slug
        || current.edition_number !== (request.editionNumber ?? null)
        || current.edition_size !== (request.editionSize ?? null)) {
        throw new Error('Reissue details must retain the certificate type, artwork and edition.');
      }

      const result = await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO certificate_versions
            (id, certificate_id, version_number, issued_at, snapshot_json, original_image_path,
             reissue_reason, previous_version_id, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        ).bind(
          versionId, id, versionNumber, now, JSON.stringify(snapshot), originalImagePath,
          reissue.reason, current.previous_version_id, now,
        ),
        env.DB.prepare(
          `INSERT INTO certificate_events (id, certificate_id, event_type, occurred_at, details_json)
           VALUES (?, ?, 'reissue_pending', ?, ?)`,
        ).bind(crypto.randomUUID(), id, now, JSON.stringify({ versionNumber, reason: reissue.reason, status: 'pending' })),
      ]);
      if (result.some(item => !item.success)) throw new Error('Could not create the pending reissue.');
    } else {
      const counterInit = env.DB.prepare(
        'INSERT OR IGNORE INTO counters (certificate_type, year, value) VALUES (?, ?, 0)',
      ).bind(request.certificateType, year);
      const counterIncrement = env.DB.prepare(
        `UPDATE counters SET value = value + 1
          WHERE certificate_type = ? AND year = ?
          RETURNING value`,
      ).bind(request.certificateType, year);
      const insertCertificate = env.DB.prepare(
        `INSERT INTO certificates
           (id, certificate_type, certificate_number, verification_token, artwork_slug,
            edition_number, edition_size, status, created_at)
         SELECT ?, ?, printf('VL-%s-%04d-%04d', ?, ?, value), ?, ?,
                ?, ?, 'pending', ?
           FROM counters WHERE certificate_type = ? AND year = ?`,
      ).bind(
        id, request.certificateType, prefix, year, token, request.artwork.slug,
        request.editionNumber ?? null, request.editionSize ?? null, now,
        request.certificateType, year,
      );
      const insertVersion = env.DB.prepare(
        `INSERT INTO certificate_versions
          (id, certificate_id, version_number, issued_at, snapshot_json, original_image_path, status, created_at)
         VALUES (?, ?, 1, ?, ?, ?, 'pending', ?)`,
      ).bind(versionId, id, now, JSON.stringify(snapshot), originalImagePath, now);
      const event = env.DB.prepare(
        `INSERT INTO certificate_events (id, certificate_id, event_type, occurred_at, details_json)
         VALUES (?, ?, 'issue_pending', ?, ?)`,
      ).bind(crypto.randomUUID(), id, now, JSON.stringify({ versionNumber: 1, status: 'pending' }));

      const results = await env.DB.batch([counterInit, counterIncrement, insertCertificate, insertVersion, event]);
      if (results.some(result => !result.success)) throw new Error('Could not create the pending certificate.');
    }

  } catch (error) {
    await env.CERTIFICATE_FILES.delete(originalImagePath);
    throw error;
  }

  const record = await env.DB.prepare(
    `SELECT c.id, c.certificate_type, c.certificate_number, c.verification_token, c.artwork_slug,
            c.edition_number, c.edition_size, c.status, v.id AS version_id, v.version_number, v.snapshot_json,
            v.original_image_path, v.status AS version_status
       FROM certificates c JOIN certificate_versions v ON v.id = ?
      WHERE c.id = ?`,
  ).bind(versionId, id).first<Record<string, unknown>>();
  if (!record) throw new Error('The certificate was saved but could not be loaded.');
  return {
    ...record,
    snapshot: JSON.parse(String(record.snapshot_json)),
    verificationUrl: `${certificateConfig.canonicalOrigin}/verify/?t=${encodeURIComponent(String(record.verification_token))}`,
  };
}

async function adminRoute(request: Request, env: Env, path: string): Promise<Response> {
  if (!await isAuthorized(request, env)) return jsonResponse({ error: 'Not authorized.' }, 403);

  const tagsMatch = /^\/api\/admin\/certificates\/([0-9a-f-]+)\/tags$/i.exec(path);
  const versionsMatch = /^\/api\/admin\/certificates\/([0-9a-f-]+)\/versions$/i.exec(path);
  if (request.method === 'GET' && versionsMatch) {
    const { results } = await env.DB.prepare(
      `SELECT id, version_number, issued_at, snapshot_json, original_image_path, web_image_path,
              pdf_path, pdf_sha256, reissue_reason, previous_version_id, status, created_at
         FROM certificate_versions
        WHERE certificate_id = ? ORDER BY version_number DESC`,
    ).bind(versionsMatch[1]).all<Record<string, unknown>>();
    return jsonResponse({
      versions: results.map(record => ({
        ...record,
        snapshot: JSON.parse(String(record.snapshot_json)),
      })),
    });
  }

  if (request.method === 'GET' && tagsMatch) {
    const certificate = await env.DB.prepare(
      'SELECT certificate_number, verification_token FROM certificates WHERE id = ?',
    ).bind(tagsMatch[1]).first<{ certificate_number: string; verification_token: string }>();
    if (!certificate) return jsonResponse({ error: 'Certificate not found.' }, 404);
    const { results } = await env.DB.prepare(
      `SELECT id, tag_reference, placement, registered_at, status, tested, replaced_tag_id
         FROM nfc_tags WHERE certificate_id = ? ORDER BY registered_at DESC`,
    ).bind(tagsMatch[1]).all<Record<string, unknown>>();
    return jsonResponse({
      tags: results,
      verificationUrl: `${certificateConfig.canonicalOrigin}/verify/?t=${encodeURIComponent(certificate.verification_token)}`,
    });
  }

  if (request.method === 'POST' && tagsMatch) {
    const body = parseJson(await request.text()) as { tagReference?: unknown; placement?: unknown };
    const tagReference = requiredText(body.tagReference, 'NFC tag reference', 120);
    if (!/^[A-Za-z0-9._:-]+$/.test(tagReference)) {
      throw new Error('Enter an NFC tag reference using letters, numbers, dots, colons, dashes or underscores.');
    }
    const placement = requiredText(body.placement, 'NFC tag placement', 200);
    const tagId = crypto.randomUUID();
    const now = new Date().toISOString();
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO nfc_tags (id, certificate_id, tag_reference, placement, registered_at, status, tested)
         SELECT ?, c.id, ?, ?, ?, 'active', 0 FROM certificates c
          WHERE c.id = ? AND c.status = 'valid'
            AND EXISTS (
              SELECT 1 FROM certificate_versions
               WHERE certificate_id = c.id AND status = 'valid'
            )`,
      ).bind(tagId, tagReference, placement, now, tagsMatch[1]),
      env.DB.prepare(
        `INSERT INTO certificate_events (id, certificate_id, event_type, occurred_at, details_json)
         SELECT ?, certificate_id, 'tag_registered', ?, ? FROM nfc_tags WHERE id = ?`,
      ).bind(crypto.randomUUID(), now, JSON.stringify({ tagId, tagReference, placement }), tagId),
    ]);
    if (!results[0].meta.changes) return jsonResponse({ error: 'Certificate not found or not valid yet.' }, 409);
    return jsonResponse({ id: tagId, tagReference, placement, status: 'active', tested: false }, 201);
  }

  const tagActionMatch = /^\/api\/admin\/certificates\/([0-9a-f-]+)\/tags\/([0-9a-f-]+)\/(test|replace|revoke)$/i.exec(path);
  if (request.method === 'POST' && tagActionMatch) {
    const [, certificateId, tagId, action] = tagActionMatch;
    const body = parseJson(await request.text()) as {
      tagReference?: unknown;
      placement?: unknown;
      reason?: unknown;
    };
    const now = new Date().toISOString();

    if (action === 'test') {
      const results = await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO certificate_events (id, certificate_id, event_type, occurred_at, details_json)
           SELECT ?, certificate_id, 'tag_tested', ?, ? FROM nfc_tags
            WHERE id = ? AND certificate_id = ? AND status = 'active'`,
        ).bind(crypto.randomUUID(), now, JSON.stringify({ tagId }), tagId, certificateId),
        env.DB.prepare(
          `UPDATE nfc_tags SET tested = 1
            WHERE id = ? AND certificate_id = ? AND status = 'active'`,
        ).bind(tagId, certificateId),
      ]);
      if (!results[1].meta.changes) return jsonResponse({ error: 'Active NFC tag not found.' }, 404);
      return jsonResponse({ ok: true });
    }

    if (action === 'replace') {
      const tagReference = requiredText(body.tagReference, 'replacement NFC tag reference', 120);
      if (!/^[A-Za-z0-9._:-]+$/.test(tagReference)) {
        throw new Error('Enter an NFC tag reference using letters, numbers, dots, colons, dashes or underscores.');
      }
      const placement = requiredText(body.placement, 'replacement NFC tag placement', 200);
      const replacementId = crypto.randomUUID();
      const results = await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO nfc_tags
            (id, certificate_id, tag_reference, placement, registered_at, status, tested, replaced_tag_id)
           SELECT ?, old.certificate_id, ?, ?, ?, 'active', 0, old.id
             FROM nfc_tags old JOIN certificates c ON c.id = old.certificate_id
            WHERE old.id = ? AND old.certificate_id = ? AND old.status = 'active' AND c.status = 'valid'`,
        ).bind(replacementId, tagReference, placement, now, tagId, certificateId),
        env.DB.prepare(
          `UPDATE nfc_tags SET status = 'revoked'
            WHERE id = ? AND certificate_id = ? AND status = 'active'
              AND EXISTS (SELECT 1 FROM certificates WHERE id = ? AND status = 'valid')`,
        ).bind(tagId, certificateId, certificateId),
        env.DB.prepare(
          `INSERT INTO certificate_events (id, certificate_id, event_type, occurred_at, details_json)
           SELECT ?, certificate_id, 'tag_replaced', ?, ? FROM nfc_tags WHERE id = ?`,
        ).bind(
          crypto.randomUUID(), now,
          JSON.stringify({ previousTagId: tagId, replacementTagId: replacementId, tagReference, placement }),
          replacementId,
        ),
      ]);
      if (!results[0].meta.changes || !results[1].meta.changes) {
        return jsonResponse({ error: 'Active NFC tag not found or certificate is not valid.' }, 404);
      }
      return jsonResponse({ id: replacementId, tagReference, placement, status: 'active', tested: false }, 201);
    }

    const reason = requiredText(body.reason, 'tag revocation reason');
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO certificate_events (id, certificate_id, event_type, occurred_at, details_json)
         SELECT ?, certificate_id, 'tag_revoked', ?, ? FROM nfc_tags
          WHERE id = ? AND certificate_id = ? AND status = 'active'`,
      ).bind(crypto.randomUUID(), now, JSON.stringify({ tagId, reason }), tagId, certificateId),
      env.DB.prepare(
        `UPDATE nfc_tags SET status = 'revoked'
          WHERE id = ? AND certificate_id = ? AND status = 'active'`,
      ).bind(tagId, certificateId),
    ]);
    if (!results[1].meta.changes) return jsonResponse({ error: 'Active NFC tag not found.' }, 404);
    return jsonResponse({ ok: true });
  }

  if (request.method === 'POST' && path === '/api/admin/backup') {
    const backupId = crypto.randomUUID();
    const exportedAt = new Date().toISOString();
    const [counters, certificates, versions, tags, events] = await Promise.all([
      env.DB.prepare('SELECT * FROM counters ORDER BY certificate_type, year').all(),
      env.DB.prepare('SELECT * FROM certificates ORDER BY created_at, id').all(),
      env.DB.prepare('SELECT * FROM certificate_versions ORDER BY certificate_id, version_number').all(),
      env.DB.prepare('SELECT * FROM nfc_tags ORDER BY certificate_id, registered_at, id').all(),
      env.DB.prepare('SELECT * FROM certificate_events ORDER BY occurred_at, id').all(),
    ]);
    const objects: Array<{ key: string; size: number; etag: string; uploaded: Date }> = [];
    let cursor: string | undefined;
    do {
      const page = await env.CERTIFICATE_FILES.list({
        prefix: 'certificates/',
        limit: 1000,
        ...(cursor ? { cursor } : {}),
      });
      objects.push(...page.objects.map(object => ({
        key: object.key,
        size: object.size,
        etag: object.etag,
        uploaded: object.uploaded,
      })));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return jsonResponse({
      backupId,
      objects,
      snapshot: {
        format: 'vlement-certificates-backup-v1',
        exportedAt,
        tables: {
          counters: counters.results,
          certificates: certificates.results,
          versions: versions.results,
          nfcTags: tags.results,
          events: events.results,
        },
        objects,
      },
    });
  }

  const backupCompleteMatch = /^\/api\/admin\/backup\/([0-9a-f-]+)\/complete$/i.exec(path);
  if (request.method === 'POST' && backupCompleteMatch) {
    const body = parseJson(await request.text()) as { sha256?: unknown; objectCount?: unknown };
    const digest = requiredText(body.sha256, 'backup checksum', 64);
    if (!/^[a-f0-9]{64}$/i.test(digest)
      || !Number.isInteger(body.objectCount) || Number(body.objectCount) < 0) {
      throw new Error('Enter a valid backup checksum and object count.');
    }
    const backupId = backupCompleteMatch[1];
    const existing = await env.DB.prepare(
      `SELECT id FROM certificate_events
        WHERE event_type = 'backup_exported' AND json_extract(details_json, '$.backupId') = ?`,
    ).bind(backupId).first();
    if (existing) return jsonResponse({ ok: true });
    await env.DB.prepare(
      `INSERT INTO certificate_events (id, certificate_id, event_type, occurred_at, details_json)
       VALUES (?, NULL, 'backup_exported', ?, ?)`,
    ).bind(
      crypto.randomUUID(), new Date().toISOString(),
      JSON.stringify({ backupId, sha256: digest, objectCount: body.objectCount }),
    ).run();
    return jsonResponse({ ok: true });
  }

  if (request.method === 'GET' && path === '/api/admin/backup/file') {
    const key = new URL(request.url).searchParams.get('key') || '';
    if (!key.startsWith('certificates/') || key.split('/').includes('..')) {
      return jsonResponse({ error: 'Backup object path is invalid.' }, 400);
    }
    const object = await env.CERTIFICATE_FILES.get(key);
    if (!object) return jsonResponse({ error: 'Backup object not found.' }, 404);
    const filename = key.split('/').pop()?.replace(/[^a-zA-Z0-9._-]/g, '-') || 'backup-object';
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  if (request.method === 'GET' && path === '/api/admin/certificates') {
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.certificate_type, c.certificate_number, c.verification_token,
              c.artwork_slug, c.edition_number, c.edition_size, c.status, c.created_at,
              v.id AS version_id, v.version_number, v.status AS version_status, v.snapshot_json
         FROM certificates c
         JOIN certificate_versions v ON v.certificate_id = c.id
        WHERE v.version_number = (
          SELECT MAX(v2.version_number) FROM certificate_versions v2 WHERE v2.certificate_id = c.id
        )
        ORDER BY c.created_at DESC`,
    ).all<Record<string, unknown>>();
    return jsonResponse({
      certificates: results.map(record => ({
        ...record,
        snapshot: JSON.parse(String(record.snapshot_json)),
        verificationUrl: `${certificateConfig.canonicalOrigin}/verify/?t=${encodeURIComponent(String(record.verification_token))}`,
      })),
    });
  }

  const originalImageMatch = /^\/api\/admin\/certificates\/([0-9a-f-]+)\/versions\/([0-9a-f-]+)\/image$/i.exec(path);
  if (request.method === 'GET' && originalImageMatch) {
    const record = await env.DB.prepare(
      `SELECT original_image_path FROM certificate_versions
        WHERE id = ? AND certificate_id = ?`,
    ).bind(originalImageMatch[2], originalImageMatch[1]).first<{ original_image_path: string }>();
    if (!record) return jsonResponse({ error: 'Certificate version not found.' }, 404);
    const image = await env.CERTIFICATE_FILES.get(record.original_image_path);
    if (!image) return jsonResponse({ error: 'The saved artwork image is missing.' }, 404);
    return new Response(image.body, {
      headers: {
        'Content-Type': image.httpMetadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  if (request.method === 'POST' && path === '/api/admin/certificates/issue') {
    const formData = await request.formData();
    const input = parseJson(String(formData.get('request') || 'null'));
    const issue = validateIssueRequest(input);
    const image = await parseImage(formData);
    return jsonResponse({ certificate: await createPendingVersion(env, issue, image) }, 201);
  }

  const reissueMatch = /^\/api\/admin\/certificates\/([0-9a-f-]+)\/reissue$/i.exec(path);
  if (request.method === 'POST' && reissueMatch) {
    const formData = await request.formData();
    const requestBody = parseJson(String(formData.get('request') || 'null')) as IssueRequest & { reason?: unknown };
    const issue = validateIssueRequest(requestBody);
    const reason = requiredText(requestBody.reason, 'reissue reason');
    const image = await parseImage(formData);
    return jsonResponse({
      certificate: await createPendingVersion(env, issue, image, { certificateId: reissueMatch[1], reason }),
    }, 201);
  }

  const finalizeMatch = /^\/api\/admin\/certificates\/([0-9a-f-]+)\/versions\/([0-9a-f-]+)\/finalize$/i.exec(path);
  if (request.method === 'POST' && finalizeMatch) {
    const { file, bytes } = await parsePdf(await request.formData());
    const certificateId = finalizeMatch[1];
    const versionId = finalizeMatch[2];
    const pending = await env.DB.prepare(
      `SELECT c.status AS certificate_status, v.version_number, v.status AS version_status,
              v.pdf_sha256
         FROM certificates c
         JOIN certificate_versions v ON v.certificate_id = c.id
        WHERE c.id = ? AND v.id = ?`,
    ).bind(certificateId, versionId).first<{
      certificate_status: string;
      version_number: number;
      version_status: string;
      pdf_sha256: string | null;
    }>();
    if (!pending) {
      return jsonResponse({ error: 'Pending certificate version not found.' }, 404);
    }
    const digest = await sha256Bytes(bytes);
    if (pending.version_status === 'valid' && pending.pdf_sha256 === digest) {
      return jsonResponse({ ok: true, sha256: digest });
    }
    if (pending.version_status !== 'pending'
      || !['pending', 'valid'].includes(pending.certificate_status)) {
      return jsonResponse({ error: 'Pending certificate version not found.' }, 409);
    }

    const pdfPath = `certificates/${certificateId}/v${pending.version_number}/certificate-${digest}.pdf`;
    await env.CERTIFICATE_FILES.put(pdfPath, bytes, {
      httpMetadata: { contentType: 'application/pdf' },
      customMetadata: { certificateId, versionId, sha256: digest },
    });
    try {
      const now = new Date().toISOString();
      const results = await env.DB.batch([
        env.DB.prepare(
          `UPDATE certificate_versions SET status = 'superseded'
            WHERE certificate_id = ? AND status = 'valid'
              AND EXISTS (
                SELECT 1 FROM certificates
                 WHERE id = ? AND status IN ('pending', 'valid')
              )
              AND EXISTS (
                SELECT 1 FROM certificate_versions
                 WHERE id = ? AND certificate_id = ? AND status = 'pending'
              )`,
        ).bind(certificateId, certificateId, versionId, certificateId),
        env.DB.prepare(
          `UPDATE certificate_versions
              SET pdf_path = ?, pdf_sha256 = ?, status = 'valid', issued_at = ?
            WHERE id = ? AND certificate_id = ? AND status = 'pending'
              AND EXISTS (
                SELECT 1 FROM certificates
                 WHERE id = ? AND status IN ('pending', 'valid')
              )`,
        ).bind(pdfPath, digest, now, versionId, certificateId, certificateId),
        env.DB.prepare(
          `UPDATE certificates SET status = 'valid'
            WHERE id = ? AND status IN ('pending', 'valid')
              AND EXISTS (
                SELECT 1 FROM certificate_versions
                 WHERE id = ? AND certificate_id = ? AND status = 'valid' AND pdf_sha256 = ?
              )`,
        ).bind(certificateId, versionId, certificateId, digest),
        env.DB.prepare(
          `INSERT INTO certificate_events (id, certificate_id, event_type, occurred_at, details_json)
           SELECT ?, v.certificate_id,
                  CASE WHEN version_number = 1 THEN 'issued' ELSE 'reissued' END,
                  ?, ?
             FROM certificate_versions v JOIN certificates c ON c.id = v.certificate_id
            WHERE v.id = ? AND v.certificate_id = ? AND v.status = 'valid'
              AND v.pdf_sha256 = ? AND c.status = 'valid'`,
        ).bind(
          crypto.randomUUID(), now,
          JSON.stringify({ versionNumber: pending.version_number, sha256: digest }),
          versionId, certificateId, digest,
        ),
      ]);
      if (results.some(result => !result.success)
        || !results[1].meta.changes || !results[2].meta.changes || !results[3].meta.changes) {
        throw new Error('The pending certificate could not be finalized.');
      }
    } catch (error) {
      const saved = await env.DB.prepare(
        `SELECT status, pdf_sha256 FROM certificate_versions WHERE id = ? AND certificate_id = ?`,
      ).bind(versionId, certificateId).first<{ status: string; pdf_sha256: string | null }>();
      if (saved?.status === 'valid' && saved.pdf_sha256 === digest) {
        return jsonResponse({ ok: true, sha256: digest });
      }
      await env.CERTIFICATE_FILES.delete(pdfPath);
      throw error;
    }
    return jsonResponse({ ok: true, sha256: digest });
  }

  const revokeMatch = /^\/api\/admin\/certificates\/([0-9a-f-]+)\/revoke$/i.exec(path);
  if (request.method === 'POST' && revokeMatch) {
    const body = parseJson(await request.text()) as { reason?: unknown };
    const reason = requiredText(body.reason, 'revocation reason');
    const now = new Date().toISOString();
    const result = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO certificate_events (id, certificate_id, event_type, occurred_at, details_json)
         SELECT ?, id, 'revoked', ?, ? FROM certificates WHERE id = ? AND status = 'valid'`,
      ).bind(crypto.randomUUID(), now, JSON.stringify({ reason }), revokeMatch[1]),
      env.DB.prepare(
        `UPDATE certificates SET status = 'revoked', revoked_at = ?, revocation_reason = ?
          WHERE id = ? AND status = 'valid'`,
      ).bind(now, reason, revokeMatch[1]),
    ]);
    if (!result[1].meta.changes) return jsonResponse({ error: 'Certificate not found or already revoked.' }, 404);
    return jsonResponse({ ok: true });
  }

  const voidMatch = /^\/api\/admin\/certificates\/([0-9a-f-]+)\/versions\/([0-9a-f-]+)\/void$/i.exec(path);
  if (request.method === 'POST' && voidMatch) {
    const body = parseJson(await request.text()) as { reason?: unknown };
    const reason = requiredText(body.reason, 'void reason');
    const now = new Date().toISOString();
    const result = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO certificate_events (id, certificate_id, event_type, occurred_at, details_json)
         SELECT ?, certificate_id, 'pending_voided', ?, ? FROM certificate_versions
          WHERE id = ? AND certificate_id = ? AND status = 'pending'`,
      ).bind(crypto.randomUUID(), now, JSON.stringify({ versionId: voidMatch[2], reason }), voidMatch[2], voidMatch[1]),
      env.DB.prepare(
        `UPDATE certificate_versions SET status = 'voided'
          WHERE id = ? AND certificate_id = ? AND status = 'pending'`,
      ).bind(voidMatch[2], voidMatch[1]),
      env.DB.prepare(
        `UPDATE certificates SET status = 'voided'
          WHERE id = ? AND status = 'pending'
            AND NOT EXISTS (
              SELECT 1 FROM certificate_versions
               WHERE certificate_id = ? AND status = 'valid'
            )`,
      ).bind(voidMatch[1], voidMatch[1]),
    ]);
    if (!result[1].meta.changes) return jsonResponse({ error: 'Pending certificate version not found.' }, 404);
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: 'Not found.' }, 404);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

async function verifyRoute(request: Request, env: Env): Promise<Response> {
  const token = new URL(request.url).searchParams.get('t') || '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return jsonResponse({ status: 'not_found' }, 404);
  }

  const limit = await env.VERIFY_LIMITER.limit({ key: await sha256(token) });
  if (!limit.success) return jsonResponse({ error: 'Too many verification attempts. Try again shortly.' }, 429);

  const certificate = await env.DB.prepare(
    `SELECT c.id, c.certificate_number, c.status, c.artwork_slug,
            v.snapshot_json, v.version_number, v.pdf_path, v.pdf_sha256
       FROM certificates c
       LEFT JOIN certificate_versions v
         ON v.certificate_id = c.id AND v.status = 'valid'
      WHERE c.verification_token = ?
      LIMIT 1`,
  ).bind(token).first<{
    id: string;
    certificate_number: string;
    status: 'pending' | 'valid' | 'revoked' | 'voided';
    artwork_slug: string;
    snapshot_json: string | null;
    version_number: number | null;
    pdf_path: string | null;
    pdf_sha256: string | null;
  }>();
  if (!certificate) return jsonResponse({ status: 'not_found' }, 404);
  if (certificate.status === 'revoked') {
    return jsonResponse({
      status: 'revoked',
      certificateNumber: certificate.certificate_number,
      artist: certificateConfig.artist,
    });
  }
  if (certificate.status === 'voided') return jsonResponse({ status: 'voided' }, 404);
  if (certificate.status !== 'valid' || !certificate.snapshot_json) {
    return jsonResponse({ status: 'pending', certificateNumber: certificate.certificate_number });
  }

  const snapshot = JSON.parse(certificate.snapshot_json) as Record<string, unknown>;
  return jsonResponse({
    status: 'valid',
    certificateNumber: certificate.certificate_number,
    version: certificate.version_number,
    artist: certificateConfig.artist,
    artwork: {
      title: snapshot.title,
      year: snapshot.year,
      medium: snapshot.medium,
      dimensions: snapshot.dimensions,
      support: snapshot.support,
      printDate: snapshot.printDate,
      signed: snapshot.signed,
      editionType: snapshot.editionType,
      editionSize: snapshot.editionSize,
      editionNumber: snapshot.editionNumber,
      image: snapshot.image,
      url: `${certificateConfig.canonicalOrigin}/work/${encodeURIComponent(certificate.artwork_slug)}/`,
    },
    pdf: certificate.pdf_path && certificate.pdf_sha256
      ? `${certificateConfig.canonicalOrigin}/api/verify/pdf?t=${encodeURIComponent(token)}`
      : null,
  });
}

async function pdfRoute(request: Request, env: Env): Promise<Response> {
  const token = new URL(request.url).searchParams.get('t') || '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return jsonResponse({ status: 'not_found' }, 404);
  const limit = await env.VERIFY_LIMITER.limit({ key: `pdf-${await sha256(token)}` });
  if (!limit.success) return jsonResponse({ error: 'Too many download attempts. Try again shortly.' }, 429);

  const certificate = await env.DB.prepare(
    `SELECT c.certificate_number, v.pdf_path, v.pdf_sha256
       FROM certificates c
       JOIN certificate_versions v ON v.certificate_id = c.id AND v.status = 'valid'
      WHERE c.verification_token = ? AND c.status = 'valid'
      LIMIT 1`,
  ).bind(token).first<{ certificate_number: string; pdf_path: string | null; pdf_sha256: string | null }>();
  if (!certificate?.pdf_path || !certificate.pdf_sha256) {
    return jsonResponse({ error: 'Certificate PDF not found.' }, 404);
  }
  const storedPdf = await env.CERTIFICATE_FILES.get(certificate.pdf_path);
  if (!storedPdf) return jsonResponse({ error: 'Certificate PDF not found.' }, 404);
  const bytes = await storedPdf.arrayBuffer();
  if (await sha256Bytes(bytes) !== certificate.pdf_sha256) {
    return jsonResponse({ error: 'Certificate PDF integrity check failed.' }, 500);
  }
  const filename = certificate.certificate_number.replace(/[^A-Z0-9._-]/gi, '-');
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': `inline; filename="${filename}.pdf"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (origin && origin !== env.ALLOWED_ORIGIN) {
      return jsonResponse({ error: 'Not found.' }, 404);
    }
    if (request.method === 'OPTIONS') {
      if (origin !== env.ALLOWED_ORIGIN) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (url.pathname === '/health' && request.method === 'GET') {
      return withCors(jsonResponse({ ok: true }), request, env);
    }
    if (url.pathname === '/api/verify' && request.method === 'GET') {
      try {
        return withCors(await verifyRoute(request, env), request, env);
      } catch {
        return errorResponse(request, env, 500, 'Verification could not be completed.');
      }
    }
    if (url.pathname === '/api/verify/pdf' && request.method === 'GET') {
      try {
        return withCors(await pdfRoute(request, env), request, env);
      } catch {
        return errorResponse(request, env, 500, 'Certificate PDF could not be checked.');
      }
    }
    if (!url.pathname.startsWith('/api/admin/')) {
      return errorResponse(request, env, 404, 'Not found.');
    }
    if (!['GET', 'POST'].includes(request.method)) {
      return errorResponse(request, env, 405, 'Method not allowed.');
    }

    try {
      const response = await adminRoute(request, env, url.pathname);
      return withCors(response, request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.';
      const status = /Enter a valid|Enter an NFC tag reference|Enter a replacement NFC tag reference|Choose|Limited edition size must match|Limited editions|Edition number|The artwork|Upload an artwork|Upload a certificate PDF|certificate file is not a valid PDF|Reissue details|Certificate type|reason|valid JSON/i.test(message)
        ? 400
        : /GitHub authorization could not be verified/i.test(message)
          ? 503
        : /could not be finalized|Pending certificate version/.test(message)
          ? 409
        : /UNIQUE constraint|limited edition size cannot change/.test(message)
          ? 409
          : 500;
      return errorResponse(
        request,
        env,
        status,
        status === 500 ? 'Request could not be completed.' : message,
      );
    }
  },
};

export { certificateTypes, validateIssueRequest };
