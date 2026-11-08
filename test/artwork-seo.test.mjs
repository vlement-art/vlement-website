import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artworkTitle, artworkDescription } from '../src/lib/artwork-seo.mjs';

const painting = {
  title: 'Ballerinas 2', year: 2021, category: 'Original painting',
  medium: 'Acrylic on Canvas panel', dimensions: '42 X 30cm',
  editionType: 'original', available: true,
};

test('generates artwork titles without guessing and respects the length fallback', () => {
  assert.equal(artworkTitle(painting), 'Ballerinas 2 (2021) | Original Painting by Vlement J. Rodrigues');
  assert.equal(artworkTitle({ ...painting, category: 'Mixed media' }), 'Ballerinas 2 (2021) | Original Artwork by Vlement J. Rodrigues');
  assert.equal(artworkTitle({ ...painting, category: 'Print', editionType: 'open' }), 'Ballerinas 2 (2021) | Open Edition Print by Vlement J. Rodrigues');
  assert.equal(artworkTitle({ ...painting, category: 'Unknown', editionType: undefined }), 'Ballerinas 2 (2021) — Vlement J. Rodrigues');
  assert.match(artworkTitle({ ...painting, title: 'A longer painting title' }), / by Vlement$/);
  assert.equal(artworkTitle({ ...painting, title: 'A very long painting title that exceeds the limit completely' }), 'A very long painting title that exceeds the limit completely (2021) — Vlement J. Rodrigues');
});

test('generates descriptions with optional fields, editions and a full sentence only when it fits', () => {
  assert.equal(artworkDescription(painting, ''), 'Ballerinas 2 (2021), original painting by London artist Vlement J. Rodrigues. Acrylic on Canvas panel, 42 × 30 cm. Available.');
  const print = { title: 'La Luz', year: 2024, category: 'Print', editionType: 'limited', editionSize: 50, medium: 'Print-Hahnemühle Photo Rag Giclée', dimensions: '30 x 42cm', available: true };
  assert.equal(artworkDescription(print, ''), 'La Luz (2024), limited edition print (edition of 50) by London artist Vlement J. Rodrigues. Hahnemühle Photo Rag Giclée, 30 × 42 cm. Available.');
  assert.match(artworkDescription({ ...print, editionSize: undefined, edition: 'Limited edition' }, ''), /limited edition print by/);
  assert.match(artworkDescription({ ...print, editionSize: undefined, edition: 'Limited edition of 25' }, ''), /edition of 25/);
  assert.match(artworkDescription({ ...print, editionType: 'open', medium: 'Print - Paper', available: false }, ''), /open edition print.*Paper.*Sold\./);
  const missing = artworkDescription({ title: 'Test', category: '', medium: '', dimensions: '', available: false }, 'A short sentence. Another sentence.');
  assert.doesNotMatch(missing, /undefined|\(\)|,\s*\.|\.\s*\./);
  assert.match(missing, /Sold\. A short sentence\.$/);
  assert.equal(artworkDescription({ ...painting, seoDescription: '  A custom & unique description.  ' }, ''), 'A custom & unique description.');
  const long = artworkDescription({ ...painting, medium: 'A very long medium name '.repeat(20) }, '');
  assert.ok(long.length <= 155);
  assert.ok(!long.endsWith('mediu'));
});
