import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { GhostButton } from '../../../components/shared/button';
import { useReservationDraft } from '../context';

export function ReservationKeyField() {
  const { state, actions, meta } = useReservationDraft();

  return (
    <section className="flex flex-col gap-4">
      <div>
        <div className="section-label">Request details</div>
        <p className="mt-1 text-[13px] text-fg-muted">
          {meta.mode === 'replay'
            ? 'Keep the key and order details unchanged to receive the saved order.'
            : 'Use a stable key if you may need to safely retry this request.'}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="resv-idempotency-key" className="text-[13px] font-medium text-fg-strong">
            Idempotency-Key
          </label>
          <GhostButton onClick={actions.regenerateKey} className="h-6 px-2 text-[13px]">
            <ArrowClockwiseIcon size={12} />
            <span>Regenerate</span>
          </GhostButton>
        </div>
        <input
          id="resv-idempotency-key"
          type="text"
          value={state.idempotencyKey}
          onChange={(event) => actions.setIdempotencyKey(event.target.value)}
          placeholder="e.g. order-2026-001"
          className="h-10 w-full rounded-md border border-border-strong bg-bg px-3 font-mono text-[13px] text-fg-strong focus:border-ring focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="resv-customer-id" className="text-[13px] font-medium text-fg-strong">
          Customer ID
        </label>
        <input
          id="resv-customer-id"
          type="text"
          value={state.customerId}
          onChange={(event) => actions.setCustomerId(event.target.value)}
          placeholder="cust-ops-console"
          className="h-10 w-full rounded-md border border-border-strong bg-bg px-3 font-mono text-[13px] text-fg-strong focus:border-ring focus:outline-none"
        />
      </div>
    </section>
  );
}
