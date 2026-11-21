import { useState } from 'react';
import { useWorkbenchActions, useWorkbenchNavigation } from '../../context/workbench-context';
import { InventoryMetricsStrip, InventoryTablePanel, type StockFilter } from './components/inventory-table-panel';
import { SkuDetailPanel } from './components/sku-detail-panel';

export function InventoryWorkspace() {
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [filter, setFilter] = useState<StockFilter>('all');
  const { skuInspectorOpen, selectedSku } = useWorkbenchNavigation();
  const actions = useWorkbenchActions();
  function openInspector() {
    setInspectorOpen(true);
    if (selectedSku) actions.selectSku(selectedSku);
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="workspace-heading shrink-0">
        <div>
          <p className="workspace-eyebrow">Reservation operations</p>
          <h1 className="workspace-title">Inventory</h1>
          <p className="workspace-description">Know what’s available. Follow every reservation and release.</p>
        </div>
        {!inspectorOpen ? <button type="button" onClick={openInspector} className="shrink-0 rounded-md border border-border px-3 py-2 text-[13px] font-medium text-fg hover:bg-bg-hover">Open inspector</button> : null}
      </header>
      <div className="mx-4 mb-4 sm:mx-8"><InventoryMetricsStrip onScarce={() => setFilter('scarce')} /></div>
      <div className={`grid min-h-0 flex-1 gap-4 px-4 pb-4 sm:px-8 sm:pb-8 ${inspectorOpen ? 'lg:grid-cols-[minmax(0,1fr)_400px]' : 'grid-cols-1'}`}>
        <div className={`panel-surface min-h-0 ${skuInspectorOpen && inspectorOpen ? 'hidden lg:block' : 'block'}`}>
          <InventoryTablePanel filter={filter} onFilterChange={setFilter} onSelect={() => setInspectorOpen(true)} />
        </div>
        {inspectorOpen ? (
          <div className={`panel-surface min-h-0 ${skuInspectorOpen ? 'block' : 'hidden lg:block'}`}>
            <SkuDetailPanel onClose={() => { setInspectorOpen(false); actions.closeSkuInspector(); }} onBack={actions.closeSkuInspector} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
