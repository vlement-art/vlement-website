import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createCertificatePdf } from '../src/admin/certificate-pdf.js';

const output = process.argv[2];
if (!output) throw new Error('Provide an output directory for local PDF samples.');
await mkdir(output, { recursive: true });

const fonts = {
  regular: await readFile('node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff'),
  bold: await readFile('node_modules/@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff'),
};
const landscape = await sharp('public/images/artwork/pastilla-para-dejar-de-so-ar.webp')
  .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
const portrait = await sharp('public/images/artwork/la-luz.jpg')
  .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
const snapshot = {
  title: 'Pastilla Para Dejar De Soñar',
  year: 2024,
  medium: 'Oil on canvas Panel',
  dimensions: '42 X 30 cm',
  certificateType: 'original',
  certificateWording: 'This certifies this one-of-a-kind artwork as an original work by Vlement J Rodrigues.',
  artworkCode: 'VL-O-A0001',
};
const cases = [
  ['uid', { ...snapshot, nfcTagUid: '04:8B:22:25' }, landscape],
  ['empty-uid', snapshot, landscape],
  ['portrait', snapshot, portrait],
  ['long-title', { ...snapshot, title: 'Pastilla Para Dejar De Soñar Y Encontrar La Luz De Una Nueva Mañana' }, landscape],
];
for (const [name, details, image] of cases) {
  const pdf = await createCertificatePdf(
    details,
    'https://vlement.com/verify/?t=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg',
    'VL-O-2026-0001',
    image,
    fonts,
  );
  await writeFile(path.join(output, `${name}.pdf`), pdf);
}
