import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { OisDatabase } from '@ois/db/client';
import {
  idempotencyKey,
  inventoryLedger,
  orderItem,
  product,
  reservationOrder,
} from '@ois/db/schema';
import { hashOrderPayload } from '@ois/shared/hash';
import type {
  CancelOrderResponse,
  CreateOrderBody,
  CreateOrderResponse,
  IdempotencyMetadataDto,
  IdempotencyStatus,
  ListOrdersQuery,
  ListOrdersResponse,
  OrderDetailDto,
  OrderDto,
  OrderItemDto,
  OrderStatus,
  StockShortageDto,
} from '@ois/shared/schemas';
import { generateUuidV7, isValidUuid } from '@ois/shared/uuidv7';
import {
  duplicateSkuError,
  idempotencyConflictError,
  insufficientStockError,
  invalidCursorError,
  invalidOrderPayloadError,
  isAppError,
  missingIdempotencyKeyError,
  orderNotFoundError,
  transientDbError,
  unknownSkuError,
} from '../errors.js';
import { toLedgerEntryDto } from './inventory-service.js';

type DbExecutor = Pick<OisDatabase, 'select' | 'insert' | 'update' | 'execute'>;

interface OrderHeaderRow {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly customerId: string;
  readonly status: string;
  readonly totalPaise: number;
  readonly createdAt: Date;
  readonly cancelledAt: Date | null;
}

type OrderLockRow = {
  readonly id: string;
  readonly idempotency_key: string;
  readonly customer_id: string;
  readonly status: string;
  readonly total_paise: string | number;
  readonly created_at: string | Date;
  readonly cancelled_at: string | Date | null;
};

function toOrderHeaderRow(row: OrderLockRow | undefined): OrderHeaderRow | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    customerId: row.customer_id,
    status: row.status,
    totalPaise: Number(row.total_paise),
    createdAt: new Date(row.created_at),
    cancelledAt: row.cancelled_at === null ? null : new Date(row.cancelled_at),
  };
}

interface CursorPayload {
  readonly createdAt: string;
  readonly id: string;
}

const DEFAULT_ORDERS_LIMIT = 25;
const MAX_ORDERS_LIMIT = 100;

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): CursorPayload {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('createdAt' in parsed) ||
      !('id' in parsed) ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.id !== 'string' ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      !isValidUuid(parsed.id)
    ) {
      throw invalidCursorError();
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch (error) {
    if (isAppError(error)) {
      throw error;
    }
    throw invalidCursorError();
  }
}

function assembleOrderDto(header: OrderHeaderRow, items: OrderItemDto[]): OrderDto {
  return {
    id: header.id,
    idempotencyKey: header.idempotencyKey,
    customerId: header.customerId,
    status: header.status as OrderStatus,
    totalPaise: header.totalPaise,
    createdAt: header.createdAt.toISOString(),
    cancelledAt: header.cancelledAt ? header.cancelledAt.toISOString() : null,
    items,
  };
}

const TRANSACTION_SETTINGS = sql`
  SELECT
    set_config('lock_timeout', '5000', true) AS lock_timeout,
    set_config('statement_timeout', '10000', true) AS statement_timeout
`;

function skuIsAnyOf(skus: readonly string[]): SQL {
  return sql`${product.sku} = ANY(${sql.param([...skus])}::text[])`;
}

interface StockLine {
  readonly sku: string;
  readonly quantity: number;
  readonly unitPricePaise: number;
  readonly availableAfter: number;
  readonly reservedAfter: number;
}

interface ReservationWrite {
  readonly orderId: string;
  readonly idempotencyKey: string;
  readonly customerId: string;
  readonly totalPaise: number;
  readonly createdAt: Date;
  readonly lines: readonly StockLine[];
  readonly response: OrderDto;
}

type WriteCounts = {
  readonly stock_rows: number;
  readonly item_rows: number;
  readonly ledger_rows: number;
};

function stockLineValues(lines: readonly StockLine[]): SQL {
  return sql.join(
    lines.map(
      (line) =>
        sql`(${line.sku}::text, ${line.quantity}::integer, ${line.unitPricePaise}::integer, ${line.availableAfter}::integer, ${line.reservedAfter}::integer)`,
    ),
    sql`, `,
  );
}

