import { useSkuDetail } from '../../../api/inventory';
import { useRejections } from '../../../api/rejections';
import { RejectionList } from '../../../components/shared/rejection-list';
import { GhostButton, PrimaryButton } from '../../../components/shared/button';
import { LedgerTimeline } from '../../../components/shared/ledger-timeline';
import { StockTierIndicator } from '../../../components/shared/status-badge';
import { useWorkbenchActions, useWorkbenchNavigation } from '../../../context/workbench-context';
import { getStockTier, shortToken } from '../../../lib/format';

export function SkuDetailPanel({ onClose, onBack }: { onClose: () => void; onBack: () => void }) {
  const actions = useWorkbenchActions();
  const { selectedSku } = useWorkbenchNavigation();
  const detailSwr = useSkuDetail(selectedSku);
  const rejectionsSwr = useRejections({ sku: selectedSku ?? undefined });
  const detail = detailSwr.data;

  const invariantHolds = detail
    ? detail.product.availableStock + detail.product.reservedStock === detail.product.totalStock
    : false;

  return (
    <section className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
        <button type="button" onClick={onBack} className="min-h-10 rounded-md px-3 text-[13px] font-medium text-fg-muted hover:bg-bg-hover hover:text-fg lg:hidden">
          ← Inventory
        </button>
        <span className="section-label hidden lg:inline">SKU inspector</span>
        <button type="button" onClick={onClose} aria-label="Close inspector" className="ml-auto min-h-10 rounded-md px-3 text-[13px] text-fg-muted hover:bg-bg-hover hover:text-fg">
          Close <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        {!selectedSku ? (
          <div className="py-16 text-center text-[13px] text-fg-muted">Select a product to inspect its stock position and ledger.</div>
        ) : detailSwr.isLoading && !detail ? (
          <div className="py-16 text-center text-[13px] text-fg-muted">Loading SKU ledger…</div>
        ) : detailSwr.error ? (
          <div className="text-[13px] text-danger">Failed to load SKU details: {detailSwr.error.message}</div>
        ) : detail ? (
          <div className="flex flex-col">
            <div className="flex items-start justify-between gap-3 pb-5">
              <div className="min-w-0">
                <h2 className="m-0 text-[20px] font-semibold leading-snug tracking-tight text-fg-strong">{detail.product.name}</h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-fg-muted">
                  <span className="font-mono">{detail.product.sku}</span>
                  <StockTierIndicator tier={getStockTier(detail.product)} />
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <PrimaryButton disabled={detail.product.availableStock === 0} onClick={() => actions.openNewReservation(detail.product.sku)}>
                  Reserve
                </PrimaryButton>
                <GhostButton onClick={() => actions.filterOrdersBySku(detail.product.sku)} className="h-7 px-2 text-[13px]">
                  Orders with this SKU
                </GhostButton>
              </div>
            </div>

            <div className="grid grid-cols-3 divide-x divide-border border-y border-border py-3">
              <div className="pr-3">
                <div className="text-[13px] text-fg-muted">Available</div>
                <div className="mt-1 font-sans text-[28px] font-semibold leading-none tabular-nums text-fg-strong">{detail.product.availableStock}</div>
              </div>
              <div className="px-3">
                <div className="text-[13px] text-fg-muted">Reserved</div>
                <div className="mt-1 font-sans text-[20px] font-semibold leading-none tabular-nums text-fg-strong">{detail.product.reservedStock}</div>
              </div>
              <div className="pl-3">
                <div className="text-[13px] text-fg-muted">Total</div>
                <div className="mt-1 font-sans text-[20px] font-semibold leading-none tabular-nums text-fg-strong">{detail.product.totalStock}</div>
              </div>
            </div>

            <details className="group border-b border-border py-3">
              <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-[13px] font-medium text-fg marker:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                <span className={`h-2 w-2 rounded-full ${invariantHolds ? 'bg-success' : 'bg-danger'}`} />
                {invariantHolds ? 'Stock balanced' : 'Stock mismatch'}
                <span className="ml-auto text-[13px] text-fg-muted group-open:hidden">Details +</span>
                <span className="ml-auto hidden text-[13px] text-fg-muted group-open:inline">Details −</span>
              </summary>
              <div className="pb-1 pl-4 text-[13px] leading-relaxed text-fg-muted">
                <p className="mb-1 mt-2">This check describes the current inventory snapshot only; it does not verify the full event history.</p>
                <p className="mb-0 font-mono tabular-nums text-fg">Available {detail.product.availableStock} + reserved {detail.product.reservedStock} = total {detail.product.totalStock}</p>
              </div>
            </details>

            <div className="border-b border-border py-4">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="m-0 text-[14px] font-semibold text-fg-strong">Rejected attempts</h3>
                <span className="font-mono text-[13px] tabular-nums text-fg-muted">
                  {rejectionsSwr.data ? rejectionsSwr.data.rejections.length : '…'}
                </span>
              </div>
              <p className="mb-1 mt-0 text-[13px] text-fg-muted">Requests that lost a race or could not be fully reserved. Nothing was reserved for them.</p>
              {rejectionsSwr.error ? (
                <p className="m-0 text-[13px] text-danger">Failed to load rejected attempts: {rejectionsSwr.error.message}</p>
              ) : (
                <RejectionList rejections={rejectionsSwr.data?.rejections ?? []} emptyText="No rejected attempts for this SKU." />
              )}
            </div>

            <div className="pt-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="m-0 text-[14px] font-semibold text-fg-strong">Activity</h3>
                <span className="font-mono text-[13px] tabular-nums text-fg-muted">{detail.ledger.length} {detail.ledger.length === 1 ? 'event' : 'events'}</span>
              </div>
              <LedgerTimeline entries={detail.ledger}>
                {(entry) => {
                  const linkedOrderId = entry.orderId;
                  if (!linkedOrderId) return <span className="font-mono text-[13px] text-fg-muted">Initial seed</span>;
                  return (
                    <button
                      type="button"
                      onClick={() => actions.selectOrder(linkedOrderId)}
                      className="cursor-pointer truncate font-mono text-[13px] text-fg underline decoration-border-strong underline-offset-3 hover:text-fg-strong hover:decoration-fg-strong"
                    >
                      Order {shortToken(linkedOrderId, 8, 4)}
                    </button>
                  );
                }}
              </LedgerTimeline>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
