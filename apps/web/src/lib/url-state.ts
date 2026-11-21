export type UrlTab = 'orders' | 'inventory';

export interface UrlState {
  readonly tab: UrlTab;
  readonly order: string | null;
  readonly sku: string | null;
}

const DEFAULT_URL_STATE: UrlState = { tab: 'orders', order: null, sku: null };

function nonEmpty(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

export function readUrlState(): UrlState {
  if (typeof window === 'undefined') {
    return DEFAULT_URL_STATE;
  }
  const params = new URLSearchParams(window.location.search);
  return {
    tab: params.get('tab') === 'inventory' ? 'inventory' : 'orders',
    order: nonEmpty(params.get('order')),
    sku: nonEmpty(params.get('sku')),
  };
}

export function writeUrlState(next: UrlState): void {
  if (typeof window === 'undefined') {
    return;
  }
  const params = new URLSearchParams();
  if (next.tab !== 'orders') {
    params.set('tab', next.tab);
  }
  if (next.order) {
    params.set('order', next.order);
  }
  if (next.sku) {
    params.set('sku', next.sku);
  }
  const query = params.toString();
  const target = `${window.location.pathname}${query ? `?${query}` : ''}`;
  if (target !== `${window.location.pathname}${window.location.search}`) {
    window.history.replaceState(null, '', target);
  }
}
