import certificateConfig from '../../../shared/certificate-config.json';
import type { CertificateType, Env, IssueRequest } from './types';
import { D1BackupWorkflow } from './backup-workflow';
import { handleArtworkCodeRequest } from './artwork-codes';
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

interface ArtworkForSale {
  slug: string;
  title: string;
  category: string;
  available: boolean;
  editionType: string;
  editionSize: number | null;
  price: string;
  soldEditionNumbers?: number[];
}

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

async function adminAuthorizationFailure(
  request: Request,
  env: Env,
): Promise<401 | 403 | 503 | null> {
  const authorization = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) return 401;
  if (!/^\d+$/.test(env.ALLOWED_GITHUB_USER_ID || '')) return 503;

  const githubToken = match[1];
  const tokenHash = await sha256(githubToken);
  const cached = identityCache.get(tokenHash);
  if (cached && cached.expiresAt > Date.now()) return cached.allowed ? null : 403;

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
  if (userResponse.status === 401 || repositoryResponse.status === 401) {
    return 401;
  }
  if ([403, 404].includes(userResponse.status) || [403, 404].includes(repositoryResponse.status)) {
    return 403;
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
  return allowed ? null : 403;
}

function requiredText(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`Enter a valid ${field}.`);
  }
  return value.trim();
}

function validateSaleRequest(input: unknown): {
  artworkSlug: string;
  itemType: CertificateType;
  editionNumber: number | null;
  buyerName: string;
  buyerEmail: string | null;
  saleDate: string;
  price: number;
  currency: string;
  notes: string;
} {
  if (!input || typeof input !== 'object') throw new Error('Enter sale details.');
  const body = input as Record<string, unknown>;
  const artworkSlug = requiredText(body.artworkSlug, 'artwork', 120);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(artworkSlug)) throw new Error('Enter a valid artwork.');

  if (typeof body.itemType !== 'string' || !allowedTypes.has(body.itemType)) {
    throw new Error('Choose a valid item type.');
  }
  const itemType = body.itemType as CertificateType;
  let editionNumber: number | null = null;
  if (itemType === 'limited_edition') {
    if (!Number.isInteger(body.editionNumber) || Number(body.editionNumber) < 1) {
      throw new Error('Enter a valid limited-edition number.');
    }
    editionNumber = Number(body.editionNumber);
  } else if (body.editionNumber !== undefined && body.editionNumber !== null && body.editionNumber !== '') {
    throw new Error('An edition number is only valid for a limited edition.');
  }

  const buyerName = requiredText(body.buyerName, 'buyer name', 200);
  const buyerEmail = body.buyerEmail ? requiredText(body.buyerEmail, 'buyer email', 254) : null;
  if (buyerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    throw new Error('Enter a valid buyer email.');
  }
  const saleDate = requiredText(body.saleDate, 'sale date', 10);
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(saleDate)
    ? new Date(`${saleDate}T00:00:00.000Z`)
    : null;
  if (!parsedDate || Number(saleDate.slice(0, 4)) < 1900
    || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== saleDate) {
    throw new Error('Enter a valid sale date in YYYY-MM-DD format.');
  }
  const price = Number(body.price);
  if (typeof body.price !== 'number' || !Number.isFinite(price) || price < 0) {
    throw new Error('Enter a valid price.');
  }
  const currency = requiredText(body.currency || 'GBP', 'currency', 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Enter a valid three-letter currency.');
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    throw new Error('Enter valid sale notes.');
  }
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (notes.length > 1000) throw new Error('Notes must be 1000 characters or fewer.');

  return { artworkSlug, itemType, editionNumber, buyerName, buyerEmail, saleDate, price, currency, notes };
}

function githubTokenFromRequest(request: Request): string {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
  if (!match) throw new Error('Not authorized.');
  return match[1];
}

