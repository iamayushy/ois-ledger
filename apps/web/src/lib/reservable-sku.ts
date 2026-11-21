import type { ProductDto } from '@ois/shared/schemas';

export function pickReservableSku(
  products: readonly ProductDto[],
  exclude: ReadonlySet<string>,
): string | null {
  const reservable = products.find(
    (product) => product.availableStock > 0 && !exclude.has(product.sku),
  );
  const fallback = products.find((product) => !exclude.has(product.sku));
  return reservable?.sku ?? fallback?.sku ?? null;
}
