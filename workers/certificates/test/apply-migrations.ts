import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

const testEnv = env as typeof env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };
await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
