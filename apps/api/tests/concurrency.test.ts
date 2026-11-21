import { count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DbClient } from '@ois/db/client';
import {
  idempotencyKey,
  inventoryLedger,
  orderItem,
  product,
  reservationOrder,
} from '@ois/db/schema';
import {
  ERROR_CODE,
  type CancelOrderResponse,
  type CreateOrderBody,
  type CreateOrderResponse,
  type ErrorResponse,
} from '@ois/shared/schemas';
import { buildApp } from '../src/app.js';
import {
  assertInventoryInvariants,
  createTestDbClient,
  ensureTestDatabaseMigrated,
  resetTestDb,
  seedTestProducts,
} from './setup.js';

interface HttpResult<T> {
  readonly status: number;
  readonly headers: Headers;
  readonly body: T;
}

async function postOrder(
  baseUrl: string,
  key: string,
  payload: CreateOrderBody,
): Promise<HttpResult<CreateOrderResponse | ErrorResponse>> {
  const response = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as CreateOrderResponse | ErrorResponse;
  return {
    status: response.status,
    headers: response.headers,
    body,
  };
}

async function postCancel(
  baseUrl: string,
  orderId: string,
): Promise<HttpResult<CancelOrderResponse | ErrorResponse>> {
  const response = await fetch(`${baseUrl}/api/orders/${orderId}/cancel`, {
    method: 'POST',
  });
  const body = (await response.json()) as CancelOrderResponse | ErrorResponse;
  return {
    status: response.status,
    headers: response.headers,
    body,
  };
}