async function writeReservation(executor: DbExecutor, write: ReservationWrite): Promise<void> {
  const result = await executor.execute<WriteCounts>(sql`
    WITH line(sku, qty, unit_price, available_after, reserved_after) AS (
      VALUES ${stockLineValues(write.lines)}
    ),
    stock AS (
      UPDATE product AS p
      SET
        available_stock = p.available_stock - line.qty,
        reserved_stock = p.reserved_stock + line.qty,
        updated_at = ${write.createdAt}::timestamptz
      FROM line
      WHERE p.sku = line.sku
      RETURNING p.sku
    ),
    new_order AS (
      INSERT INTO reservation_order (id, idempotency_key, customer_id, status, total_paise, created_at)
      VALUES (${write.orderId}::uuid, ${write.idempotencyKey}, ${write.customerId}, 'RESERVED', ${write.totalPaise}::bigint, ${write.createdAt}::timestamptz)
      RETURNING id
    ),
    items AS (
      INSERT INTO order_item (order_id, sku, quantity, unit_price_paise, created_at)
      SELECT new_order.id, line.sku, line.qty, line.unit_price, ${write.createdAt}::timestamptz
      FROM new_order CROSS JOIN line
      RETURNING sku
    ),
    ledger AS (
      INSERT INTO inventory_ledger (sku, order_id, idempotency_key, event_type, delta, available_after, reserved_after, created_at)
      SELECT line.sku, new_order.id, ${write.idempotencyKey}, 'RESERVE', -line.qty, line.available_after, line.reserved_after, ${write.createdAt}::timestamptz
      FROM new_order CROSS JOIN line
      RETURNING sku
    )
    UPDATE idempotency_key
    SET
      status = 'COMPLETED',
      response_status = 201,
      response_body = ${JSON.stringify(write.response)}::jsonb,
      order_id = (SELECT id FROM new_order),
      updated_at = ${write.createdAt}::timestamptz
    WHERE key = ${write.idempotencyKey}
    RETURNING
      (SELECT count(*) FROM stock)::integer AS stock_rows,
      (SELECT count(*) FROM items)::integer AS item_rows,
      (SELECT count(*) FROM ledger)::integer AS ledger_rows
  `);
  assertAllLinesWritten(result.rows[0], write.lines.length);
}

interface ReleaseWrite {
  readonly orderId: string;
  readonly idempotencyKey: string;
  readonly cancelledAt: Date;
  readonly lines: readonly StockLine[];
}

async function writeRelease(executor: DbExecutor, write: ReleaseWrite): Promise<void> {
  const result = await executor.execute<WriteCounts>(sql`
    WITH line(sku, qty, unit_price, available_after, reserved_after) AS (
      VALUES ${stockLineValues(write.lines)}
    ),
    stock AS (
      UPDATE product AS p
      SET
        available_stock = p.available_stock + line.qty,
        reserved_stock = p.reserved_stock - line.qty,
        updated_at = ${write.cancelledAt}::timestamptz
      FROM line
      WHERE p.sku = line.sku
      RETURNING p.sku
    ),
    ledger AS (
      INSERT INTO inventory_ledger (sku, order_id, idempotency_key, event_type, delta, available_after, reserved_after, created_at)
      SELECT line.sku, ${write.orderId}::uuid, ${write.idempotencyKey}, 'RELEASE', line.qty, line.available_after, line.reserved_after, ${write.cancelledAt}::timestamptz
      FROM line
      RETURNING sku
    )
    UPDATE reservation_order
    SET status = 'CANCELLED', cancelled_at = ${write.cancelledAt}::timestamptz
    WHERE id = ${write.orderId}::uuid
    RETURNING
      (SELECT count(*) FROM stock)::integer AS stock_rows,
      (SELECT count(*) FROM line)::integer AS item_rows,
      (SELECT count(*) FROM ledger)::integer AS ledger_rows
  `);
  assertAllLinesWritten(result.rows[0], write.lines.length);
}

function assertAllLinesWritten(counts: WriteCounts | undefined, expected: number): void {
  if (
    !counts ||
    counts.stock_rows !== expected ||
    counts.item_rows !== expected ||
    counts.ledger_rows !== expected
  ) {
    throw transientDbError('Reservation write affected an unexpected number of rows; retry request');
  }
}

