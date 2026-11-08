import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preparePicture, validatePictureFiles } from '../src/admin/artwork-pictures.js';

const file = (name, type, size) => ({ name, type, size });

test('picture upload accepts JPG, PNG, and WebP up to 20 MB and enforces eight total', () => {
  const files = [
    file('one.jpg', 'image/jpeg', 20 * 1024 * 1024),
    file('two.png', 'image/png', 10),
    file('three.webp', 'image/webp', 10),
  ];
  assert.equal(validatePictureFiles(files, 5).length, 3);
  assert.throws(() => validatePictureFiles([file('large.jpg', 'image/jpeg', 20 * 1024 * 1024 + 1)], 0), /20 MB/);
  assert.throws(() => validatePictureFiles([file('text.txt', 'text/plain', 10)], 0), /JPG, PNG, or WebP/);
  assert.throws(() => validatePictureFiles([file('extra.jpg', 'image/jpeg', 10)], 8), /at most 8/);
  assert.deepEqual(validatePictureFiles([], 8), []);
});

test('picture preparation applies EXIF-aware decoding and creates bounded page and zoom JPEGs', async () => {
  const original = {
    createImageBitmap: globalThis.createImageBitmap,
    document: globalThis.document,
  };
  const canvases = [];
  let orientation;
  globalThis.createImageBitmap = async (_file, options) => {
    orientation = options.imageOrientation;
    return { width: 4000, height: 2000, close() {} };
  };
  globalThis.document = {
    createElement() {
      const canvas = {
        getContext: () => ({ fillRect() {}, drawImage() {} }),
        toBlob(callback, type, quality) {
          canvas.encoding = { type, quality, width: canvas.width, height: canvas.height };
          callback(new Blob(['jpeg'], { type }));
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  };
  try {
    const result = await preparePicture(file('source.png', 'image/png', 100));
    assert.equal(orientation, 'from-image');
    assert.deepEqual(
      canvases.map(canvas => [canvas.width, canvas.height]),
      [[1600, 800], [3000, 1500]],
    );
    assert.deepEqual(
      canvases.map(canvas => canvas.encoding),
      [
        { type: 'image/jpeg', quality: 0.88, width: 1600, height: 800 },
        { type: 'image/jpeg', quality: 0.82, width: 3000, height: 1500 },
      ],
    );
    assert.equal(result.width, 4000);
    assert.equal(result.height, 2000);
    assert.equal(result.page.blob.type, 'image/jpeg');
    assert.equal(result.zoom.blob.type, 'image/jpeg');
  } finally {
    if (original.createImageBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = original.createImageBitmap;
    if (original.document === undefined) delete globalThis.document;
    else globalThis.document = original.document;
  }
});
