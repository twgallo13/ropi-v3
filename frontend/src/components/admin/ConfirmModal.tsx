import { useEffect, useRef } from "react";

/**
 * TALLY-SETTINGS-UX Phase 3 / B.0 — ConfirmModal
 *
 * HTML5 <dialog>-based confirmation modal (Frink rec; PO Rulings 5 + 5b).
 * Replaces native confirm() callsites and adjacent alert() patterns.
 *
 * Architecture (single architecture per Frink 2nd-pass D2):
 *   - useRef<HTMLDialogElement> + showModal() / close().
 *   - Native focus trap, native ESC-to-close, ::backdrop CSS for overlay.
 *   - NO createPortal alternative.
 *
 * onConfirm contract: parent wraps in try/catch.
 *   success → parent sets open=false
 *   failure → parent sets errorSlot to message; modal stays open.
 */
export interface ConfirmModalProps {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "destructive";
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  errorSlot?: string | null;
}

export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "primary",
  onConfirm,
  onCancel,
  errorSlot,
}: ConfirmModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Sync open prop to dialog imperative API.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  // ESC + backdrop click both fire the native "cancel" event.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onCancel();
    };
    const handleClick = (e: MouseEvent) => {
      // Backdrop click: target is the dialog element itself (clicks on inner
      // content target the inner element instead).
      if (e.target === d) onCancel();
    };
    d.addEventListener("cancel", handleCancel);
    d.addEventListener("click", handleClick);
    return () => {
      d.removeEventListener("cancel", handleCancel);
      d.removeEventListener("click", handleClick);
    };
  }, [onCancel]);

  const confirmClass =
    confirmVariant === "destructive"
      ? "bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm"
      : "bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm";

  return (
    <dialog
      ref={dialogRef}
      className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md p-6 backdrop:bg-black/50"
    >
      {/* Inner wrapper so backdrop-click target detection above works. */}
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h2>
        <div className="text-sm text-gray-700 dark:text-gray-300">{body}</div>

        {errorSlot && (
          <div
            role="alert"
            className="bg-red-50 text-red-800 px-3 py-2 rounded text-sm border border-red-200"
          >
            {errorSlot}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="bg-gray-100 hover:bg-gray-200 text-gray-800 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-100 px-4 py-2 rounded text-sm"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              void onConfirm();
            }}
            className={confirmClass}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export default ConfirmModal;
