import type { OrderStatus } from '@ois/shared/schemas';
import { buildQueryString } from '../lib/query-string';

export interface OrdersListQueryParams {
  readonly status?: OrderStatus | undefined;
  readonly search?: string | undefined;
  readonly sku?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export const oisKeys = {
  health: {
    status: () => '/api/health' as const,
  },
  inventory: {
    list: () => '/api/inventory' as const,
    detail: (sku: string, limit = 50) => {
      const qs = buildQueryString({ limit });
      return `/api/inventory/${encodeURIComponent(sku)}${qs ? `?${qs}` : ''}`;
    },
  },
  orders: {
    list: (params: OrdersListQueryParams = {}) => {
      const qs = buildQueryString({
        limit: params.limit ?? 20,
        status: params.status,
        search: params.search,
        sku: params.sku,
        cursor: params.cursor,
      });
      return `/api/orders${qs ? `?${qs}` : ''}`;
    },
    detail: (orderId: string) => `/api/orders/${encodeURIComponent(orderId)}`,
    byKey: (idempotencyKey: string) =>
      `/api/orders/by-key/${encodeURIComponent(idempotencyKey)}`,
  },
} as const;
