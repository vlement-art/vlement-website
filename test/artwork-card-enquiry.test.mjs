import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

for (const page of ['index.html', 'work/index.html']) {
  test(`${page} links available artwork cards to their existing enquiry form`, async () => {
    const html = await readFile(join('dist', page), 'utf8');
    const cards = [...html.matchAll(/<article class="artwork-card\b[\s\S]*?<\/article>/g)];
    assert.ok(cards.length, 'expected artwork cards');

    for (const [card] of cards) {
      const links = [...card.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>[\s\S]*?<\/a>/g)];
      const detail = links.find(([, href]) => href.startsWith('/work/'));
      assert.ok(detail, 'card should link to its artwork');
      const enquiry = links.find(([, href]) => href.startsWith('/contact?'));
      const available = />\s*Available\s*<\/span>/.test(card);
      assert.equal(Boolean(enquiry), available, `${detail[1]} availability`);
      if (!enquiry) continue;

      assert.ok(card.indexOf(enquiry[0]) > card.indexOf(detail[0]) + detail[0].length - 1);
      const detailPage = await readFile(join('dist', detail[1], 'index.html'), 'utf8');
      const detailLink = detailPage.match(/<a\b[^>]*href="([^"]*)"[^>]*aria-label="Request information about /);
      assert.ok(detailLink, `${detail[1]} should have a detail enquiry link`);
      assert.equal(enquiry[1], detailLink[1], `${detail[1]} enquiry details must match`);
    }
  });
}
