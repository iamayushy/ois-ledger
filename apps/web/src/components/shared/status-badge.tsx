import type { LedgerEventType, OrderStatus } from '@ois/shared/schemas';
import type { StockTier } from '../../lib/format';

const ORDER_STATUS_META: Record<OrderStatus, { readonly dot: string; readonly label: string; readonly tone: string }> = {
  RESERVED: { dot: 'bg-success', label: 'Reserved', tone: 'bg-success-soft text-success-ink' },
  CANCELLED: { dot: 'bg-fg-muted', label: 'Cancelled', tone: 'bg-bg-inset text-fg-muted' },
};

const STOCK_TIER_META: Record<
  StockTier,
  { readonly dot: string; readonly label: string; readonly text: string }
> = {
  'IN STOCK': { dot: 'bg-success', label: 'In stock', text: 'text-fg' },
  LOW: { dot: 'bg-warning', label: 'Low stock', text: 'text-fg' },
  'LAST UNIT': { dot: 'bg-warning', label: 'Last unit', text: 'text-warning-ink' },
  DEPLETED: { dot: 'bg-danger', label: 'Unavailable', text: 'text-danger' },
};

const LEDGER_EVENT_LABEL: Record<LedgerEventType, { readonly dot: string; readonly label: string }> =
  {
    SEED: { dot: 'bg-fg-muted/50', label: 'Seed' },
    RESERVE: { dot: 'bg-fg-strong', label: 'Reserve' },
    RELEASE: { dot: 'bg-success', label: 'Release' },
  };

export function OrderStatusIndicator({ status }: { readonly status: OrderStatus }) {
  const meta = ORDER_STATUS_META[status];
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-1 text-[13px] font-medium ${meta.tone}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
      <span>{meta.label}</span>
    </span>
  );
}

export function StockTierIndicator({ tier }: { readonly tier: StockTier }) {
  const meta = STOCK_TIER_META[tier];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap ${meta.text}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
      <span>{meta.label}</span>
    </span>
  );
}

export function LedgerEventIndicator({ eventType }: { readonly eventType: LedgerEventType }) {
  const meta = LEDGER_EVENT_LABEL[eventType];
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-fg-strong">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
      <span>{meta.label}</span>
    </span>
  );
}
