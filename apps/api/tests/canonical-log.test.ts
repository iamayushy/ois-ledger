import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DbClient } from '@ois/db/client';
import type { CreateOrderResponse } from '@ois/shared/schemas';
import { buildApp } from '../src/app.js';
import { PROXY_SECRET_HEADER } from '../src/plugins/proxy-auth.js';
import {
  createTestDbClient,
  ensureTestDatabaseMigrated,
  resetTestDb,
  seedTestProducts,
} from './setup.js';

type LogRecord = Record<string, unknown>;

const SECRET = 'canonical-log-test-secret-0123456789abcdef';

function captureLogs(): { readonly lines: LogRecord[]; readonly raw: string[]; readonly write: (message: string) => void } {
  const lines: LogRecord[] = [];
  const raw: string[] = [];
  return {
    lines,
    raw,
    write: (message: string) => {
      raw.push(message);
      lines.push(JSON.parse(message) as LogRecord);
    },
  };
}

function linesFor(lines: readonly LogRecord[], requestId: string): LogRecord[] {
  return lines.filter((line) => line['request_id'] === requestId);
}

describe('Canonical log lines', () => {
  let dbClient: DbClient;
  let app: FastifyInstance;
  let gated: FastifyInstance;
  const logs = captureLogs();
  const gatedLogs = captureLogs();

  beforeAll(async () => {
    await ensureTestDatabaseMigrated();
    dbClient = createTestDbClient(6);
    app = await buildApp({
      dbClient,
      logLevel: 'info',
      logStream: logs,
      buildId: 'test-build',
      enablePressure: false,
      enableDocs: false,
    });
    gated = await buildApp({
      dbClient,
      logLevel: 'info',
      logStream: gatedLogs,
      enablePressure: false,
      enableDocs: false,
      proxySharedSecret: SECRET,
    });
    await Promise.all([app.ready(), gated.ready()]);
  });

  afterAll(async () => {
    await Promise.all([app.close(), gated.close()]);
    await dbClient.close();
  });

  beforeEach(async () => {
    await resetTestDb(dbClient.db);
    await seedTestProducts(dbClient.db, [
      { sku: 'SKU-LOG-A', name: 'Log Widget', pricePaise: 1000, totalStock: 1 },
    ]);
  });

  it('emits exactly one wide line per request with route template, timings, DB stats and business fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { 'idempotency-key': 'log-key-1' },
      payload: { customerId: 'cust-log', items: [{ sku: 'SKU-LOG-A', quantity: 1 }] },
    });
    expect(res.statusCode).toBe(201);
    const requestId = String(res.headers['x-request-id']);
    const lines = linesFor(logs.lines, requestId);

    expect(lines).toHaveLength(1);
    const line = lines[0] ?? {};
    expect(line).toMatchObject({
      message: 'canonical-log-line',
      event: 'canonical-log-line',
      severity: 'INFO',
      service: 'ois-api',
      build_id: 'test-build',
      http_method: 'POST',
      http_route: '/api/v1/orders',
      http_status: 201,
      api_version: 'v1',
      idempotency_key: 'log-key-1',
      customer_id: 'cust-log',
      item_count: 1,
      skus: ['SKU-LOG-A'],
      order_id: res.json<CreateOrderResponse>().order.id,
      idempotency_replayed: false,
      db_acquire_count: 1,
    });
    expect(line['db_query_count']).toBe(5);
    expect(Number(line['db_duration_ms'])).toBeGreaterThan(0);
    expect(Number(line['duration_ms'])).toBeGreaterThanOrEqual(Number(line['db_duration_ms']));
    expect(typeof line['db_slowest_statement']).toBe('string');
    expect(String(line['db_slowest_statement'])).not.toMatch(/log-key-1|cust-log/);
    expect(logs.lines.some((l) => l['message'] === 'incoming request' || l['message'] === 'request completed')).toBe(false);
  });

  it('records the error code, stable slug and shortage on a rejected reservation', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { 'idempotency-key': 'log-key-winner' },
      payload: { customerId: 'cust-a', items: [{ sku: 'SKU-LOG-A', quantity: 1 }] },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { 'idempotency-key': 'log-key-loser' },
      payload: { customerId: 'cust-b', items: [{ sku: 'SKU-LOG-A', quantity: 1 }] },
    });
    expect(res.statusCode).toBe(409);
    const [line] = linesFor(logs.lines, String(res.headers['x-request-id']));
    expect(line).toMatchObject({
      http_status: 409,
      error_code: 1201,
      error_slug: 'insufficient_stock',
      shortage_skus: ['SKU-LOG-A'],
      idempotency_key: 'log-key-loser',
      severity: 'INFO',
    });
    expect(line?.['order_id']).toBeUndefined();
  });

  it('logs route templates instead of raw paths, and unmatched routes as such', async () => {
    const byId = await app.inject({ method: 'GET', url: '/api/v1/orders/019373c2-8a1e-7c4b-9d2e-5f8a1b3c4d5e' });
    const [idLine] = linesFor(logs.lines, String(byId.headers['x-request-id']));
    expect(idLine).toMatchObject({ http_route: '/api/v1/orders/:id', http_status: 404, error_slug: 'order_not_found' });

    const missing = await app.inject({ method: 'GET', url: '/api/v1/nope/123' });
    const [missingLine] = linesFor(logs.lines, String(missing.headers['x-request-id']));
    expect(missingLine).toMatchObject({ http_route: 'unmatched', http_status: 404, error_slug: 'route_not_found' });
  });

  it('accepts only well-formed cf-ray values', async () => {
    const valid = await app.inject({ method: 'GET', url: '/api/v1/health', headers: { 'cf-ray': 'a5e2600e39e44348-MRS' } });
    const forged = await app.inject({ method: 'GET', url: '/api/v1/health', headers: { 'cf-ray': '"><script>' } });
    expect(linesFor(logs.lines, String(valid.headers['x-request-id']))[0]?.['cf_ray']).toBe('a5e2600e39e44348-MRS');
    expect(linesFor(logs.lines, String(forged.headers['x-request-id']))[0]?.['cf_ray']).toBeUndefined();
  });

  it('logs gateway rejections and never writes the proxy secret', async () => {
    const rejected = await gated.inject({ method: 'GET', url: '/api/v1/inventory' });
    expect(rejected.statusCode).toBe(401);
    const [line] = linesFor(gatedLogs.lines, String(rejected.headers['x-request-id']));
    expect(line).toMatchObject({ http_status: 401, error_code: 1005, error_slug: 'unauthorized_origin', db_query_count: 0 });

    const accepted = await gated.inject({
      method: 'GET',
      url: '/api/v1/inventory',
      headers: { [PROXY_SECRET_HEADER]: SECRET },
    });
    expect(accepted.statusCode).toBe(200);
    expect(gatedLogs.raw.some((message) => message.includes(SECRET))).toBe(false);
  });

  it('counts queries on connections that were opened before the app instrumented the pool', async () => {
    const warmClient = createTestDbClient(1);
    await warmClient.pool.query('SELECT 1');
    const warmLogs = captureLogs();
    const warmApp = await buildApp({
      dbClient: warmClient,
      logLevel: 'info',
      logStream: warmLogs,
      enablePressure: false,
      enableDocs: false,
    });
    try {
      const res = await warmApp.inject({ method: 'GET', url: '/api/v1/inventory' });
      expect(res.statusCode).toBe(200);
      const [line] = linesFor(warmLogs.lines, String(res.headers['x-request-id']));
      expect(Number(line?.['db_query_count'])).toBeGreaterThan(0);
      expect(line?.['db_acquire_count']).toBe(1);
    } finally {
      await warmApp.close();
      await warmClient.close();
    }
  });
});