async function fetchItemsByOrderIds(
  executor: DbExecutor,
  orderIds: readonly string[],
): Promise<Map<string, OrderItemDto[]>> {
  const itemsByOrder = new Map<string, OrderItemDto[]>();
  if (orderIds.length === 0) {
    return itemsByOrder;
  }

  const rows = await executor
    .select({
      orderId: orderItem.orderId,
      sku: orderItem.sku,
      productName: product.name,
      quantity: orderItem.quantity,
      unitPricePaise: orderItem.unitPricePaise,
    })
    .from(orderItem)
    .innerJoin(product, eq(orderItem.sku, product.sku))
    .where(inArray(orderItem.orderId, [...orderIds]))
    .orderBy(asc(orderItem.orderId), asc(orderItem.sku));

  for (const row of rows) {
    const bucket = itemsByOrder.get(row.orderId);
    const dto: OrderItemDto = {
      sku: row.sku,
      productName: row.productName,
      quantity: row.quantity,
      unitPricePaise: row.unitPricePaise,
    };
    if (bucket) {
      bucket.push(dto);
    } else {
      itemsByOrder.set(row.orderId, [dto]);
    }
  }

  return itemsByOrder;
}


export async function createOrder(
  db: OisDatabase,
  rawIdempotencyKey: string,
  payload: CreateOrderBody,
): Promise<CreateOrderResponse> {
  const trimmedKey = rawIdempotencyKey.trim();
  if (trimmedKey.length === 0) {
    throw missingIdempotencyKeyError();
  }

  const hashed = hashOrderPayload(payload);
  if (!hashed.ok) {
    throw duplicateSkuError(hashed.duplicateSkus);
  }

  const { canonical, requestHash } = hashed;
  if (canonical.customerId.length === 0) {
    throw invalidOrderPayloadError('customerId must be a non-empty string');
  }
  if (canonical.items.length === 0 || canonical.items.some((item) => item.sku.length === 0)) {
    throw invalidOrderPayloadError('items must contain non-empty SKUs');
  }

  const skus = canonical.items.map((item) => item.sku);

  return db.transaction(async (tx) => {
    const claimed = await tx.execute<{ key: string }>(sql`
      WITH settings AS (${TRANSACTION_SETTINGS})
      INSERT INTO idempotency_key (key, request_hash, status)
      SELECT ${trimmedKey}, ${requestHash}, 'IN_PROGRESS' FROM settings
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    `);

    if (claimed.rows.length === 0) {
      const [existing] = await tx
        .select({
          requestHash: idempotencyKey.requestHash,
          responseBody: idempotencyKey.responseBody,
        })
        .from(idempotencyKey)
        .where(eq(idempotencyKey.key, trimmedKey))
        .limit(1);

      if (!existing) {
        throw transientDbError('Idempotency record state changed concurrently; retry request');
      }

      if (existing.requestHash !== requestHash) {
        throw idempotencyConflictError(trimmedKey);
      }

      if (!existing.responseBody) {
        throw transientDbError('Original order payload unavailable; retry request');
      }

      return {
        order: existing.responseBody,
        replayed: true,
      };
    }

    const lockedProducts = await tx
      .select({
        sku: product.sku,
        name: product.name,
        pricePaise: product.pricePaise,
        availableStock: product.availableStock,
        reservedStock: product.reservedStock,
      })
      .from(product)
      .where(skuIsAnyOf(skus))
      .orderBy(asc(product.sku))
      .for('update');

    const productBySku = new Map(lockedProducts.map((row) => [row.sku, row]));

    const missingSkus: string[] = [];
    for (const item of canonical.items) {
      if (!productBySku.has(item.sku)) {
        missingSkus.push(item.sku);
      }
    }
    if (missingSkus.length > 0) {
      throw unknownSkuError(missingSkus);
    }

    const shortages: StockShortageDto[] = [];
    for (const item of canonical.items) {
      const locked = productBySku.get(item.sku);
      if (locked && locked.availableStock < item.quantity) {
        shortages.push({
          sku: item.sku,
          requested: item.quantity,
          available: locked.availableStock,
        });
      }
    }
    if (shortages.length > 0) {
      throw insufficientStockError(shortages);
    }

    const now = new Date();
    const orderId = generateUuidV7();
    let totalPaise = 0;

    const orderItemDtos: OrderItemDto[] = [];
    const lines: StockLine[] = [];

    for (const item of canonical.items) {
      const locked = productBySku.get(item.sku);
      if (!locked) {
        throw unknownSkuError([item.sku]);
      }

      totalPaise += locked.pricePaise * item.quantity;

      orderItemDtos.push({
        sku: item.sku,
        productName: locked.name,
        quantity: item.quantity,
        unitPricePaise: locked.pricePaise,
      });

      lines.push({
        sku: item.sku,
        quantity: item.quantity,
        unitPricePaise: locked.pricePaise,
        availableAfter: locked.availableStock - item.quantity,
        reservedAfter: locked.reservedStock + item.quantity,
      });
    }

    const orderDto: OrderDto = {
      id: orderId,
      idempotencyKey: trimmedKey,
      customerId: canonical.customerId,
      status: 'RESERVED',
      totalPaise,
      createdAt: now.toISOString(),
      cancelledAt: null,
      items: orderItemDtos,
    };

    await writeReservation(tx, {
      orderId,
      idempotencyKey: trimmedKey,
      customerId: canonical.customerId,
      totalPaise,
      createdAt: now,
      lines,
      response: orderDto,
    });

    return {
      order: orderDto,
      replayed: false,
    };
  });
}

