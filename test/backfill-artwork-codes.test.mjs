import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv, parseFrontmatter, proposeRow, toCsv, validateApprovedRows } from '../scripts/backfill-artwork-codes.mjs';

test('proposes types from frontmatter and flags unclear ones', () => {
  const fm = parseFrontmatter("---\ntitle: 'A, \"B\"'\neditionType: limited\neditionSize: 50\n---\nbody");
  assert.deepEqual(proposeRow('a', fm), { slug: 'a', title: 'A, "B"', proposed_type: 'limited', edition_size: '50', note: '' });
  assert.equal(proposeRow('b', { title: 'B' }).proposed_type, 'NEEDS DECISION');
  assert.equal(proposeRow('c', { editionType: 'limited' }).proposed_type, 'NEEDS DECISION');
});

test('CSV round-trips and approval validation refuses undecided rows', () => {
  const rows = [proposeRow('a', { title: 'A, "B"', editionType: 'open' }), proposeRow('b', {})];
  const parsed = parseCsv(toCsv(rows));
  assert.deepEqual(parsed.map(r => r.title), ['A, "B"', 'b']);
  assert.equal(validateApprovedRows(parsed).length, 1);
  parsed[1].proposed_type = 'original';
  assert.deepEqual(validateApprovedRows(parsed), []);
  parsed[1].proposed_type = 'limited';
  assert.equal(validateApprovedRows(parsed).length, 1);
});
