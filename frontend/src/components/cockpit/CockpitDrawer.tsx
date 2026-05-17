/**
 * TALLY-146 PR 2 — Cockpit Drawer.
 *
 * Right-anchored slide-in panel, 520px wide, z-40, scrim bg-slate-900/30.
 * - Opens when an item card body is clicked.
 * - Closes on Esc (dispatch: close-on-decision OFF — Approve/Reject inside
 *   the drawer do NOT auto-close; only Esc or scrim click closes it).
 * - Keyboard: j = next, k = prev, a = approve, d = deny/reject, h = hold,
 *   Esc = close, Tab = focus trap inside drawer.
 * - Auto-advance: after a per-item decision succeeds, drawer advances to the
 *   NEXT item in queue (parent supplies the queue, already filtered by the
 *   shared hidden-MPN set).
 *
 * TALLY-155 — Optimistic UI + toast feedback:
 *   - On success: emit success toast, call parent onRowSuccess (which hides
 *     the row + re-derives the filtered queue), then advance() to the next
 *     visible item. Drawer never closes from an action alone.
 *   - On failure: emit error toast (persistent if code matches), surface an
 *     inline rose error block above the action buttons, do NOT advance.
 *   - alert("Action failed. See console.") removed.
 *
 * TALLY-156 — Deep-dive exception controls:
 *   - Custom Price block: buyer can set an explicit override price via the
 *     existing POST /api/v1/buyer-actions/markdown contract with
 *     action_type="adjust", adjustment={ type:"price", value:<number> }.
 *     Same feedback model as quick actions (busy disable, success toast +
 *     onRowSuccess + advance, failure persistent toast + inline error).
 *   - Step Override is INTENTIONALLY OMITTED: no buyer-scoped backend
 *     contract exists for manually changing cadence step. cadenceEngine
 *     mutates current_step internally; the only manual trigger is
 *     POST /api/v1/admin/cadence/run-evaluation (admin-only, runs whole
 *     evaluation, not per-MPN step set). See dispatch Step 0 gap report.
 *
 * Hierarchy blocks (whitespace-separated, no dividers):
 *   1. Header     : MPN, name, brand
 *   2. Badges     : full taxonomy incl. MAP Protected
 *   3. Pricing    : RICS retail / RICS offer / SCOM / SCOM sale / MAP floor
 *   4. Metrics    : STR% / WOS / GM% (store, web) / inventory / days_in_queue
 *   5. Quick acts : Approve / Reject(Deny) / Hold (single-item)
 *   6. Deep dive  : Custom Price (TALLY-156)
 *   7. Footer     : keyboard cheatsheet
 *
 * NOTE: drawer remains compatible with the existing single-item
 * buyerAction("approve"|"deny") / buyerHold() endpoints. The "Reject" label
 * is shown in the UI; the wire-level action_type is "deny" (existing FE
 * convention preserved — does not need PR-1 endpoint).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { buyerAction, buyerHold } from "../../lib/api";
import type { CadenceReviewItem } from "../../lib/api";
import ReasonBadges from "./ReasonBadge";
import { showToast } from "../../lib/toast";
import {
  extractErrorCode,
  extractErrorMessage,
  isPersistentErrorCode,
} from "../../lib/errorMessage";

const DECISION_LABEL: Record<"approve" | "deny" | "hold", string> = {
  approve: "Approve",
  deny: "Reject",
  hold: "Hold",
};

interface Props {
  open: boolean;
  item: CadenceReviewItem | null;
  /** All items in the active queue (used for j/k navigation + auto-advance). */
  queue: CadenceReviewItem[];
  readOnly?: boolean;
  onClose: () => void;
  /** Called with the next MPN to display, or null when queue is exhausted. */
  onNavigate: (nextMpn: string | null) => void;
  /** Called after a per-item decision so parent can refetch cockpit. */
  onActionComplete: () => void;
  /** TALLY-155 — optimistic-hide + per-row error callbacks (cadence tab). */
  onRowSuccess: (mpn: string) => void;
  onRowFailure: (mpn: string, errMsg: string) => void;
  getRowError: (mpn: string) => string | undefined;
  clearRowError: (mpn: string) => void;
}