export async function cancelOrder(
  db: OisDatabase,
  rawOrderId: string,
): Promise<CancelOrderResponse> {
  const orderId = rawOrderId.trim();
  if (!isValidUuid(orderId)) {
    throw orderNotFoundError(orderId);
  }

  return db.transaction(async (tx) => {
    const lockedRows = await tx.execute<OrderLockRow>(sql`
      WITH settings AS (${TRANSACTION_SETTINGS})
      SELECT o.id, o.idempotency_key, o.customer_id, o.status, o.total_paise, o.created_at, o.cancelled_at
      FROM reservation_order AS o CROSS JOIN settings
      WHERE o.id = ${orderId}::uuid
      FOR UPDATE OF o
    `);
    const lockedOrder = toOrderHeaderRow(lockedRows.rows[0]);

    if (!lockedOrder) {
      throw orderNotFoundError(orderId);
    }

    const items = await tx
      .select({
        sku: orderItem.sku,
        productName: product.name,
        quantity: orderItem.quantity,
        unitPricePaise: orderItem.unitPricePaise,
      })
      .from(orderItem)
      .innerJoin(product, eq(orderItem.sku, product.sku))
      .where(eq(orderItem.orderId, lockedOrder.id))
      .orderBy(asc(orderItem.sku));

    if (lockedOrder.status === 'CANCELLED') {
      return {
        order: assembleOrderDto(lockedOrder, items),
        alreadyCancelled: true,
      };
    }

    const skus = items.map((item) => item.sku);
    const lockedProducts = await tx
      .select({
        sku: product.sku,
        availableStock: product.availableStock,
        reservedStock: product.reservedStock,
      })
      .from(product)
      .where(skuIsAnyOf(skus))
      .orderBy(asc(product.sku))
      .for('update');

    const productBySku = new Map(lockedProducts.map((row) => [row.sku, row]));
    const now = new Date();

    const releaseLines: StockLine[] = items.map((item) => {
      const locked = productBySku.get(item.sku);
      if (!locked) {
        throw transientDbError(`Product row missing during cancellation for SKU: ${item.sku}`);
      }
      return {
        sku: item.sku,
        quantity: item.quantity,
        unitPricePaise: item.unitPricePaise,
        availableAfter: locked.availableStock + item.quantity,
        reservedAfter: locked.reservedStock - item.quantity,
      };
    });

    await writeRelease(tx, {
      orderId: lockedOrder.id,
      idempotencyKey: lockedOrder.idempotencyKey,
      cancelledAt: now,
      lines: releaseLines,
    });

    const updatedOrder = assembleOrderDto(
      {
        ...lockedOrder,
        status: 'CANCELLED',
        cancelledAt: now,
      },
      items,
    );

    return {
      order: updatedOrder,
      alreadyCancelled: false,
    };
  });
}

async function fetchOrderDetailForHeader(
  db: OisDatabase,
  header: OrderHeaderRow,
): Promise<OrderDetailDto> {
  const [itemsMap, idemRows, ledgerRows] = await Promise.all([
    fetchItemsByOrderIds(db, [header.id]),
    db
      .select({
        key: idempotencyKey.key,
        requestHash: idempotencyKey.requestHash,
        status: idempotencyKey.status,
        createdAt: idempotencyKey.createdAt,
        updatedAt: idempotencyKey.updatedAt,
      })
      .from(idempotencyKey)
      .where(eq(idempotencyKey.key, header.idempotencyKey))
      .limit(1),
    db
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
      .where(eq(inventoryLedger.orderId, header.id))
      .orderBy(asc(inventoryLedger.createdAt), asc(inventoryLedger.id))
      .limit(200),
  ]);

  const idemRow = idemRows[0];
  const idempotency: IdempotencyMetadataDto | null = idemRow
    ? {
        key: idemRow.key,
        requestHash: idemRow.requestHash,
        status: idemRow.status as IdempotencyStatus,
        createdAt: idemRow.createdAt.toISOString(),
        updatedAt: idemRow.updatedAt.toISOString(),
      }
    : null;

  return {
    order: assembleOrderDto(header, itemsMap.get(header.id) ?? []),
    idempotency,
    ledger: ledgerRows.map(toLedgerEntryDto),
  };
}

