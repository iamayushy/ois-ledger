import type { HealthResponse } from '@ois/shared/schemas';
import useSWR from 'swr';
import { oisKeys } from '../queryKeys';

export function useHealth() {
  return useSWR<HealthResponse>(oisKeys.health.status(), {
    refreshInterval: 10_000,
    revalidateOnFocus: true,
  });
}
