import type { LedgerEntryDto } from '@ois/shared/schemas';
import type { ReactNode } from 'react';
import { formatTimestamp } from '../../lib/format';

interface LedgerTimelineProps {
  readonly entries: readonly LedgerEntryDto[];
  readonly children: (entry: LedgerEntryDto) => ReactNode;
}

const EVENT_LABELS = { SEED: 'Stock added', RESERVE: 'Reserved', RELEASE: 'Released' } as const;

export function LedgerTimeline({ entries, children }: LedgerTimelineProps) {
  if (entries.length === 0) {
    return <p className="m-0 py-4 text-[13px] text-fg-muted">No stock movements yet.</p>;
  }

  return (
    <ol className="m-0 list-none pl-1">
      {entries.map((entry) => (
        <li key={entry.id} className="relative border-l border-border pb-6 pl-5 last:pb-1">
          <span className={`absolute -left-[4px] top-1.5 h-2 w-2 rounded-full ring-4 ring-bg ${entry.eventType === 'RELEASE' ? 'bg-success' : entry.eventType === 'SEED' ? 'bg-fg-muted' : 'bg-active'}`} />
          <p className="m-0 text-[14px] font-semibold text-fg-strong">
            {EVENT_LABELS[entry.eventType]} {Math.abs(entry.delta)} {Math.abs(entry.delta) === 1 ? 'unit' : 'units'}
          </p>
          <div className="mt-1 text-[13px] text-fg-muted">{children(entry)}</div>
          <time dateTime={entry.createdAt} className="mt-1 block text-[13px] tabular-nums text-fg-muted">{formatTimestamp(entry.createdAt)}</time>
          <details className="mt-2 text-[13px] text-fg-muted">
            <summary className="w-fit cursor-pointer text-active">Stock changes</summary>
            <dl className="mb-0 mt-2 grid grid-cols-2 gap-2 rounded-md bg-bg-subtle p-3 tabular-nums">
              <div><dt>Available</dt><dd className="m-0 mt-1 font-medium text-fg-strong">{entry.eventType === 'SEED' ? entry.availableAfter : `${entry.availableAfter - entry.delta} → ${entry.availableAfter}`}</dd></div>
              <div><dt>Reserved</dt><dd className="m-0 mt-1 font-medium text-fg-strong">{entry.eventType === 'SEED' ? entry.reservedAfter : `${entry.reservedAfter + entry.delta} → ${entry.reservedAfter}`}</dd></div>
            </dl>
          </details>
        </li>
      ))}
    </ol>
  );
}
