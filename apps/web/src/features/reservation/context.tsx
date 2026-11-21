import type { OrderItemInput, ProductDto } from '@ois/shared/schemas';
import {
  createContext,
  use,
  useCallback,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { createOrder, type CreateOrderApiResult } from '../../api/orders';
import {
  useWorkbenchActions,
  useWorkbenchData,
  type ReservationDraft,
} from '../../context/workbench-context';
import { generateIdempotencyKey } from '../../lib/idempotency-key';
import { pickReservableSku } from '../../lib/reservable-sku';

export interface DraftLineItem {
  readonly rowId: string;
  readonly sku: string;
  readonly quantity: number;
}

export interface ReservationDraftState {
  readonly idempotencyKey: string;
  readonly customerId: string;
  readonly items: readonly DraftLineItem[];
  readonly submitting: boolean;
  readonly outcome: CreateOrderApiResult | null;
  readonly attempt: number;
}

export interface ReservationDraftActions {
  readonly setIdempotencyKey: (key: string) => void;
  readonly regenerateKey: () => void;
  readonly setCustomerId: (customerId: string) => void;
  readonly addItem: () => void;
  readonly updateItemSku: (rowId: string, sku: string) => void;
  readonly updateItemQty: (rowId: string, quantity: number) => void;
  readonly removeItem: (rowId: string) => void;
  readonly submit: () => Promise<void>;
  readonly inspectOrder: (orderId: string) => void;
  readonly close: () => void;
}

export interface ReservationDraftMeta {
  readonly mode: 'new' | 'replay';
  readonly products: readonly ProductDto[];
  readonly productBySku: ReadonlyMap<string, ProductDto>;
  readonly estimatedTotalPaise: number;
  readonly canSubmit: boolean;
}

export interface ReservationDraftContextValue {
  readonly state: ReservationDraftState;
  readonly actions: ReservationDraftActions;
  readonly meta: ReservationDraftMeta;
}

const ReservationDraftContext = createContext<ReservationDraftContextValue | null>(null);

let rowCounter = 0;

function nextRowId(): string {
  rowCounter += 1;
  return `line-${rowCounter}`;
}

function toDraftLines(items: readonly OrderItemInput[]): DraftLineItem[] {
  return items.map((item) => ({
    rowId: nextRowId(),
    sku: item.sku,
    quantity: item.quantity,
  }));
}

interface ReservationDraftProviderProps {
  readonly initialDraft: ReservationDraft;
  readonly children: ReactNode;
}

export function ReservationDraftProvider({
  initialDraft,
  children,
}: ReservationDraftProviderProps) {
  const workbenchActions = useWorkbenchActions();
  const workbenchMeta = useWorkbenchData();

  const [idempotencyKey, setIdempotencyKey] = useState(initialDraft.idempotencyKey);
  const [customerId, setCustomerId] = useState(initialDraft.customerId);
  const [items, setItems] = useState<DraftLineItem[]>(() => toDraftLines(initialDraft.items));
  const [submitting, startSubmit] = useTransition();
  const [outcome, setOutcome] = useState<CreateOrderApiResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  const regenerateKey = useCallback(() => {
    setIdempotencyKey(generateIdempotencyKey());
    setOutcome(null);
  }, []);

  const updateIdempotencyKey = useCallback((key: string) => {
    setIdempotencyKey(key);
    setOutcome(null);
  }, []);

  const updateCustomerId = useCallback((value: string) => {
    setCustomerId(value);
    setOutcome(null);
  }, []);

  const addItem = useCallback(() => {
    setItems((prev) => {
      const candidate = pickReservableSku(
        workbenchMeta.products,
        new Set(prev.map((line) => line.sku)),
      );
      return candidate ? [...prev, { rowId: nextRowId(), sku: candidate, quantity: 1 }] : prev;
    });
    setOutcome(null);
  }, [workbenchMeta.products]);

  const updateItemSku = useCallback((rowId: string, sku: string) => {
    setItems((prev) => prev.map((line) => (line.rowId === rowId ? { ...line, sku } : line)));
    setOutcome(null);
  }, []);

  const updateItemQty = useCallback((rowId: string, quantity: number) => {
    const safeQty = Number.isFinite(quantity) && quantity >= 1 ? Math.floor(quantity) : 1;
    setItems((prev) =>
      prev.map((line) => (line.rowId === rowId ? { ...line, quantity: safeQty } : line)),
    );
    setOutcome(null);
  }, []);

  const removeItem = useCallback((rowId: string) => {
    setItems((prev) => (prev.length > 1 ? prev.filter((line) => line.rowId !== rowId) : prev));
    setOutcome(null);
  }, []);

  const submit = useCallback(async () => {
    const trimmedKey = idempotencyKey.trim();
    const trimmedCustomer = customerId.trim();
    if (!trimmedKey || !trimmedCustomer || items.length === 0) {
      return;
    }

    startSubmit(async () => {
      const result = await createOrder(trimmedKey, {
        customerId: trimmedCustomer,
        items: items.map((line) => ({ sku: line.sku, quantity: line.quantity })),
      });
      startSubmit(() => {
        setOutcome(result);
        setAttempt((current) => current + 1);
      });
      await workbenchActions.revalidateAfterMutation(result.ok ? result.data.order.id : undefined);
    });
  }, [customerId, idempotencyKey, items, workbenchActions]);

  const inspectOrder = useCallback(
    (orderId: string) => {
      workbenchActions.selectOrder(orderId);
      workbenchActions.closeDrawer();
    },
    [workbenchActions],
  );

  const estimatedTotalPaise = useMemo(() => {
    let total = 0;
    for (const line of items) {
      const product = workbenchMeta.productBySku.get(line.sku);
      if (product) {
        total += product.pricePaise * line.quantity;
      }
    }
    return total;
  }, [items, workbenchMeta.productBySku]);

  const canSubmit =
    !submitting &&
    idempotencyKey.trim().length > 0 &&
    customerId.trim().length > 0 &&
    items.length > 0;

  const value = useMemo<ReservationDraftContextValue>(
    () => ({
      state: {
        idempotencyKey,
        customerId,
        items,
        submitting,
        outcome,
        attempt,
      },
      actions: {
        setIdempotencyKey: updateIdempotencyKey,
        regenerateKey,
        setCustomerId: updateCustomerId,
        addItem,
        updateItemSku,
        updateItemQty,
        removeItem,
        submit,
        inspectOrder,
        close: workbenchActions.closeDrawer,
      },
      meta: {
        mode: initialDraft.mode,
        products: workbenchMeta.products,
        productBySku: workbenchMeta.productBySku,
        estimatedTotalPaise,
        canSubmit,
      },
    }),
    [
      idempotencyKey,
      customerId,
      items,
      submitting,
      outcome,
      attempt,
      regenerateKey,
      updateIdempotencyKey,
      updateCustomerId,
      addItem,
      updateItemSku,
      updateItemQty,
      removeItem,
      submit,
      inspectOrder,
      workbenchActions.closeDrawer,
      initialDraft.mode,
      workbenchMeta.products,
      workbenchMeta.productBySku,
      estimatedTotalPaise,
      canSubmit,
    ],
  );

  return <ReservationDraftContext value={value}>{children}</ReservationDraftContext>;
}

export function useReservationDraft(): ReservationDraftContextValue {
  const ctx = use(ReservationDraftContext);
  if (!ctx) {
    throw new Error('useReservationDraft must be used inside ReservationDraftProvider');
  }
  return ctx;
}
