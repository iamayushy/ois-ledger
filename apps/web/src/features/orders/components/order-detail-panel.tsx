import { useState, useTransition } from 'react';
import { isRetryableErrorCode } from '../../../api/client';
import { cancelOrder, useOrderDetail, type CancelOrderApiResult } from '../../../api/orders';
import { DangerButton, SecondaryButton } from '../../../components/shared/button';
import { CopyButton } from '../../../components/shared/copy-button';
import { LedgerTimeline } from '../../../components/shared/ledger-timeline';
import { OrderStatusIndicator } from '../../../components/shared/status-badge';
import { useWorkbenchActions, useWorkbenchNavigation } from '../../../context/workbench-context';
import { formatPaise, formatTimestamp } from '../../../lib/format';
import { IdempotencyCard } from './idempotency-card';

interface CancelNotice {
  readonly orderId: string;
  readonly tone: 'success' | 'info' | 'error';
  readonly message: string;
}

function toCancelNotice(orderId: string, result: CancelOrderApiResult): CancelNotice {
  if (result.ok) {
    return {
      orderId,
      tone: result.data.alreadyCancelled ? 'info' : 'success',
      message: result.data.alreadyCancelled
        ? 'Already cancelled. No additional stock was released.'
        : 'Order cancelled. All reserved quantities were released.',
    };
  }
  const prefix = result.httpStatus === 0 ? 'Network error' : `HTTP ${result.httpStatus}`;
  const hint = isRetryableErrorCode(result.error.code)
    ? ' Cancellation is idempotent, so it is safe to try again.'
    : '';
  return {
    orderId,
    tone: 'error',
    message: `${prefix} · [${result.error.code}] ${result.error.message}${hint}`,
  };
}

