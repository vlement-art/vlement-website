const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function validatePictureFiles(files, existingCount) {
  const selected = Array.from(files || []);
  if (!selected.length) return selected;
  if (existingCount + selected.length > 8) throw new Error('An artwork can have at most 8 pictures, including its main picture.');
  for (const file of selected) {
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name || 'This picture'} is over the 20 MB per-picture limit.`);
    if (!ALLOWED_TYPES.has(file.type)) throw new Error(`${file.name || 'This file'} is not a supported image. Choose a JPG, PNG, or WebP picture.`);
  }
  return selected;
}

export async function inspectPicture(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

async function encode(bitmap, maximumEdge) {
  const scale = Math.min(1, maximumEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not prepare this picture.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', maximumEdge === 3000 ? 0.82 : 0.88));
  if (!blob) throw new Error('Your browser could not resize this picture.');
  return { blob, width: canvas.width, height: canvas.height };
}

export async function preparePicture(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const [page, zoom] = await Promise.all([
      encode(bitmap, 1600),
      encode(bitmap, 3000),
    ]);
    return {
      page,
      zoom,
      width: bitmap.width,
      height: bitmap.height,
    };
  } catch {
    throw new Error(`Could not read ${file.name || 'this picture'}. Choose a valid JPG, PNG, or WebP image.`);
  } finally {
    bitmap?.close();
  }
}

if (typeof window !== 'undefined') {
  window.VlementPictures = { validatePictureFiles, inspectPicture, preparePicture };
}