describe('Real-PostgreSQL Concurrency, Idempotency & Atomicity Proofs', () => {
  let dbClient: DbClient;
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    await ensureTestDatabaseMigrated();
    dbClient = createTestDbClient(30);
    app = await buildApp({
      dbClient,
      logLevel: 'silent',
      enablePressure: false,
      enableDocs: false,
    });
    baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await app.close();
    await dbClient.close();
  });

  beforeEach(async () => {
    await resetTestDb(dbClient.db);
  });

  it('Proof 1 (Competing for the Last Unit): 20 simultaneous distinct-key requests yield exactly 1 order and 0 negative stock', async () => {
    await seedTestProducts(dbClient.db, [
      { sku: 'SKU-LAST-UNIT', name: 'Limited Edition GPU', pricePaise: 199900, totalStock: 1 },
    ]);

    const concurrency = 20;
    const results = await Promise.all(
      Array.from({ length: concurrency }, (_, index) =>
        postOrder(baseUrl, `last-unit-key-${index}`, {
          customerId: `cust-${index}`,
          items: [{ sku: 'SKU-LAST-UNIT', quantity: 1 }],
        }),
      ),
    );

    const created = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    const unexpected = results.filter((r) => r.status !== 201 && r.status !== 409);

    expect(unexpected).toHaveLength(0);
    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(concurrency - 1);

    for (const conflict of conflicts) {
      const errBody = conflict.body as ErrorResponse;
      expect(errBody.error.code).toBe(ERROR_CODE.INSUFFICIENT_STOCK);
    }

    const [skuRow] = await dbClient.db
      .select({
        availableStock: product.availableStock,
        reservedStock: product.reservedStock,
      })
      .from(product)
      .where(eq(product.sku, 'SKU-LAST-UNIT'));

    expect(skuRow).toEqual({ availableStock: 0, reservedStock: 1 });

    const [orderCount] = await dbClient.db.select({ total: count() }).from(reservationOrder);
    expect(orderCount?.total).toBe(1);

    await assertInventoryInvariants(dbClient.db);
  });

  it('Proof 2 (Overlapping Retries): 10 simultaneous identical-key requests + 1 post-commit retry return the same order and decrement stock once', async () => {
    await seedTestProducts(dbClient.db, [
      { sku: 'SKU-RETRY-A', name: 'Mechanical Keyboard', pricePaise: 15000, totalStock: 10 },
      { sku: 'SKU-RETRY-B', name: 'USB-C Hub', pricePaise: 5000, totalStock: 10 },
    ]);

    const sharedKey = 'overlap-retry-key-001';
    const simultaneous = await Promise.all(
      Array.from({ length: 10 }, (_, index) => {
        const items =
          index % 2 === 0
            ? [
                { sku: 'SKU-RETRY-A', quantity: 2 },
                { sku: 'SKU-RETRY-B', quantity: 1 },
              ]
            : [
                { sku: ' SKU-RETRY-B ', quantity: 1 },
                { sku: 'SKU-RETRY-A', quantity: 2 },
              ];
        return postOrder(baseUrl, sharedKey, {
          customerId: 'cust-retry-001',
          items,
        });
      }),
    );

    const postCommit = await postOrder(baseUrl, sharedKey, {
      customerId: 'cust-retry-001',
      items: [
        { sku: 'SKU-RETRY-A', quantity: 2 },
        { sku: 'SKU-RETRY-B', quantity: 1 },
      ],
    });

    const allResults = [...simultaneous, postCommit];
    const created = allResults.filter((r) => r.status === 201);
    const replayed = allResults.filter((r) => r.status === 200);
    const errors = allResults.filter((r) => r.status !== 201 && r.status !== 200);

    expect(errors).toHaveLength(0);
    expect(created).toHaveLength(1);
    expect(replayed).toHaveLength(10);

    const createdPayload = created[0]?.body as CreateOrderResponse;
    expect(createdPayload.replayed).toBe(false);
    expect(created[0]?.headers.get('idempotency-replayed')).toBe('false');

    for (const replay of replayed) {
      const replayPayload = replay.body as CreateOrderResponse;
      expect(replayPayload.replayed).toBe(true);
      expect(replay.headers.get('idempotency-replayed')).toBe('true');
      expect(replayPayload.order.id).toBe(createdPayload.order.id);
    }

    const [skuA] = await dbClient.db
      .select({ available: product.availableStock, reserved: product.reservedStock })
      .from(product)
      .where(eq(product.sku, 'SKU-RETRY-A'));
    const [skuB] = await dbClient.db
      .select({ available: product.availableStock, reserved: product.reservedStock })
      .from(product)
      .where(eq(product.sku, 'SKU-RETRY-B'));

    expect(skuA).toEqual({ available: 8, reserved: 2 });
    expect(skuB).toEqual({ available: 9, reserved: 1 });

    const [orderCount] = await dbClient.db.select({ total: count() }).from(reservationOrder);
    expect(orderCount?.total).toBe(1);

    await assertInventoryInvariants(dbClient.db);
  });

  it('Proof 3 (Key Reuse Conflict): reusing an Idempotency-Key with a different payload returns 409 (1202) sequentially and concurrently without mutating state', async () => {
    await seedTestProducts(dbClient.db, [
      { sku: 'SKU-CONFLICT', name: '4K Monitor', pricePaise: 60000, totalStock: 10 },
    ]);

    const seqFirst = await postOrder(baseUrl, 'conflict-seq-key', {
      customerId: 'cust-1',
      items: [{ sku: 'SKU-CONFLICT', quantity: 1 }],
    });
    expect(seqFirst.status).toBe(201);

    const seqDifferentQty = await postOrder(baseUrl, 'conflict-seq-key', {
      customerId: 'cust-1',
      items: [{ sku: 'SKU-CONFLICT', quantity: 2 }],
    });
    expect(seqDifferentQty.status).toBe(409);
    expect((seqDifferentQty.body as ErrorResponse).error.code).toBe(
      ERROR_CODE.IDEMPOTENCY_CONFLICT,
    );

    const seqDifferentCustomer = await postOrder(baseUrl, 'conflict-seq-key', {
      customerId: 'cust-2',
      items: [{ sku: 'SKU-CONFLICT', quantity: 1 }],
    });
    expect(seqDifferentCustomer.status).toBe(409);
    expect((seqDifferentCustomer.body as ErrorResponse).error.code).toBe(
      ERROR_CODE.IDEMPOTENCY_CONFLICT,
    );

    const concurrentKey = 'conflict-race-key';
    const payloadA: CreateOrderBody = {
      customerId: 'cust-race',
      items: [{ sku: 'SKU-CONFLICT', quantity: 1 }],
    };
    const payloadB: CreateOrderBody = {
      customerId: 'cust-race',
      items: [{ sku: 'SKU-CONFLICT', quantity: 3 }],
    };

    const raceResults = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        postOrder(baseUrl, concurrentKey, index < 5 ? payloadA : payloadB),
      ),
    );

    const raceCreated = raceResults.filter((r) => r.status === 201);
    const raceReplayed = raceResults.filter((r) => r.status === 200);
    const raceConflicts = raceResults.filter((r) => r.status === 409);
    const raceErrors = raceResults.filter(
      (r) => r.status !== 201 && r.status !== 200 && r.status !== 409,
    );

    expect(raceErrors).toHaveLength(0);
    expect(raceCreated).toHaveLength(1);
    expect(raceReplayed).toHaveLength(4);
    expect(raceConflicts).toHaveLength(5);

    const winnerOrder = (raceCreated[0]?.body as CreateOrderResponse).order;
    const winningQty = winnerOrder.items[0]?.quantity ?? 0;
    expect([1, 3]).toContain(winningQty);

    for (const replay of raceReplayed) {
      expect((replay.body as CreateOrderResponse).order.id).toBe(winnerOrder.id);
    }
    for (const conflict of raceConflicts) {
      expect((conflict.body as ErrorResponse).error.code).toBe(ERROR_CODE.IDEMPOTENCY_CONFLICT);
    }

    const [skuRow] = await dbClient.db
      .select({ available: product.availableStock, reserved: product.reservedStock })
      .from(product)
      .where(eq(product.sku, 'SKU-CONFLICT'));

    expect(skuRow).toEqual({
      available: 10 - (1 + winningQty),
      reserved: 1 + winningQty,
    });

    await assertInventoryInvariants(dbClient.db);
  });

  it('Proof 4 (All-or-Nothing Multi-Item Failure): shortage on one SKU leaves zero items reserved, zero orders, and zero ledger writes', async () => {
    await seedTestProducts(dbClient.db, [
      { sku: 'SKU-A', name: 'Item A', pricePaise: 1000, totalStock: 5 },
      { sku: 'SKU-B', name: 'Item B', pricePaise: 2000, totalStock: 1 },
      { sku: 'SKU-C', name: 'Item C', pricePaise: 3000, totalStock: 10 },
    ]);

    const res = await postOrder(baseUrl, 'atomic-fail-key-001', {
      customerId: 'cust-atomic',
      items: [
        { sku: 'SKU-A', quantity: 2 },
        { sku: 'SKU-B', quantity: 3 },
        { sku: 'SKU-C', quantity: 4 },
      ],
    });

    expect(res.status).toBe(409);
    const errBody = res.body as ErrorResponse;
    expect(errBody.error.code).toBe(ERROR_CODE.INSUFFICIENT_STOCK);
    expect(errBody.error.details?.shortages).toEqual([
      { sku: 'SKU-B', requested: 3, available: 1 },
    ]);

    const products = await dbClient.db
      .select({
        sku: product.sku,
        availableStock: product.availableStock,
        reservedStock: product.reservedStock,
      })
      .from(product);

    const bySku = new Map(products.map((row) => [row.sku, row]));
    expect(bySku.get('SKU-A')).toEqual({ sku: 'SKU-A', availableStock: 5, reservedStock: 0 });
    expect(bySku.get('SKU-B')).toEqual({ sku: 'SKU-B', availableStock: 1, reservedStock: 0 });
    expect(bySku.get('SKU-C')).toEqual({ sku: 'SKU-C', availableStock: 10, reservedStock: 0 });

    const [ordersCount] = await dbClient.db.select({ total: count() }).from(reservationOrder);
    const [itemsCount] = await dbClient.db.select({ total: count() }).from(orderItem);
    const [keysCount] = await dbClient.db.select({ total: count() }).from(idempotencyKey);
    const [reserveLedgerCount] = await dbClient.db
      .select({ total: count() })
      .from(inventoryLedger)
      .where(eq(inventoryLedger.eventType, 'RESERVE'));

    expect(ordersCount?.total).toBe(0);
    expect(itemsCount?.total).toBe(0);
    expect(keysCount?.total).toBe(0);
    expect(reserveLedgerCount?.total).toBe(0);

    await assertInventoryInvariants(dbClient.db);
  });

  it('Proof 5 (Reverse-Order Multi-Item Deadlock Resistance): 20 alternating [A,B] vs [B,A] concurrent requests complete with 0 deadlocks and exact conservation', async () => {
    await seedTestProducts(dbClient.db, [
      { sku: 'SKU-ALPHA', name: 'Alpha Unit', pricePaise: 1000, totalStock: 10 },
      { sku: 'SKU-OMEGA', name: 'Omega Unit', pricePaise: 2000, totalStock: 10 },
    ]);

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => {
        const items =
          index % 2 === 0
            ? [
                { sku: 'SKU-ALPHA', quantity: 1 },
                { sku: 'SKU-OMEGA', quantity: 1 },
              ]
            : [
                { sku: 'SKU-OMEGA', quantity: 1 },
                { sku: 'SKU-ALPHA', quantity: 1 },
              ];
        return postOrder(baseUrl, `reverse-lock-key-${index}`, {
          customerId: `cust-lock-${index}`,
          items,
        });
      }),
    );

    const created = results.filter((r) => r.status === 201);
    const shortages = results.filter((r) => r.status === 409);
    const unexpected = results.filter((r) => r.status !== 201 && r.status !== 409);

    expect(unexpected).toHaveLength(0);
    expect(created).toHaveLength(10);
    expect(shortages).toHaveLength(10);

    for (const failure of shortages) {
      expect((failure.body as ErrorResponse).error.code).toBe(ERROR_CODE.INSUFFICIENT_STOCK);
    }

    const [alpha] = await dbClient.db
      .select({ available: product.availableStock, reserved: product.reservedStock })
      .from(product)
      .where(eq(product.sku, 'SKU-ALPHA'));
    const [omega] = await dbClient.db
      .select({ available: product.availableStock, reserved: product.reservedStock })
      .from(product)
      .where(eq(product.sku, 'SKU-OMEGA'));

    expect(alpha).toEqual({ available: 0, reserved: 10 });
    expect(omega).toEqual({ available: 0, reserved: 10 });

    const [ordersCount] = await dbClient.db.select({ total: count() }).from(reservationOrder);
    expect(ordersCount?.total).toBe(10);

    await assertInventoryInvariants(dbClient.db);
  });

  it('Proof 6 (Concurrent Repeated Cancellation): 10 simultaneous cancel requests release reserved stock exactly once', async () => {
    await seedTestProducts(dbClient.db, [
      { sku: 'SKU-X', name: 'Item X', pricePaise: 1200, totalStock: 7 },
      { sku: 'SKU-Y', name: 'Item Y', pricePaise: 2400, totalStock: 5 },
    ]);

    const createdRes = await postOrder(baseUrl, 'cancel-race-order-001', {
      customerId: 'cust-cancel',
      items: [
        { sku: 'SKU-X', quantity: 3 },
        { sku: 'SKU-Y', quantity: 2 },
      ],
    });
    expect(createdRes.status).toBe(201);
    const orderId = (createdRes.body as CreateOrderResponse).order.id;

    const cancelResults = await Promise.all(
      Array.from({ length: 10 }, () => postCancel(baseUrl, orderId)),
    );

    expect(cancelResults.every((r) => r.status === 200)).toBe(true);
    const bodies = cancelResults.map((r) => r.body as CancelOrderResponse);
    expect(bodies.every((b) => b.order.status === 'CANCELLED')).toBe(true);
    expect(bodies.filter((b) => b.alreadyCancelled === false)).toHaveLength(1);
    expect(bodies.filter((b) => b.alreadyCancelled === true)).toHaveLength(9);

    const [skuX] = await dbClient.db
      .select({ available: product.availableStock, reserved: product.reservedStock })
      .from(product)
      .where(eq(product.sku, 'SKU-X'));
    const [skuY] = await dbClient.db
      .select({ available: product.availableStock, reserved: product.reservedStock })
      .from(product)
      .where(eq(product.sku, 'SKU-Y'));

    expect(skuX).toEqual({ available: 7, reserved: 0 });
    expect(skuY).toEqual({ available: 5, reserved: 0 });

    const [releaseRows] = await dbClient.db
      .select({ total: count() })
      .from(inventoryLedger)
      .where(eq(inventoryLedger.eventType, 'RELEASE'));
    expect(releaseRows?.total).toBe(2);

    await assertInventoryInvariants(dbClient.db);
  });
});
