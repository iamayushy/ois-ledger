import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbClient, type DbClient } from '@ois/db/client';
import { ERROR_CODE, type CreateOrderResponse, type ErrorResponse } from '@ois/shared/schemas';
import { buildApp } from '../src/app.js';
import {
  assertInventoryInvariants,
  ensureTestDatabaseMigrated,
  getTestDatabaseUrl,
  resetTestDb,
  seedTestProducts,
} from './setup.js';

interface PressureHarness {
  readonly dbClient: DbClient;
  readonly app: FastifyInstance;
  readonly heldClient: PoolClient;
}

const ORDER_PAYLOAD = {
  customerId: 'cust-pressure',
  items: [{ sku: 'SKU-P', quantity: 1 }],
} as const;

async function buildSaturatedHarness(
  connectionTimeoutMs: number,
  poolMaxWaiting: number,
): Promise<PressureHarness> {
  const dbClient = createDbClient({
    connectionString: getTestDatabaseUrl(),
    max: 1,
    idleTimeoutMs: 10_000,
    connectionTimeoutMs,
  });
  const app = await buildApp({
    dbClient,
    logLevel: 'silent',
    enablePressure: false,
    enableDocs: false,
    poolMaxWaiting,
  });
  await app.ready();
  const heldClient = await dbClient.pool.connect();
  return { dbClient, app, heldClient };
}

function postOrder(app: FastifyInstance, key: string) {
  return app.inject({
    method: 'POST',
    url: '/api/orders',
    headers: { 'idempotency-key': key },
    payload: ORDER_PAYLOAD,
  });
}

describe('Connection pool exhaustion', () => {
  let adminClient: DbClient;
  let harness: PressureHarness | null = null;
  let heldReleased = false;

  beforeAll(async () => {
    await ensureTestDatabaseMigrated();
  });

  beforeEach(async () => {
    adminClient = createDbClient({ connectionString: getTestDatabaseUrl(), max: 2 });
    await resetTestDb(adminClient.db);
    await seedTestProducts(adminClient.db, [
      { sku: 'SKU-P', name: 'Pressure Widget', pricePaise: 1000, totalStock: 3 },
    ]);
    heldReleased = false;
  });

  afterEach(async () => {
    if (harness) {
      if (!heldReleased) {
        harness.heldClient.release();
      }
      await harness.app.close();
      await harness.dbClient.close();
      harness = null;
    }
    await adminClient.close();
  });

  it('maps a pool acquire timeout to a retryable 503 (1301) and a same-key retry succeeds once', async () => {
    harness = await buildSaturatedHarness(300, 100);

    const starved = await postOrder(harness.app, 'pool-timeout-001');
    expect(starved.statusCode).toBe(503);
    expect(starved.headers['retry-after']).toBe('1');
    expect(starved.json<ErrorResponse>().error.code).toBe(ERROR_CODE.SERVICE_UNAVAILABLE);

    harness.heldClient.release();
    heldReleased = true;

    const retried = await postOrder(harness.app, 'pool-timeout-001');
    expect(retried.statusCode).toBe(201);
    expect(retried.json<CreateOrderResponse>().replayed).toBe(false);

    const orderCount = await adminClient.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM reservation_order WHERE idempotency_key = $1`,
      ['pool-timeout-001'],
    );
    expect(orderCount.rows[0]?.count).toBe('1');
    await assertInventoryInvariants(adminClient.db);
  });

  it('sheds requests with 503 (1302) once the pool wait queue is full, without touching state', async () => {
    harness = await buildSaturatedHarness(5_000, 1);
    const { app, dbClient, heldClient } = harness;

    const queued = postOrder(app, 'pool-queue-001');
    await vi.waitFor(() => {
      expect(dbClient.pool.waitingCount).toBe(1);
    });

    const shed = await postOrder(app, 'pool-queue-002');
    expect(shed.statusCode).toBe(503);
    expect(shed.headers['retry-after']).toBe('1');
    expect(shed.json<ErrorResponse>().error.code).toBe(ERROR_CODE.SERVER_UNDER_PRESSURE);

    heldClient.release();
    heldReleased = true;

    const queuedResult = await queued;
    expect(queuedResult.statusCode).toBe(201);

    const keys = await adminClient.pool.query<{ key: string }>(
      `SELECT key FROM idempotency_key ORDER BY key ASC LIMIT 10`,
    );
    expect(keys.rows.map((row) => row.key)).toEqual(['pool-queue-001']);

    const stock = await adminClient.pool.query<{ available_stock: number; reserved_stock: number }>(
      `SELECT available_stock, reserved_stock FROM product WHERE sku = $1 LIMIT 1`,
      ['SKU-P'],
    );
    expect(stock.rows[0]).toEqual({ available_stock: 2, reserved_stock: 1 });
    await assertInventoryInvariants(adminClient.db);
  });
});
