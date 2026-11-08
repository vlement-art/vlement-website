import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { createCertificatePdf } from '../src/admin/certificate-pdf.js';

test('local samples fit the page, retain text and have scannable vector QR codes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vlement-certificate-pdf-'));
  try {
    execFileSync(process.execPath, ['scripts/certificate-pdf-samples.mjs', dir]);
    for (const name of ['uid', 'empty-uid', 'portrait', 'long-title']) {
      const file = path.join(dir, `${name}.pdf`);
      const pdf = await PDFDocument.load(await readFile(file));
      const page = pdf.getPage(0);
      assert.equal(pdf.getPageCount(), 1);
      assert.ok(Math.abs(page.getWidth() - 21 * 72 / 2.54) < 0.01);
      assert.ok(Math.abs(page.getHeight() - 29.7 * 72 / 2.54) < 0.01);
      const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
      assert.match(text, /Soñar/);
      assert.match(text.replace(/\s+/g, ' '), /42 × 30 cm \/ 16\.54 × 11\.81 in/);
      assert.match(text, /VL-O-A0001/);
      assert.match(text, /NFC UID:/);
      assert.equal(text.includes('04:8B:22:25'), name === 'uid');
      const bbox = execFileSync('pdftotext', ['-bbox', file, '-'], { encoding: 'utf8' });
      const words = [...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
        .map(match => ({ x1: +match[1], y1: +match[2], x2: +match[3], y2: +match[4], text: match[5] }));
      assert.ok(words.length > 20);
      const border = 0.78 * 72 / 2.54;
      for (const word of words) {
        assert.ok(word.x1 > border && word.x2 < page.getWidth() - border, `${name}: horizontal border ${word.text}`);
        assert.ok(word.y1 > border && word.y2 < page.getHeight() - border, `${name}: vertical border ${word.text}`);
      }
      const bottom = words.filter(word => word.text.includes('VLEMENT.COM/VERIFY'));
      assert.equal(bottom.length, 1);
      assert.ok(page.getHeight() - border - bottom[0].y2 >= 72 / 2.54, `${name}: bottom text margin`);
      for (let i = 0; i < words.length; i++) {
        for (let j = i + 1; j < words.length; j++) {
          const a = words[i], b = words[j];
          const overlapX = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
          const overlapY = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
          assert.ok(overlapX <= 0.1 || overlapY <= 0.1, `${name}: ${a.text} overlaps ${b.text}`);
        }
      }
      const imageList = execFileSync('pdfimages', ['-list', file], { encoding: 'utf8' });
      assert.equal(imageList.split('\n').filter(line => /^\s*1\s+\d+\s+image\s/.test(line)).length, 1,
        `${name}: only the artwork should be rasterized`);
      execFileSync('pdftoppm', ['-f', '1', '-l', '1', '-png', '-r', '150', '-singlefile', file, path.join(dir, name)]);
      const scanned = execFileSync('zbarimg', ['--quiet', '--raw', path.join(dir, `${name}.png`)], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      assert.equal(scanned, 'https://vlement.com/verify/?t=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg');
    }

    const fonts = {
      regular: await readFile('node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff'),
      bold: await readFile('node_modules/@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff'),
    };
    const image = await sharp('public/images/artwork/pastilla-para-dejar-de-so-ar.webp').resize({ width: 400 }).jpeg().toBuffer();
    const snapshot = {
      title: 'Pastilla Para Dejar De Soñar', year: 2024, medium: 'Oil',
      dimensions: '42 X 30 cm', certificateType: 'limited_edition',
      editionNumber: 3, editionSize: 20, certificateWording: 'Limited edition.',
    };
    const fallbackFile = path.join(dir, 'fallback.pdf');
    await writeFile(fallbackFile, await createCertificatePdf(snapshot, 'https://vlement.com/verify/?t=local-fixture', 'VL-LE-2026-0001', image, fonts));
    const fallbackText = execFileSync('pdftotext', ['-layout', fallbackFile, '-'], { encoding: 'utf8' });
    assert.match(fallbackText, /VL-LE-2026-0001/);
    assert.match(fallbackText, /Edition 3 of 20/);
    await assert.rejects(
      createCertificatePdf({ ...snapshot, title: 'M'.repeat(250) }, 'https://vlement.com/verify/?t=local-fixture', 'VL-LE-2026-0001', image, fonts),
      /ARTWORK is too long/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
