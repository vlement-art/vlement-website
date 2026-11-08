import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import sharp from 'sharp';
import { formatDimensions } from '../src/lib/dimensions.mjs';

async function editorContext() {
  const html = await readFile('public/admin/index.html', 'utf8');
  const script = html.match(/<script>\s*\/\* ---------------------------------------------------------------------\s*CONFIG[\s\S]*?<\/script>/)?.[0]
    .replace(/^<script>/, '').replace(/<\/script>$/, '');
  assert.ok(script, 'admin editor script exists');
  const elements = new Map();
  const context = vm.createContext({
    window: {},
    VlementDimensions: { formatDimensions },
    elements,
    sessionStorage: { getItem: () => null },
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, {
          value: '',
          addEventListener(type, handler) { this[`on${type}`] = handler; },
          replaceChildren() {},
          append() {},
        });
        return elements.get(id);
      },
      createElement: () => ({}),
    },
    DataView, Uint8Array, File, URL, console, setTimeout, clearTimeout,
  });
  vm.runInContext(script, context);
  return context;
}

test('editor keeps the typed dimensions and updates its display preview', async () => {
  const context = await editorContext();
  vm.runInContext(`
    document.getElementById('f-dimensions').value = '42 X 30 cm';
    openEditor({ slug: 'sold-painting', data: { dimensions: '42 X 30 cm' }, body: '' });
  `, context);
  assert.match(context.elements.get('modal').innerHTML, /value="42 X 30 cm"/);
  assert.equal(context.elements.get('dimensions-preview').textContent, '42 × 30 cm / 16.54 × 11.81 in');
  const input = context.elements.get('f-dimensions');
  input.value = '42.5x30cm';
  input.oninput();
  assert.equal(context.elements.get('dimensions-preview').textContent, '42.5 × 30 cm / 16.73 × 11.81 in');
  assert.equal(input.value, '42.5x30cm');
});

test('duplicate slugs skip existing files and assigned artwork codes', async () => {
  const context = await editorContext();
  context.window.VlementAdminArtworkCodes = {
    load: async () => [],
    getCode: slug => slug === 'painting-2' ? { artwork_code: 'VL-O-A0001' } : null,
  };
  vm.runInContext(`
    entries = [{ slug: 'painting' }];
    ghGetFile = async path => path.endsWith('/painting-3.md') ? {} : null;
  `, context);
  assert.equal(await vm.runInContext("chooseNewSlug('Painting', true)", context), 'painting-4');
  assert.ok((await vm.runInContext("chooseNewSlug('A'.repeat(200), true)", context)).length <= 120);
  context.window.VlementAdminArtworkCodes.load = async () => { throw new Error('Code service unavailable'); };
  await assert.rejects(vm.runInContext("chooseNewSlug('Painting', true)", context), /Code service unavailable/);
});

test('duplicate opens an explicitly identified unsaved copy without saving it', async () => {
  const context = await editorContext();
  vm.runInContext(`
    const values = {
      title: 'Pastilla Para Dejar De Soñar', year: '2024', medium: 'Oil',
      dimensions: '42 X 30 cm', displayOrder: '2', width: '5184', height: '3456',
      category: 'Original painting', collection: 'Sueños', summary: '',
      altText: 'A painting', price: '', editionType: 'original', editionSize: '',
      support: '', printDate: ''
    };
    for (const [key, value] of Object.entries(values)) document.getElementById('f-' + key).value = value;
    document.getElementById('f-featured').checked = false;
    document.getElementById('f-signed').checked = true;
    document.getElementById('f-available').checked = false;
    imageFields = {
      image: { saved: '/images/artwork/pastilla.webp', file: null, url: null },
      thumbnail: { saved: '/images/thumbnails/pastilla.webp', file: null, url: null },
      portraitDownload: { saved: '', file: null, url: null },
      landscapeDownload: { saved: '', file: null, url: null }
    };
    document.getElementById('f-body').value = 'Existing description.';
    duplicateArtwork();
  `, context);

  const modal = context.elements.get('modal');
  assert.match(modal.innerHTML, /Duplicate Artwork/);
  assert.match(modal.innerHTML, /new, unsaved copy/);
  assert.match(modal.innerHTML, /select Save to create the duplicate/);
  assert.match(modal.innerHTML, /id="save-btn"/);
  assert.doesNotMatch(modal.innerHTML, /id="duplicate-btn"/);
});

test('detects EXIF orientation and leaves already upright JPEGs untouched', async () => {
  const context = await editorContext();
  const pixels = { create: { width: 80, height: 40, channels: 3, background: '#ff0000' } };
  const rotated = await sharp(pixels).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const upright = await sharp(pixels).jpeg().toBuffer();
  context.rotated = new File([rotated], 'rotated.jpg', { type: 'image/jpeg' });
  context.upright = new File([upright], 'upright.jpg', { type: 'image/jpeg' });
  assert.equal(await vm.runInContext('jpegOrientation(rotated)', context), 6);
  assert.equal(await vm.runInContext('jpegOrientation(upright)', context), 1);
  assert.equal(await vm.runInContext('normalizeImageOrientation(upright)', context), context.upright);
});
