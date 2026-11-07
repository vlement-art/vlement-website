import type { Env } from './types';

const artworkCodeTypeMap = {
  original: 'O',
  limited: 'LE',
  open: 'OE',
} as const;

const artworkLetterMap = {
  O: 'A',
  LE: 'B',
  OE: 'C',
} as const;

const artworkCodePattern = /^VL-(?:O-A|LE-B|OE-C)\d{4,}$/;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
    },
  });
}

function requiredText(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`Enter a valid ${field}.`);
  }
  return value.trim();
}

function normalizeArtworkCodeType(value: unknown): 'O' | 'LE' | 'OE' {
  if (typeof value !== 'string') throw new Error('Choose a valid artwork type.');
  const normalized = value.toLowerCase();
  const mapped = normalized === 'original' ? 'O' : normalized === 'limited' ? 'LE' : normalized === 'open' ? 'OE' : null;
  if (!mapped) throw new Error('Choose a valid artwork type.');
  return mapped;
}

function buildArtworkCode(type: 'O' | 'LE' | 'OE', nextNumber: number): string {
  const letter = artworkLetterMap[type];
  const count = String(nextNumber).padStart(4, '0');
  const typeSegment = type === 'O' ? 'O' : type === 'LE' ? 'LE' : 'OE';
  return `VL-${typeSegment}-${letter}${count}`;
}

function validateArtworkCode(code: string): void {
  if (!artworkCodePattern.test(code)) {
    throw new Error('Artwork code validation failed.');
  }
}

async function getCounterNext(env: Env, type: 'O' | 'LE' | 'OE'): Promise<number> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO code_counter (type, next_number) VALUES (?, 1)`,
  ).bind(type).run();

  const row = await env.DB.prepare(
    `UPDATE code_counter SET next_number = next_number + 1 WHERE type = ? RETURNING next_number - 1 AS next_number`,
  ).bind(type).first<{ next_number: number }>();

  if (!row || !Number.isFinite(row.next_number)) {
    throw new Error('Could not allocate the next artwork code.');
  }

  return Number(row.next_number);
}

async function listArtworkCodes(env: Env): Promise<Array<Record<string, unknown>>> {
  const { results } = await env.DB.prepare(
    `SELECT ac.artwork_slug,
            ac.artwork_code,
            ac.type,
            ac.edition_size,
            ac.based_on_code,
            ac.status,
            ac.created_at,
            (SELECT COUNT(*) FROM artwork_units au WHERE au.artwork_code = ac.artwork_code AND au.status = 'sold') AS sold_units,
            (SELECT COUNT(*) FROM artwork_units au WHERE au.artwork_code = ac.artwork_code AND au.status = 'reserved') AS reserved_units
       FROM artwork_codes ac
       ORDER BY ac.artwork_slug ASC`,
  ).all<Record<string, unknown>>();
  return results;
}

async function getArtworkCodeRecord(env: Env, slug: string): Promise<Record<string, unknown> | null> {
  const row = await env.DB.prepare(
    `SELECT ac.artwork_slug,
            ac.artwork_code,
            ac.type,
            ac.edition_size,
            ac.based_on_code,
            ac.status,
            ac.created_at,
            (SELECT COUNT(*) FROM artwork_units au WHERE au.artwork_code = ac.artwork_code AND au.status = 'sold') AS sold_units,
            (SELECT COUNT(*) FROM artwork_units au WHERE au.artwork_code = ac.artwork_code AND au.status = 'reserved') AS reserved_units
       FROM artwork_codes ac
      WHERE ac.artwork_slug = ?
      LIMIT 1`,
  ).bind(slug).first<Record<string, unknown>>();
  return row ?? null;
}

async function upsertArtworkCode(env: Env, body: unknown, actorId: string): Promise<Response> {
  if (!body || typeof body !== 'object') throw new Error('Enter artwork code details.');
  const input = body as Record<string, unknown>;
  const slug = requiredText(input.slug, 'artwork slug', 120);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Enter a valid artwork slug.');

  const existing = await getArtworkCodeRecord(env, slug);
  if (existing) return jsonResponse({ code: existing }, 200);

  const type = normalizeArtworkCodeType(input.type);
  const editionSize = input.edition_size !== undefined && input.edition_size !== null
    ? Number(input.edition_size)
    : null;

  if (type === 'LE') {
    if (!Number.isInteger(editionSize) || Number(editionSize) < 1) {
      throw new Error('Limited editions require an edition size.');
    }
  } else if (editionSize !== null && Number.isFinite(editionSize)) {
    throw new Error('Only limited editions can have an edition size.');
  }

  const basedOnCode = typeof input.based_on_code === 'string' && input.based_on_code.trim()
    ? input.based_on_code.trim()
    : null;
  if (basedOnCode) {
    const parent = await env.DB.prepare(
      `SELECT artwork_code FROM artwork_codes WHERE artwork_code = ? LIMIT 1`,
    ).bind(basedOnCode).first<{ artwork_code: string }>();
    if (!parent) throw new Error('The referenced artwork code was not found.');
  }

  const nextNumber = await getCounterNext(env, type);
  const artworkCode = buildArtworkCode(type, nextNumber);
  validateArtworkCode(artworkCode);

  const createdAt = new Date().toISOString();
  const id = crypto.randomUUID();
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO artwork_codes (id, artwork_slug, artwork_code, type, edition_size, based_on_code, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
    ).bind(
      id,
      slug,
      artworkCode,
      type,
      type === 'LE' ? Number(editionSize) : null,
      basedOnCode,
      createdAt,
    ),
    env.DB.prepare(
      `INSERT INTO artwork_code_audit_log (id, actor_id, action, artwork_code, occurred_at, details_json)
       VALUES (?, ?, 'code_created', ?, ?, ?)`,
    ).bind(crypto.randomUUID(), actorId, artworkCode, createdAt, JSON.stringify({ slug, type })),
  ]);
  if (results.some(result => !result.success)) {
    throw new Error('Could not create the artwork code.');
  }

  const record = await getArtworkCodeRecord(env, slug);
  if (!record) throw new Error('The new artwork code could not be loaded.');
  return jsonResponse({ code: record }, 201);
}

export async function handleArtworkCodeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/api\/admin\/artwork-codes(?:\/(.+))?$/.exec(url.pathname);
  if (!match) return jsonResponse({ error: 'Not found.' }, 404);

  if (request.method === 'GET' && !match[1]) {
    return jsonResponse({ codes: await listArtworkCodes(env) }, 200);
  }

  if (request.method === 'POST' && !match[1]) {
    const body = JSON.parse(await request.text());
    return upsertArtworkCode(env, body, env.ALLOWED_GITHUB_USER_ID || 'admin');
  }

  if (request.method === 'GET' && match[1]) {
    const slug = decodeURIComponent(match[1]);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return jsonResponse({ error: 'Enter a valid artwork slug.' }, 400);
    }
    const record = await getArtworkCodeRecord(env, slug);
    if (!record) return jsonResponse({ error: 'Artwork code not found.' }, 404);
    return jsonResponse({ code: record }, 200);
  }

  return jsonResponse({ error: 'Method not allowed.' }, 405);
}

export { artworkCodePattern, artworkCodeTypeMap, artworkLetterMap, normalizeArtworkCodeType, buildArtworkCode };
