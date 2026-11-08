import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import sharp from 'sharp';
import { formatDimensions } from '../src/lib/dimensions.mjs';
import { validatePictureFiles } from '../src/admin/artwork-pictures.js';

function mockElement() {
  return {
    children: [],
    dataset: {},
    addEventListener(type, handler) { this[`on${type}`] = handler; },
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this[name] = value; },
  };
}

async function editorContext() {
  const html = await readFile('public/admin/index.html', 'utf8');
  const script = html.match(/<script>\s*\/\* ---------------------------------------------------------------------\s*CONFIG[\s\S]*?<\/script>/)?.[0]
    .replace(/^<script>/, '').replace(/<\/script>$/, '');
  assert.ok(script, 'admin editor script exists');
  const elements = new Map();
  const context = vm.createContext({
    window: {
      VlementPictures: {
        validatePictureFiles,
        inspectPicture: async () => ({ width: 1200, height: 800 }),
      },
    },
    VlementDimensions: { formatDimensions },
    elements,
    sessionStorage: { getItem: () => null },
    crypto,
    URL: {
      createObjectURL: file => `blob:${file.name}`,
      revokeObjectURL() {},
    },
    confirm: () => true,
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, mockElement());
        return elements.get(id);
      },
      createElement: () => mockElement(),
    },
    DataView, Uint8Array, File, console, setTimeout, clearTimeout,
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

test('picture editor supports adding, reordering, promoting, and removing pictures', async () => {
  const context = await editorContext();
  vm.runInContext("openEditor(null)", context);
  const first = new File(['one'], 'first.jpg', { type: 'image/jpeg' });
  const second = new File(['two'], 'second.jpg', { type: 'image/jpeg' });
  context.selectedPictures = [first, second];
  await vm.runInContext('addPictures(selectedPictures)', context);
  assert.equal(vm.runInContext('pictureItems.length', context), 2);

  const secondActions = context.elements.get('pictures-list').children[1].children[2];
  secondActions.children.find(button => button.textContent === 'Make main').onclick();
  assert.equal(vm.runInContext('pictureItems[0].file.name', context), 'second.jpg');

  const firstRowActions = context.elements.get('pictures-list').children[1].children[2];
  firstRowActions.children.find(button => button.textContent === 'Delete').onclick();
  assert.equal(vm.runInContext('pictureItems.length', context), 1);
  assert.equal(vm.runInContext('pictureItems[0].file.name', context), 'second.jpg');
});

test('saving is blocked when the artwork has no main picture', async () => {
  const context = await editorContext();
  vm.runInContext(`
    ensureYamlLibrary = async () => {};
    openEditor(null);
    document.getElementById('f-title').value = 'Test artwork';
    document.getElementById('f-year').value = '2025';
    document.getElementById('f-category').value = 'Print';
    document.getElementById('f-collection').value = 'Yellow Balloon';
  `, context);
  await vm.runInContext('saveEntry()', context);
  assert.match(context.elements.get('modal-error').innerHTML, /Add a main picture/);
});

test('saving a duplicate description warns without blocking the save', async () => {
  const context = await editorContext();
  vm.runInContext(`
    ensureYamlLibrary = async () => {};
    entries = [{ path: 'src/content/artworks/other.md', slug: 'other', data: { title: 'Other & work' }, body: 'Same description.\\n' }];
    openEditor(null);
    document.getElementById('f-title').value = 'New work';
    document.getElementById('f-year').value = '2025';
    document.getElementById('f-category').value = 'Print';
    document.getElementById('f-collection').value = 'Luz';
    document.getElementById('f-body').value = 'Same description.';
    document.getElementById('f-seoDescription').value = 'Custom SEO';
    document.getElementById('f-medium').value = '';
    document.getElementById('f-dimensions').value = '';
    document.getElementById('f-summary').value = '';
    document.getElementById('f-price').value = '';
    document.getElementById('f-support').value = '';
    document.getElementById('f-printDate').value = '';
    document.getElementById('f-editionType').value = '';
    document.getElementById('f-heroImage').value = '';
    pictureItems = [{ src: '/image.jpg', width: 100, height: 100, alt: '', label: 'other' }];
    chooseNewSlug = async () => 'new-work';
    buildFrontmatter = (data, body) => JSON.stringify({ data, body });
    utf8ToBase64 = value => value;
    ghPutFile = async (path, content) => { window.saved = { path, content }; return { content: { sha: 'new' } }; };
    renderGrid = () => {};
  `, context);
  await vm.runInContext('saveEntry()', context);
  assert.ok(context.window.saved, `save reaches the mocked write: ${context.elements.get('modal-error').innerHTML}`);
  assert.equal(JSON.parse(context.window.saved.content).data.seoDescription, 'Custom SEO');
  assert.equal(context.elements.get('duplicate-warning').hidden, false);
  assert.match(context.elements.get('duplicate-warning').textContent, /Another artwork has exactly the same description.*Other & work/);
});
