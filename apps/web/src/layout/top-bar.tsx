import { Tabs } from '@base-ui/react/tabs';
import { Tooltip } from '@base-ui/react/tooltip';
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/csr/ArrowUpRight';
import { MoonIcon } from '@phosphor-icons/react/dist/csr/Moon';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { StackIcon } from '@phosphor-icons/react/dist/csr/Stack';
import { SunIcon } from '@phosphor-icons/react/dist/csr/Sun';
import { apiUrl } from '../api/client';
import { IconButton, PrimaryButton } from '../components/shared/button';
import { useWorkbenchActions, useWorkbenchData, useWorkbenchHealth, useWorkbenchNavigation, type WorkspaceTab } from '../context/workbench-context';

export function TopBar() {
  const state = useWorkbenchNavigation();
  const actions = useWorkbenchActions();
  const data = useWorkbenchData();
  const meta = useWorkbenchHealth();
  const isHealthy = meta.health?.status === 'ok' && !meta.healthError;
  const inUse = meta.health ? meta.health.pool.totalCount - meta.health.pool.idleCount : 0;

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border bg-bg-frame px-3 sm:px-8">
      <div className="flex h-full min-w-0 items-center gap-3 sm:gap-6">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <StackIcon size={18} weight="bold" />
          </span>
          <span className="hidden sm:inline text-[14px] font-semibold tracking-tight text-fg-strong">OIS<span className="ml-2 hidden text-[13px] font-normal tracking-normal text-fg-muted sm:inline">/ Operations</span></span>
        </div>

        <Tabs.Root
          value={state.activeTab}
          onValueChange={(value) => actions.setActiveTab(value as WorkspaceTab)}
          className="flex h-full items-stretch"
        >
          <Tabs.List className="flex h-full items-stretch gap-3 sm:gap-5">
            <Tabs.Tab
              value="orders"
              className="relative inline-flex cursor-pointer items-center gap-1.5 border-b-2 border-transparent px-0.5 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg-strong data-[active]:border-active data-[active]:text-fg-strong"
            >
              <span>Orders</span>
              <span className="font-mono text-[13px] tabular-nums text-fg-muted">
                {data.orders.length}
              </span>
            </Tabs.Tab>
            <Tabs.Tab
              value="inventory"
              className="relative inline-flex cursor-pointer items-center gap-1.5 border-b-2 border-transparent px-0.5 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg-strong data-[active]:border-active data-[active]:text-fg-strong"
            >
              <span>Inventory</span>
              <span className="font-mono text-[13px] tabular-nums text-fg-muted">
                {data.kpis.totalSkus}
              </span>
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.Root>
      </div>

      <div className="flex items-center gap-1.5">
        <Tooltip.Root>
          <Tooltip.Trigger
            render={
              <div className="mr-2 hidden items-center gap-1.5 font-mono text-[13px] text-fg-muted md:flex" />
            }
          >
            <span className={`h-1.5 w-1.5 rounded-full ${isHealthy ? 'bg-success' : 'bg-danger'}`} />
            <span className="tabular-nums">
              {isHealthy && meta.health ? 'Connected' : 'offline'}
            </span>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner sideOffset={6} className="z-50">
              <Tooltip.Popup className="rounded-md bg-fg-strong px-2.5 py-1 font-mono text-[13px] text-bg shadow-md">
                {meta.health
                  ? `Database ${meta.health.dbLatencyMs.toFixed(1)}ms · pool ${inUse}/${meta.health.pool.totalCount} active · inventory refreshes every 15s`
                  : 'PostgreSQL unreachable'}
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger
            render={
              <IconButton
                onClick={() => void actions.refreshAll()}
                disabled={meta.isSyncing}
                aria-label="Refresh data"
              />
            }
          >
            <ArrowClockwiseIcon size={15} className={meta.isSyncing ? 'animate-spin' : ''} />
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner sideOffset={6} className="z-50">
              <Tooltip.Popup className="rounded-md bg-fg-strong px-2 py-1 text-[13px] text-bg shadow-md">
                Refresh
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>

        <a
          href={apiUrl('/docs')}
          target="_blank"
          rel="noreferrer"
          className="hidden sm:inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-fg-muted no-underline transition-colors hover:bg-bg-hover hover:text-fg-strong"
        >
          <span className="hidden sm:inline">API</span>
          <ArrowUpRightIcon size={13} />
        </a>

        <Tooltip.Root>
          <Tooltip.Trigger
            render={
              <IconButton
                onClick={actions.toggleTheme}
                aria-label={state.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              />
            }
          >
            {state.theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner sideOffset={6} className="z-50">
              <Tooltip.Popup className="rounded-md bg-fg-strong px-2 py-1 text-[13px] text-bg shadow-md">
                {state.theme === 'dark' ? 'Light theme' : 'Dark theme'}
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>

        <div className="ml-1">
          <PrimaryButton onClick={() => actions.openNewReservation()}>
            <PlusIcon size={13} weight="bold" />
            <span className="hidden sm:inline">New reservation</span><span className="sm:hidden">New</span>
          </PrimaryButton>
        </div>
      </div>
    </header>
  );
}
