/**
 * TALLY-SETTINGS-UX Phase 3 / B.0 — SettingsToast (deprecated location).
 *
 * TALLY-155 — Implementation promoted to `frontend/src/lib/toast.tsx`.
 * This file is preserved as a re-export shim so existing call sites
 *   import { showToast, SettingsToastHost } from "../components/admin";
 * keep working without churn.
 *
 * Do not add new logic here — extend `frontend/src/lib/toast.tsx`.
 */
export {
  showToast,
  dismissToast,
  ToastHost,
  SettingsToastHost,
  type ToastOptions,
  type ToastVariant,
} from "../../lib/toast";