export default function CockpitDrawer({
  open,
  item,
  queue,
  readOnly,
  onClose,
  onNavigate,
  onActionComplete,
  onRowSuccess,
  onRowFailure,
  getRowError,
  clearRowError,
}: Props) {
  const [busy, setBusy] = useState(false);
  // TALLY-156 — deep-dive Custom Price input (string for free entry; parsed on submit).
  const [customPrice, setCustomPrice] = useState<string>("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const currentMpn = item?.mpn ?? null;
  const inlineError = currentMpn ? getRowError(currentMpn) : undefined;

  // Reset the Custom Price input whenever the drawer switches to a new item
  // so a stale value from item A can never be submitted against item B.
  useEffect(() => {
    setCustomPrice("");
  }, [currentMpn]);

  // Auto-advance helper: move to NEXT visible item in queue, or close if at end.
  // The parent strips successful rows out of `queue` before passing it down,
  // so the next index is always the next visible MPN.
  const advance = useCallback(
    (succeededMpn: string) => {
      const idx = queue.findIndex((q) => q.mpn === succeededMpn);
      // After the hide is applied, the successful row will fall out of `queue`
      // on the next render. Until then, skip it explicitly.
      const candidates = queue.filter((q) => q.mpn !== succeededMpn);
      if (candidates.length === 0) {
        onClose();
        return;
      }
      const nextIdx = Math.min(Math.max(idx, 0), candidates.length - 1);
      onNavigate(candidates[nextIdx].mpn);
    },
    [queue, onClose, onNavigate],
  );

  const navigate = useCallback(
    (dir: 1 | -1) => {
      if (!item) return;
      const idx = queue.findIndex((q) => q.mpn === item.mpn);
      if (idx < 0) return;
      const target = idx + dir;
      if (target < 0 || target >= queue.length) return;
      onNavigate(queue[target].mpn);
    },
    [item, queue, onNavigate],
  );

  const runDecision = useCallback(
    async (kind: "approve" | "deny" | "hold") => {
      if (!item || readOnly || busy) return;
      const mpn = item.mpn;
      setBusy(true);
      clearRowError(mpn);
      try {
        if (kind === "hold") {
          await buyerHold(mpn, "Held from Cockpit Drawer (TALLY-146 PR 2)");
        } else {
          await buyerAction(mpn, kind);
        }
        showToast({
          message: `${DECISION_LABEL[kind]} succeeded for ${mpn}.`,
          variant: "success",
        });
        onRowSuccess(mpn);
        onActionComplete();
        // close-on-decision OFF; instead auto-advance to next visible item.
        advance(mpn);
      } catch (e) {
        console.error("[cockpit drawer] action failed:", e);
        const code = extractErrorCode(e);
        const msg = extractErrorMessage(e);
        onRowFailure(mpn, msg);
        showToast({
          message: msg,
          variant: "error",
          persistent: isPersistentErrorCode(code),
        });
        // Drawer stays open on the failed item; do NOT advance.
      } finally {
        setBusy(false);
      }
    },
    [item, readOnly, busy, onActionComplete, advance, onRowSuccess, onRowFailure, clearRowError],
  );

  // TALLY-156 — Custom Price submission.
  // Wires the existing buyerAction("adjust", { type: "price", value }) contract.
  // Same feedback model as runDecision: optimistic hide + success toast +
  // advance on success; inline error + persistent toast on failure.
  const runCustomPrice = useCallback(
    async () => {
      if (!item || readOnly || busy) return;
      const mpn = item.mpn;
      const parsed = Number(customPrice);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        const msg = "Enter a valid price greater than 0.";
        onRowFailure(mpn, msg);
        showToast({ message: msg, variant: "error" });
        return;
      }
      setBusy(true);
      clearRowError(mpn);
      try {
        await buyerAction(mpn, "adjust", { type: "price", value: parsed });
        showToast({
          message: `Custom price $${parsed.toFixed(2)} applied to ${mpn}.`,
          variant: "success",
        });
        onRowSuccess(mpn);
        onActionComplete();
        advance(mpn);
      } catch (e) {
        console.error("[cockpit drawer] custom price failed:", e);
        const code = extractErrorCode(e);
        const msg = extractErrorMessage(e);
        onRowFailure(mpn, msg);
        showToast({
          message: msg,
          variant: "error",
          persistent: isPersistentErrorCode(code),
        });
      } finally {
        setBusy(false);
      }
    },
    [
      item,
      readOnly,
      busy,
      customPrice,
      onActionComplete,
      advance,
      onRowSuccess,
      onRowFailure,
      clearRowError,
    ],
  );

  // Focus the panel when it opens (focus trap baseline).
  useEffect(() => {
    if (open && panelRef.current) {
      panelRef.current.focus();
    }
  }, [open, item?.mpn]);

  // Keyboard bindings (binding: j/k/a/d/h/Esc/Tab).
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      // Don't intercept while typing in a form field.
      const target = ev.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (inField) return;

      switch (ev.key) {
        case "Escape":
          ev.preventDefault();
          onClose();
          break;
        case "j":
          ev.preventDefault();
          navigate(1);
          break;
        case "k":
          ev.preventDefault();
          navigate(-1);
          break;
        case "a":
          ev.preventDefault();
          void runDecision("approve");
          break;
        case "d":
          ev.preventDefault();
          void runDecision("deny");
          break;
        case "h":
          ev.preventDefault();
          void runDecision("hold");
          break;
        case "Tab": {
          // Focus trap inside panel.
          const panel = panelRef.current;
          if (!panel) return;
          const focusable = panel.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          const active = document.activeElement as HTMLElement | null;
          if (ev.shiftKey && active === first) {
            ev.preventDefault();
            last.focus();
          } else if (!ev.shiftKey && active === last) {
            ev.preventDefault();
            first.focus();
          }
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, navigate, runDecision, onClose]);

  if (!open || !item) return null;

  const idx = queue.findIndex((q) => q.mpn === item.mpn);
  const positionLabel =
    idx >= 0 ? `${idx + 1} / ${queue.length}` : `1 / ${queue.length}`;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`Detail drawer for ${item.mpn}`}
    >
      <div
        className="absolute inset-0 bg-slate-900/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative w-[520px] max-w-full h-full bg-white shadow-2xl overflow-y-auto outline-none animate-[slideInRight_180ms_ease-out]"
        style={{ animationName: "slideInRight", animationDuration: "180ms", animationTimingFunction: "ease-out" }}
      >
        <style>{`@keyframes slideInRight { from { transform: translateX(16px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>

        <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
          <div className="text-xs text-slate-500">{positionLabel}</div>
          <button
            onClick={onClose}
            aria-label="Close drawer"
            className="text-slate-400 hover:text-slate-700 text-lg leading-none px-2"
          >
            ×
          </button>
        </div>

        {/* Hierarchy blocks: whitespace-only separation, no dividers. */}
        <div className="px-4 py-3 space-y-5">
          {/* 1. Header */}
          <div>
            <div className="text-base font-semibold">{item.name}</div>
            <div className="text-xs text-slate-500 font-mono">{item.mpn}</div>
            <div className="text-xs text-slate-500">
              {item.brand} • {item.department} / {item.class}
            </div>
          </div>

          {/* 2. Badges (full taxonomy incl. MAP Protected) */}
          <div>
            <ReasonBadges ctx={item} surface="drawer" />
          </div>

          {/* 3. Pricing */}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">
              Pricing
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">RICS retail</span>
                <span>{fmt$(item.rics_retail)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">RICS offer</span>
                <span>{fmt$(item.rics_offer)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">SCOM</span>
                <span>{fmt$(item.scom)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">SCOM sale</span>
                <span>{fmt$(item.scom_sale)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">MAP floor</span>
                <span>{item.map_price != null ? fmt$(item.map_price) : "—"}</span>
              </div>
            </div>
          </div>

          {/* 4. Metrics */}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">
              Metrics
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">STR %</span>
                <span>{fmtPct(item.str_pct)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">WOS</span>
                <span>{item.wos ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Store GM%</span>
                <span>{fmtPct(item.store_gm_pct)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Web GM%</span>
                <span>{fmtPct(item.web_gm_pct)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Inventory</span>
                <span>{item.inventory_total}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Days in queue</span>
                <span>{item.days_in_queue}</span>
              </div>
            </div>
          </div>

          {/* 5. Actions */}
          {inlineError && (
            <div className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded px-2 py-1">
              {inlineError}
            </div>
          )}
          <div className="flex gap-2">
            <button
              disabled={readOnly || busy}
              onClick={() => void runDecision("approve")}
              className="px-3 py-1.5 text-sm rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:bg-slate-300 disabled:cursor-not-allowed"
              aria-keyshortcuts="a"
            >
              Approve (a)
            </button>
            <button
              disabled={readOnly || busy}
              onClick={() => void runDecision("deny")}
              className="px-3 py-1.5 text-sm rounded bg-rose-600 hover:bg-rose-700 text-white disabled:bg-slate-300 disabled:cursor-not-allowed"
              aria-keyshortcuts="d"
            >
              Reject (d)
            </button>
            <button
              disabled={readOnly || busy}
              onClick={() => void runDecision("hold")}
              className="px-3 py-1.5 text-sm rounded bg-amber-500 hover:bg-amber-600 text-white disabled:bg-slate-300 disabled:cursor-not-allowed"
              aria-keyshortcuts="h"
            >
              Hold (h)
            </button>
          </div>

          {/* 6. Deep dive — exception controls (TALLY-156)
               Visually separated from quick actions by extra top margin +
               a small label. NOT keyboard-shortcutted to prevent accidental
               price entry. Click-only. */}
          <div className="pt-2 border-t border-slate-100">
            <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">
              Deep dive — exception controls
            </div>
            <div className="space-y-2">
              <div className="text-xs text-slate-600">
                <span className="font-medium">Custom price</span>
                <span className="text-slate-400">
                  &nbsp;— override RICS offer with an explicit price.
                </span>
              </div>
              <div className="text-[11px] text-slate-500 space-y-0.5">
                <div>
                  Current RICS offer:&nbsp;
                  <span className="font-mono text-slate-700">{fmt$(item.rics_offer)}</span>
                  &nbsp;·&nbsp;Recommended ({"-15%"}):&nbsp;
                  <span className="font-mono text-slate-700">
                    {fmt$(
                      typeof item.rics_retail === "number"
                        ? Math.round(item.rics_retail * 0.85 * 100) / 100
                        : null,
                    )}
                  </span>
                </div>
                <div>
                  MAP floor:&nbsp;
                  <span className="font-mono text-slate-700">
                    {item.map_price != null ? fmt$(item.map_price) : "—"}
                  </span>
                  {item.map_price != null && (
                    <span className="text-slate-400">
                      &nbsp;— price below MAP will be blocked unless it
                      exactly matches the floor.
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                    $
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={customPrice}
                    onChange={(e) => setCustomPrice(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !busy && !readOnly) {
                        e.preventDefault();
                        void runCustomPrice();
                      }
                    }}
                    placeholder="Override price"
                    disabled={readOnly || busy}
                    aria-label="Custom override price"
                    className="w-full pl-5 pr-2 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100 disabled:cursor-not-allowed"
                  />
                </div>
                <button
                  disabled={readOnly || busy || customPrice.trim() === ""}
                  onClick={() => void runCustomPrice()}
                  className="px-3 py-1.5 text-sm rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:bg-slate-300 disabled:cursor-not-allowed"
                >
                  Apply custom price
                </button>
              </div>
              <div className="text-[11px] text-slate-400 leading-tight">
                Step Override is not yet available — no buyer-scoped backend
                contract exists for manually changing cadence step.
              </div>
            </div>
          </div>

          {/* 7. Footer / cheatsheet */}
          <div className="text-[11px] text-slate-400 leading-tight">
            Keyboard:&nbsp;
            <kbd className="px-1 border border-slate-200 rounded">j</kbd>/<kbd className="px-1 border border-slate-200 rounded">k</kbd> next/prev,&nbsp;
            <kbd className="px-1 border border-slate-200 rounded">a</kbd>/<kbd className="px-1 border border-slate-200 rounded">d</kbd>/<kbd className="px-1 border border-slate-200 rounded">h</kbd> approve/reject/hold,&nbsp;
            <kbd className="px-1 border border-slate-200 rounded">Esc</kbd> close.
            <br />
            Decisions advance to next item automatically; drawer stays open
            until queue end or Esc. Custom price input is click-only (no
            keyboard shortcut) to prevent accidental entry.
          </div>
        </div>
      </div>
    </div>
  );
}

function fmt$(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}
function fmtPct(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}