async function githubContent(
  request: Request,
  env: Env,
  path: string,
): Promise<unknown> {
  const response = await fetch(
    `https://api.github.com/repos/${env.ARTWORK_REPOSITORY}/contents/${path}?ref=main`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubTokenFromRequest(request)}`,
        'User-Agent': 'Vlement-Certificates',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error('Could not read artwork details from GitHub.');
  return response.json();
}

function isGitHubContentFile(value: unknown): value is { content: string; name?: string; type?: string } {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && 'content' in value
    && typeof value.content === 'string';
}

function parseArtworkFrontmatter(content: string): Record<string, string> {
  const decoded = new TextDecoder().decode(
    Uint8Array.from(atob(content.replace(/\s/g, '')), character => character.charCodeAt(0)),
  );
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(decoded);
  if (!match) throw new Error('Artwork metadata is missing its frontmatter.');
  const values: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line);
    if (!field) continue;
    let value = field[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        throw new Error('Artwork metadata contains an invalid quoted value.');
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1).replaceAll("''", "'");
    }
    values[field[1]] = value;
  }
  return values;
}

async function getArtworkForSale(
  request: Request,
  env: Env,
  slug: string,
): Promise<ArtworkForSale> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Enter a valid artwork.');
  const file = await githubContent(request, env, `src/content/artworks/${encodeURIComponent(slug)}.md`);
  if (!isGitHubContentFile(file)) throw new Error('Artwork metadata is missing from GitHub.');
  if (!file.content) throw new Error('Artwork metadata is missing from GitHub.');
  const data = parseArtworkFrontmatter(file.content);
  const editionSize = Number(data.editionSize || 0);
  return {
    slug,
    title: data.title || slug,
    category: data.category || '',
    available: data.available !== 'false',
    editionType: data.editionType || (data.category === 'Print' ? 'open' : 'original'),
    editionSize: Number.isInteger(editionSize) && editionSize > 0 ? editionSize : null,
    price: data.price || '',
  };
}

async function listArtworksForSale(request: Request, env: Env): Promise<ArtworkForSale[]> {
  const listing = await githubContent(request, env, 'src/content/artworks');
  if (!Array.isArray(listing)) throw new Error('Could not list artwork files in GitHub.');
  const files = listing.filter((file): file is { name: string; type: string } =>
    typeof file === 'object' && file !== null
    && 'type' in file && file.type === 'file'
    && 'name' in file && typeof file.name === 'string'
    && /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(file.name),
  );
  const artworks = await Promise.all(files.map(async file => {
    const slug = file.name.slice(0, -3);
    const content = await githubContent(request, env, `src/content/artworks/${encodeURIComponent(file.name)}`);
    if (!isGitHubContentFile(content)) return null;
    const data = parseArtworkFrontmatter(content.content);
    const editionSize = Number(data.editionSize || 0);
    const artwork: ArtworkForSale = {
      slug,
      title: data.title || slug,
      category: data.category || '',
      available: data.available !== 'false',
      editionType: data.editionType || (data.category === 'Print' ? 'open' : 'original'),
      editionSize: Number.isInteger(editionSize) && editionSize > 0 ? editionSize : null,
      price: data.price || '',
    };
    return artwork;
  }));
  const activeSales = await env.DB.prepare(
    `SELECT artwork_slug, item_type, edition_number
       FROM sales WHERE status = 'active'`,
  ).all<{ artwork_slug: string; item_type: CertificateType; edition_number: number | null }>();
  const grouped = new Map<string, typeof activeSales.results>();
  for (const sale of activeSales.results) {
    const current = grouped.get(sale.artwork_slug) || [];
    current.push(sale);
    grouped.set(sale.artwork_slug, current);
  }

  return artworks.filter((artwork): artwork is ArtworkForSale => artwork !== null).map(artwork => {
    const sold = grouped.get(String(artwork.slug)) || [];
    const soldEditionNumbers = sold
      .filter(sale => sale.item_type === 'limited_edition')
      .map(sale => sale.edition_number)
      .filter((number): number is number => number !== null);
    const activeOriginal = sold.some(sale => sale.item_type === 'original');
    const editionType = artwork.editionType;
    const available = editionType === 'limited'
      ? artwork.available && Boolean(artwork.editionSize) && soldEditionNumbers.length < Number(artwork.editionSize)
      : editionType === 'open'
        ? artwork.available
        : artwork.available && !activeOriginal;
    return { ...artwork, available, soldEditionNumbers };
  });
}

async function enforceSalesRateLimit(env: Env): Promise<void> {
  const result = await env.VERIFY_LIMITER.limit({
    key: `sales-admin-${env.ALLOWED_GITHUB_USER_ID || 'unknown'}`,
  });
  if (!result.success) throw new Error('Sales requests are temporarily limited. Try again shortly.');
}

async function recordSale(request: Request, env: Env): Promise<Response> {
  const body = parseJson(await request.text());
  const sale = validateSaleRequest(body);
  const artwork = await getArtworkForSale(request, env, sale.artworkSlug);
  if (!artwork.available) throw new Error('This artwork is not currently available for sale.');
  const expectedType = artwork.editionType === 'limited'
    ? 'limited_edition'
    : artwork.editionType === 'open'
      ? 'open_edition'
      : 'original';
  if (sale.itemType !== expectedType) throw new Error('Choose the item type configured for this artwork.');
  if (sale.itemType === 'limited_edition'
    && (!artwork.editionSize || !sale.editionNumber || sale.editionNumber > Number(artwork.editionSize))) {
    throw new Error('Enter an edition number within the artwork edition size.');
  }

  const now = new Date().toISOString();
  const year = Number(sale.saleDate.slice(0, 4));
  const prefix = certificateTypes[sale.itemType].prefix;
  const id = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const matchingCertificate = sale.itemType === 'open_edition'
    ? null
    : await env.DB.prepare(
      `SELECT c.id, c.certificate_number
         FROM certificates c
        WHERE c.artwork_slug = ? AND c.certificate_type = ? AND c.edition_number IS ?
          AND c.status IN ('pending', 'valid')
          AND NOT EXISTS (
            SELECT 1 FROM sales s WHERE s.certificate_id = c.id OR s.sale_number = c.certificate_number
          )
        ORDER BY c.created_at, c.id LIMIT 1`,
    ).bind(sale.artworkSlug, sale.itemType, sale.editionNumber).first<{
      id: string;
      certificate_number: string;
    }>();
  const statements = matchingCertificate ? [] : [
    env.DB.prepare(
      'INSERT OR IGNORE INTO counters (certificate_type, year, value) VALUES (?, ?, 0)',
    ).bind(sale.itemType, year),
    env.DB.prepare(
      `UPDATE counters SET value = value + 1
        WHERE certificate_type = ? AND year = ?`,
    ).bind(sale.itemType, year),
  ];
  if (sale.itemType === 'open_edition') {
    statements.push(
      env.DB.prepare(
        'INSERT OR IGNORE INTO open_edition_sales_counters (artwork_slug, value) VALUES (?, 0)',
      ).bind(sale.artworkSlug),
      env.DB.prepare(
        'UPDATE open_edition_sales_counters SET value = value + 1 WHERE artwork_slug = ?',
      ).bind(sale.artworkSlug),
    );
  }
  statements.push(
    env.DB.prepare(
      `INSERT INTO sales
        (id, artwork_slug, item_type, edition_number, open_edition_number, sale_number,
         buyer_name, buyer_email, sale_date, price, currency, notes, status, cancelled_at,
         certificate_id, created_at, created_by)
       SELECT ?, ?, ?, ?, CASE WHEN ? = 'open_edition'
                    THEN (SELECT value FROM open_edition_sales_counters WHERE artwork_slug = ?)
                    ELSE NULL END,
             COALESCE(
               (SELECT certificate_number FROM certificates WHERE id = ?),
               printf('VL-%s-%04d-%04d', ?, ?, counters.value)
             ),
             ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?
        FROM counters
        WHERE certificate_type = ? AND year = ?
       RETURNING id, artwork_slug, item_type, edition_number, open_edition_number,
                 sale_number, buyer_name, buyer_email, sale_date, price, currency,
                 notes, status, cancelled_at, certificate_id, created_at, created_by`,
    ).bind(
      id, sale.artworkSlug, sale.itemType, sale.editionNumber,
      sale.itemType, sale.artworkSlug,
      matchingCertificate?.id || null,
      prefix, year, sale.buyerName, sale.buyerEmail, sale.saleDate, sale.price,
      sale.currency, sale.notes, matchingCertificate?.id || null, now, env.ALLOWED_GITHUB_USER_ID || '',
      sale.itemType, year,
    ),
  );
  const salesInsert = statements[statements.length - 1];
  statements.push(
    env.DB.prepare(
      `INSERT INTO sales_audit_log (id, actor_id, action, sale_id, sale_number, occurred_at)
       SELECT ?, ?, 'sale_recorded', id, sale_number, ? FROM sales WHERE id = ?`,
    ).bind(auditId, env.ALLOWED_GITHUB_USER_ID || '', now, id),
  );
  const results = await env.DB.batch(statements);
  if (results.some(result => !result.success)) throw new Error('Could not record the sale.');
  const insertResult = results[statements.indexOf(salesInsert)];
  const inserted = insertResult.results?.[0] as Record<string, unknown> | undefined;
  if (!inserted) throw new Error('Could not load the recorded sale.');
  let artworkAvailable = true;
  if (sale.itemType === 'original') {
    artworkAvailable = false;
  } else if (sale.itemType === 'limited_edition') {
    const active = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM sales
        WHERE artwork_slug = ? AND item_type = 'limited_edition' AND status = 'active'`,
    ).bind(sale.artworkSlug).first<{ count: number }>();
    artworkAvailable = Number(active?.count || 0) < Number(artwork.editionSize);
  } else {
    artworkAvailable = Boolean(artwork.available);
  }
  return jsonResponse({ sale: inserted, artworkAvailable }, 201);
}

