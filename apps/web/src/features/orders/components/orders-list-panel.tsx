import { Tabs } from '@base-ui/react/tabs';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { useState, useTransition, type FormEvent } from 'react';
import { lookupOrderByIdentifier, type StatusFilter } from '../../../api/orders';
import { GhostButton } from '../../../components/shared/button';
import { useWorkbenchActions, useWorkbenchData, useWorkbenchNavigation, useWorkbenchSearch } from '../../../context/workbench-context';
import { OrderRow } from './order-row';

const STATUS_TABS: readonly { readonly value: StatusFilter; readonly label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'RESERVED', label: 'Reserved' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function OrdersToolbar() {
  const state = useWorkbenchSearch();
  const actions = useWorkbenchActions();
  const [lookupBusy, startLookup] = useTransition();
  const [lookupNotice, setLookupNotice] = useState<{
    readonly tone: 'error' | 'info';
    readonly text: string;
  } | null>(null);

  function handleExactLookup(event: FormEvent) {
    event.preventDefault();
    const query = state.searchInput.trim();
    setLookupNotice(null);
    if (!query) {
      return;
    }

    startLookup(async () => {
      const result = await lookupOrderByIdentifier(query);
      startLookup(() => {
        if (result.ok) {
          actions.jumpToOrderDetail(result.detail);
          setLookupNotice({
            tone: 'info',
            text: `Found via ${result.mode === 'id' ? 'Order UUIDv7' : 'Idempotency-Key'}`,
          });
          return;
        }
        setLookupNotice({ tone: 'error', text: `[${result.error.code}] ${result.error.message}` });
      });
    });
  }

  return (
    <div className="shrink-0 border-b border-border bg-bg">
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 p-4 sm:px-5">
        <form onSubmit={handleExactLookup} className="flex h-9 min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-border bg-bg-subtle px-3">
          <MagnifyingGlassIcon
            size={14}
            className={`shrink-0 ${state.isSearchPending ? 'animate-pulse text-active' : 'text-fg-muted'}`}
          />
          <input
            type="text"
            value={state.searchInput}
            onChange={(event) => {
              actions.setSearchInput(event.target.value);
              if (lookupNotice) {
                setLookupNotice(null);
              }
            }}
            aria-label="Search orders"
            placeholder="Order ID, customer or request key…"
            className="h-full w-full max-w-lg bg-transparent text-[13px] text-fg-strong placeholder:text-fg-muted focus:outline-none focus-visible:outline-none"
          />
          {state.searchInput ? (
            <div className="flex items-center gap-1">
              <GhostButton type="submit" disabled={lookupBusy} className="h-6 px-2 text-[13px]">
                {lookupBusy ? 'Finding…' : 'Lookup ↵'}
              </GhostButton>
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  actions.clearSearch();
                  setLookupNotice(null);
                }}
                className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-fg-muted hover:bg-bg-hover hover:text-fg-strong"
              >
                <XIcon size={12} />
              </button>
            </div>
          ) : null}
        </form>

        <Tabs.Root
          value={state.statusFilter}
          onValueChange={(value) => actions.setStatusFilter(value as StatusFilter)}
        >
          <Tabs.List className="flex items-center gap-1">
            {STATUS_TABS.map((tab) => (
              <Tabs.Tab
                key={tab.value}
                value={tab.value}
                className="cursor-pointer rounded-md px-2.5 py-1 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg-strong data-[active]:bg-bg-inset data-[active]:text-fg-strong"
              >
                {tab.label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.Root>
      </div>

      {state.skuFilter ? (
        <div className="flex items-center gap-2 border-t border-border px-5 py-1.5 text-[13px] text-fg-muted">
          <span>Orders containing</span>
          <span className="inline-flex items-center gap-1 rounded-md bg-bg-inset px-2 py-0.5 font-mono text-fg-strong">
            {state.skuFilter}
            <button
              type="button"
              aria-label={`Remove ${state.skuFilter} filter`}
              onClick={() => actions.filterOrdersBySku(null)}
              className="inline-flex cursor-pointer items-center text-fg-muted hover:text-fg-strong"
            >
              <XIcon size={11} />
            </button>
          </span>
        </div>
      ) : null}

      {lookupNotice ? (
        <div
          role="status"
          className={`flex items-center justify-between border-t border-border px-5 py-1.5 font-mono text-[13px] ${
            lookupNotice.tone === 'error'
              ? 'bg-danger-soft text-danger'
              : 'bg-bg-subtle text-fg-strong'
          }`}
        >
          <span>{lookupNotice.text}</span>
          <button
            type="button"
            onClick={() => setLookupNotice(null)}
            className="cursor-pointer text-fg-muted hover:text-fg-strong"
          >
            <XIcon size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function OrdersListPanel() {
  const state = useWorkbenchNavigation();
  const actions = useWorkbenchActions();
  const meta = useWorkbenchData();

  return (
    <section aria-label="Orders list" className="flex min-h-0 flex-1 flex-col bg-bg">
      <div className="orders-grid shrink-0 border-b border-border bg-bg-subtle px-4 py-3 text-[13px] font-medium text-fg-muted sm:px-5" aria-hidden="true">
        <span>Product / Order ID</span><span className="orders-secondary">Customer</span><span>Status</span><span className="orders-secondary text-right">Units</span><span className="orders-secondary">Created</span><span className="text-right">Total</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {meta.ordersError ? (
          <div className="p-6 text-[13px] text-danger">
            Failed to load orders: {meta.ordersError.message}
          </div>
        ) : meta.isLoadingOrders && meta.orders.length === 0 ? (
          <div className="p-6 text-[13px] text-fg-muted">Loading orders…</div>
        ) : meta.orders.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-fg-muted">
            No orders match the current filter.
          </div>
        ) : (
          meta.orders.map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              isSelected={state.selectedOrderId === order.id}
              onSelect={actions.selectOrder}
            />
          ))
        )}
      </div>

      <div className="flex h-10 shrink-0 items-center justify-between border-t border-border bg-bg-subtle px-5 text-[13px] text-fg-muted">
        <span className="font-mono tabular-nums">
          {meta.orders.length} {meta.orders.length === 1 ? 'order' : 'orders'} shown
        </span>
        {meta.hasMoreOrders ? (
          <GhostButton onClick={actions.loadMoreOrders} disabled={meta.isLoadingMoreOrders}>
            {meta.isLoadingMoreOrders ? 'Loading…' : 'Load older'}
          </GhostButton>
        ) : (
          <span>Refreshes every 15s</span>
        )}
      </div>
    </section>
  );
}
