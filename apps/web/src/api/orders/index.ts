import type {
  CancelOrderResponse,
  CreateOrderBody,
  CreateOrderResponse,
  ListOrdersResponse,
  OrderDetailDto,
  OrderDto,
  OrderStatus,
} from '@ois/shared/schemas';
import { ERROR_CODE } from '@ois/shared/schemas';
import { isValidUuid } from '@ois/shared/uuidv7';
import { useCallback, useMemo } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { getResult, postResult, type ApiError } from '../client';
import { oisKeys } from '../queryKeys';

export type StatusFilter = 'ALL' | OrderStatus;

export interface OrderListFilters {
  readonly status: StatusFilter;
  readonly search: string;
  readonly sku: string | null;
}

export interface ApiFailure {
  readonly ok: false;
  readonly httpStatus: number;
  readonly retryAfterSeconds: number | null;
  readonly error: ApiError;
}

export type CreateOrderApiResult =
  | {
      readonly ok: true;
      readonly httpStatus: number;
      readonly replayed: boolean;
      readonly data: CreateOrderResponse;
    }
  | ApiFailure;

export type CancelOrderApiResult =
  | {
      readonly ok: true;
      readonly httpStatus: number;
      readonly data: CancelOrderResponse;
    }
  | ApiFailure;

export type LookupOrderResult =
  | {
      readonly ok: true;
      readonly detail: OrderDetailDto;
      readonly mode: 'id' | 'key';
    }
  | ApiFailure;

export async function createOrder(
  idempotencyKey: string,
  payload: CreateOrderBody,
): Promise<CreateOrderApiResult> {
  const result = await postResult<CreateOrderResponse>('/api/v1/orders', payload, {
    headers: { 'idempotency-key': idempotencyKey },
  });
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    httpStatus: result.httpStatus,
    replayed: result.headers.get('idempotency-replayed') === 'true',
    data: result.data,
  };
}

export async function cancelOrder(orderId: string): Promise<CancelOrderApiResult> {
  const result = await postResult<CancelOrderResponse>(
    `/api/v1/orders/${encodeURIComponent(orderId)}/cancel`,
  );
  if (!result.ok) {
    return result;
  }
  return { ok: true, httpStatus: result.httpStatus, data: result.data };
}

export async function lookupOrderByIdentifier(rawQuery: string): Promise<LookupOrderResult> {
  const trimmed = rawQuery.trim();
  const mode: 'id' | 'key' = isValidUuid(trimmed) ? 'id' : 'key';
  const path = mode === 'id' ? oisKeys.orders.detail(trimmed) : oisKeys.orders.byKey(trimmed);

  const result = await getResult<OrderDetailDto>(path, ERROR_CODE.ORDER_NOT_FOUND);
  if (!result.ok) {
    return result;
  }
  return { ok: true, detail: result.data, mode };
}

export function useOrdersStream(filters: OrderListFilters, pageSize = 20) {
  const trimmedSearch = filters.search.trim();
  const statusParam = filters.status === 'ALL' ? undefined : filters.status;

  const swr = useSWRInfinite<ListOrdersResponse>(
    (pageIndex, previousPage) => {
      if (pageIndex > 0 && !previousPage?.nextCursor) {
        return null;
      }
      return oisKeys.orders.list({
        limit: pageSize,
        status: statusParam,
        search: trimmedSearch || undefined,
        sku: filters.sku ?? undefined,
        cursor: pageIndex > 0 ? (previousPage?.nextCursor ?? undefined) : undefined,
      });
    },
    {
      refreshInterval: 15_000,
      revalidateFirstPage: true,
      revalidateOnFocus: true,
      keepPreviousData: true,
    },
  );

  const orders = useMemo<readonly OrderDto[]>(() => {
    if (!swr.data) {
      return [];
    }
    const seen = new Set<string>();
    const combined: OrderDto[] = [];
    for (const page of swr.data) {
      for (const order of page.orders) {
        if (!seen.has(order.id)) {
          seen.add(order.id);
          combined.push(order);
        }
      }
    }
    return combined;
  }, [swr.data]);

  const lastPage = swr.data && swr.data.length > 0 ? swr.data[swr.data.length - 1] : undefined;
  const hasMore = Boolean(lastPage?.nextCursor);
  const isLoadingMore =
    swr.size > 1 && swr.data !== undefined && typeof swr.data[swr.size - 1] === 'undefined';

  const setSize = swr.setSize;
  const loadMore = useCallback(() => setSize((current) => current + 1), [setSize]);

  return {
    orders,
    hasMore,
    isLoading: swr.isLoading,
    isValidating: swr.isValidating,
    isLoadingMore,
    error: swr.error as Error | undefined,
    loadMore,
    mutate: swr.mutate,
  };
}

export function useOrderDetail(orderId: string | null) {
  return useSWR<OrderDetailDto>(orderId ? oisKeys.orders.detail(orderId) : null, {
    revalidateOnFocus: true,
  });
}
