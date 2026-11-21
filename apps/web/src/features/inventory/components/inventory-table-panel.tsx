import { useMemo, useState } from 'react';
import { GhostButton } from '../../../components/shared/button';
import { StockTierIndicator } from '../../../components/shared/status-badge';
import { useWorkbenchActions, useWorkbenchData, useWorkbenchNavigation } from '../../../context/workbench-context';
import { getStockTier } from '../../../lib/format';

export type StockFilter = 'all' | 'last-unit' | 'unavailable' | 'scarce';

export function InventoryMetricsStrip({ onScarce }: { onScarce: () => void }) {
  const meta = useWorkbenchData();
  const metrics = [
    { label: 'Products', value: meta.kpis.totalSkus, accent: false, title: undefined },
    { label: 'Available units', value: meta.kpis.availableUnits, accent: false, title: undefined },
    { label: 'Reserved units', value: meta.kpis.reservedUnits, accent: false, title: undefined },
    { label: 'Needs attention', value: meta.kpis.scarceSkus, accent: meta.kpis.scarceSkus > 0, title: 'Products with 1 or fewer available units' },
  ];

  return (
    <section aria-label="Inventory summary" className="grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
      {metrics.map((metric) => (
        <div key={metric.label} className="bg-bg px-5 py-4 sm:px-7">
          {metric.accent ? <button type="button" title={metric.title} onClick={onScarce} className="min-h-10 cursor-pointer text-left text-[13px] font-medium text-warning-ink underline decoration-warning/30 underline-offset-4">{metric.label} ↗</button> : <div className="flex min-h-10 items-center text-[13px] font-medium text-fg-muted">{metric.label}</div>}
          <div className={`mt-1 font-sans text-[24px] font-semibold leading-none tracking-tight tabular-nums ${metric.accent ? 'text-warning-ink' : 'text-fg-strong'}`}>
            {metric.value}
          </div>
        </div>
      ))}
    </section>
  );
}

export function InventoryTablePanel({ onSelect, filter, onFilterChange }: { onSelect: () => void; filter: StockFilter; onFilterChange: (filter: StockFilter) => void }) {
  const actions = useWorkbenchActions();
  const { selectedSku } = useWorkbenchNavigation();
  const meta = useWorkbenchData();
  const [query, setQuery] = useState('');
  const products = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return meta.products.filter((product) => {
      const matchesQuery = !needle || product.name.toLowerCase().includes(needle) || product.sku.toLowerCase().includes(needle);
      const matchesFilter = filter === 'all' || (filter === 'scarce' ? product.availableStock <= 1 : filter === 'last-unit' ? product.availableStock === 1 : product.availableStock === 0);
      return matchesQuery && matchesFilter;
    });
  }, [filter, meta.products, query]);

  const filters: { id: StockFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'last-unit', label: 'Last unit' },
    { id: 'unavailable', label: 'Unavailable' },
    ...(filter === 'scarce' ? [{ id: 'scarce' as const, label: 'Scarce' }] : []),
  ];

  return (
    <section className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex shrink-0 flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <label className="relative block sm:w-64">
          <span className="sr-only">Search products or SKUs</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search products or SKU…"
            className="h-10 w-full rounded-md border border-border bg-bg-subtle px-3 text-[13px] text-fg-strong outline-none placeholder:text-fg-muted focus:border-accent"
          />
        </label>
        <div role="group" aria-label="Filter inventory" className="flex items-center gap-1">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => onFilterChange(item.id)}
              className={`min-h-10 rounded-md px-3 text-[13px] font-medium transition-colors ${filter === item.id ? 'bg-active-soft text-active' : 'text-fg-muted hover:bg-bg-hover hover:text-fg'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {meta.inventoryError ? (
          <div className="p-6 text-[13px] text-danger">Failed to load inventory: {meta.inventoryError.message}</div>
      ) : meta.isLoadingInventory && meta.products.length === 0 ? (
        <div className="p-6 text-[13px] text-fg-muted">Loading inventory…</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[570px] border-collapse text-[13px]">
            <thead className="sticky top-0 z-10 border-b border-border bg-bg-subtle text-left text-[13px] font-medium text-fg-muted">
              <tr>
                <th className="px-5 py-3.5 font-medium">Product</th>
                <th className="px-3 py-3.5 text-right font-medium">Available</th>
                <th className="px-3 py-3.5 text-right font-medium">Reserved</th>
                <th className="px-3 py-3.5 text-right font-medium">Total</th>
                <th className="px-3 py-3.5 font-medium">Status</th>
                <th className="px-5 py-3.5 text-right font-medium"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {products.map((product) => {
                const selected = selectedSku === product.sku;
                const tier = getStockTier(product);
                return (
                  <tr
                    key={product.sku}
                    onClick={() => { actions.selectSku(product.sku); onSelect(); }}
                    className={`cursor-pointer transition-colors ${selected ? 'bg-bg-subtle shadow-[inset_2px_0_0_0_var(--color-accent)]' : 'hover:bg-bg-hover'}`}
                  >
                    <td className="max-w-[280px] px-5 py-4">
                      <button type="button" onClick={(event) => { event.stopPropagation(); actions.selectSku(product.sku); onSelect(); }} className="block max-w-full cursor-pointer truncate text-left text-[14px] font-semibold text-fg-strong hover:text-active">{product.name}</button>
                      <div className="mt-1 font-mono text-[13px] text-fg-muted">{product.sku}</div>
                    </td>
                    <td className="px-3 py-4 text-right font-sans text-[16px] font-semibold tabular-nums text-fg-strong">{product.availableStock}</td>
                    <td className="px-3 py-4 text-right font-sans text-[14px] tabular-nums text-fg-muted">{product.reservedStock}</td>
                    <td className="px-3 py-4 text-right font-sans text-[14px] tabular-nums text-fg">{product.totalStock}</td>
                    <td className="px-3 py-4"><StockTierIndicator tier={tier} /></td>
                    <td className="px-5 py-4 text-right" onClick={(event) => event.stopPropagation()}>
                      <GhostButton disabled={product.availableStock === 0} onClick={() => actions.openNewReservation(product.sku)}>Reserve</GhostButton>
                    </td>
                  </tr>
                );
              })}
              {products.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-[13px] text-fg-muted">No products match this search and filter.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      <div className="shrink-0 border-t border-border px-5 py-2 text-[13px] text-fg-muted">
        Showing {products.length} of {meta.products.length} products
      </div>
    </section>
  );
}
