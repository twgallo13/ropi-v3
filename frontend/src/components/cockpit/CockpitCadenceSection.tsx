/**
 * Track 3 Cockpit V1 — Cadence section.
 * TALLY-146 PR 2 — adds selection checkbox + reason badges + drawer trigger.
 *
 * TALLY-155 — Optimistic UI + toast feedback:
 *   - Single-item actions emit success toast + hide row locally; failures
 *     keep row visible with inline rose error block and an error toast.
 *   - alert("Action failed. See console.") removed.
 *
 * Density (PO Ratification #2):
 *   - Row padding capped at py-2.
 *   - Max 3 reason badges on main row; MAP Protected reserved for drawer only.
 *   - Inline metric pills (STR, Margin, etc) stay drawer-only — main row keeps
 *     the existing context line (brand • dept / class • step • days_in_queue).
 *
 * Interactions:
 *   - Click on row BODY  → opens drawer (onOpenDrawer).
 *   - Click on checkbox  → toggles per-tab selection (does not open drawer).
 *   - Click on action btn → runs single-item action (does not open drawer).
 */
import { useState } from "react";
import { buyerAction, buyerHold } from "../../lib/api";
import type { CadenceReviewItem } from "../../lib/api";
import ReasonBadges from "./ReasonBadge";
import { useCockpitSelection } from "./cockpitSelection";
import { showToast } from "../../lib/toast";
import {
  extractErrorCode,
  extractErrorMessage,
  isPersistentErrorCode,
} from "../../lib/errorMessage";

interface Props {
  items: CadenceReviewItem[];
  readOnly?: boolean;
  onAction: () => void;
  onOpenDrawer: (mpn: string) => void;
  onRowSuccess: (mpn: string) => void;
  onRowFailure: (mpn: string, errMsg: string) => void;
  getRowError: (mpn: string) => string | undefined;
  clearRowError: (mpn: string) => void;
}

export default function CockpitCadenceSection({
  items,
  readOnly,
  onAction,
  onOpenDrawer,
  onRowSuccess,
  onRowFailure,
  getRowError,
  clearRowError,
}: Props) {
  const sel = useCockpitSelection();
  const allMpns = items.map((i) => i.mpn);
  const selectedCount = allMpns.filter((m) => sel.isSelected("cadence", m)).length;
  const allChecked = items.length > 0 && selectedCount === items.length;
  const someChecked = selectedCount > 0 && !allChecked;

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">Cadence Review ({items.length})</h2>
        {items.length > 0 && (
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={allChecked}
              ref={(el) => {
                if (el) el.indeterminate = someChecked;
              }}
              onChange={(e) => sel.setMany("cadence", allMpns, e.target.checked)}
              aria-label="Select all cadence items"
            />
            <span>Select all</span>
          </label>
        )}
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-slate-500">No cadence items.</div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <CadenceRow
              key={it.mpn}
              item={it}
              readOnly={readOnly}
              onAction={onAction}
              onOpenDrawer={onOpenDrawer}
              onRowSuccess={onRowSuccess}
              onRowFailure={onRowFailure}
              rowError={getRowError(it.mpn)}
              clearRowError={clearRowError}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CadenceRow({
  item,
  readOnly,
  onAction,
  onOpenDrawer,
  onRowSuccess,
  onRowFailure,
  rowError,
  clearRowError,
}: {
  item: CadenceReviewItem;
  readOnly?: boolean;
  onAction: () => void;
  onOpenDrawer: (mpn: string) => void;
  onRowSuccess: (mpn: string) => void;
  onRowFailure: (mpn: string, errMsg: string) => void;
  rowError: string | undefined;
  clearRowError: (mpn: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const sel = useCockpitSelection();
  const checked = sel.isSelected("cadence", item.mpn);

  // TALLY-D2B — Phase 3.13 Primary/Support tier UI.
  // Explicit `=== false` check: admin-global rows have is_primary undefined
  // and should not be badged.
  const isSupport =
    item.is_primary === false && (item.support_user_ids?.length ?? 0) > 0;

  async function run(label: string, fn: () => Promise<unknown>) {
    if (readOnly || busy) return;
    setBusy(true);
    clearRowError(item.mpn);
    try {
      await fn();
      showToast({ message: `${label} succeeded for ${item.mpn}.`, variant: "success" });
      onRowSuccess(item.mpn);
      onAction();
    } catch (e) {
      console.error("[cockpit cadence] action failed:", e);
      const code = extractErrorCode(e);
      const msg = extractErrorMessage(e);
      onRowFailure(item.mpn, msg);
      showToast({
        message: msg,
        variant: "error",
        persistent: isPersistentErrorCode(code),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`rounded border bg-white px-3 py-2 flex flex-col gap-2 cursor-pointer hover:bg-slate-50 ${
        checked ? "border-blue-300 bg-blue-50/30" : "border-slate-200"
      }`}
      role="button"
      tabIndex={0}
      onClick={() => onOpenDrawer(item.mpn)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDrawer(item.mpn);
        }
      }}
      aria-label={`Open detail drawer for ${item.mpn}`}
    >
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => sel.toggle("cadence", item.mpn)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${item.mpn}`}
          className="flex-none"
        />
        <div className="flex-1 min-w-0 text-sm leading-tight">
          <div className="flex items-center gap-2 font-medium">
            <span className="truncate">
              {item.name} <span className="text-slate-400">({item.mpn})</span>
            </span>
            {item.is_primary === true && (
              <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800 flex-none">
                Primary
              </span>
            )}
            {isSupport && (
              <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 flex-none">
                Support
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500">
            {item.brand} • {item.department} / {item.class} • Step {item.current_step} •{" "}
            {item.days_in_queue}d in queue
          </div>
          {isSupport && item.primary_display_name && (
            <div className="text-xs text-slate-500 mt-0.5">
              Shared by {item.primary_display_name}
            </div>
          )}
        </div>
        {/*
          TALLY-146 PR 2 v2.5 Matt-VQA Fix #5 — CSS Guardrail #2.
          Reason Badges lifted out of the subtitle flow and placed in a dedicated
          right-aligned column so they align on the X-axis across rows. Fixed
          ~360px width accommodates up to 3 badges + a `+N more` overflow chip
          (per ReasonBadge.tsx density cap). `flex-none` keeps the middle text
          column truncating cleanly. py-2 row padding (Guardrail #1) and the
          clickable row affordance (Guardrail #3) are preserved.
        */}
        <div
          className="flex-none w-[360px] hidden md:flex justify-end items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <ReasonBadges ctx={item} surface="main" />
        </div>
        <div
          className="flex gap-1 flex-none"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            disabled={readOnly || busy || isSupport}
            onClick={() => run("Approve", () => buyerAction(item.mpn, "approve"))}
            className="px-2 py-1 text-xs rounded bg-emerald-600 text-white disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            Approve
          </button>
          <button
            disabled={readOnly || busy || isSupport}
            onClick={() => run("Deny", () => buyerAction(item.mpn, "deny"))}
            className="px-2 py-1 text-xs rounded bg-rose-600 text-white disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            Deny
          </button>
          <button
            disabled={readOnly || busy || isSupport}
            onClick={() => run("Hold", () => buyerHold(item.mpn, "Held from Cockpit V1"))}
            className="px-2 py-1 text-xs rounded bg-amber-500 text-white disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            Hold
          </button>
        </div>
      </div>
      {rowError && (
        <div
          className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded px-2 py-1"
          onClick={(e) => e.stopPropagation()}
        >
          {rowError}
        </div>
      )}
    </div>
  );
}
