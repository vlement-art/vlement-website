#!/usr/bin/env node
// Backfill artwork codes for existing artworks in two reviewed steps.
//   --dry-run  (default) writes a review CSV. Never writes to the database.
//   --apply    reads the approved CSV and creates missing codes via the Worker API.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = new Set(['original', 'limited', 'open']);
const HEADER = ['slug', 'title', 'proposed_type', 'edition_size', 'note'];
const NEEDS_DECISION = 'NEEDS DECISION';

export function parseFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  const data = {};
  if (!match) return data;
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z][\w]*):\s*(.*)$/.exec(line);
    if (pair) data[pair[1]] = pair[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return data;
}

export function proposeRow(slug, data) {
  const title = data.title || slug;
  const type = data.editionType;
  const categoryType = data.category === 'Original painting' ? 'original' : null;
  const proposedType = TYPES.has(type) ? type : categoryType;
  if (!proposedType) {
    const note = data.category === 'Print'
      ? 'Choose limited or open for this print'
      : 'No usable editionType or category in markdown';
    return { slug, title, proposed_type: NEEDS_DECISION, edition_size: '', note };
  }
  if (proposedType === 'limited') {
    const size = Number(data.editionSize);
    if (!Number.isInteger(size) || size < 1) {
      return { slug, title, proposed_type: NEEDS_DECISION, edition_size: '', note: 'Limited edition without a valid editionSize' };
    }
    return { slug, title, proposed_type: proposedType, edition_size: String(size), note: '' };
  }
  return { slug, title, proposed_type: proposedType, edition_size: '', note: '' };
}

const quote = value => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export function toCsv(rows) {
  return [HEADER.join(','), ...rows.map(row => HEADER.map(key => quote(row[key] ?? '')).join(','))].join('\n') + '\n';
}

export function parseCsv(text) {
  const records = [];
  let field = '', record = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { record.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field); field = '';
      if (record.some(Boolean)) records.push(record);
      record = [];
    } else field += ch;
  }
  record.push(field);
  if (record.some(Boolean)) records.push(record);
  const [head, ...body] = records;
  if (!head || HEADER.some((key, index) => head[index] !== key)) {
    throw new Error(`CSV header must be: ${HEADER.join(',')}`);
  }
  return body.map(cells => Object.fromEntries(HEADER.map((key, index) => [key, (cells[index] ?? '').trim()])));
}

export function validateApprovedRows(rows) {
  const problems = [];
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.slug)) problems.push(`${row.slug}: duplicate row`);
    seen.add(row.slug);
    if (row.proposed_type === NEEDS_DECISION) problems.push(`${row.slug}: still ${NEEDS_DECISION}`);
    else if (!TYPES.has(row.proposed_type)) problems.push(`${row.slug}: invalid type "${row.proposed_type}"`);
    else if (row.proposed_type === 'limited' && !(Number.isInteger(Number(row.edition_size)) && Number(row.edition_size) >= 1)) {
      problems.push(`${row.slug}: limited edition needs edition_size`);
    } else if (row.proposed_type !== 'limited' && row.edition_size) {
      problems.push(`${row.slug}: only limited editions can have edition_size`);
    }
  }
  return problems;
}

async function api(config, method, pathname, body) {
  const response = await fetch(`${config.apiUrl}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${pathname} failed (${response.status}): ${payload.error || 'unknown error'}`);
  return payload;
}

async function existingCodes(config) {
  const payload = await api(config, 'GET', '/api/admin/artwork-codes');
  return new Map((payload.codes || []).map(code => [code.artwork_slug, code.artwork_code]));
}

function parseArgs(argv) {
  const args = { mode: 'dry-run', csv: 'artwork-codes-review.csv', content: 'src/content/artworks' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') args.mode = 'apply';
    else if (arg === '--dry-run') args.mode = 'dry-run';
    else if (arg === '--csv') args.csv = argv[++i];
    else if (arg === '--content') args.content = argv[++i];
    else if (arg === '--api-url') args.apiUrl = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  args.apiUrl = (args.apiUrl || process.env.CERTIFICATES_API_URL || '').replace(/\/$/, '');
  args.token = process.env.VLEMENT_ADMIN_TOKEN || '';
  return args;
}

async function dryRun(args) {
  const files = (await readdir(args.content)).filter(name => name.endsWith('.md')).sort();
  let existing = new Map();
  if (args.apiUrl && args.token) existing = await existingCodes(args);
  else console.log('No API URL/token set: listing every artwork, including any that may already have a code.');

  const rows = [];
  for (const file of files) {
    const slug = file.replace(/\.md$/, '');
    if (existing.has(slug)) continue;
    rows.push(proposeRow(slug, parseFrontmatter(await readFile(path.join(args.content, file), 'utf8'))));
  }
  await writeFile(args.csv, toCsv(rows));
  const undecided = rows.filter(row => row.proposed_type === NEEDS_DECISION).length;
  console.log(`Wrote ${rows.length} rows to ${args.csv} (${undecided} ${NEEDS_DECISION}). Nothing was written to the database.`);
}

async function apply(args) {
  if (!args.apiUrl || !args.token) throw new Error('Set CERTIFICATES_API_URL (or --api-url) and VLEMENT_ADMIN_TOKEN.');
  const rows = parseCsv(await readFile(args.csv, 'utf8'));
  const problems = validateApprovedRows(rows);
  if (problems.length) throw new Error(`Refusing to apply:\n  ${problems.join('\n  ')}`);

  const existing = await existingCodes(args);
  let created = 0, skipped = 0;
  for (const row of rows) {
    if (existing.has(row.slug)) {
      console.log(`skip  ${row.slug} (already ${existing.get(row.slug)})`);
      skipped++;
      continue;
    }
    const payload = await api(args, 'POST', '/api/admin/artwork-codes', {
      slug: row.slug,
      type: row.proposed_type,
      ...(row.proposed_type === 'limited' ? { edition_size: Number(row.edition_size) } : {}),
    });
    console.log(`new   ${row.slug} -> ${payload.code.artwork_code}`);
    created++;
  }
  console.log(`Done. Created ${created}, skipped ${skipped}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  (args.mode === 'apply' ? apply(args) : dryRun(args)).catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
