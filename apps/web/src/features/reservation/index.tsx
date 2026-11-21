import { Dialog } from '@base-ui/react/dialog';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import type { FormEvent } from 'react';
import { IconButton, PrimaryButton, SecondaryButton } from '../../components/shared/button';
import type { ReservationDraft } from '../../context/workbench-context';
import { ReservationItemsEditor } from './components/items-editor';
import { ReservationKeyField } from './components/key-field';
import { ReservationOutcomeBanner } from './components/outcome-banner';
import { NewReservationHeader, ReplayReservationHeader } from './components/reservation-headers';
import { ReservationDraftProvider, useReservationDraft } from './context';

function ReservationDrawerContent() {
  const { state, actions, meta } = useReservationDraft();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void actions.submit();
  }

  return (
    <form onSubmit={handleSubmit} className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div>
          {meta.mode === 'replay' ? <ReplayReservationHeader /> : <NewReservationHeader />}
        </div>
        <Dialog.Close render={<IconButton aria-label="Close drawer" />}>
          <XIcon size={15} />
        </Dialog.Close>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
        <ReservationKeyField />
        <ReservationItemsEditor />
        <ReservationOutcomeBanner />
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border bg-bg-subtle px-5 py-3">
        <SecondaryButton onClick={actions.close}>Close</SecondaryButton>
        <PrimaryButton type="submit" disabled={!meta.canSubmit}>
          {state.submitting
            ? 'Submitting…'
            : meta.mode === 'replay'
              ? 'Send Request'
              : 'Reserve Stock'}
        </PrimaryButton>
      </div>
    </form>
  );
}

interface ReservationDrawerProps {
  readonly draft: ReservationDraft | null;
  readonly version: number;
  readonly onClose: () => void;
}

export default function ReservationDrawer({ draft, version, onClose }: ReservationDrawerProps) {
  return (
    <Dialog.Root
      open={draft !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[1px] transition-opacity" />
        <Dialog.Popup className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] flex-col border-l border-border-strong bg-bg shadow-2xl outline-none">
          {draft ? (
            <ReservationDraftProvider key={version} initialDraft={draft}>
              <ReservationDrawerContent />
            </ReservationDraftProvider>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
