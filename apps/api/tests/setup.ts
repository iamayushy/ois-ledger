import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { expect } from 'vitest';
import { createDbClient, type DbClient, type OisDatabase } from '@ois/db/client';
import { runMigrations } from '@ois/db/migrate';
import { inventoryLedger, product } from '@ois/db/schema';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_ENV_PATH = resolve(CURRENT_DIR, '../../../.env');

export interface TestProductSeed {
  readonly sku: string;
  readonly name: string;
  readonly pricePaise: number;
  readonly totalStock: number;
}

let migrationPromise: Promise<void> | null = null;

export function getTestDatabaseUrl(): string {
  if (!process.env.TEST_DATABASE_URL && existsSync(ROOT_ENV_PATH)) {
    process.loadEnvFile(ROOT_ENV_PATH);
  }

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL must be configured before running API tests');
  }

  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to run destructive test suite against non-test database: ${dbName}`);
  }

  return url;
}

export async function ensureTestDatabaseMigrated(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = runMigrations(getTestDatabaseUrl());
  }
  await migrationPromise;
}

export function createTestDbClient(max = 25): DbClient {
  return createDbClient({
    connectionString: getTestDatabaseUrl(),
    max,
    idleTimeoutMs: 10_000,
    connectionTimeoutMs: 5_000,
  });
}

export async function resetTestDb(db: OisDatabase): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE reservation_rejection, inventory_ledger, order_item, idempotency_key, reservation_order, product RESTART IDENTITY CASCADE`,
  );
}

export async function seedTestProducts(
  db: OisDatabase,
  products: readonly TestProductSeed[],
): Promise<void> {
  if (products.length === 0) {
    return;
  }

  const now = new Date();

  await db.insert(product).values(
    products.map((item) => ({
      sku: item.sku,
      name: item.name,
      pricePaise: item.pricePaise,
      totalStock: item.totalStock,
      availableStock: item.totalStock,
      reservedStock: 0,
      createdAt: now,
      updatedAt: now,
    })),
  );

  const seedLedgerRows = products
    .filter((item) => item.totalStock > 0)
    .map((item) => ({
      sku: item.sku,
      orderId: null,
      idempotencyKey: null,
      eventType: 'SEED',
      delta: item.totalStock,
      availableAfter: item.totalStock,
      reservedAfter: 0,
      createdAt: now,
    }));

  if (seedLedgerRows.length > 0) {
    await db.insert(inventoryLedger).values(seedLedgerRows);
  }
}

interface InvariantRow {
  readonly sku: string;
  readonly total_stock: number;
  readonly available_stock: number;
  readonly reserved_stock: number;
  readonly ledger_sum: string;
  readonly active_reserved_sum: string;
}

export async function assertInventoryInvariants(db: OisDatabase): Promise<void> {
  const result = await db.execute(sql`
    SELECT
      p.sku,
      p.total_stock,
      p.available_stock,
      p.reserved_stock,
      COALESCE((
        SELECT SUM(l.delta)
        FROM inventory_ledger l
        WHERE l.sku = p.sku
      ), 0)::text AS ledger_sum,
      COALESCE((
        SELECT SUM(oi.quantity)
        FROM order_item oi
        INNER JOIN reservation_order o ON o.id = oi.order_id
        WHERE oi.sku = p.sku AND o.status = 'RESERVED'
      ), 0)::text AS active_reserved_sum
    FROM product p
    ORDER BY p.sku ASC
  `);

  const rows = result.rows as unknown as readonly InvariantRow[];
  for (const row of rows) {
    expect(row.available_stock, `${row.sku} available_stock >= 0`).toBeGreaterThanOrEqual(0);
    expect(row.reserved_stock, `${row.sku} reserved_stock >= 0`).toBeGreaterThanOrEqual(0);
    expect(
      row.available_stock + row.reserved_stock,
      `${row.sku} available + reserved === total`,
    ).toBe(row.total_stock);
    expect(Number(row.ledger_sum), `${row.sku} SUM(ledger.delta) === available_stock`).toBe(
      row.available_stock,
    );
    expect(
      Number(row.active_reserved_sum),
      `${row.sku} SUM(active order_item.quantity) === reserved_stock`,
    ).toBe(row.reserved_stock);
  }
}
