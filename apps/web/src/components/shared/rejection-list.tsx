import type { RejectionDto, RejectionReason } from '@ois/shared/schemas';
import { formatTimestamp } from '../../lib/format';

const REASON_META: Record<RejectionReason, { readonly label: string; readonly tone: string }> = {
  INSUFFICIENT_STOCK: { label: 'Not enough stock', tone: 'bg-warning-soft text-warning-ink' },
  UNKNOWN_SKU: { label: 'Unknown SKU', tone: 'bg-danger-soft text-danger' },
  IDEMPOTENCY_CONFLICT: { label: 'Key reused with different payload', tone: 'bg-danger-soft text-danger' },
};

function describeRejection(rejection: RejectionDto): string {
  if (rejection.reason === 'INSUFFICIENT_STOCK') {
    return rejection.shortages
      .map((shortage) => `${shortage.sku}: wanted ${shortage.requested}, ${shortage.available} left`)
      .join(' · ');
  }
  if (rejection.reason === 'UNKNOWN_SKU') {
    return `Missing: ${rejection.missingSkus.join(', ')}`;
  }
  return rejection.items.map((item) => `${item.sku} × ${item.quantity}`).join(', ');
}

interface RejectionListProps {
  readonly rejections: readonly RejectionDto[];
  readonly emptyText: string;
}

export function RejectionList({ rejections, emptyText }: RejectionListProps) {
  if (rejections.length === 0) {
    return <p className="m-0 py-3 text-[13px] text-fg-muted">{emptyText}</p>;
  }

  return (
    <ol className="m-0 flex list-none flex-col divide-y divide-border p-0">
      {rejections.map((rejection) => {
        const meta = REASON_META[rejection.reason];
        return (
          <li key={rejection.id} className="flex flex-col gap-1 py-2.5 text-[13px]">
            <div className="flex items-center justify-between gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${meta.tone}`}>{meta.label}</span>
              <time dateTime={rejection.createdAt} className="tabular-nums text-fg-muted">
                {formatTimestamp(rejection.createdAt)}
              </time>
            </div>
            <div className="text-fg-strong">{describeRejection(rejection)}</div>
            <div className="flex flex-wrap gap-x-3 font-mono text-[12px] text-fg-muted">
              <span>key {rejection.idempotencyKey}</span>
              <span>{rejection.customerId}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
