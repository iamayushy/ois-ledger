import type { ListRejectionsResponse } from '@ois/shared/schemas';
import useSWR from 'swr';
import { oisKeys, type RejectionsQueryParams } from '../queryKeys';

function hasFilter(params: RejectionsQueryParams): boolean {
  return Boolean(params.sku) || Boolean(params.idempotencyKey);
}

export function useRejections(params: RejectionsQueryParams) {
  return useSWR<ListRejectionsResponse>(hasFilter(params) ? oisKeys.rejections.list(params) : null, {
    revalidateOnFocus: true,
  });
}
