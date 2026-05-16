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
 * Hierarchy blocks (whitespace-separated, no dividers):
 *   1. Header  : MPN, name, brand
 *   2. Badges  : full taxonomy incl. MAP Protected
 *   3. Pricing : RICS retail / RICS offer / SCOM / SCOM sale / MAP floor
 *   4. Metrics : STR% / WOS / GM% (store, web) / inventory / days_in_queue
 *   5. Actions : Approve / Reject(Deny) / Hold (single-item, not bulk)
 *   6. Footer  : keyboard cheatsheet
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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const currentMpn = item?.mpn ?? null;
  const inlineError = currentMpn ? getRowError(currentMpn) : undefined;

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

          {/* 6. Footer / cheatsheet */}
          <div className="text-[11px] text-slate-400 leading-tight">
            Keyboard:&nbsp;
            <kbd className="px-1 border border-slate-200 rounded">j</kbd>/<kbd className="px-1 border border-slate-200 rounded">k</kbd> next/prev,&nbsp;
            <kbd className="px-1 border border-slate-200 rounded">a</kbd>/<kbd className="px-1 border border-slate-200 rounded">d</kbd>/<kbd className="px-1 border border-slate-200 rounded">h</kbd> approve/reject/hold,&nbsp;
            <kbd className="px-1 border border-slate-200 rounded">Esc</kbd> close.
            <br />
            Decisions advance to next item automatically; drawer stays open
            until queue end or Esc.
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
