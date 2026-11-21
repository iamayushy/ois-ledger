import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbClient } from '@ois/db/client';
import { ERROR_CODE, type ErrorResponse } from '@ois/shared/schemas';
import { buildApp } from '../src/app.js';
import { PROXY_SECRET_HEADER } from '../src/plugins/proxy-auth.js';
import { createTestDbClient, ensureTestDatabaseMigrated } from './setup.js';

const SECRET = 'test-proxy-secret-0123456789abcdef0123456789';

describe('Proxy shared-secret gate', () => {
  let dbClient: DbClient;
  let gated: FastifyInstance;
  let open: FastifyInstance;

  beforeAll(async () => {
    await ensureTestDatabaseMigrated();
    dbClient = createTestDbClient(4);
    gated = await buildApp({
      dbClient,
      logLevel: 'silent',
      enablePressure: false,
      enableDocs: false,
      proxySharedSecret: SECRET,
    });
    open = await buildApp({ dbClient, logLevel: 'silent', enablePressure: false, enableDocs: false });
    await Promise.all([gated.ready(), open.ready()]);
  });

  afterAll(async () => {
    await Promise.all([gated.close(), open.close()]);
    await dbClient.close();
  });

  it('rejects requests without the header with 401 (1005) and no body leakage', async () => {
    const res = await gated.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(401);
    expect(res.json<ErrorResponse>()).toEqual({
      error: { code: ERROR_CODE.UNAUTHORIZED_ORIGIN, message: 'Requests must arrive through the API gateway' },
    });
  });

  it('rejects a wrong secret, including one of a different length', async () => {
    for (const presented of ['wrong', `${SECRET}x`, SECRET.slice(0, -1)]) {
      const res = await gated.inject({
        method: 'GET',
        url: '/api/inventory',
        headers: { [PROXY_SECRET_HEADER]: presented },
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it('rejects unknown routes before revealing they do not exist', async () => {
    const res = await gated.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(401);
  });

  it('accepts the correct secret', async () => {
    const res = await gated.inject({
      method: 'GET',
      url: '/api/health',
      headers: { [PROXY_SECRET_HEADER]: SECRET },
    });
    expect(res.statusCode).toBe(200);
  });

  it('is disabled when no secret is configured', async () => {
    const res = await open.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
  });
});
