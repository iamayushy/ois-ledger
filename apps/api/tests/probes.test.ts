import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, type DbClient } from '@ois/db/client';
import { ERROR_CODE, type ErrorResponse } from '@ois/shared/schemas';
import { buildApp } from '../src/app.js';
import { createTestDbClient, ensureTestDatabaseMigrated } from './setup.js';

const SECRET = 'probe-test-secret-0123456789abcdef0123456789';

function captureLogs(): { readonly lines: Record<string, unknown>[]; readonly write: (message: string) => void } {
  const lines: Record<string, unknown>[] = [];
  return { lines, write: (message: string) => lines.push(JSON.parse(message) as Record<string, unknown>) };
}

describe('Liveness and readiness probes', () => {
  let dbClient: DbClient;
  let deadClient: DbClient;
  let gated: FastifyInstance;
  let unreachable: FastifyInstance;
  const gatedLogs = captureLogs();
  const unreachableLogs = captureLogs();

  beforeAll(async () => {
    await ensureTestDatabaseMigrated();
    dbClient = createTestDbClient(2);
    deadClient = createDbClient({
      connectionString: 'postgres://ois:ois@127.0.0.1:1/nowhere',
      max: 1,
      connectionTimeoutMs: 500,
    });
    gated = await buildApp({
      dbClient,
      logLevel: 'info',
      logStream: gatedLogs,
      enablePressure: false,
      enableDocs: false,
      proxySharedSecret: SECRET,
    });
    unreachable = await buildApp({
      dbClient: deadClient,
      logLevel: 'info',
      logStream: unreachableLogs,
      enablePressure: false,
      enableDocs: false,
    });
    await Promise.all([gated.ready(), unreachable.ready()]);
  });

  afterAll(async () => {
    await Promise.all([gated.close(), unreachable.close()]);
    await Promise.all([dbClient.close(), deadClient.close()]);
  });

  it('answers /healthz and /readyz without the gateway secret, while everything else still needs it', async () => {
    const live = await gated.inject({ method: 'GET', url: '/healthz' });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toMatchObject({ status: 'ok' });

    const ready = await gated.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready', database: 'connected' });

    const diagnostics = await gated.inject({ method: 'GET', url: '/api/health' });
    expect(diagnostics.statusCode).toBe(401);
    const api = await gated.inject({ method: 'GET', url: '/api/v1/inventory' });
    expect(api.statusCode).toBe(401);
  });

  it('keeps successful probes out of the canonical logs', async () => {
    const before = gatedLogs.lines.length;
    await gated.inject({ method: 'GET', url: '/healthz' });
    await gated.inject({ method: 'GET', url: '/readyz' });
    expect(gatedLogs.lines.slice(before).filter((line) => line['event'] === 'canonical-log-line')).toHaveLength(0);
  });

  it('reports not ready with a retryable 503 when PostgreSQL is unreachable, and logs it, while liveness stays up', async () => {
    const live = await unreachable.inject({ method: 'GET', url: '/healthz' });
    expect(live.statusCode).toBe(200);

    const ready = await unreachable.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(503);
    expect(ready.headers['retry-after']).toBe('1');
    expect(ready.json<ErrorResponse>().error.code).toBe(ERROR_CODE.SERVICE_UNAVAILABLE);
    expect(
      unreachableLogs.lines.some((line) => line['http_route'] === '/readyz' && line['http_status'] === 503),
    ).toBe(true);
  });
});
