/**
 * TALLY-155 — Toast helper (promoted from admin/SettingsToast).
 *
 * Module-level subscribe pattern: showToast() pushes to a module-scoped array;
 * ToastHost subscribes via React state and renders into a portal.
 *
 * Mount <ToastHost /> ONCE at the App root. Legacy <SettingsToastHost /> is a
 * re-export alias kept here for backward compatibility — there must only be
 * one host mounted at a time.
 *
 * Backward-compatible signatures:
 *   showToast(message)                        // legacy success-only, 4s
 *   showToast(message, durationMs)            // legacy success-only, custom
 *   showToast({ message, variant?, durationMs?, persistent? })  // extended
 *
 * Variants: "success" (default) | "error" | "warning"
 * Persistent toasts ignore durationMs and stay until manually dismissed.
 *
 * TALLY-155 callsites require persistent: true for INELIGIBLE_STATE and
 * MAP_CONFLICT_BLOCKED errors (per dispatch binding).
 */
import { useEffect, useState } from "react";
import ReactDOM from "react-dom";

export type ToastVariant = "success" | "error" | "warning";

export interface ToastOptions {
  message: string;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms. Ignored if `persistent` is true. Default 4000. */
  durationMs?: number;
  /** When true, the toast stays until the user dismisses it. */
  persistent?: boolean;
}

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  persistent: boolean;
  expiresAt: number; // 0 if persistent
}

let toasts: Toast[] = [];
const listeners = new Set<(t: Toast[]) => void>();

function emit() {
  for (const l of listeners) l([...toasts]);
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function nextId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Show a toast. Returns the toast id (callers may pass it to dismissToast()).
 *
 * Legacy: showToast("message") and showToast("message", 6000) still work and
 * resolve to a success toast — no admin call sites need to change.
 */
export function showToast(message: string, durationMs?: number): string;
export function showToast(opts: ToastOptions): string;
export function showToast(arg: string | ToastOptions, durationMs?: number): string {
  const opts: ToastOptions =
    typeof arg === "string" ? { message: arg, durationMs } : arg;
  const variant: ToastVariant = opts.variant ?? "success";
  const persistent = opts.persistent === true;
  const duration = opts.durationMs ?? 4000;
  const id = nextId();
  const t: Toast = {
    id,
    message: opts.message,
    variant,
    persistent,
    expiresAt: persistent ? 0 : Date.now() + duration,
  };
  toasts = [...toasts, t];
  emit();
  if (!persistent) {
    setTimeout(() => dismissToast(id), duration);
  }
  return id;
}

const VARIANT_CLASS: Record<ToastVariant, string> = {
  success: "bg-green-50 text-green-800 border border-green-200",
  error: "bg-rose-50 text-rose-800 border border-rose-200",
  warning: "bg-amber-50 text-amber-900 border border-amber-200",
};

const VARIANT_BTN_CLASS: Record<ToastVariant, string> = {
  success: "text-green-800 hover:text-green-900",
  error: "text-rose-800 hover:text-rose-900",
  warning: "text-amber-900 hover:text-amber-950",
};

export function ToastHost(): JSX.Element | null {
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
          role={t.variant === "error" ? "alert" : "status"}
          className={`${VARIANT_CLASS[t.variant]} px-4 py-3 rounded shadow-lg flex items-start gap-2 pointer-events-auto max-w-sm`}
        >
          <span className="flex-1 text-sm whitespace-pre-line">{t.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
            className={`${VARIANT_BTN_CLASS[t.variant]} font-bold leading-none`}
          >
            ×
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** Backward-compatible alias for code paths that still import SettingsToastHost. */
export const SettingsToastHost = ToastHost;
