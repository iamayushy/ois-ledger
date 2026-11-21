import { Dialog } from '@base-ui/react/dialog';

export function NewReservationHeader() {
  return (
    <div>
      <div className="workspace-eyebrow">Inventory operation</div>
      <Dialog.Title className="m-0 text-[16px] font-semibold tracking-tight text-fg-strong">
        Reserve stock
      </Dialog.Title>
      <Dialog.Description className="mt-1 text-[13px] text-fg-muted">
        Create an order and reserve every line together.
      </Dialog.Description>
    </div>
  );
}

export function ReplayReservationHeader() {
  return (
    <div>
      <div className="workspace-eyebrow">Idempotency check</div>
      <Dialog.Title className="m-0 text-[16px] font-semibold tracking-tight text-fg-strong">
        Retry an order
      </Dialog.Title>
      <Dialog.Description className="mt-1 text-[13px] text-fg-muted">
        Send the same key and order details to retrieve the original result.
      </Dialog.Description>
    </div>
  );
}
