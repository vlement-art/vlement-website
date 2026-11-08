import QRCode from 'qrcode';
import { marked } from 'marked';
import { site } from '../data/site';
import { labelOrientation, makeLabelBlob } from './label-document.js';

async function imageForLabel(entry, getFile) {
  const path = entry.data.image;
  if (typeof path !== 'string' || !/^\/images\/artwork\/[^/]+$/.test(path)) {
    throw new Error('The saved artwork image path is invalid.');
  }
  const response = await fetch(path, { cache: 'no-store' });
  let source;
  if (response.ok) {
    source = await response.blob();
  } else if (response.status === 404) {
    const file = await getFile(`public${path}`);
    if (!file?.content || file.encoding !== 'base64') {
      throw new Error('The saved artwork image is not available yet. Wait for the website to build and try again.');
    }
    const binary = atob(file.content.replace(/\s/g, ''));
    source = new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))]);
  } else {
    throw new Error(`Could not load the saved artwork image (${response.status}).`);
  }
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare the artwork image.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!jpeg) throw new Error('Your browser could not convert the artwork image to JPEG.');
    return {
      bytes: new Uint8Array(await jpeg.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
      originalWidth: bitmap.width,
      originalHeight: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

async function publicationWarning(slug, url) {
  try {
    const response = await fetch(`/work/${encodeURIComponent(slug)}`, { cache: 'no-store' });
    if (response.status === 404 || response.status === 410) {
      return "This artwork isn't visible on the site yet, so the QR code would lead to a missing page.";
    }
    if (!response.ok) return 'Could not check whether the artwork page is published. Verify the QR link before printing.';
    const html = await response.text();
    const canonical = new DOMParser().parseFromString(html, 'text/html').querySelector('link[rel="canonical"]')?.getAttribute('href');
    if (canonical?.replace(/\/$/, '') !== url.replace(/\/$/, '')) {
      return "This artwork isn't visible on the site yet, so the QR code would lead to a missing page.";
    }
    return '';
  } catch {
    return 'Could not check whether the artwork page is published. Verify the QR link before printing.';
  }
}

async function download(entry, orientation, getFile) {
  if (!entry || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug)) throw new Error('Save the artwork before printing its label.');
  const url = new URL(`/work/${encodeURIComponent(entry.slug)}`, site.url).href;
  const [image, warning] = await Promise.all([imageForLabel(entry, getFile), publicationWarning(entry.slug, url)]);
  const imageOrientation = labelOrientation(orientation, image.originalWidth, image.originalHeight);
  const qrUrl = await QRCode.toDataURL(url, { width: 360, margin: 4, errorCorrectionLevel: 'M' });
  const qrBytes = Uint8Array.from(atob(qrUrl.split(',')[1]), char => char.charCodeAt(0));
  const markdown = entry.body || entry.data.summary || '';
  const description = new DOMParser().parseFromString(marked.parse(markdown), 'text/html').body.textContent || '';
  const { blob, shortened } = await makeLabelBlob({ artwork: { ...entry, description }, orientation: imageOrientation, image, qr: qrBytes });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `label-${entry.slug}.docx`;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }
  return [
    warning,
    shortened ? 'The description was shortened. You can edit the full text in Word.' : '',
  ].filter(Boolean).join(' ');
}

window.VlementPrintLabel = { download };
