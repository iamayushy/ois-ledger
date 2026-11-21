import {
  ERROR_CODE,
  type ErrorCode,
  type ErrorResponse,
  type StockShortageDto,
} from '@ois/shared/schemas';

export type ErrorDetails = NonNullable<ErrorResponse['error']['details']>;

const APP_ERROR_TAG = Symbol('ois.appError');

export interface AppError extends Error {
  readonly [APP_ERROR_TAG]: true;
  readonly httpStatus: number;
  readonly code: ErrorCode;
  readonly details?: ErrorDetails;
}

export function createAppError(
  httpStatus: number,
  code: ErrorCode,
  message: string,
  details?: ErrorDetails,
): AppError {
  const base = new Error(message);
  return Object.assign(base, {
    [APP_ERROR_TAG]: true as const,
    name: 'AppError',
    httpStatus,
    code,
    ...(details !== undefined ? { details } : {}),
  });
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    APP_ERROR_TAG in value &&
    (value as Record<symbol, unknown>)[APP_ERROR_TAG] === true
  );
}

export function toErrorResponse(error: AppError): ErrorResponse {
  if (error.details !== undefined) {
    return {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }

  return {
    error: {
      code: error.code,
      message: error.message,
    },
  };
}

export function missingIdempotencyKeyError(): AppError {
  return createAppError(
    400,
    ERROR_CODE.MISSING_IDEMPOTENCY_KEY,
    'Idempotency-Key header must be a non-empty string',
  );
}

export function invalidOrderPayloadError(message: string): AppError {
  return createAppError(400, ERROR_CODE.INVALID_ORDER_PAYLOAD, message);
}

export function duplicateSkuError(duplicateSkus: readonly string[]): AppError {
  return createAppError(
    400,
    ERROR_CODE.DUPLICATE_SKU,
    `Order payload contains duplicate SKUs: ${duplicateSkus.join(', ')}`,
    { duplicateSkus: [...duplicateSkus] },
  );
}

export function invalidCursorError(): AppError {
  return createAppError(400, ERROR_CODE.INVALID_CURSOR, 'Cursor parameter is malformed');
}

export function unknownSkuError(missingSkus: readonly string[]): AppError {
  return createAppError(
    404,
    ERROR_CODE.UNKNOWN_SKU,
    `One or more SKUs do not exist: ${missingSkus.join(', ')}`,
    { missingSkus: [...missingSkus] },
  );
}

export function productNotFoundError(sku: string): AppError {
  return createAppError(
    404,
    ERROR_CODE.PRODUCT_NOT_FOUND,
    `Product not found for SKU: ${sku}`,
  );
}

export function orderNotFoundError(identifier: string): AppError {
  return createAppError(
    404,
    ERROR_CODE.ORDER_NOT_FOUND,
    `Order not found: ${identifier}`,
  );
}

export function idempotencyConflictError(key: string): AppError {
  return createAppError(
    409,
    ERROR_CODE.IDEMPOTENCY_CONFLICT,
    `Idempotency key "${key}" was already used with a different request payload`,
    { idempotencyKey: key },
  );
}

export function insufficientStockError(shortages: readonly StockShortageDto[]): AppError {
  const summary = shortages
    .map((s) => `${s.sku} (requested ${s.requested}, available ${s.available})`)
    .join(', ');
  return createAppError(
    409,
    ERROR_CODE.INSUFFICIENT_STOCK,
    `Insufficient stock for: ${summary}`,
    { shortages: [...shortages] },
  );
}

export function transientDbError(message: string): AppError {
  return createAppError(503, ERROR_CODE.SERVICE_UNAVAILABLE, message);
}
