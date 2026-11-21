import type {
  HealthResponse,
  OrderDetailDto,
  OrderDto,
  OrderItemInput,
  ProductDto,
} from '@ois/shared/schemas';
import {
  createContext,
  use,
  useCallback,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { useSWRConfig } from 'swr';
import { useHealth } from '../api/health';
import { useInventory, type InventoryKpis } from '../api/inventory';
import { useOrdersStream, type StatusFilter } from '../api/orders';
import { oisKeys } from '../api/queryKeys';
import { generateIdempotencyKey } from '../lib/idempotency-key';
import { pickReservableSku } from '../lib/reservable-sku';
import { useTheme, type ThemeMode } from '../lib/theme';
import { readUrlState, writeUrlState, type UrlState } from '../lib/url-state';

export type WorkspaceTab = 'orders' | 'inventory';

export interface ReservationDraft {
  readonly mode: 'new' | 'replay';
  readonly idempotencyKey: string;
  readonly customerId: string;
  readonly items: readonly OrderItemInput[];
}

interface NavigationState {
  readonly activeTab: WorkspaceTab;
  readonly orderInspectorOpen: boolean;
  readonly skuInspectorOpen: boolean;
  readonly selectedOrderId: string | null;
  readonly selectedSku: string | null;
  readonly theme: ThemeMode;
}

interface SearchState {
  readonly statusFilter: StatusFilter;
  readonly searchInput: string;
  readonly skuFilter: string | null;
  readonly isSearchPending: boolean;
}

interface DrawerState {
  readonly drawerDraft: ReservationDraft | null;
  readonly drawerVersion: number;
}

export interface WorkbenchActions {
  readonly setActiveTab: (tab: WorkspaceTab) => void;
  readonly selectOrder: (orderId: string) => void;
  readonly closeOrderInspector: () => void;
  readonly closeSkuInspector: () => void;
  readonly selectSku: (sku: string) => void;
  readonly setStatusFilter: (status: StatusFilter) => void;
  readonly setSearchInput: (value: string) => void;
  readonly clearSearch: () => void;
  readonly filterOrdersBySku: (sku: string | null) => void;
  readonly openNewReservation: (prefillSku?: string) => void;
  readonly openReplayReservation: (detail: OrderDetailDto) => void;
  readonly closeDrawer: () => void;
  readonly toggleTheme: () => void;
  readonly refreshAll: () => Promise<void>;
  readonly revalidateAfterMutation: (orderId?: string) => Promise<void>;
  readonly jumpToOrderDetail: (detail: OrderDetailDto) => void;
  readonly loadMoreOrders: () => void;
}

export interface WorkbenchData {
  readonly products: readonly ProductDto[];
  readonly productBySku: ReadonlyMap<string, ProductDto>;
  readonly kpis: InventoryKpis;
  readonly isLoadingInventory: boolean;
  readonly inventoryError: Error | undefined;
  readonly orders: readonly OrderDto[];
  readonly hasMoreOrders: boolean;
  readonly isLoadingOrders: boolean;
  readonly isLoadingMoreOrders: boolean;
  readonly ordersError: Error | undefined;
}

interface HealthMeta {
  readonly health: HealthResponse | undefined;
  readonly healthError: Error | undefined;
  readonly isSyncing: boolean;
}

const SEARCH_DEBOUNCE_MS = 250;
const CONSOLE_CUSTOMER_ID = 'cust-ops-console';

const NavigationContext = createContext<NavigationState | null>(null);
const SearchContext = createContext<SearchState | null>(null);
const DrawerContext = createContext<DrawerState | null>(null);
const ActionsContext = createContext<WorkbenchActions | null>(null);
const DataContext = createContext<WorkbenchData | null>(null);
const HealthContext = createContext<HealthMeta | null>(null);

function patchUrl(patch: Partial<UrlState>): void {
  writeUrlState({ ...readUrlState(), ...patch });
}

export function WorkbenchProvider({ children }: { readonly children: ReactNode }) {
  const { mutate: globalMutate } = useSWRConfig();
  const { theme, toggleTheme } = useTheme();
  const [initialUrl] = useState(readUrlState);

  const [activeTab, setActiveTabState] = useState<WorkspaceTab>(initialUrl.tab);
  const [orderInspectorOpen, setOrderInspectorOpen] = useState(initialUrl.order !== null);
  const [skuInspectorOpen, setSkuInspectorOpen] = useState(initialUrl.sku !== null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(initialUrl.order);
  const [explicitSku, setExplicitSku] = useState<string | null>(initialUrl.sku);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [searchInput, setSearchInputState] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [skuFilter, setSkuFilter] = useState<string | null>(null);
  const [isSearchPending, startSearchTransition] = useTransition();
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [drawerDraft, setDrawerDraft] = useState<ReservationDraft | null>(null);
  const [drawerVersion, setDrawerVersion] = useState(0);

  const healthSwr = useHealth();
  const inventory = useInventory();
  const ordersStream = useOrdersStream({
    status: statusFilter,
    search: appliedSearch,
    sku: skuFilter,
  });

  const selectedSku = explicitSku ?? inventory.products[0]?.sku ?? null;
  const mutateHealth = healthSwr.mutate;
  const mutateInventory = inventory.mutate;
  const mutateOrders = ordersStream.mutate;
  const loadMore = ordersStream.loadMore;
  const products = inventory.products;

  const setActiveTab = useCallback((tab: WorkspaceTab) => {
    setActiveTabState(tab);
    patchUrl({ tab });
  }, []);

  const selectOrder = useCallback((orderId: string) => {
    setSelectedOrderId(orderId);
    setOrderInspectorOpen(true);
    setActiveTabState('orders');
    patchUrl({ tab: 'orders', order: orderId });
  }, []);

  const selectSku = useCallback((sku: string) => {
    setExplicitSku(sku);
    setSkuInspectorOpen(true);
    setActiveTabState('inventory');
    patchUrl({ tab: 'inventory', sku });
  }, []);

  const closeOrderInspector = useCallback(() => setOrderInspectorOpen(false), []);
  const closeSkuInspector = useCallback(() => setSkuInspectorOpen(false), []);

  const cancelPendingSearch = useCallback(() => {
    if (searchTimerRef.current !== null) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
  }, []);

  const setSearchInput = useCallback(
    (value: string) => {
      setSearchInputState(value);
      cancelPendingSearch();
      searchTimerRef.current = setTimeout(() => {
        searchTimerRef.current = null;
        startSearchTransition(() => setAppliedSearch(value));
      }, SEARCH_DEBOUNCE_MS);
    },
    [cancelPendingSearch],
  );

  const clearSearch = useCallback(() => {
    cancelPendingSearch();
    setSearchInputState('');
    setAppliedSearch('');
  }, [cancelPendingSearch]);

  const filterOrdersBySku = useCallback((sku: string | null) => {
    setSkuFilter(sku);
    setActiveTabState('orders');
    patchUrl({ tab: 'orders' });
  }, []);

  const openNewReservation = useCallback(
    (prefillSku?: string) => {
      const targetSku = prefillSku ?? pickReservableSku(products, new Set());
      setDrawerVersion((v) => v + 1);
      setDrawerDraft({
        mode: 'new',
        idempotencyKey: generateIdempotencyKey(),
        customerId: CONSOLE_CUSTOMER_ID,
        items: targetSku ? [{ sku: targetSku, quantity: 1 }] : [],
      });
    },
    [products],
  );

  const openReplayReservation = useCallback((detail: OrderDetailDto) => {
    setDrawerVersion((v) => v + 1);
    setDrawerDraft({
      mode: 'replay',
      idempotencyKey: detail.order.idempotencyKey,
      customerId: detail.order.customerId,
      items: detail.order.items.map((item) => ({ sku: item.sku, quantity: item.quantity })),
    });
  }, []);

  const closeDrawer = useCallback(() => setDrawerDraft(null), []);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      mutateHealth(),
      mutateInventory(),
      mutateOrders(),
      selectedOrderId ? globalMutate(oisKeys.orders.detail(selectedOrderId)) : Promise.resolve(),
      selectedSku ? globalMutate(oisKeys.inventory.detail(selectedSku)) : Promise.resolve(),
    ]);
  }, [globalMutate, mutateHealth, mutateInventory, mutateOrders, selectedOrderId, selectedSku]);

  const revalidateAfterMutation = useCallback(
    async (orderId?: string) => {
      const tasks: Promise<unknown>[] = [
        mutateHealth(),
        mutateInventory(),
        mutateOrders(),
        globalMutate(
          (key) => typeof key === 'string' && key.startsWith('/api/inventory/'),
          undefined,
          { revalidate: true },
        ),
      ];
      if (orderId) {
        tasks.push(globalMutate(oisKeys.orders.detail(orderId)));
      }
      await Promise.all(tasks);
    },
    [globalMutate, mutateHealth, mutateInventory, mutateOrders],
  );

  const jumpToOrderDetail = useCallback(
    (detail: OrderDetailDto) => {
      void globalMutate(oisKeys.orders.detail(detail.order.id), detail, false);
      selectOrder(detail.order.id);
    },
    [globalMutate, selectOrder],
  );

  const loadMoreOrders = useCallback(() => {
    void loadMore();
  }, [loadMore]);

  const navigation = useMemo<NavigationState>(
    () => ({ activeTab, orderInspectorOpen, skuInspectorOpen, selectedOrderId, selectedSku, theme }),
    [activeTab, orderInspectorOpen, skuInspectorOpen, selectedOrderId, selectedSku, theme],
  );
  const search = useMemo<SearchState>(
    () => ({ statusFilter, searchInput, skuFilter, isSearchPending }),
    [statusFilter, searchInput, skuFilter, isSearchPending],
  );
  const drawer = useMemo<DrawerState>(() => ({ drawerDraft, drawerVersion }), [drawerDraft, drawerVersion]);
  const actions = useMemo<WorkbenchActions>(
    () => ({
      setActiveTab,
      selectOrder,
      closeOrderInspector,
      closeSkuInspector,
      selectSku,
      setStatusFilter,
      setSearchInput,
      clearSearch,
      filterOrdersBySku,
      openNewReservation,
      openReplayReservation,
      closeDrawer,
      toggleTheme,
      refreshAll,
      revalidateAfterMutation,
      jumpToOrderDetail,
      loadMoreOrders,
    }),
    [
      setActiveTab,
      selectOrder,
      closeOrderInspector,
      closeSkuInspector,
      selectSku,
      setSearchInput,
      clearSearch,
      filterOrdersBySku,
      openNewReservation,
      openReplayReservation,
      closeDrawer,
      toggleTheme,
      refreshAll,
      revalidateAfterMutation,
      jumpToOrderDetail,
      loadMoreOrders,
    ],
  );
  const data = useMemo<WorkbenchData>(
    () => ({
      products: inventory.products,
      productBySku: inventory.productBySku,
      kpis: inventory.kpis,
      isLoadingInventory: inventory.isLoading,
      inventoryError: inventory.error,
      orders: ordersStream.orders,
      hasMoreOrders: ordersStream.hasMore,
      isLoadingOrders: ordersStream.isLoading,
      isLoadingMoreOrders: ordersStream.isLoadingMore,
      ordersError: ordersStream.error,
    }),
    [
      inventory.products,
      inventory.productBySku,
      inventory.kpis,
      inventory.isLoading,
      inventory.error,
      ordersStream.orders,
      ordersStream.hasMore,
      ordersStream.isLoading,
      ordersStream.isLoadingMore,
      ordersStream.error,
    ],
  );
  const health = useMemo<HealthMeta>(
    () => ({
      health: healthSwr.data,
      healthError: healthSwr.error as Error | undefined,
      isSyncing: healthSwr.isValidating || inventory.isValidating || ordersStream.isValidating,
    }),
    [healthSwr.data, healthSwr.error, healthSwr.isValidating, inventory.isValidating, ordersStream.isValidating],
  );

  return (
    <ActionsContext value={actions}>
      <NavigationContext value={navigation}>
        <SearchContext value={search}>
          <DrawerContext value={drawer}>
            <DataContext value={data}>
              <HealthContext value={health}>{children}</HealthContext>
            </DataContext>
          </DrawerContext>
        </SearchContext>
      </NavigationContext>
    </ActionsContext>
  );
}

function requireProvider<T>(value: T | null): T {
  if (value === null) throw new Error('Workbench hooks must be used inside WorkbenchProvider');
  return value;
}

export function useWorkbenchNavigation() { return requireProvider(use(NavigationContext)); }
export function useWorkbenchSearch() { return requireProvider(use(SearchContext)); }
export function useWorkbenchDrawer() { return requireProvider(use(DrawerContext)); }
export function useWorkbenchActions() { return requireProvider(use(ActionsContext)); }
export function useWorkbenchData() { return requireProvider(use(DataContext)); }
export function useWorkbenchHealth() { return requireProvider(use(HealthContext)); }
