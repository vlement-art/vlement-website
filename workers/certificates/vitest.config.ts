import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const migrations = await readD1Migrations(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations'),
);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './workers/certificates/wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          ALLOWED_GITHUB_USER_ID: '12345',
        },
      },
    }),
  ],
  test: {
    include: ['workers/certificates/test/**/*.test.ts'],
    setupFiles: ['workers/certificates/test/apply-migrations.ts'],
  },
});
