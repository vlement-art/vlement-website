import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(`dist/${path}`, 'utf8');
const meta = (html, key, value) => html.match(new RegExp(`<meta ${key}="${value}" content="([^"]*)"`, 'i'))?.[1];

test('built artwork metadata is consistent with the canonical and social tags', async () => {
  for (const slug of ['ballerinas-2', 'la-luz', 'ballerinas-4', 'pastilla-para-dejar-de-so-ar', 'thanks-mr-overton']) {
    const html = await read(`work/${slug}/index.html`);
    const title = html.match(/<title>(.*?)<\/title>/)?.[1];
    const description = meta(html, 'name', 'description');
    assert.ok(title && description);
    assert.equal(meta(html, 'property', 'og:title'), title);
    assert.equal(meta(html, 'name', 'twitter:title'), title);
    assert.equal(meta(html, 'property', 'og:description'), description);
    assert.equal(meta(html, 'name', 'twitter:description'), description);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://vlement.com/work/${slug}"`));
    assert.doesNotMatch(html, /<meta name="robots" content="[^"]*noindex/);
  }
});

test('homepage, contact and private pages have the intended indexing and heading', async () => {
  const home = await read('index.html');
  const title = 'Vlement J. Rodrigues | Original Paintings &amp; Limited Edition Prints';
  assert.ok(home.includes(`<title>${title}</title>`));
  assert.equal(meta(home, 'property', 'og:title')?.replaceAll('&#38;', '&amp;'), title);
  assert.equal(meta(home, 'name', 'twitter:title')?.replaceAll('&#38;', '&amp;'), title);
  assert.equal((home.match(/<h1\b/g) || []).length, 1);
  assert.match(home, /<h1\b[^>]*>\s*Vlement\s*<span[^>]*>J\. Rodrigues<\/span>\s*<\/h1>/);
  for (const path of ['index.html', 'work/index.html', 'about/index.html', 'contact/index.html', 'privacy/index.html']) {
    assert.doesNotMatch(await read(path), /<meta name="robots" content="[^"]*noindex/);
  }
  assert.match(await read('contact/index.html'), /<link rel="canonical" href="https:\/\/vlement.com\/contact"/);
  for (const path of ['admin/index.html', 'verify/index.html']) {
    assert.match(await read(path), /<meta name="robots" content="[^"]*noindex/);
  }
});
