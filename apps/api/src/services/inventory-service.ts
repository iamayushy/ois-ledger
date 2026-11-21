import { asc, desc, eq } from 'drizzle-orm';
import type { OisDatabase } from '@ois/db/client';
import { inventoryLedger, product } from '@ois/db/schema';
import type {
  LedgerEntryDto,
  LedgerEventType,
  ProductDetailDto,
  ProductDto,
} from '@ois/shared/schemas';
import { productNotFoundError } from '../errors.js';

const DEFAULT_LEDGER_LIMIT = 50;
const MAX_LEDGER_LIMIT = 100;

export function toLedgerEntryDto(row: {
  readonly id: bigint;
  readonly sku: string;
  readonly orderId: string | null;
  readonly idempotencyKey: string | null;
  readonly eventType: string;
  readonly delta: number;
  readonly availableAfter: number;
  readonly reservedAfter: number;
  readonly createdAt: Date;
}): LedgerEntryDto {
  return {
    id: row.id.toString(),
    sku: row.sku,
    orderId: row.orderId,
    idempotencyKey: row.idempotencyKey,
    eventType: row.eventType as LedgerEventType,
    delta: row.delta,
    availableAfter: row.availableAfter,
    reservedAfter: row.reservedAfter,
    createdAt: row.createdAt.toISOString(),
  };
}

function toProductDto(row: {
  readonly sku: string;
  readonly name: string;
  readonly pricePaise: number;
  readonly totalStock: number;
  readonly availableStock: number;
  readonly reservedStock: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}): ProductDto {
  return {
    sku: row.sku,
    name: row.name,
    pricePaise: row.pricePaise,
    totalStock: row.totalStock,
    availableStock: row.availableStock,
    reservedStock: row.reservedStock,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listInventory(db: OisDatabase): Promise<ProductDto[]> {
  const rows = await db
    .select({
      sku: product.sku,
      name: product.name,
      pricePaise: product.pricePaise,
      totalStock: product.totalStock,
      availableStock: product.availableStock,
      reservedStock: product.reservedStock,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    })
    .from(product)
    .orderBy(asc(product.sku))
    .limit(500);

  return rows.map(toProductDto);
}

export async function getProductWithLedger(
  db: OisDatabase,
  rawSku: string,
  requestedLimit?: number,
): Promise<ProductDetailDto> {
  const sku = rawSku.trim();
  const limit = Math.min(
    Math.max(requestedLimit ?? DEFAULT_LEDGER_LIMIT, 1),
    MAX_LEDGER_LIMIT,
  );

  const [found] = await db
    .select({
      sku: product.sku,
      name: product.name,
      pricePaise: product.pricePaise,
      totalStock: product.totalStock,
      availableStock: product.availableStock,
      reservedStock: product.reservedStock,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    })
    .from(product)
    .where(eq(product.sku, sku))
    .limit(1);

  if (!found) {
    throw productNotFoundError(sku);
  }

  const ledgerRows = await db
    .select({
      id: inventoryLedger.id,
      sku: inventoryLedger.sku,
      orderId: inventoryLedger.orderId,
      idempotencyKey: inventoryLedger.idempotencyKey,
      eventType: inventoryLedger.eventType,
      delta: inventoryLedger.delta,
      availableAfter: inventoryLedger.availableAfter,
      reservedAfter: inventoryLedger.reservedAfter,
      createdAt: inventoryLedger.createdAt,
    })
    .from(inventoryLedger)
    .where(eq(inventoryLedger.sku, sku))
    .orderBy(desc(inventoryLedger.createdAt), desc(inventoryLedger.id))
    .limit(limit);

  return {
    product: toProductDto(found),
    ledger: ledgerRows.map(toLedgerEntryDto),
  };
}
