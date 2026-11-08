import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDimensions } from '../src/lib/dimensions.mjs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('formats two centimetre values in the original order', () => {
  for (const input of ['42 x 30 cm', '42x30cm', '42 X 30 CM', '42 × 30 cm']) {
    assert.equal(formatDimensions(input), '42 × 30 cm / 16.54 × 11.81 in');
  }
  assert.equal(formatDimensions('42.5 x 30 cm'), '42.5 × 30 cm / 16.73 × 11.81 in');
  assert.equal(formatDimensions('30.00 x 42 cm'), '30.00 × 42 cm / 11.81 × 16.54 in');
});

test('built public artwork page and gallery show the same sold artwork dimensions', async () => {
  const expected = '42 × 30 cm / 16.54 × 11.81 in';
  const detail = await readFile('dist/work/pastilla-para-dejar-de-so-ar/index.html', 'utf8');
  const gallery = await readFile('dist/work/index.html', 'utf8');
  assert.ok(detail.includes(expected));
  const card = [...gallery.matchAll(/<article class="artwork-card\b[\s\S]*?<\/article>/g)]
    .map(([html]) => html).find(html => html.includes('/work/pastilla-para-dejar-de-so-ar'));
  assert.ok(card?.includes(expected));
});

test('verification page formats stored dimensions at display time', async () => {
  const html = await readFile('dist/verify/index.html', 'utf8');
  const script = html.match(/<script>\s*const result[\s\S]*?<\/script>/)?.[0]
    .replace(/^<script>/, '').replace(/<\/script>$/, '');
  assert.ok(script);
  const result = {};
  const context = vm.createContext({
    document: { getElementById: () => result },
    location: { search: '?t=fixture' },
    window: { CERTIFICATES_API_URL: 'http://localhost' },
    URLSearchParams,
    fetch: async () => ({ json: async () => ({
      status: 'valid',
      artwork: { dimensions: '42 X 30 cm' },
    }) }),
  });
  vm.runInContext(await readFile('dist/admin/dimensions.js', 'utf8'), context);
  vm.runInContext(script, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(result.innerHTML, /42 × 30 cm \/ 16\.54 × 11\.81 in/);
});

test('leaves other text unchanged and does not produce invalid numbers', () => {
  for (const input of [
    'Variable dimensions', '', '  ', '42 x 30 in', '42 x 30 x 2 cm',
    '42 x 30 cm / 11.81 × 16.54 Inch', '42,5 x 30 cm', 'NaN x 30 cm',
    `${'9'.repeat(400)} x 30 cm`,
  ]) {
    assert.equal(formatDimensions(input), input);
  }
});
