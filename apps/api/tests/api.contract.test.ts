import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DbClient } from '@ois/db/client';
import {
  ERROR_CODE,
  type CancelOrderResponse,
  type CreateOrderResponse,
  type ErrorResponse,
  type HealthResponse,
  type ListRejectionsResponse,
  type ListOrdersResponse,
  type OrderDetailDto,
  type ProductDetailDto,
  type ProductListResponse,
} from '@ois/shared/schemas';
import { buildApp } from '../src/app.js';
import {
  assertInventoryInvariants,
  createTestDbClient,
  ensureTestDatabaseMigrated,
  resetTestDb,
  seedTestProducts,
} from './setup.js';

function assertCleanErrorBody(body: unknown, expectedCode: number): ErrorResponse {
  expect(typeof body).toBe('object');
  expect(body).not.toBeNull();
  const record = body as Record<string, unknown>;
  expect(Object.keys(record)).toEqual(['error']);
  expect('statusCode' in record).toBe(false);
  expect('headers' in record).toBe(false);

  const errorObj = record.error as Record<string, unknown>;
  expect(typeof errorObj).toBe('object');
  expect(errorObj).not.toBeNull();
  expect('statusCode' in errorObj).toBe(false);
  expect('headers' in errorObj).toBe(false);
  expect(errorObj.code).toBe(expectedCode);
  expect(typeof errorObj.code).toBe('number');
  expect(typeof errorObj.message).toBe('string');

  return body as ErrorResponse;
}

