import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src';
import type { Env } from '../src/types';

const APEX = 'https://vlement.com';
const WWW = 'https://www.vlement.com';

function corsEnv(allowed = ` ${APEX} , ${WWW} `): Env {
  return Object.assign(Object.create(env), { ALLOWED_ORIGIN: allowed }) as Env;
}

function preflight(path: string, origin: string, e = corsEnv()) {
  return worker.fetch(
    new Request(`https://worker.test${path}`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    }),
    e,
  );
}

describe('ALLOWED_ORIGIN list', () => {
  for (const origin of [APEX, WWW]) {
    for (const path of ['/api/admin/artwork-codes', '/api/admin/sales']) {
      it(`preflight ${path} returns 204 for ${origin}`, async () => {
        const response = await preflight(path, origin);
        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
        expect(response.headers.get('Vary')).toContain('Origin');
      });
    }
  }

  it('echoes the matching origin on normal responses, never *', async () => {
    const response = await worker.fetch(
      new Request('https://worker.test/health', { headers: { Origin: WWW } }),
      corsEnv(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(WWW);
    expect(response.headers.get('Vary')).toContain('Origin');
  });

  it('rejects a different origin as before', async () => {
    const get = await worker.fetch(
      new Request('https://worker.test/health', { headers: { Origin: 'https://evil.example' } }),
      corsEnv(),
    );
    expect(get.status).toBe(404);
    expect(get.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const options = await preflight('/api/admin/sales', 'https://evil.example');
    expect(options.status).toBe(404);
    expect(options.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('still works with a single origin', async () => {
    const response = await preflight('/api/admin/sales', APEX, corsEnv(APEX));
    expect(response.status).toBe(204);
    expect((await preflight('/api/admin/sales', WWW, corsEnv(APEX))).status).toBe(404);
  });
});
