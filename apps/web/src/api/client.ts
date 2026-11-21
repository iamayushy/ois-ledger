import { ERROR_CODE, type ErrorResponse } from '@ois/shared/schemas';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const NETWORK_FAILURE_STATUS = 0;

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export type ApiError = ErrorResponse['error'];

export interface ApiFetchError extends Error {
  readonly httpStatus: number;
  readonly errorCode: number;
  readonly details: ApiError['details'];
}

export interface RequestOptions {
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal | null;
}

export type ApiResponseResult<T> =
  | {
      readonly ok: true;
      readonly httpStatus: number;
      readonly headers: Headers;
      readonly data: T;
    }
  | {
      readonly ok: false;
      readonly httpStatus: number;
      readonly retryAfterSeconds: number | null;
      readonly error: ApiError;
    };

function isErrorResponse(value: unknown): value is ErrorResponse {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false;
  }
  const inner = value.error;
  return (
    typeof inner === 'object' &&
    inner !== null &&
    'code' in inner &&
    typeof inner.code === 'number' &&
    'message' in inner &&
    typeof inner.message === 'string'
  );
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseRetryAfter(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (raw === null) {
    return null;
  }
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function networkFailure<T>(error: unknown): ApiResponseResult<T> {
  const reason = error instanceof Error ? error.message : 'Network request failed';
  return {
    ok: false,
    httpStatus: NETWORK_FAILURE_STATUS,
    retryAfterSeconds: null,
    error: {
      code: ERROR_CODE.SERVICE_UNAVAILABLE,
      message: `API unreachable: ${reason}. The request may or may not have reached the server.`,
    },
  };
}

interface SendInit {
  readonly method: 'GET' | 'POST';
  readonly payload?: unknown;
  readonly fallbackCode: number;
  readonly options: RequestOptions | undefined;
}

async function send<T>(path: string, init: SendInit): Promise<ApiResponseResult<T>> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...init.options?.headers,
  };
  if (init.payload !== undefined) {
    headers['content-type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method: init.method,
      headers,
      body: init.payload !== undefined ? JSON.stringify(init.payload) : null,
      signal: init.options?.signal ?? null,
    });
  } catch (error) {
    return networkFailure<T>(error);
  }

  const body = await parseJsonSafe(response);
  if (response.ok) {
    return { ok: true, httpStatus: response.status, headers: response.headers, data: body as T };
  }

  return {
    ok: false,
    httpStatus: response.status,
    retryAfterSeconds: parseRetryAfter(response.headers),
    error: isErrorResponse(body)
      ? body.error
      : { code: init.fallbackCode, message: `Unexpected HTTP ${response.status}` },
  };
}

export function getResult<T>(
  path: string,
  fallbackCode: number = ERROR_CODE.INTERNAL_ERROR,
  options?: RequestOptions,
): Promise<ApiResponseResult<T>> {
  return send<T>(path, { method: 'GET', fallbackCode, options });
}

export function postResult<TResponse>(
  path: string,
  payload?: unknown,
  options?: RequestOptions,
): Promise<ApiResponseResult<TResponse>> {
  return send<TResponse>(path, {
    method: 'POST',
    payload,
    fallbackCode: ERROR_CODE.INTERNAL_ERROR,
    options,
  });
}

export async function swrFetcher<T>(path: string): Promise<T> {
  const result = await getResult<T>(path);
  if (result.ok) {
    return result.data;
  }
  const err = new Error(result.error.message);
  const fetchError: ApiFetchError = Object.assign(err, {
    name: 'ApiFetchError',
    httpStatus: result.httpStatus,
    errorCode: result.error.code,
    details: result.error.details,
  });
  throw fetchError;
}

export function isRetryableErrorCode(code: number): boolean {
  return code === ERROR_CODE.SERVICE_UNAVAILABLE || code === ERROR_CODE.SERVER_UNDER_PRESSURE;
}
