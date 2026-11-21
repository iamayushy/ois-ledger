import { lazy, Suspense } from 'react';
import { useWorkbenchActions, useWorkbenchDrawer, useWorkbenchNavigation } from '../context/workbench-context';
import { InventoryWorkspace } from '../features/inventory';
import { OrdersWorkspace } from '../features/orders';
import { TopBar } from './top-bar';

const ReservationDrawer = lazy(() => import('../features/reservation'));

export function AppShell() {
  const state = useWorkbenchNavigation();
  const drawer = useWorkbenchDrawer();
  const actions = useWorkbenchActions();

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg-frame text-fg">
      <TopBar />

      <main className="flex min-h-0 flex-1 flex-col">
        {state.activeTab === 'orders' ? <OrdersWorkspace /> : <InventoryWorkspace />}
      </main>

      {drawer.drawerDraft ? (
        <Suspense fallback={null}>
          <ReservationDrawer
            draft={drawer.drawerDraft}
            version={drawer.drawerVersion}
            onClose={actions.closeDrawer}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
