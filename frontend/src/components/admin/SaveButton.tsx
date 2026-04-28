/**
 * TALLY-SETTINGS-UX Phase 3 / B.0 — SaveButton
 *
 * Standardized save button with saving/default states.
 * Out of scope: existing inline Save / "Saving…" patterns are NOT migrated in B.0.
 */
export interface SaveButtonProps {
  onClick: () => void | Promise<void>;
  isSaving: boolean;
  disabled?: boolean;
  label?: string;
  savingLabel?: string;
  className?: string;
}

export function SaveButton({
  onClick,
  isSaving,
  disabled,
  label = "Save",
  savingLabel = "Saving…",
  className,
}: SaveButtonProps) {
  const base =
    "bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm " +
    "disabled:opacity-50 disabled:cursor-not-allowed";
  return (
    <button
      type="button"
      onClick={() => {
        void onClick();
      }}
      disabled={isSaving || disabled}
      className={[base, className].filter(Boolean).join(" ")}
    >
      {isSaving ? savingLabel : label}
    </button>
  );
}

export default SaveButton;
