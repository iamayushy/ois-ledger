import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { OrderDto } from '@ois/shared/schemas';

export const product = pgTable(
  'product',
  {
    sku: text('sku').primaryKey(),
    name: text('name').notNull(),
    pricePaise: integer('price_paise').notNull(),
    totalStock: integer('total_stock').notNull(),
    availableStock: integer('available_stock').notNull(),
    reservedStock: integer('reserved_stock').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('product_price_paise_check', sql`${table.pricePaise} >= 0`),
    check('product_total_stock_check', sql`${table.totalStock} >= 0`),
    check('product_available_stock_check', sql`${table.availableStock} >= 0`),
    check('product_reserved_stock_check', sql`${table.reservedStock} >= 0`),
    check(
      'product_stock_conservation_check',
      sql`${table.availableStock} + ${table.reservedStock} = ${table.totalStock}`,
    ),
  ],
);

export const reservationOrder = pgTable(
  'reservation_order',
  {
    id: uuid('id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    customerId: text('customer_id').notNull(),
    status: text('status').notNull(),
    totalPaise: bigint('total_paise', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'reservation_order_status_check',
      sql`${table.status} IN ('RESERVED', 'CANCELLED')`,
    ),
    check('reservation_order_total_paise_check', sql`${table.totalPaise} >= 0`),
    check(
      'reservation_order_cancelled_at_check',
      sql`(${table.status} = 'CANCELLED' AND ${table.cancelledAt} IS NOT NULL) OR (${table.status} = 'RESERVED' AND ${table.cancelledAt} IS NULL)`,
    ),
    index('reservation_order_status_created_id_idx').on(
      table.status,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('reservation_order_created_id_idx').on(
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('reservation_order_customer_id_idx').on(
      table.customerId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const orderItem = pgTable(
  'order_item',
  {
    id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => reservationOrder.id, { onDelete: 'cascade' }),
    sku: text('sku')
      .notNull()
      .references(() => product.sku, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    unitPricePaise: integer('unit_price_paise').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('order_item_quantity_check', sql`${table.quantity} > 0`),
    check('order_item_unit_price_paise_check', sql`${table.unitPricePaise} >= 0`),
    uniqueIndex('order_item_order_id_sku_unique').on(table.orderId, table.sku),
    index('order_item_sku_idx').on(table.sku),
  ],
);

export const idempotencyKey = pgTable(
  'idempotency_key',
  {
    key: text('key').primaryKey(),
    requestHash: text('request_hash').notNull(),
    status: text('status').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body').$type<OrderDto | null>(),
    orderId: uuid('order_id').references(() => reservationOrder.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'idempotency_key_status_check',
      sql`${table.status} IN ('IN_PROGRESS', 'COMPLETED')`,
    ),
    check(
      'idempotency_key_completed_payload_check',
      sql`(${table.status} = 'IN_PROGRESS') OR (${table.status} = 'COMPLETED' AND ${table.responseStatus} IS NOT NULL AND ${table.responseBody} IS NOT NULL AND ${table.orderId} IS NOT NULL)`,
    ),
    index('idempotency_key_order_id_idx').on(table.orderId),
  ],
);

export const inventoryLedger = pgTable(
  'inventory_ledger',
  {
    id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
    sku: text('sku')
      .notNull()
      .references(() => product.sku, { onDelete: 'restrict' }),
    orderId: uuid('order_id').references(() => reservationOrder.id, {
      onDelete: 'set null',
    }),
    idempotencyKey: text('idempotency_key'),
    eventType: text('event_type').notNull(),
    delta: integer('delta').notNull(),
    availableAfter: integer('available_after').notNull(),
    reservedAfter: integer('reserved_after').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'inventory_ledger_event_type_check',
      sql`${table.eventType} IN ('SEED', 'RESERVE', 'RELEASE')`,
    ),
    check('inventory_ledger_available_after_check', sql`${table.availableAfter} >= 0`),
    check('inventory_ledger_reserved_after_check', sql`${table.reservedAfter} >= 0`),
    check(
      'inventory_ledger_delta_sign_check',
      sql`(${table.eventType} = 'RESERVE' AND ${table.delta} < 0) OR (${table.eventType} = 'RELEASE' AND ${table.delta} > 0) OR (${table.eventType} = 'SEED' AND ${table.delta} >= 0)`,
    ),
    index('inventory_ledger_order_id_idx').on(table.orderId),
    index('inventory_ledger_sku_created_id_idx').on(
      table.sku,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export interface RejectionDetails {
  readonly items: readonly { readonly sku: string; readonly quantity: number }[];
  readonly shortages: readonly { readonly sku: string; readonly requested: number; readonly available: number }[];
  readonly missingSkus: readonly string[];
}

export const reservationRejection = pgTable(
  'reservation_rejection',
  {
    id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    customerId: text('customer_id').notNull(),
    requestHash: text('request_hash').notNull(),
    errorCode: integer('error_code').notNull(),
    skus: text('skus').array().notNull(),
    details: jsonb('details').$type<RejectionDetails>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('reservation_rejection_error_code_check', sql`${table.errorCode} IN (1102, 1201, 1202)`),
    index('reservation_rejection_key_id_idx').on(table.idempotencyKey, table.id.desc()),
    index('reservation_rejection_skus_gin_idx').using('gin', table.skus),
  ],
);

export const dbSchema = {
  product,
  reservationOrder,
  orderItem,
  idempotencyKey,
  inventoryLedger,
  reservationRejection,
};

export type DbSchema = typeof dbSchema;
export type ProductRow = typeof product.$inferSelect;
export type ReservationOrderRow = typeof reservationOrder.$inferSelect;
export type OrderItemRow = typeof orderItem.$inferSelect;
export type ReservationRejectionRow = typeof reservationRejection.$inferSelect;
export type IdempotencyKeyRow = typeof idempotencyKey.$inferSelect;
export type InventoryLedgerRow = typeof inventoryLedger.$inferSelect;