export function OrderDetailPanel() {
  const state = useWorkbenchNavigation();
  const actions = useWorkbenchActions();
  const detailSwr = useOrderDetail(state.selectedOrderId);
  const [cancelling, startCancel] = useTransition();
  const [cancelNotice, setCancelNotice] = useState<CancelNotice | null>(null);

  const detail = detailSwr.data;
  const activeNotice =
    cancelNotice && cancelNotice.orderId === state.selectedOrderId ? cancelNotice : null;

  function handleCancelOrder(orderId: string) {
    setCancelNotice(null);
    startCancel(async () => {
      const result = await cancelOrder(orderId);
      if (result.ok) {
        await actions.revalidateAfterMutation(orderId);
      }
      startCancel(() => setCancelNotice(toCancelNotice(orderId, result)));
    });
  }

  return (
    <section aria-label="Order details" className="min-h-0 flex-1 overflow-y-auto bg-bg px-5 py-5">
      <button type="button" onClick={actions.closeOrderInspector} className="mb-5 cursor-pointer text-[13px] text-active lg:hidden">← Back to orders</button>
      <p className="workspace-eyebrow">Order inspector</p>
      {!state.selectedOrderId ? (
        <div className="py-16 text-center text-[13px] text-fg-muted">
          Select an order to inspect its items, idempotency proof, and ledger history.
        </div>
      ) : detailSwr.isLoading && !detail ? (
        <div className="py-16 text-center text-[13px] text-fg-muted">Loading order details…</div>
      ) : detailSwr.error ? (
        <div className="text-[13px] text-danger">
          Failed to load order: {detailSwr.error.message}
        </div>
      ) : detail ? (
        <div className="flex flex-col">
          <div className="flex flex-col items-start gap-4 pb-4">
            <div className="min-w-0">
              <div className="mb-3"><OrderStatusIndicator status={detail.order.status} /></div>
              <h2 className="m-0 text-[20px] font-semibold tracking-tight text-fg-strong">{detail.order.status === 'RESERVED' ? 'Reservation active' : 'Reservation cancelled'}</h2>
              <div className="mt-1 flex items-center gap-1">
                <span className="min-w-0 break-all font-mono text-[13px] text-fg-muted">
                  {detail.order.id}
                </span>
                <CopyButton value={detail.order.id} />
              </div>
            </div>

            <div className="flex items-center gap-2">
              {detail.order.status === 'RESERVED' ? (
                <DangerButton
                  disabled={cancelling}
                  onClick={() => handleCancelOrder(detail.order.id)}
                >
                  {cancelling ? 'Cancelling…' : 'Cancel Order'}
                </DangerButton>
              ) : (
                <SecondaryButton
                  disabled={cancelling}
                  onClick={() => handleCancelOrder(detail.order.id)}
                >
                  {cancelling ? 'Testing…' : 'Test Duplicate Cancel'}
                </SecondaryButton>
              )}
            </div>
          </div>

          <div className="mb-5 grid grid-cols-2 gap-4 rounded-lg border border-border bg-bg-subtle p-4">
            <div><p className="mb-1 mt-0 text-[13px] text-fg-muted">Order total</p><p className="m-0 text-[24px] font-semibold tracking-tight tabular-nums text-fg-strong">{formatPaise(detail.order.totalPaise)}</p></div>
            <div><p className="mb-1 mt-0 text-[13px] text-fg-muted">{detail.order.status === 'RESERVED' ? 'Reserved units' : 'Released units'}</p><p className="m-0 text-[24px] font-semibold tracking-tight tabular-nums text-fg-strong">{detail.order.items.reduce((total, item) => total + item.quantity, 0)}</p></div>
          </div>
          {activeNotice ? (
            <div
              role="status"
              className={`mb-4 rounded-md border px-2 py-2 text-[13px] ${
                activeNotice.tone === 'error'
                  ? 'border-danger/30 bg-danger-soft text-danger'
                  : 'border-border-strong bg-bg-subtle text-fg-strong'
              }`}
            >
              {activeNotice.message}
            </div>
          ) : null}

          <dl className="m-0 flex flex-col gap-2 border-t border-border py-4 text-[13px]">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-fg-muted">Customer</dt>
              <dd className="m-0 font-mono font-medium text-fg-strong">
                {detail.order.customerId}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-fg-muted">Created</dt>
              <dd className="m-0 font-mono tabular-nums text-fg">
                {formatTimestamp(detail.order.createdAt)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-fg-muted">Cancelled</dt>
              <dd className="m-0 font-mono tabular-nums text-fg">
                {detail.order.cancelledAt ? formatTimestamp(detail.order.cancelledAt) : '—'}
              </dd>
            </div>
          </dl>


          <div className="inspector-section">
            <div className="mb-2.5 flex items-center justify-between">
              <h3 className="m-0 text-[13px] font-semibold text-fg-muted">
                Line Items ({detail.order.items.length})
              </h3>
              <span className="text-[13px] text-fg-muted">Select a SKU to inspect</span>
            </div>

            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[13px] font-medium text-fg-muted">
                  <th className="py-2 pr-2 font-medium">SKU</th>
                  <th className="px-2 py-2 text-right font-medium">Qty</th>
                  <th className="px-2 py-2 text-right font-medium">Unit</th>
                  <th className="py-2 pl-2 text-right font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {detail.order.items.map((item) => (
                  <tr key={item.sku}>
                    <td className="py-2.5 pr-2">
                      <button
                        type="button"
                        onClick={() => actions.selectSku(item.sku)}
                        className="cursor-pointer text-left font-mono text-[13px] font-medium text-fg-strong underline decoration-border-strong underline-offset-3 hover:decoration-fg-strong"
                      >
                        {item.sku}
                      </button>
                      <div className="text-[13px] text-fg-muted">{item.productName}</div>
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums text-fg">
                      {item.quantity}
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums text-fg-muted">
                      {formatPaise(item.unitPricePaise)}
                    </td>
                    <td className="py-2.5 pl-2 text-right font-mono font-medium tabular-nums text-fg-strong">
                      {formatPaise(item.unitPricePaise * item.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="inspector-section">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="m-0 text-[13px] font-semibold text-fg-muted">
                Stock movements
              </h3>
              <span className="font-mono text-[13px] tabular-nums text-fg-muted">
                {detail.ledger.length} {detail.ledger.length === 1 ? 'event' : 'events'}
              </span>
            </div>

            <LedgerTimeline entries={detail.ledger}>
              {(entry) => (
                <button
                  type="button"
                  onClick={() => actions.selectSku(entry.sku)}
                  className="cursor-pointer truncate font-mono text-[13px] text-fg underline decoration-border-strong underline-offset-3 hover:text-fg-strong hover:decoration-fg-strong"
                >
                  {entry.sku}
                </button>
              )}
            </LedgerTimeline>
          </div>
          <IdempotencyCard detail={detail} onReplayTest={actions.openReplayReservation} />
        </div>
      ) : null}
    </section>
  );
}