export async function getOrderDetailById(
  db: OisDatabase,
  rawOrderId: string,
): Promise<OrderDetailDto> {
  const orderId = rawOrderId.trim();
  if (!isValidUuid(orderId)) {
    throw orderNotFoundError(orderId);
  }

  const [header] = await db
    .select({
      id: reservationOrder.id,
      idempotencyKey: reservationOrder.idempotencyKey,
      customerId: reservationOrder.customerId,
      status: reservationOrder.status,
      totalPaise: reservationOrder.totalPaise,
      createdAt: reservationOrder.createdAt,
      cancelledAt: reservationOrder.cancelledAt,
    })
    .from(reservationOrder)
    .where(eq(reservationOrder.id, orderId))
    .limit(1);

  if (!header) {
    throw orderNotFoundError(orderId);
  }

  return fetchOrderDetailForHeader(db, header);
}

export async function getOrderDetailByIdempotencyKey(
  db: OisDatabase,
  rawKey: string,
): Promise<OrderDetailDto> {
  const key = rawKey.trim();
  const [header] = await db
    .select({
      id: reservationOrder.id,
      idempotencyKey: reservationOrder.idempotencyKey,
      customerId: reservationOrder.customerId,
      status: reservationOrder.status,
      totalPaise: reservationOrder.totalPaise,
      createdAt: reservationOrder.createdAt,
      cancelledAt: reservationOrder.cancelledAt,
    })
    .from(reservationOrder)
    .where(eq(reservationOrder.idempotencyKey, key))
    .limit(1);

  if (!header) {
    throw orderNotFoundError(key);
  }

  return fetchOrderDetailForHeader(db, header);
}

export async function listOrders(
  db: OisDatabase,
  query: ListOrdersQuery,
): Promise<ListOrdersResponse> {
  const limit = Math.min(
    Math.max(query.limit ?? DEFAULT_ORDERS_LIMIT, 1),
    MAX_ORDERS_LIMIT,
  );

  const conditions: SQL[] = [];

  if (query.status) {
    conditions.push(eq(reservationOrder.status, query.status));
  }

  if (query.customerId) {
    conditions.push(eq(reservationOrder.customerId, query.customerId.trim()));
  }

  if (query.sku) {
    const sku = query.sku.trim();
    conditions.push(
      sql`EXISTS (SELECT 1 FROM order_item oi WHERE oi.order_id = ${reservationOrder.id} AND oi.sku = ${sku})`,
    );
  }

  if (query.search) {
    const term = query.search.trim();
    if (term.length > 0) {
      const pattern = `%${escapeLikePattern(term)}%`;
      const searchClauses: SQL[] = [
        ilike(reservationOrder.idempotencyKey, pattern),
        ilike(reservationOrder.customerId, pattern),
      ];
      if (isValidUuid(term)) {
        searchClauses.push(eq(reservationOrder.id, term));
      }
      const combined = or(...searchClauses);
      if (combined) {
        conditions.push(combined);
      }
    }
  }

  if (query.cursor) {
    const decoded = decodeCursor(query.cursor);
    conditions.push(
      sql`(${reservationOrder.createdAt}, ${reservationOrder.id}) < (${new Date(decoded.createdAt)}, ${decoded.id}::uuid)`,
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const headers = await db
    .select({
      id: reservationOrder.id,
      idempotencyKey: reservationOrder.idempotencyKey,
      customerId: reservationOrder.customerId,
      status: reservationOrder.status,
      totalPaise: reservationOrder.totalPaise,
      createdAt: reservationOrder.createdAt,
      cancelledAt: reservationOrder.cancelledAt,
    })
    .from(reservationOrder)
    .where(whereClause)
    .orderBy(desc(reservationOrder.createdAt), desc(reservationOrder.id))
    .limit(limit + 1);

  const hasMore = headers.length > limit;
  const pageHeaders = hasMore ? headers.slice(0, limit) : headers;
  const orderIds = pageHeaders.map((row) => row.id);
  const itemsMap = await fetchItemsByOrderIds(db, orderIds);

  const orders = pageHeaders.map((header) =>
    assembleOrderDto(header, itemsMap.get(header.id) ?? []),
  );

  const lastRow = pageHeaders[pageHeaders.length - 1];
  const nextCursor =
    hasMore && lastRow
      ? encodeCursor({
          createdAt: lastRow.createdAt.toISOString(),
          id: lastRow.id,
        })
      : null;

  return {
    orders,
    nextCursor,
  };
}
