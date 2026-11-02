import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const apiUrl = process.env.PUBLIC_CERTIFICATES_API_URL?.trim() || '';
const secureOrigin = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(apiUrl);
const localOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(apiUrl);
if (apiUrl && !secureOrigin && !localOrigin) {
  throw new Error('PUBLIC_CERTIFICATES_API_URL must be an HTTPS origin, or a localhost origin for development.');
}

await mkdir('public/admin', { recursive: true });
await writeFile(
  'public/admin/certificates-config.js',
  `window.CERTIFICATES_API_URL = ${JSON.stringify(apiUrl)};\n`,
);
await build({
  entryPoints: ['src/admin/certificates.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2022',
  outfile: 'public/admin/certificates.js',
});
