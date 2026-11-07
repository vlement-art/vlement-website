import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import sharp from 'sharp';

async function editorContext() {
  const html = await readFile('public/admin/index.html', 'utf8');
  const script = html.match(/<script>\s*\/\* ---------------------------------------------------------------------\s*CONFIG[\s\S]*?<\/script>/)?.[0]
    .replace(/^<script>/, '').replace(/<\/script>$/, '');
  assert.ok(script, 'admin editor script exists');
  const elements = new Map();
  const context = vm.createContext({
    window: {},
    sessionStorage: { getItem: () => null },
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { addEventListener() {} });
        return elements.get(id);
      },
    },
    DataView, Uint8Array, File, URL, console, setTimeout, clearTimeout,
  });
  vm.runInContext(script, context);
  return context;
}

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
