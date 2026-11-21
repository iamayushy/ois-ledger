import { NumberField } from '@base-ui/react/number-field';
import { Select } from '@base-ui/react/select';
import { CaretUpDownIcon } from '@phosphor-icons/react/dist/csr/CaretUpDown';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { MinusIcon } from '@phosphor-icons/react/dist/csr/Minus';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { GhostButton } from '../../../components/shared/button';
import { formatPaise } from '../../../lib/format';
import { useReservationDraft } from '../context';

export function ReservationItemsEditor() {
  const { state, actions, meta } = useReservationDraft();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="section-label">Items to reserve</div>
          <p className="mt-1 text-[13px] text-fg-muted">Stock is checked again when you submit.</p>
        </div>
        <GhostButton onClick={actions.addItem} className="h-6 px-2 text-[13px]">
          <PlusIcon size={12} weight="bold" />
          <span>Add SKU</span>
        </GhostButton>
      </div>

      <div className="divide-y divide-border border-y border-border">
        {state.items.map((line) => {
          const selectedProduct = meta.productBySku.get(line.sku);
          const exceedsStock =
            selectedProduct !== undefined && line.quantity > selectedProduct.availableStock;

          return (
            <div key={line.rowId} className="flex flex-col gap-1.5 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Select.Root
                    value={line.sku}
                    onValueChange={(value) => {
                      if (value) {
                        actions.updateItemSku(line.rowId, value);
                      }
                    }}
                  >
                    <Select.Trigger className="flex h-8.5 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-border-strong bg-bg px-2.5 text-left font-mono text-[13px] text-fg-strong focus:border-ring focus:outline-none">
                      <Select.Value>
                        {(value) => {
                          const prod = value ? meta.productBySku.get(value) : undefined;
                          return prod ? `${prod.sku} (${prod.availableStock} free)` : value;
                        }}
                      </Select.Value>
                      <Select.Icon className="shrink-0 text-fg-muted">
                        <CaretUpDownIcon size={13} />
                      </Select.Icon>
                    </Select.Trigger>
                    <Select.Portal>
                      <Select.Positioner sideOffset={4} className="z-50">
                        <Select.Popup className="max-h-64 min-w-[260px] overflow-y-auto rounded-md border border-border-strong bg-bg p-1 shadow-lg">
                          {meta.products.map((product) => (
                            <Select.Item
                              key={product.sku}
                              value={product.sku}
                              className="flex cursor-pointer items-center justify-between gap-3 rounded px-2.5 py-1.5 text-[13px] text-fg-strong outline-none data-[highlighted]:bg-bg-hover"
                            >
                              <div className="flex min-w-0 flex-col">
                                <span className="font-mono font-medium">{product.sku}</span>
                                <span className="truncate text-[13px] text-fg-muted">
                                  {product.name} · {formatPaise(product.pricePaise)}
                                </span>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <span
                                  className={`font-mono text-[13px] tabular-nums ${
                                    product.availableStock === 0 ? 'text-danger' : 'text-fg-muted'
                                  }`}
                                >
                                  {product.availableStock} free
                                </span>
                                <Select.ItemIndicator>
                                  <CheckIcon size={12} weight="bold" className="text-fg-strong" />
                                </Select.ItemIndicator>
                              </div>
                            </Select.Item>
                          ))}
                        </Select.Popup>
                      </Select.Positioner>
                    </Select.Portal>
                  </Select.Root>
                </div>

                <NumberField.Root
                  value={line.quantity}
                  min={1}
                  max={100000}
                  onValueChange={(value) => {
                    if (value !== null) {
                      actions.updateItemQty(line.rowId, value);
                    }
                  }}
                >
                  <NumberField.Group className="inline-flex h-8.5 items-center overflow-hidden rounded-md border border-border-strong bg-bg">
                    <NumberField.Decrement className="flex h-full w-7 cursor-pointer items-center justify-center text-fg-muted hover:bg-bg-hover hover:text-fg-strong disabled:opacity-40">
                      <MinusIcon size={12} />
                    </NumberField.Decrement>
                    <NumberField.Input className="h-full w-11 border-x border-border bg-transparent text-center font-mono text-[13px] tabular-nums text-fg-strong focus:outline-none" />
                    <NumberField.Increment className="flex h-full w-7 cursor-pointer items-center justify-center text-fg-muted hover:bg-bg-hover hover:text-fg-strong disabled:opacity-40">
                      <PlusIcon size={12} />
                    </NumberField.Increment>
                  </NumberField.Group>
                </NumberField.Root>

                <button
                  type="button"
                  aria-label="Remove item"
                  disabled={state.items.length <= 1}
                  onClick={() => actions.removeItem(line.rowId)}
                  className="inline-flex h-8.5 w-8.5 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-bg-hover hover:text-danger disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <TrashIcon size={14} />
                </button>
              </div>

              {selectedProduct ? (
                <div className="flex items-center justify-between font-mono text-[13px] tabular-nums">
                  <span className={exceedsStock ? 'text-warning-ink' : 'text-fg-muted'}>
                    {exceedsStock
                      ? `Preview shows ${selectedProduct.availableStock} available; submission may fail if stock remains low`
                      : `${selectedProduct.availableStock} free · ${formatPaise(selectedProduct.pricePaise)}`}
                  </span>
                  <span className="font-medium text-fg-strong">
                    {formatPaise(selectedProduct.pricePaise * line.quantity)}
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-1 text-[13px]">
        <span className="text-fg-muted">Estimated Total</span>
        <span className="font-mono text-[14px] font-semibold tabular-nums text-fg-strong">
          {formatPaise(meta.estimatedTotalPaise)}
        </span>
      </div>
    </section>
  );
}
