import type { OrderDetailDto } from '@ois/shared/schemas';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { GhostButton } from '../../../components/shared/button';
import { CopyButton } from '../../../components/shared/copy-button';
import { formatDurationBetween, formatTimestamp, shortToken } from '../../../lib/format';

interface IdempotencyCardProps {
  readonly detail: OrderDetailDto;
  readonly onReplayTest: (detail: OrderDetailDto) => void;
}

export function IdempotencyCard({ detail, onReplayTest }: IdempotencyCardProps) {
  const { order, idempotency } = detail;

  return (
    <details className="inspector-section group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-medium text-fg-strong">
        Request & retry investigation <span className="text-active group-open:rotate-45">+</span>
      </summary>
      <p className="mb-3 mt-3 text-[13px] leading-relaxed text-fg-muted">Inspect the request identity or resend it to check retry behavior.</p>
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-[13px] font-semibold uppercase tracking-wider text-fg-muted">
          Request identity
        </h3>
        <GhostButton onClick={() => onReplayTest(detail)} className="h-6 px-2 text-[13px]">
          <ArrowCounterClockwiseIcon size={12} />
          <span>Investigate retry</span>
        </GhostButton>
      </div>

      <dl className="m-0 flex flex-col gap-2 text-[13px]">
        <div className="flex items-center justify-between gap-4">
          <dt className="shrink-0 text-fg-muted">Key</dt>
          <dd className="m-0 flex min-w-0 items-center gap-1">
            <span className="truncate font-mono text-[13px] text-fg-strong">
              {order.idempotencyKey}
            </span>
            <CopyButton value={order.idempotencyKey} />
          </dd>
        </div>

        {idempotency ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <dt className="shrink-0 text-fg-muted">Payload SHA-256</dt>
              <dd className="m-0 flex min-w-0 items-center gap-1">
                <span
                  className="truncate font-mono text-[13px] text-fg"
                  title={idempotency.requestHash}
                >
                  {shortToken(idempotency.requestHash, 14, 10)}
                </span>
                <CopyButton value={idempotency.requestHash} />
              </dd>
            </div>

            <div className="flex items-center justify-between gap-4">
              <dt className="shrink-0 text-fg-muted">Record state</dt>
              <dd className="m-0 font-mono text-[13px] text-fg">
                {idempotency.status === 'COMPLETED' ? 'Completed' : 'In progress'}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-4">
              <dt className="shrink-0 text-fg-muted">Key claimed</dt>
              <dd className="m-0 font-mono text-[13px] tabular-nums text-fg">
                {formatTimestamp(idempotency.createdAt)}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-4">
              <dt className="shrink-0 text-fg-muted">Response stored</dt>
              <dd className="m-0 font-mono text-[13px] tabular-nums text-fg">
                {formatTimestamp(idempotency.updatedAt)}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-4">
              <dt className="shrink-0 text-fg-muted" title="Time between claiming the key and storing the response, inside one transaction">
                First attempt took
              </dt>
              <dd className="m-0 font-mono text-[13px] tabular-nums text-fg">
                {formatDurationBetween(idempotency.createdAt, idempotency.updatedAt)}
              </dd>
            </div>
          </>
        ) : null}
      </dl>
    </details>
  );
}
