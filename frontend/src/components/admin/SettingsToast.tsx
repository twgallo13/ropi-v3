import { useEffect, useState } from "react";
import ReactDOM from "react-dom";

/**
 * TALLY-SETTINGS-UX Phase 3 / B.0 — SettingsToast
 *
 * Toast host + queue for save-success feedback.
 * Module-level subscribe pattern: showToast() pushes to a module-scoped array;
 * SettingsToastHost subscribes via React state and renders into a portal.
 *
 * Mount <SettingsToastHost /> once in App.tsx (B.0 Step 2.5 wiring).
 */

interface Toast {
  id: string;
  message: string;
  expiresAt: number;
}

let toasts: Toast[] = [];
const listeners = new Set<(t: Toast[]) => void>();

function emit() {
  for (const l of listeners) l([...toasts]);
}

function dismiss(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function showToast(message: string, durationMs = 4000): void {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const t: Toast = { id, message, expiresAt: Date.now() + durationMs };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => dismiss(id), durationMs);
}

export function SettingsToastHost(): JSX.Element | null {
  const [active, setActive] = useState<Toast[]>(toasts);

  useEffect(() => {
    listeners.add(setActive);
    return () => {
      listeners.delete(setActive);
    };
  }, []);

  if (typeof document === "undefined") return null;
  if (active.length === 0) return null;

  return ReactDOM.createPortal(
    <div
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
    >
      {active.map((t) => (
        <div
          key={t.id}
          className="bg-green-50 text-green-800 border border-green-200 px-4 py-3 rounded shadow-lg flex items-start gap-2 pointer-events-auto max-w-sm"
        >
          <span className="flex-1 text-sm">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="text-green-800 hover:text-green-900 font-bold leading-none"
          >
            ×
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}