async function cancelSale(request: Request, env: Env): Promise<Response> {
  const input = parseJson(await request.text());
  if (!input || typeof input !== 'object') throw new Error('Enter a sale number to cancel.');
  const saleNumber = requiredText((input as Record<string, unknown>).saleNumber, 'sale number', 40);
  const existing = await env.DB.prepare(
    `SELECT id, artwork_slug, item_type, status, certificate_id
       FROM sales WHERE sale_number = ?`,
  ).bind(saleNumber).first<{
    id: string;
    artwork_slug: string;
    item_type: CertificateType;
    status: 'active' | 'cancelled';
    certificate_id: string | null;
  }>();
  if (!existing) return jsonResponse({ error: 'Sale not found.' }, 404);
  if (existing.status === 'cancelled') {
    return jsonResponse({
      sale: { ...existing, sale_number: saleNumber },
      alreadyCancelled: true,
      certificateRequiresManualReview: Boolean(existing.certificate_id),
      artworkAvailable: existing.item_type !== 'open_edition',
    });
  }
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE sales SET status = 'cancelled', cancelled_at = ?
        WHERE id = ? AND status = 'active'`,
    ).bind(now, existing.id),
    env.DB.prepare(
      `INSERT INTO sales_audit_log (id, actor_id, action, sale_id, sale_number, occurred_at, details_json)
       SELECT ?, ?, 'sale_cancelled', id, sale_number, ?, ?
         FROM sales WHERE id = ? AND status = 'cancelled' AND cancelled_at = ?`,
    ).bind(
      crypto.randomUUID(), env.ALLOWED_GITHUB_USER_ID || '', now,
      JSON.stringify({ certificateRequiresManualReview: Boolean(existing.certificate_id) }),
      existing.id, now,
    ),
  ]);
  if (results.some(result => !result.success)) throw new Error('Could not cancel the sale.');
  const sale = await env.DB.prepare(
    `SELECT id, artwork_slug, item_type, edition_number, open_edition_number,
            sale_number, buyer_name, buyer_email, sale_date, price, currency, notes,
            status, cancelled_at, certificate_id, created_at, created_by
       FROM sales WHERE id = ?`,
  ).bind(existing.id).first<Record<string, unknown>>();
  return jsonResponse({
    sale,
    certificateRequiresManualReview: Boolean(existing.certificate_id),
    artworkAvailable: existing.item_type !== 'open_edition',
  });
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
  if (candidate.nfcTagUid != null) {
    if (typeof candidate.nfcTagUid !== 'string') throw new Error('Enter a valid NFC tag UID.');
    const nfcTagUid = candidate.nfcTagUid.trim();
    if (nfcTagUid) {
      if (!/^[A-Za-z0-9._:-]+$/.test(nfcTagUid)) {
        throw new Error('Enter an NFC tag UID using letters, numbers, dots, colons, dashes or underscores.');
      }
      normalized.nfcTagUid = requiredText(nfcTagUid, 'NFC tag UID', 120);
      if (candidate.nfcTagPlacement != null && candidate.nfcTagPlacement !== '') {
        normalized.nfcTagPlacement = requiredText(candidate.nfcTagPlacement, 'NFC tag placement', 200);
      }
    }
  }
  if (!normalized.nfcTagUid && candidate.nfcTagPlacement != null
    && (typeof candidate.nfcTagPlacement !== 'string' || candidate.nfcTagPlacement.trim())) {
    throw new Error('Enter an NFC tag UID before specifying its placement.');
  }

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
  replacement?: { certificateId: string; versionId: string; reason?: string },
): Promise<Record<string, unknown>> {
  const id = reissue?.certificateId || replacement?.certificateId || crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const token = reissue || replacement ? null : randomToken();
  const versionNumber = reissue || replacement
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
  let artworkCode: string | null = null;
  if (reissue || replacement) {
    const previous = await env.DB.prepare(
      `SELECT c.artwork_code, v.snapshot_json
         FROM certificates c JOIN certificate_versions v ON v.certificate_id = c.id
        WHERE c.id = ? AND (? IS NULL OR v.id = ?)
        ORDER BY v.version_number DESC LIMIT 1`,
    ).bind(id, replacement?.versionId || null, replacement?.versionId || null)
      .first<{ artwork_code: string | null; snapshot_json: string }>();
    if (previous) {
      const previousSnapshot = JSON.parse(previous.snapshot_json) as { artworkCode?: string };
      artworkCode = previousSnapshot.artworkCode || previous.artwork_code;
    }
  } else {
    const codeType = { original: 'O', limited_edition: 'LE', open_edition: 'OE' }[request.certificateType];
    const code = await env.DB.prepare(
      `SELECT artwork_code FROM artwork_codes WHERE artwork_slug = ? AND type = ? AND status = 'active'`,
    ).bind(request.artwork.slug, codeType).first<{ artwork_code: string }>();
    artworkCode = code?.artwork_code || null;
  }
  const snapshot = {
    ...request.artwork,
    artist: certificateConfig.artist,
    certificateType: request.certificateType,
    certificateTypeTitle: type.pdfTitle,
    certificateWording: type.pdfWording,
    nfcSuggested: type.nfcDefault,
    ...(artworkCode ? { artworkCode } : {}),
    ...(request.certificateType === 'limited_edition'
      ? { editionNumber: request.editionNumber, editionSize: request.editionSize }
      : request.certificateType === 'open_edition'
        ? { editionStatement: 'Open edition, no limit on quantity' }
        : {}),
    ...(request.nfcTagUid
      ? { nfcTagUid: request.nfcTagUid, nfcTagPlacement: request.nfcTagPlacement }
      : {}),
  };

  if (request.nfcTagUid) {
    const existingTag = await env.DB.prepare(
      'SELECT certificate_id, status, placement FROM nfc_tags WHERE tag_reference = ?',
    ).bind(request.nfcTagUid).first<{ certificate_id: string; status: string; placement: string }>();
    if (existingTag && (reissue || replacement)
      && existingTag.certificate_id === id && existingTag.status === 'active') {
      snapshot.nfcTagPlacement = existingTag.placement;
    } else if (existingTag) {
      throw new Error("NFC UID is already registered. Use a new UID or the certificate's existing active tag.");
    }
  }

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
    } else if (replacement) {
      const current = await env.DB.prepare(
        `SELECT c.status AS certificate_status, c.certificate_type, c.artwork_slug,
                c.edition_number, c.edition_size, v.reissue_reason, v.previous_version_id
           FROM certificates c
           JOIN certificate_versions v ON v.certificate_id = c.id
          WHERE c.id = ? AND v.id = ? AND v.status = 'pending'
            AND c.status IN ('pending', 'valid')`,
      ).bind(id, replacement.versionId).first<{
        certificate_status: 'pending' | 'valid';
        certificate_type: CertificateType;
        artwork_slug: string;
        edition_number: number | null;
        edition_size: number | null;
        reissue_reason: string | null;
        previous_version_id: string | null;
      }>();
      if (!current) throw new Error('Pending certificate version not found.');
      if (current.certificate_type !== request.certificateType
        || current.artwork_slug !== request.artwork.slug
        || current.edition_number !== (request.editionNumber ?? null)
        || current.edition_size !== (request.editionSize ?? null)) {
        throw new Error('Pending certificate edits must retain its type, artwork and edition.');
      }

      const reissueReason = current.certificate_status === 'valid'
        ? replacement.reason || current.reissue_reason || ''
        : null;
      const updated = await env.DB.batch([
        env.DB.prepare(
          `UPDATE certificate_versions SET status = 'voided'
            WHERE id = ? AND certificate_id = ? AND status = 'pending'
              AND EXISTS (
                SELECT 1 FROM certificates
                 WHERE id = ? AND status IN ('pending', 'valid')
              )`,
        ).bind(replacement.versionId, id, id),
        env.DB.prepare(
          `INSERT INTO certificate_versions
            (id, certificate_id, version_number, issued_at, snapshot_json, original_image_path,
             reissue_reason, previous_version_id, status, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?
            WHERE EXISTS (
              SELECT 1 FROM certificate_versions
               WHERE id = ? AND certificate_id = ? AND status = 'voided'
            )
              AND EXISTS (
                SELECT 1 FROM certificates
                 WHERE id = ? AND status IN ('pending', 'valid')
              )`,
        ).bind(
          versionId, id, versionNumber, now, JSON.stringify(snapshot), originalImagePath,
          reissueReason, current.previous_version_id, now, replacement.versionId, id, id,
        ),
        env.DB.prepare(
          `INSERT INTO certificate_events (id, certificate_id, event_type, occurred_at, details_json)
           SELECT ?, ?, ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM certificate_versions WHERE id = ? AND status = 'pending'
            )`,
        ).bind(
          crypto.randomUUID(), id,
          current.certificate_status === 'valid' ? 'reissue_pending' : 'issue_pending',
          now,
          JSON.stringify({
            versionNumber,
            reason: reissueReason,
            status: 'pending',
            replacedPendingVersion: replacement.versionId,
          }),
          versionId,
        ),
      ]);
      if (updated.some(result => !result.success)
        || !updated[0].meta.changes || !updated[1].meta.changes || !updated[2].meta.changes) {
        throw new Error('Could not replace the pending certificate preview.');
      }
    } else {
      const matchingSale = await env.DB.prepare(
        `SELECT id, sale_number FROM sales
          WHERE artwork_slug = ? AND item_type = ? AND edition_number IS ?
            AND status = 'active' AND certificate_id IS NULL
          ORDER BY created_at, id LIMIT 1`,
      ).bind(request.artwork.slug, request.certificateType, request.editionNumber ?? null)
        .first<{ id: string; sale_number: string }>();
      const counterStatements = matchingSale ? [] : [
        env.DB.prepare(
          'INSERT OR IGNORE INTO counters (certificate_type, year, value) VALUES (?, ?, 0)',
        ).bind(request.certificateType, year),
        env.DB.prepare(
          `UPDATE counters SET value = value + 1
            WHERE certificate_type = ? AND year = ?
            RETURNING value`,
        ).bind(request.certificateType, year),
      ];
      const insertCertificate = matchingSale
        ? env.DB.prepare(
          `INSERT INTO certificates
             (id, certificate_type, certificate_number, verification_token, artwork_slug,
              edition_number, edition_size, status, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, 'pending', ?
             FROM sales WHERE id = ? AND status = 'active' AND certificate_id IS NULL`,
        ).bind(
          id, request.certificateType, matchingSale.sale_number, token, request.artwork.slug,
          request.editionNumber ?? null, request.editionSize ?? null, now, matchingSale.id,
        )
        : env.DB.prepare(
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

      const statements = [...counterStatements, insertCertificate, insertVersion, event];
      if (matchingSale) {
        statements.push(
          env.DB.prepare(
            `UPDATE sales SET certificate_id = ?
              WHERE id = ? AND status = 'active' AND certificate_id IS NULL`,
          ).bind(id, matchingSale.id),
          env.DB.prepare(
            `INSERT INTO sales_audit_log
              (id, actor_id, action, sale_id, sale_number, occurred_at, details_json)
             VALUES (?, ?, 'certificate_linked', ?, ?, ?, ?)`,
          ).bind(
            crypto.randomUUID(), env.ALLOWED_GITHUB_USER_ID || '', matchingSale.id,
            matchingSale.sale_number, now, JSON.stringify({ certificateId: id }),
          ),
        );
      }
      const results = await env.DB.batch(statements);
      if (results.some(result => !result.success)) throw new Error('Could not create the pending certificate.');
    }

  } catch (error) {
    await env.CERTIFICATE_FILES.delete(originalImagePath);
    throw error;
  }

  const record = await env.DB.prepare(
    `SELECT c.id, c.certificate_type, c.certificate_number, c.verification_token, c.artwork_slug,
            c.edition_number, c.edition_size, c.status, v.id AS version_id, v.version_number, v.snapshot_json,
            v.original_image_path, v.status AS version_status, v.reissue_reason
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
  const authorizationFailure = await adminAuthorizationFailure(request, env);
  if (authorizationFailure === 401 || authorizationFailure === 403) {
    return jsonResponse({ error: 'Not authorized.' }, authorizationFailure);
  }
  if (authorizationFailure === 503) {
    return jsonResponse({ error: 'Certificate Worker admin authorization is not configured.' }, 503);
  }

  if (path === '/api/admin/artwork-codes' || path.startsWith('/api/admin/artwork-codes/')) {
    return handleArtworkCodeRequest(request, env);
  }

  if (path === '/api/admin/sales' || path.startsWith('/api/admin/sales/')) {
    await enforceSalesRateLimit(env);
  }

  if (request.method === 'GET' && path === '/api/admin/sales/artworks') {
    return jsonResponse({ artworks: await listArtworksForSale(request, env) });
  }

  if (request.method === 'GET' && path === '/api/admin/sales') {
    const url = new URL(request.url);
    const requestedPage = Number(url.searchParams.get('page') || 1);
    const requestedLimit = Number(url.searchParams.get('per_page') || 20);
    if (!Number.isInteger(requestedPage) || requestedPage < 1
      || !Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
      throw new Error('Enter valid sales pagination values.');
    }
    const offset = (requestedPage - 1) * requestedLimit;
    const { results } = await env.DB.prepare(
      `SELECT id, artwork_slug, item_type, edition_number, open_edition_number,
              sale_number, buyer_name, buyer_email, sale_date, price, currency, notes,
              status, cancelled_at, certificate_id, created_at, created_by
         FROM sales ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    ).bind(requestedLimit, offset).all<Record<string, unknown>>();
    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM sales')
      .first<{ total: number }>();
    return jsonResponse({
      sales: results,
      page: requestedPage,
      perPage: requestedLimit,
      total: Number(count?.total || 0),
    });
  }

  if (request.method === 'POST' && path === '/api/admin/sales') {
    return recordSale(request, env);
  }

  if (request.method === 'POST' && path === '/api/admin/sales/cancel') {
    return cancelSale(request, env);
  }

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
    const [counters, certificates, versions, tags, events, sales, openEditionSalesCounters, salesAudit] = await Promise.all([
      env.DB.prepare('SELECT * FROM counters ORDER BY certificate_type, year').all(),
      env.DB.prepare('SELECT * FROM certificates ORDER BY created_at, id').all(),
      env.DB.prepare('SELECT * FROM certificate_versions ORDER BY certificate_id, version_number').all(),
      env.DB.prepare('SELECT * FROM nfc_tags ORDER BY certificate_id, registered_at, id').all(),
      env.DB.prepare('SELECT * FROM certificate_events ORDER BY occurred_at, id').all(),
      env.DB.prepare('SELECT * FROM sales ORDER BY created_at, id').all(),
      env.DB.prepare('SELECT * FROM open_edition_sales_counters ORDER BY artwork_slug').all(),
      env.DB.prepare('SELECT * FROM sales_audit_log ORDER BY occurred_at, id').all(),
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
          sales: sales.results,
          openEditionSalesCounters: openEditionSalesCounters.results,
          salesAuditLog: salesAudit.results,
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
              v.id AS version_id, v.version_number, v.status AS version_status, v.snapshot_json,
              v.reissue_reason,
              (SELECT tag_reference FROM nfc_tags
                WHERE certificate_id = c.id AND status = 'active'
                ORDER BY registered_at DESC LIMIT 1) AS nfc_tag_uid,
              (SELECT placement FROM nfc_tags
                WHERE certificate_id = c.id AND status = 'active'
                ORDER BY registered_at DESC LIMIT 1) AS nfc_tag_placement
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

  const replacePendingMatch =
    /^\/api\/admin\/certificates\/([0-9a-f-]+)\/versions\/([0-9a-f-]+)\/replace$/i.exec(path);
  if (request.method === 'POST' && replacePendingMatch) {
    const formData = await request.formData();
    const requestBody = parseJson(String(formData.get('request') || 'null')) as IssueRequest & { reason?: unknown };
    const issue = validateIssueRequest(requestBody);
    const image = await parseImage(formData);
    const certificateId = replacePendingMatch[1];
    const versionId = replacePendingMatch[2];
    const current = await env.DB.prepare(
      `SELECT c.status AS certificate_status, v.reissue_reason
         FROM certificates c JOIN certificate_versions v ON v.certificate_id = c.id
        WHERE c.id = ? AND v.id = ? AND v.status = 'pending'`,
    ).bind(certificateId, versionId).first<{
      certificate_status: 'pending' | 'valid';
      reissue_reason: string | null;
    }>();
    if (!current || !['pending', 'valid'].includes(current.certificate_status)) {
      return jsonResponse({ error: 'Pending certificate version not found.' }, 404);
    }
    const reason = current.certificate_status === 'valid'
      ? requiredText(requestBody.reason ?? current.reissue_reason, 'reissue reason')
      : undefined;
    return jsonResponse({
      certificate: await createPendingVersion(
        env,
        issue,
        image,
        undefined,
        { certificateId, versionId, reason },
      ),
    }, 201);
  }

  const finalizeMatch = /^\/api\/admin\/certificates\/([0-9a-f-]+)\/versions\/([0-9a-f-]+)\/finalize$/i.exec(path);
  if (request.method === 'POST' && finalizeMatch) {
    const { file, bytes } = await parsePdf(await request.formData());
    const certificateId = finalizeMatch[1];
    const versionId = finalizeMatch[2];
    const pending = await env.DB.prepare(
      `SELECT c.status AS certificate_status, v.version_number, v.status AS version_status,
              v.pdf_sha256, v.snapshot_json
         FROM certificates c
         JOIN certificate_versions v ON v.certificate_id = c.id
        WHERE c.id = ? AND v.id = ?`,
    ).bind(certificateId, versionId).first<{
      certificate_status: string;
      version_number: number;
      version_status: string;
      pdf_sha256: string | null;
      snapshot_json: string;
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

    const snapshot = JSON.parse(pending.snapshot_json) as { nfcTagUid?: string; nfcTagPlacement?: string };
    const nfcTagUid = snapshot.nfcTagUid;
    let existingTag: { certificate_id: string; status: string } | null = null;
    if (nfcTagUid) {
      existingTag = await env.DB.prepare(
        'SELECT certificate_id, status FROM nfc_tags WHERE tag_reference = ?',
      ).bind(nfcTagUid).first<{ certificate_id: string; status: string }>();
      if (existingTag && !(existingTag.certificate_id === certificateId && existingTag.status === 'active')) {
        return jsonResponse({
          error: "NFC UID is already registered. Use a new UID or the certificate's existing active tag.",
        }, 409);
      }
    }

    const pdfPath = `certificates/${certificateId}/v${pending.version_number}/certificate-${digest}.pdf`;
    await env.CERTIFICATE_FILES.put(pdfPath, bytes, {
      httpMetadata: { contentType: 'application/pdf' },
      customMetadata: { certificateId, versionId, sha256: digest },
    });
    try {
      const now = new Date().toISOString();
      const newTagId = nfcTagUid && snapshot.nfcTagPlacement && !existingTag ? crypto.randomUUID() : null;
      const tagRegistration = newTagId && nfcTagUid
        ? [
          env.DB.prepare(
            `INSERT INTO nfc_tags
              (id, certificate_id, tag_reference, placement, registered_at, status, tested)
             SELECT ?, ?, ?, ?, ?, 'active', 0
              WHERE EXISTS (
                SELECT 1 FROM certificate_versions v JOIN certificates c ON c.id = v.certificate_id
                 WHERE v.id = ? AND v.certificate_id = ? AND v.status = 'pending'
                   AND c.status IN ('pending', 'valid')
              )`,
          ).bind(newTagId, certificateId, nfcTagUid, snapshot.nfcTagPlacement, now, versionId, certificateId),
          env.DB.prepare(
            `INSERT INTO certificate_events (id, certificate_id, event_type, occurred_at, details_json)
             SELECT ?, certificate_id, 'tag_registered', ?, ? FROM nfc_tags WHERE id = ?`,
          ).bind(
            crypto.randomUUID(),
            now,
            JSON.stringify({ tagId: newTagId, tagReference: nfcTagUid, placement: snapshot.nfcTagPlacement }),
            newTagId,
          ),
        ]
        : [];
      const results = await env.DB.batch([
        ...tagRegistration,
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
                  CASE WHEN EXISTS (
                    SELECT 1 FROM certificate_events prior
                     WHERE prior.certificate_id = v.certificate_id
                       AND prior.event_type IN ('issued', 'reissued')
                  ) THEN 'reissued' ELSE 'issued' END,
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
      const offset = tagRegistration.length;
      if (results.some(result => !result.success)
        || (newTagId && (!results[0].meta.changes || !results[1].meta.changes))
        || !results[offset + 1].meta.changes
        || !results[offset + 2].meta.changes
        || !results[offset + 3].meta.changes) {
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
      if (nfcTagUid && error instanceof Error && /UNIQUE constraint failed: nfc_tags\.tag_reference/i.test(error.message)) {
        return jsonResponse({
          error: "NFC UID is already registered. Use a new UID or the certificate's existing active tag.",
        }, 409);
      }
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
      ? `${new URL(request.url).origin}/api/verify/pdf?t=${encodeURIComponent(token)}`
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
      const status = /Enter a valid|Enter an NFC tag reference|Enter a replacement NFC tag reference|Choose|Limited edition size must match|Limited editions|Edition number|The artwork|Upload an artwork|Upload a certificate PDF|certificate file is not a valid PDF|Reissue details|Pending certificate edits|Certificate type|reason|valid JSON|Enter an NFC tag UID|Enter an NFC tag placement|buyer name|buyer email|sale date|currency|sale details|sale notes|Notes must|edition number is only valid|not currently available|configured for this artwork|pagination values/i.test(message)
        ? 400
        : /GitHub authorization could not be verified/i.test(message)
          ? 503
        : /temporarily limited/i.test(message)
          ? 429
        : /could not be finalized|Could not replace the pending certificate preview|Pending certificate version/.test(message)
          ? 409
        : /NFC UID is already registered|UNIQUE constraint|limited edition size cannot change|Could not record the sale|Could not cancel the sale/.test(message)
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
