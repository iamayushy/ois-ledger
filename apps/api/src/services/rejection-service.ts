import { and, arrayContains, desc, eq, lt, type SQL } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { OisDatabase } from '@ois/db/client';
import { reservationRejection, type RejectionDetails } from '@ois/db/schema';
import { hashOrderPayload } from '@ois/shared/hash';
import {
  ERROR_CODE,
  type CreateOrderBody,
  type ListRejectionsQuery,
  type ListRejectionsResponse,
  type RejectionDto,
  type RejectionReason,
} from '@ois/shared/schemas';
import { isAppError, type AppError } from '../errors.js';

const DEFAULT_REJECTIONS_LIMIT = 20;
const MAX_REJECTIONS_LIMIT = 100;

const REASON_BY_CODE: ReadonlyMap<number, RejectionReason> = new Map<number, RejectionReason>([
  [ERROR_CODE.UNKNOWN_SKU, 'UNKNOWN_SKU'],
  [ERROR_CODE.INSUFFICIENT_STOCK, 'INSUFFICIENT_STOCK'],
  [ERROR_CODE.IDEMPOTENCY_CONFLICT, 'IDEMPOTENCY_CONFLICT'],
]);

function asRecordableRejection(error: unknown): AppError | null {
  return isAppError(error) && REASON_BY_CODE.has(error.code) ? error : null;
}

function toDetails(
  items: RejectionDetails['items'],
  error: AppError,
): RejectionDetails {
  return {
    items,
    shortages: error.details?.shortages ?? [],
    missingSkus: error.details?.missingSkus ?? [],
  };
}

export async function recordRejectionIfApplicable(
  db: OisDatabase,
  log: FastifyBaseLogger,
  rawIdempotencyKey: string,
  payload: CreateOrderBody,
  error: unknown,
): Promise<void> {
  const rejection = asRecordableRejection(error);
  const hashed = rejection ? hashOrderPayload(payload) : null;
  if (!rejection || !hashed?.ok) {
    return;
  }

  const items = hashed.canonical.items.map((item) => ({ sku: item.sku, quantity: item.quantity }));
  try {
    await db.insert(reservationRejection).values({
      idempotencyKey: rawIdempotencyKey.trim(),
      customerId: hashed.canonical.customerId,
      requestHash: hashed.requestHash,
      errorCode: rejection.code,
      skus: items.map((item) => item.sku),
      details: toDetails(items, rejection),
    });
  } catch (recordError) {
    log.error(
      { err: recordError, idempotencyKey: rawIdempotencyKey, errorCode: rejection.code },
      'Failed to record reservation rejection',
    );
  }
}

function toRejectionDto(row: {
  readonly id: bigint;
  readonly idempotencyKey: string;
  readonly customerId: string;
  readonly requestHash: string;
  readonly errorCode: number;
  readonly details: RejectionDetails;
  readonly createdAt: Date;
}): RejectionDto {
  return {
    id: row.id.toString(),
    idempotencyKey: row.idempotencyKey,
    customerId: row.customerId,
    requestHash: row.requestHash,
    errorCode: row.errorCode,
    reason: REASON_BY_CODE.get(row.errorCode) ?? 'INSUFFICIENT_STOCK',
    items: [...row.details.items],
    shortages: [...row.details.shortages],
    missingSkus: [...row.details.missingSkus],
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listRejections(
  db: OisDatabase,
  query: ListRejectionsQuery,
): Promise<ListRejectionsResponse> {
  const limit = Math.min(query.limit ?? DEFAULT_REJECTIONS_LIMIT, MAX_REJECTIONS_LIMIT);
  const filters: SQL[] = [];
  if (query.sku) {
    filters.push(arrayContains(reservationRejection.skus, [query.sku.trim()]));
  }
  if (query.idempotencyKey) {
    filters.push(eq(reservationRejection.idempotencyKey, query.idempotencyKey.trim()));
  }
  if (query.cursor) {
    filters.push(lt(reservationRejection.id, BigInt(query.cursor)));
  }

  const rows = await db
    .select({
      id: reservationRejection.id,
      idempotencyKey: reservationRejection.idempotencyKey,
      customerId: reservationRejection.customerId,
      requestHash: reservationRejection.requestHash,
      errorCode: reservationRejection.errorCode,
      details: reservationRejection.details,
      createdAt: reservationRejection.createdAt,
    })
    .from(reservationRejection)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(reservationRejection.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rejections: page.map(toRejectionDto),
    nextCursor: rows.length > limit && last ? last.id.toString() : null,
  };
}
