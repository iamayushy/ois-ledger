import { ERROR_CODE, type CreateOrderResponse, type OrderStatus } from '@ois/shared/schemas';
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight';
import type { ReactNode } from 'react';
import { isRetryableErrorCode } from '../../../api/client';
import { useOrderDetail, type ApiFailure } from '../../../api/orders';
import { GhostButton } from '../../../components/shared/button';
import { shortToken } from '../../../lib/format';
import { useReservationDraft } from '../context';

type BannerTone = 'success' | 'warning' | 'danger';

const TONE_CLASSES: Record<BannerTone, { readonly frame: string; readonly label: string }> = {
  success: { frame: 'border-success/30 bg-success-soft', label: 'text-success-ink' },
  warning: { frame: 'border-warning/30 bg-warning-soft', label: 'text-warning-ink' },
  danger: { frame: 'border-danger/30 bg-danger-soft', label: 'text-danger' },
};

interface BannerFrameProps {
  readonly tone: BannerTone;
  readonly label: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}

function BannerFrame({ tone, label, action, children }: BannerFrameProps) {
  const classes = TONE_CLASSES[tone];
  return (
    <section role="status" className={`rounded-lg border p-4 ${classes.frame}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`section-label ${classes.label}`}>{label}</div>
        {action ?? null}
      </div>
      {children}
    </section>
  );
}

function TechnicalDetails({ children }: { readonly children: ReactNode }) {
  return (
    <details className="mt-3 text-[13px] text-fg-muted">
      <summary className="cursor-pointer">Technical details</summary>
      <div className="mt-2 font-mono">{children}</div>
    </details>
  );
}

function ViewOrderButton({ orderId }: { readonly orderId: string }) {
  const { actions } = useReservationDraft();
  return (
    <GhostButton onClick={() => actions.inspectOrder(orderId)}>
      <span>View order</span>
      <ArrowRightIcon size={12} />
    </GhostButton>
  );
}

function CreatedOutcome({ httpStatus, data }: { readonly httpStatus: number; readonly data: CreateOrderResponse }) {
  return (
    <BannerFrame tone="success" label="Reservation created" action={<ViewOrderButton orderId={data.order.id} />}>
      <p className="mt-1 text-[13px] text-fg-strong">All requested items were reserved in this order.</p>
      <div className="mt-3 rounded-md bg-bg/60 px-3 py-2 text-[13px] text-fg-muted">
        Order <span className="font-mono text-fg-strong">{shortToken(data.order.id, 10, 6)}</span>
      </div>
      <TechnicalDetails>HTTP {httpStatus} · Idempotency-Replayed: false</TechnicalDetails>
    </BannerFrame>
  );
}

function StatusComparison({ original, current }: { readonly original: OrderStatus; readonly current: OrderStatus | undefined }) {
  const changed = current !== undefined && current !== original;
  return (
    <dl className="mt-3 grid grid-cols-2 gap-2 rounded-md bg-bg/60 px-3 py-2 text-[13px]">
      <div>
        <dt className="text-fg-muted">Original response</dt>
        <dd className="m-0 font-mono text-fg-strong">{original}</dd>
      </div>
      <div>
        <dt className="text-fg-muted">Current state</dt>
        <dd className={`m-0 font-mono ${changed ? 'text-warning-ink' : 'text-fg-strong'}`}>
          {current ?? '…'}
        </dd>
      </div>
    </dl>
  );
}

function ReplayedOutcome({ httpStatus, data }: { readonly httpStatus: number; readonly data: CreateOrderResponse }) {
  const currentSwr = useOrderDetail(data.order.id);
  return (
    <BannerFrame tone="success" label="Original order returned" action={<ViewOrderButton orderId={data.order.id} />}>
      <p className="mt-1 text-[13px] text-fg-strong">
        This key already completed with the same payload. The server returned the stored original
        response and reserved nothing new.
      </p>
      <StatusComparison original={data.order.status} current={currentSwr.data?.order.status} />
      <TechnicalDetails>HTTP {httpStatus} · Idempotency-Replayed: true</TechnicalDetails>
    </BannerFrame>
  );
}

function RetryableOutcome({ failure }: { readonly failure: ApiFailure }) {
  const { state, actions } = useReservationDraft();
  const unreachable = failure.httpStatus === 0;
  return (
    <BannerFrame
      tone="warning"
      label="Outcome unknown"
      action={
        <GhostButton onClick={() => void actions.submit()} disabled={state.submitting}>
          <ArrowClockwiseIcon size={12} />
          <span>{state.submitting ? 'Retrying…' : 'Retry with same key'}</span>
        </GhostButton>
      }
    >
      <p className="mt-1 text-[13px] text-fg-strong">
        {unreachable
          ? 'The API could not be reached. The order may or may not have been created.'
          : 'The server was busy and could not confirm the result.'}{' '}
        Retrying with the same key is safe: it returns the original order if one was created, and never
        reserves twice.
      </p>
      {failure.retryAfterSeconds !== null ? (
        <p className="mt-2 text-[13px] text-fg-muted">Server suggests waiting {failure.retryAfterSeconds}s before retrying.</p>
      ) : null}
      <TechnicalDetails>
        {unreachable ? 'Network error' : `HTTP ${failure.httpStatus}`} · Error [{failure.error.code}] ·{' '}
        {failure.error.message} · attempt {state.attempt}
      </TechnicalDetails>
    </BannerFrame>
  );
}

const REJECTION_COPY: Partial<Record<number, { readonly label: string; readonly body: string }>> = {
  [ERROR_CODE.IDEMPOTENCY_CONFLICT]: {
    label: 'Key conflict',
    body: 'This key was already used with different order details. Nothing changed. Use the original details to retrieve that order, or start with a new key.',
  },
  [ERROR_CODE.INSUFFICIENT_STOCK]: {
    label: 'Not enough stock',
    body: 'Some items do not have enough available stock. No items were reserved and no order was created.',
  },
};

function RejectedOutcome({ failure }: { readonly failure: ApiFailure }) {
  const copy = REJECTION_COPY[failure.error.code];
  const shortages = failure.error.details?.shortages ?? [];
  return (
    <BannerFrame tone="danger" label={copy?.label ?? 'Reservation not created'}>
      <p className="mt-1 text-[13px] font-medium text-fg-strong">{copy?.body ?? failure.error.message}</p>
      {shortages.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2 rounded-md bg-bg/60 p-3 text-[13px]">
          {shortages.map((shortage) => (
            <div key={shortage.sku} className="flex items-center justify-between gap-2">
              <span className="font-mono font-medium">{shortage.sku}</span>
              <span className="text-fg-muted">
                Need {shortage.requested} · {shortage.available} available
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <TechnicalDetails>
        HTTP {failure.httpStatus} · Error [{failure.error.code}] · {failure.error.message}
      </TechnicalDetails>
    </BannerFrame>
  );
}

export function ReservationOutcomeBanner() {
  const { outcome } = useReservationDraft().state;

  if (!outcome) {
    return null;
  }
  if (outcome.ok) {
    return outcome.replayed ? (
      <ReplayedOutcome httpStatus={outcome.httpStatus} data={outcome.data} />
    ) : (
      <CreatedOutcome httpStatus={outcome.httpStatus} data={outcome.data} />
    );
  }
  return isRetryableErrorCode(outcome.error.code) ? (
    <RetryableOutcome failure={outcome} />
  ) : (
    <RejectedOutcome failure={outcome} />
  );
}
