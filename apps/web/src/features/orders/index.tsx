import { useWorkbenchNavigation } from '../../context/workbench-context';
import { OrderDetailPanel } from './components/order-detail-panel';
import { OrdersListPanel, OrdersToolbar } from './components/orders-list-panel';

export function OrdersWorkspace() {
  const { orderInspectorOpen } = useWorkbenchNavigation();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="workspace-heading">
        <div>
          <p className="workspace-eyebrow">Reservation operations</p>
          <h1 className="workspace-title">Orders</h1>
          <p className="workspace-description">Every reservation, with a trail. Look up an order or investigate a retry.</p>
        </div>

      </div>
      <div className="grid min-h-0 flex-1 gap-4 px-4 pb-4 sm:px-8 sm:pb-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className={`panel-surface min-h-0 flex-col ${orderInspectorOpen ? 'hidden lg:flex' : 'flex'}`}>
          <OrdersToolbar />
          <OrdersListPanel />
        </div>
        <div className={`panel-surface min-h-0 ${orderInspectorOpen ? 'flex flex-col' : 'hidden lg:flex lg:flex-col'}`}>
          <OrderDetailPanel />
        </div>
      </div>
    </div>
  );
}