describe('API Contract & Error Envelope', () => {
  let dbClient: DbClient;
  let app: FastifyInstance;

  beforeAll(async () => {
    await ensureTestDatabaseMigrated();
    dbClient = createTestDbClient(10);
    app = await buildApp({
      dbClient,
      logLevel: 'silent',
      enablePressure: false,
      enableDocs: true,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await dbClient.close();
  });

  beforeEach(async () => {
    await resetTestDb(dbClient.db);
    await seedTestProducts(dbClient.db, [
      { sku: 'SKU-A', name: 'Widget A', pricePaise: 1500, totalStock: 5 },
      { sku: 'SKU-B', name: 'Widget B', pricePaise: 2500, totalStock: 3 },
      { sku: 'SKU-C', name: 'Widget C', pricePaise: 500, totalStock: 0 },
    ]);
  });

  it('serves health check with database latency, pool metrics, and security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-response-time']).toMatch(/ms$/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');

    const body = res.json<HealthResponse>();
    expect(body.status).toBe('ok');
    expect(body.database).toBe('connected');
    expect(body.dbLatencyMs).toBeGreaterThanOrEqual(0);
    expect(body.pool.totalCount).toBeGreaterThanOrEqual(1);
  });

  it('lists inventory sorted by SKU and supports conditional ETag 304 responses', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/inventory' });
    expect(first.statusCode).toBe(200);
    const etagHeader = first.headers.etag;
    expect(typeof etagHeader).toBe('string');

    const body = first.json<ProductListResponse>();
    expect(body.products.map((p) => p.sku)).toEqual(['SKU-A', 'SKU-B', 'SKU-C']);

    const cached = await app.inject({
      method: 'GET',
      url: '/api/inventory',
      headers: { 'if-none-match': String(etagHeader) },
    });
    expect(cached.statusCode).toBe(304);
  });

  it('returns product detail with ledger and 404 (1101) for unknown product', async () => {
    const found = await app.inject({ method: 'GET', url: '/api/inventory/SKU-A' });
    expect(found.statusCode).toBe(200);
    const detail = found.json<ProductDetailDto>();
    expect(detail.product.sku).toBe('SKU-A');
    expect(detail.product.availableStock).toBe(5);
    expect(detail.ledger).toHaveLength(1);
    expect(detail.ledger[0]?.eventType).toBe('SEED');

    const missing = await app.inject({ method: 'GET', url: '/api/inventory/SKU-DOES-NOT-EXIST' });
    expect(missing.statusCode).toBe(404);
    assertCleanErrorBody(missing.json(), ERROR_CODE.PRODUCT_NOT_FOUND);
  });

  it('enforces validation and 1000-series error codes with zero HTTP status/headers in JSON', async () => {
    const noKey = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: { customerId: 'cust-1', items: [{ sku: 'SKU-A', quantity: 1 }] },
    });
    expect(noKey.statusCode).toBe(400);
    assertCleanErrorBody(noKey.json(), ERROR_CODE.MISSING_IDEMPOTENCY_KEY);

    const blankKey = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { 'idempotency-key': '   ' },
      payload: { customerId: 'cust-1', items: [{ sku: 'SKU-A', quantity: 1 }] },
    });
    expect(blankKey.statusCode).toBe(400);
    assertCleanErrorBody(blankKey.json(), ERROR_CODE.MISSING_IDEMPOTENCY_KEY);

    const zeroQty = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { 'idempotency-key': 'bad-qty-001' },
      payload: { customerId: 'cust-1', items: [{ sku: 'SKU-A', quantity: 0 }] },
    });
    expect(zeroQty.statusCode).toBe(400);
    assertCleanErrorBody(zeroQty.json(), ERROR_CODE.VALIDATION_FAILED);

    const emptyItems = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { 'idempotency-key': 'empty-items-001' },
      payload: { customerId: 'cust-1', items: [] },
    });
    expect(emptyItems.statusCode).toBe(400);
    assertCleanErrorBody(emptyItems.json(), ERROR_CODE.VALIDATION_FAILED);

    const dupSku = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { 'idempotency-key': 'dup-sku-001' },
      payload: {
        customerId: 'cust-1',
        items: [
          { sku: 'SKU-A', quantity: 1 },
          { sku: ' SKU-A ', quantity: 2 },
        ],
      },
    });
    expect(dupSku.statusCode).toBe(400);
    const dupBody = assertCleanErrorBody(dupSku.json(), ERROR_CODE.DUPLICATE_SKU);
    expect(dupBody.error.details?.duplicateSkus).toEqual(['SKU-A']);

    const unknownSku = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { 'idempotency-key': 'unknown-sku-001' },
      payload: { customerId: 'cust-1', items: [{ sku: 'SKU-NOPE', quantity: 1 }] },
    });
    expect(unknownSku.statusCode).toBe(404);
    const unknownBody = assertCleanErrorBody(unknownSku.json(), ERROR_CODE.UNKNOWN_SKU);
    expect(unknownBody.error.details?.missingSkus).toEqual(['SKU-NOPE']);

    const badRoute = await app.inject({ method: 'GET', url: '/api/nonexistent-route' });
    expect(badRoute.statusCode).toBe(404);
    assertCleanErrorBody(badRoute.json(), ERROR_CODE.ROUTE_NOT_FOUND);

    const badOrderId = await app.inject({ method: 'GET', url: '/api/orders/not-a-uuid' });
    expect(badOrderId.statusCode).toBe(404);
    assertCleanErrorBody(badOrderId.json(), ERROR_CODE.ORDER_NOT_FOUND);

    const badCursor = await app.inject({
      method: 'GET',
      url: '/api/orders?cursor=definitely-invalid-cursor',
    });
    expect(badCursor.statusCode).toBe(400);
    assertCleanErrorBody(badCursor.json(), ERROR_CODE.INVALID_CURSOR);

    await assertInventoryInvariants(dbClient.db);
  });

  it('creates, replays with canonical payload equivalence, inspects by ID and key, and cancels idempotently', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { 'idempotency-key': 'contract-order-001' },
      payload: {
        customerId: 'cust-alpha',
        items: [
          { sku: 'SKU-B', quantity: 2 },
          { sku: 'SKU-A', quantity: 1 },
        ],
      },
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.headers['idempotency-replayed']).toBe('false');
    const created = createRes.json<CreateOrderResponse>();
    expect(created.replayed).toBe(false);
    expect(created.order.status).toBe('RESERVED');
    expect(created.order.totalPaise).toBe(2 * 2500 + 1 * 1500);
    expect(created.order.items.map((item) => item.sku)).toEqual(['SKU-A', 'SKU-B']);

    const replayRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { 'idempotency-key': 'contract-order-001' },
      payload: {
        customerId: '  cust-alpha ',
        items: [
          { sku: ' SKU-A ', quantity: 1 },
          { sku: 'SKU-B', quantity: 2 },
        ],
      },
    });
    expect(replayRes.statusCode).toBe(200);
    expect(replayRes.headers['idempotency-replayed']).toBe('true');
    const replayed = replayRes.json<CreateOrderResponse>();
    expect(replayed.replayed).toBe(true);
    expect(replayed.order.id).toBe(created.order.id);

    const byIdRes = await app.inject({
      method: 'GET',
      url: `/api/orders/${created.order.id}`,
    });
    expect(byIdRes.statusCode).toBe(200);
    const detailById = byIdRes.json<OrderDetailDto>();
    expect(detailById.order.id).toBe(created.order.id);
    expect(detailById.idempotency?.key).toBe('contract-order-001');
    expect(detailById.idempotency?.status).toBe('COMPLETED');
    expect(detailById.ledger).toHaveLength(2);
    expect(detailById.ledger.every((entry) => entry.eventType === 'RESERVE')).toBe(true);

    const byKeyRes = await app.inject({
      method: 'GET',
      url: '/api/orders/by-key/contract-order-001',
    });
    expect(byKeyRes.statusCode).toBe(200);
    expect(byKeyRes.json<OrderDetailDto>().order.id).toBe(created.order.id);

    const firstCancel = await app.inject({
      method: 'POST',
      url: `/api/orders/${created.order.id}/cancel`,
    });
    expect(firstCancel.statusCode).toBe(200);
    const firstCancelBody = firstCancel.json<CancelOrderResponse>();
    expect(firstCancelBody.alreadyCancelled).toBe(false);
    expect(firstCancelBody.order.status).toBe('CANCELLED');
    expect(firstCancelBody.order.cancelledAt).not.toBeNull();

    const secondCancel = await app.inject({
      method: 'POST',
      url: `/api/orders/${created.order.id}/cancel`,
    });
    expect(secondCancel.statusCode).toBe(200);
    const secondCancelBody = secondCancel.json<CancelOrderResponse>();
    expect(secondCancelBody.alreadyCancelled).toBe(true);
    expect(secondCancelBody.order.status).toBe('CANCELLED');

    const afterCancelDetail = (
      await app.inject({ method: 'GET', url: `/api/orders/${created.order.id}` })
    ).json<OrderDetailDto>();
    expect(afterCancelDetail.ledger).toHaveLength(4);
    expect(afterCancelDetail.ledger.filter((e) => e.eventType === 'RELEASE')).toHaveLength(2);

    const replayAfterCancel = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { 'idempotency-key': 'contract-order-001' },
      payload: {
        customerId: 'cust-alpha',
        items: [
          { sku: 'SKU-A', quantity: 1 },
          { sku: 'SKU-B', quantity: 2 },
        ],
      },
    });
    expect(replayAfterCancel.statusCode).toBe(200);
    expect(replayAfterCancel.headers['idempotency-replayed']).toBe('true');
    const replayAfterCancelBody = replayAfterCancel.json<CreateOrderResponse>();
    expect(replayAfterCancelBody.order).toEqual(created.order);
    expect(replayAfterCancelBody.order.status).toBe('RESERVED');
    expect(replayAfterCancelBody.order.cancelledAt).toBeNull();

    const afterReplayDetail = (
      await app.inject({ method: 'GET', url: `/api/orders/${created.order.id}` })
    ).json<OrderDetailDto>();
    expect(afterReplayDetail.order.status).toBe('CANCELLED');
    expect(afterReplayDetail.ledger).toHaveLength(4);

    await assertInventoryInvariants(dbClient.db);
  });

  it('paginates orders deterministically via keyset cursor and supports status, sku, and search filters', async () => {
    const createdIds: string[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { 'idempotency-key': `page-key-00${i}` },
        payload: {
          customerId: i % 2 === 0 ? 'cust-even' : 'cust-odd',
          items: [{ sku: 'SKU-A', quantity: 1 }],
        },
      });
      expect(res.statusCode).toBe(201);
      createdIds.push(res.json<CreateOrderResponse>().order.id);
    }

    const cancelledId = createdIds[0];
    if (!cancelledId) {
      throw new Error('Expected at least one created order');
    }
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/orders/${cancelledId}/cancel`,
    });
    expect(cancelRes.statusCode).toBe(200);

    const seenIds: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const url: string = cursor
        ? `/api/orders?limit=2&cursor=${encodeURIComponent(cursor)}`
        : '/api/orders?limit=2';
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      const body: ListOrdersResponse = res.json<ListOrdersResponse>();
      seenIds.push(...body.orders.map((order) => order.id));
      cursor = body.nextCursor;
      if (!cursor) {
        break;
      }
    }

    expect(seenIds).toHaveLength(5);
    expect(new Set(seenIds).size).toBe(5);
    expect(seenIds).toEqual([...createdIds].reverse());

    const cancelledOnly = (
      await app.inject({ method: 'GET', url: '/api/orders?status=CANCELLED' })
    ).json<ListOrdersResponse>();
    expect(cancelledOnly.orders.map((o) => o.id)).toEqual([cancelledId]);

    const searchByKey = (
      await app.inject({ method: 'GET', url: '/api/orders?search=page-key-003' })
    ).json<ListOrdersResponse>();
    expect(searchByKey.orders).toHaveLength(1);
    expect(searchByKey.orders[0]?.idempotencyKey).toBe('page-key-003');

    const bySku = (
      await app.inject({ method: 'GET', url: '/api/orders?sku=SKU-B' })
    ).json<ListOrdersResponse>();
    expect(bySku.orders).toHaveLength(0);

    await assertInventoryInvariants(dbClient.db);
  });

  it('records rejected attempts and serves them with filters, validation and cursor pagination', async () => {
    for (const [key, sku, quantity] of [
      ['rej-key-1', 'SKU-C', 1],
      ['rej-key-2', 'SKU-B', 9],
      ['rej-key-3', 'SKU-NOPE', 1],
    ] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { 'idempotency-key': key },
        payload: { customerId: 'cust-rej', items: [{ sku, quantity }] },
      });
      expect([404, 409]).toContain(res.statusCode);
    }

    const page1 = (await app.inject({ method: 'GET', url: '/api/rejections?limit=2' })).json<ListRejectionsResponse>();
    expect(page1.rejections.map((r) => r.idempotencyKey)).toEqual(['rej-key-3', 'rej-key-2']);
    expect(page1.rejections[0]?.reason).toBe('UNKNOWN_SKU');
    expect(page1.rejections[0]?.missingSkus).toEqual(['SKU-NOPE']);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = (
      await app.inject({ method: 'GET', url: `/api/rejections?limit=2&cursor=${page1.nextCursor ?? ''}` })
    ).json<ListRejectionsResponse>();
    expect(page2.rejections.map((r) => r.idempotencyKey)).toEqual(['rej-key-1']);
    expect(page2.nextCursor).toBeNull();

    const bySku = (await app.inject({ method: 'GET', url: '/api/rejections?sku=SKU-B' })).json<ListRejectionsResponse>();
    expect(bySku.rejections).toHaveLength(1);
    expect(bySku.rejections[0]?.shortages).toEqual([{ sku: 'SKU-B', requested: 9, available: 3 }]);

    const tooMany = await app.inject({ method: 'GET', url: '/api/rejections?limit=101' });
    expect(tooMany.statusCode).toBe(400);
    assertCleanErrorBody(tooMany.json(), ERROR_CODE.VALIDATION_FAILED);
    const badCursor = await app.inject({ method: 'GET', url: '/api/rejections?cursor=abc' });
    expect(badCursor.statusCode).toBe(400);

    await assertInventoryInvariants(dbClient.db);
  });
});
