import type { OrderDto } from '@ois/shared/schemas';
import { memo } from 'react';
import { OrderStatusIndicator } from '../../../components/shared/status-badge';
import { formatPaise, formatTimestamp, shortToken } from '../../../lib/format';

interface OrderRowProps {
  readonly order: OrderDto;
  readonly isSelected: boolean;
  readonly onSelect: (orderId: string) => void;
}

export const OrderRow = memo(function OrderRow({ order, isSelected, onSelect }: OrderRowProps) {
  const totalUnits = order.items.reduce((total, item) => total + item.quantity, 0);
  const firstProduct = order.items[0]?.productName ?? 'No products';
  const additionalProducts = order.items.length - 1;
  const productSummary = order.items.map((item) => `${item.productName} × ${item.quantity}`).join(', ');
  return (
    <button
      type="button"
      aria-current={isSelected ? 'true' : undefined}
      onClick={() => onSelect(order.id)}
      className={`orders-grid w-full cursor-pointer border-b border-border px-4 py-4 text-left transition-colors sm:px-5 ${
        isSelected ? 'bg-active-soft shadow-[inset_3px_0_0_0_var(--color-active)]' : 'hover:bg-bg-hover'
      }`}
    >
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[14px] font-semibold text-fg-strong" title={productSummary}>
          <span className="truncate">{firstProduct}</span>
          {additionalProducts > 0 ? <span className="shrink-0 text-[13px] font-normal text-fg-muted">+{additionalProducts} more</span> : null}
        </span>
        <span className="truncate font-mono text-[13px] text-fg-muted" title={order.id}>{shortToken(order.id, 8, 4)}</span>
      </span>
      <span className="orders-secondary truncate text-[13px] text-fg" title={order.customerId}>{order.customerId}</span>
      <OrderStatusIndicator status={order.status} />
      <span className="orders-secondary text-right text-[13px] tabular-nums text-fg-muted">{totalUnits}</span>
      <span className="orders-secondary text-[13px] tabular-nums text-fg-muted">{formatTimestamp(order.createdAt)}</span>
      <span className="text-right text-[13px] font-medium tabular-nums text-fg-strong">{formatPaise(order.totalPaise)}</span>
    </button>
  );
});
