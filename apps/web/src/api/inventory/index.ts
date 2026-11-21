import type { ProductDetailDto, ProductDto, ProductListResponse } from '@ois/shared/schemas';
import { useMemo } from 'react';
import useSWR from 'swr';
import { oisKeys } from '../queryKeys';

export interface InventoryKpis {
  readonly totalSkus: number;
  readonly availableUnits: number;
  readonly reservedUnits: number;
  readonly scarceSkus: number;
}

export function useInventory() {
  const swr = useSWR<ProductListResponse>(oisKeys.inventory.list(), {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
  });

  const products = swr.data?.products ?? [];

  const derived = useMemo(() => {
    const productBySku = new Map<string, ProductDto>();
    let availableUnits = 0;
    let reservedUnits = 0;
    let scarceSkus = 0;

    for (const product of products) {
      productBySku.set(product.sku, product);
      availableUnits += product.availableStock;
      reservedUnits += product.reservedStock;
      if (product.availableStock <= 1) {
        scarceSkus += 1;
      }
    }

    const kpis: InventoryKpis = {
      totalSkus: products.length,
      availableUnits,
      reservedUnits,
      scarceSkus,
    };

    return { productBySku, kpis };
  }, [products]);

  return {
    products,
    productBySku: derived.productBySku,
    kpis: derived.kpis,
    isLoading: swr.isLoading,
    isValidating: swr.isValidating,
    error: swr.error as Error | undefined,
    mutate: swr.mutate,
  };
}

export function useSkuDetail(sku: string | null, limit = 50) {
  return useSWR<ProductDetailDto>(sku ? oisKeys.inventory.detail(sku, limit) : null, {
    revalidateOnFocus: true,
  });
}
