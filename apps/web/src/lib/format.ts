import type { ProductDto } from '@ois/shared/schemas';

const INR_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
});

const TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatPaise(paise: number): string {
  return INR_FORMATTER.format(paise / 100);
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return TIME_FORMATTER.format(date);
}

export function formatDurationBetween(startIso: string, endIso: string): string {
  const elapsedMs = Date.parse(endIso) - Date.parse(startIso);
  if (!Number.isFinite(elapsedMs)) {
    return '—';
  }
  if (elapsedMs < 1) {
    return '<1 ms';
  }
  return elapsedMs < 1000 ? `${Math.round(elapsedMs)} ms` : `${(elapsedMs / 1000).toFixed(2)} s`;
}

export function shortToken(value: string, head = 8, tail = 4): string {
  if (value.length <= head + tail + 2) {
    return value;
  }
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export type StockTier = 'DEPLETED' | 'LAST UNIT' | 'LOW' | 'IN STOCK';

export function getStockTier(product: ProductDto): StockTier {
  if (product.availableStock === 0) {
    return 'DEPLETED';
  }
  if (product.availableStock === 1) {
    return 'LAST UNIT';
  }
  if (product.availableStock <= 3) {
    return 'LOW';
  }
  return 'IN STOCK';
}
