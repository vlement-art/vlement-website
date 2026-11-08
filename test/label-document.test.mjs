import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Packer } from 'docx';
import { PDFDocument } from 'pdf-lib';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { load as loadYaml } from 'js-yaml';
import JSZip from 'jszip';
import { createLabelDocument, labelOrientation, shortDescription } from '../src/admin/label-document.js';

test('orientation and sentence boundaries are deterministic', () => {
  assert.equal(labelOrientation('auto', 800, 600), 'landscape');
  assert.equal(labelOrientation('auto', 600, 800), 'portrait');
  assert.equal(labelOrientation('auto', 800, 800), 'landscape');
  assert.equal(labelOrientation('portrait', 800, 600), 'portrait');
  assert.equal(shortDescription('A sentence. '.repeat(60)).text.length <= 350, true);
  assert.equal(shortDescription('A'.repeat(500)).text, '');
  assert.equal(shortDescription('').shortened, false);
  assert.throws(() => createLabelDocument({
    artwork: { data: { title: 'Test', medium: 'Oil', dimensions: '42 x 30 cm' }, description: 'Price £100.' },
    orientation: 'landscape', image: { width: 800, height: 600 }, qr: new Uint8Array(),
  }), /price or sale information/i);
});

test('editable A5 labels render on one page with undistorted artwork and scannable QR', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vlement-label-'));
  const screenshotDir = process.env.LABEL_SCREENSHOT_DIR;
  const cases = [
    { name: 'sold-landscape', slug: 'pastilla-para-dejar-de-so-ar', image: 'public/images/artwork/pastilla-para-dejar-de-so-ar.webp',
      title: 'Pastilla Para Dejar De Soñar', dimensions: '42 X 30 cm', medium: 'Oil on canvas Panel',
      description: 'A painting about dreams and the imagination.' },
    { name: 'portrait', slug: 'la-luz', image: 'public/images/artwork/la-luz.jpg',
      title: 'La Luz', dimensions: '30 x 42 cm', medium: 'Oil on canvas',
      description: 'A quiet study in light and shadow.' },
    { name: 'print', slug: 'slippery-spring', image: 'public/images/artwork/slippery-spring.webp',
      title: 'Slippery Spring', dimensions: '30 x 42 cm', medium: 'Giclée', editionType: 'limited',
      description: 'A seasonal exploration of spring.' },
    { name: 'long-title', slug: 'long-title', image: 'public/images/artwork/pastilla-para-dejar-de-so-ar.webp',
      title: 'Pastilla Para Dejar De Soñar Y Encontrar La Luz De Una Nueva Mañana', dimensions: '42 X 30 cm',
      medium: 'Oil on canvas Panel', description: 'A sentence about the painting. '.repeat(20) },
    { name: 'no-description', slug: 'no-description', image: 'public/images/artwork/la-luz.jpg',
      title: 'Untitled', dimensions: 'Variable dimensions', medium: 'Oil', description: '' },
    { name: 'portrait-long', slug: 'long-title', image: 'public/images/artwork/la-luz.jpg',
      title: 'Pastilla Para Dejar De Soñar Y Encontrar La Luz De Una Nueva Mañana', dimensions: '30 x 42 cm',
      medium: 'Oil on canvas Panel', description: 'A sentence about the painting. '.repeat(20) },
    { name: 'portrait-boundary', slug: 'portrait-boundary', image: 'public/images/artwork/la-luz.jpg',
      title: 'Beautiful bold colour study in a rich and expressive landscape '.repeat(2).trim(),
      dimensions: '30 x 42 cm', medium: 'Acrylic and oil on canvas panel with pigments and mixed media',
      description: 'A sentence about the painting. '.repeat(20) },
    { name: 'portrait-wide-text', slug: 'portrait-wide-text', image: 'public/images/artwork/la-luz.jpg',
      title: 'W '.repeat(75).trim(), dimensions: 'W '.repeat(50).trim(), medium: 'W '.repeat(50).trim(),
      description: 'W '.repeat(174) + '.' },
    { name: 'landscape-wide-text', slug: 'landscape-wide-text', image: 'public/images/artwork/pastilla-para-dejar-de-so-ar.webp',
      title: 'W '.repeat(75).trim(), dimensions: 'W '.repeat(50).trim(), medium: 'W '.repeat(50).trim(),
      description: 'W '.repeat(174) + '.' },
    { name: 'override-landscape', slug: 'la-luz', image: 'public/images/artwork/la-luz.jpg',
      title: 'La Luz', dimensions: '30 x 42 cm', medium: 'Oil', description: '', override: 'landscape' },
    { name: 'override-portrait', slug: 'pastilla-para-dejar-de-so-ar', image: 'public/images/artwork/pastilla-para-dejar-de-so-ar.webp',
      title: 'Pastilla Para Dejar De Soñar', dimensions: '42 x 30 cm', medium: 'Oil', description: '', override: 'portrait' },
  ];
  try {
    if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
    for (const item of cases) {
      if (['sold-landscape', 'portrait', 'print'].includes(item.name)) {
        const raw = await readFile(`src/content/artworks/${item.slug}.md`, 'utf8');
        const match = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/.exec(raw);
        assert.ok(match);
        const saved = loadYaml(match[1]);
        Object.assign(item, { title: saved.title, year: saved.year, medium: saved.medium, dimensions: saved.dimensions,
          editionType: saved.editionType, description: match[2].trim() || saved.summary || '' });
      }
      const { data: imageBytes, info } = await sharp(item.image).rotate().resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true }).jpeg().toBuffer({ resolveWithObject: true });
      const orientation = labelOrientation(item.override || 'auto', info.width, info.height);
      const url = `https://vlement.com/work/${item.slug}`;
      const qr = await QRCode.toBuffer(url, { width: 360, margin: 4 });
      const { document } = createLabelDocument({
        artwork: { data: { ...item, year: item.year || 2024 }, description: item.description },
        orientation, image: { bytes: imageBytes, width: info.width, height: info.height }, qr,
      });
      const docx = path.join(dir, `${item.name}.docx`);
      const docxBytes = await Packer.toBuffer(document);
      await writeFile(docx, docxBytes);
      if (item.name === 'sold-landscape') {
        execFileSync('/usr/bin/python3', ['test/label-editable.py', docx], { stdio: 'pipe', timeout: 30000 });
      }
      const zip = await JSZip.loadAsync(docxBytes);
      const xml = await zip.file('word/document.xml').async('string');
      assert.ok(xml.includes(item.title), `${item.name}: title is editable text`);
      assert.doesNotMatch(xml, /<w:txbxContent|<w:drawing[^>]*anchor/);
      const extent = xml.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
      assert.ok(extent);
      assert.ok(Math.abs((+extent[1] / +extent[2]) - info.width / info.height) < 0.02, `${item.name}: image ratio`);
      execFileSync('libreoffice', ['-env:UserInstallation=file://' + path.join(dir, 'profile'), '--headless', '--convert-to', 'pdf', '--outdir', dir, docx], { stdio: 'pipe' });
      const pdfPath = path.join(dir, `${item.name}.pdf`);
      const pdf = await PDFDocument.load(await readFile(pdfPath));
      assert.equal(pdf.getPageCount(), 1, item.name);
      const page = pdf.getPage(0);
      assert.equal(page.getWidth() > page.getHeight(), orientation === 'landscape');
      assert.ok(Math.abs(page.getWidth() * 2.54 / 72 - (orientation === 'landscape' ? 21 : 14.8)) < 0.02);
      assert.ok(Math.abs(page.getHeight() * 2.54 / 72 - (orientation === 'landscape' ? 14.8 : 21)) < 0.02);
      const text = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
      assert.match(text, /VLEMENT J\. RODRIGUES/);
      assert.match(text, /View this artwork online/);
      assert.match(text, /vlement\.com/);
      assert.doesNotMatch(text, /VL-(?:O|LE|OE)-|NFC UID|certificate number|receipt number|£/i);
      if (item.name === 'sold-landscape') {
        assert.match(text, /Soñar/);
        assert.match(text, /42 × 30 cm \/ 16\.54 × 11\.81 in/);
      }
      if (item.editionType === 'limited') assert.match(text, /Limited edition print/);
      const bbox = execFileSync('pdftotext', ['-bbox', pdfPath, '-'], { encoding: 'utf8' });
      const words = [...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)]
        .map(match => ({ x1: +match[1], y1: +match[2], x2: +match[3], y2: +match[4], text: match[5] }));
      const margin = 0.8 * 72 / 2.54;
      for (const word of words) {
        assert.ok(word.x1 >= margin - 1 && word.x2 <= page.getWidth() - margin + 1, `${item.name}: horizontal margin ${word.text}`);
        assert.ok(word.y1 >= margin - 1 && word.y2 <= page.getHeight() - margin + 1, `${item.name}: vertical margin ${word.text}`);
      }
      for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) {
        const a = words[i], b = words[j];
        assert.ok(Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) <= 0.1 ||
          Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) <= 0.1, `${item.name}: overlap ${a.text} ${b.text}`);
      }
      const geometry = execFileSync('pdftohtml', ['-xml', '-stdout', pdfPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const pageWidth = Number(geometry.match(/<page\b[^>]*width="(\d+)"/)?.[1]);
      const scale = page.getWidth() / pageWidth;
      const images = [...geometry.matchAll(/<image top="(\d+)" left="(\d+)" width="(\d+)" height="(\d+)"/g)]
        .map(match => ({ y1: +match[1] * scale, x1: +match[2] * scale,
          x2: (+match[2] + +match[3]) * scale, y2: (+match[1] + +match[4]) * scale }));
      assert.equal(images.length, 2, `${item.name}: artwork and QR images`);
      for (const image of images) {
        assert.ok(image.x1 >= margin - 2 && image.x2 <= page.getWidth() - margin + 2, `${item.name}: image horizontal margin`);
        assert.ok(image.y1 >= margin - 2 && image.y2 <= page.getHeight() - margin + 2, `${item.name}: image vertical margin`);
        for (const word of words) {
          assert.ok(Math.min(image.x2, word.x2) - Math.max(image.x1, word.x1) <= 1 ||
            Math.min(image.y2, word.y2) - Math.max(image.y1, word.y1) <= 1, `${item.name}: image overlaps ${word.text}`);
        }
      }
      execFileSync('pdftoppm', ['-png', '-r', '200', '-singlefile', pdfPath, path.join(dir, item.name)]);
      const png = path.join(dir, `${item.name}.png`);
      const scanned = execFileSync('zbarimg', ['--quiet', '--raw', png], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      assert.equal(scanned, url);
      if (screenshotDir) {
        await writeFile(path.join(screenshotDir, `${item.name}.png`), await readFile(png));
      }
    }
    assert.equal((await readdir(dir)).filter(name => name.endsWith('.docx')).length, cases.length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
