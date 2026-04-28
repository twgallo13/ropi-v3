/**
 * TALLY-SETTINGS-UX Phase 3 / B.0 — ErrorBanner
 *
 * Shared inline red banner for save-error feedback.
 * Out of scope: existing inline `text-red-600` patterns are NOT migrated in B.0.
 */
export interface ErrorBannerProps {
  message: string | null;
  onDismiss?: () => void;
}

export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="bg-red-50 text-red-800 border border-red-200 px-4 py-3 rounded flex items-start gap-2"
    >
      <span aria-hidden="true">❌</span>
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-red-800 hover:text-red-900 font-bold leading-none"
        >
          ×
        </button>
      )}
    </div>
  );
}

export default ErrorBanner;
