import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import worker from '../src';
import type { Env } from '../src/types';

const testEnv = Object.assign(Object.create(env), { ALLOWED_GITHUB_USER_ID: '12345' }) as Env;

function request(path: string, method = 'GET', body?: object): Request {
  return new Request(`https://certificates.test${path}`, {
    method,
    headers: {
      Authorization: ['Bearer', 'artwork-code-test-token'].join(' '),
      Origin: 'https://vlement.com',
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe('artwork code endpoints', () => {
  it('requires administrator authorization', async () => {
    const response = await worker.fetch(new Request('https://certificates.test/api/admin/artwork-codes'), testEnv);
    expect(response.status).toBe(401);
  });

  it('creates, lists and safely retries each artwork type with an audit record', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      new URL(String(input)).pathname === '/user'
        ? Response.json({ id: 12345 })
        : Response.json({ permissions: { push: true } })));
    try {
      const suffix = crypto.randomUUID().slice(0, 8);
      for (const [type, codeType, letter] of [
        ['original', 'O', 'A'],
        ['limited', 'LE', 'B'],
        ['open', 'OE', 'C'],
      ]) {
        const slug = `${type}-${suffix}`;
        const body = { slug, type, ...(type === 'limited' ? { edition_size: 10 } : {}) };
        const response = await worker.fetch(request('/api/admin/artwork-codes', 'POST', body), testEnv);
        expect(response.status, await response.clone().text()).toBe(201);
        const payload = await response.json() as { code: { artwork_code: string; type: string } };
        expect(payload.code.type).toBe(codeType);
        expect(payload.code.artwork_code).toMatch(new RegExp(`^VL-${codeType}-${letter}\\d{4,}$`));

        const audit = await env.DB.prepare(
          "SELECT actor_id, action FROM artwork_code_audit_log WHERE artwork_code = ?",
        ).bind(payload.code.artwork_code).all();
        expect(audit.results).toEqual([{ actor_id: '12345', action: 'code_created' }]);

        const retry = await worker.fetch(request('/api/admin/artwork-codes', 'POST', body), testEnv);
        expect(retry.status).toBe(200);
        expect(await retry.json()).toMatchObject({ code: { artwork_code: payload.code.artwork_code } });

        const list = await worker.fetch(request('/api/admin/artwork-codes'), testEnv);
        expect(list.status).toBe(200);
        expect(await list.json()).toMatchObject({
          codes: expect.arrayContaining([expect.objectContaining({ artwork_slug: slug, artwork_code: payload.code.artwork_code })]),
        });
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not leave an artwork code behind if its audit insert fails', async () => {
    const slug = `audit-failure-${crypto.randomUUID().slice(0, 8)}`;
    await env.DB.prepare(
      `CREATE TRIGGER test_fail_code_audit BEFORE INSERT ON artwork_code_audit_log
       BEGIN SELECT RAISE(ABORT, 'test audit failure'); END;`,
    ).run();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      new URL(String(input)).pathname === '/user'
        ? Response.json({ id: 12345 })
        : Response.json({ permissions: { push: true } })));
    try {
      const response = await worker.fetch(
        request('/api/admin/artwork-codes', 'POST', { slug, type: 'original' }),
        testEnv,
      );
      expect(response.status).toBe(500);
      const code = await env.DB.prepare('SELECT artwork_code FROM artwork_codes WHERE artwork_slug = ?')
        .bind(slug).first();
      expect(code).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      await env.DB.exec('DROP TRIGGER test_fail_code_audit');
    }
  });
});
