/**
 * Track 3 Cockpit V1 — Cadence section.
 * TALLY-146 PR 2 — adds selection checkbox + reason badges + drawer trigger.
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

interface Props {
  items: CadenceReviewItem[];
  readOnly?: boolean;
  onAction: () => void;
  onOpenDrawer: (mpn: string) => void;
}

export default function CockpitCadenceSection({
  items,
  readOnly,
  onAction,
  onOpenDrawer,
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
}: {
  item: CadenceReviewItem;
  readOnly?: boolean;
  onAction: () => void;
  onOpenDrawer: (mpn: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const sel = useCockpitSelection();
  const checked = sel.isSelected("cadence", item.mpn);

  // TALLY-D2B — Phase 3.13 Primary/Support tier UI.
  // Explicit `=== false` check: admin-global rows have is_primary undefined
  // and should not be badged.
  const isSupport =
    item.is_primary === false && (item.support_user_ids?.length ?? 0) > 0;

  async function run(fn: () => Promise<unknown>) {
    if (readOnly || busy) return;
    setBusy(true);
    try {
      await fn();
      onAction();
    } catch (e) {
      console.error("[cockpit cadence] action failed:", e);
      alert("Action failed. See console.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`rounded border bg-white px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-slate-50 ${
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
        <div className="mt-1">
          <ReasonBadges ctx={item} surface="main" />
        </div>
        {isSupport && item.primary_display_name && (
          <div className="text-xs text-slate-500 mt-0.5">
            Shared by {item.primary_display_name}
          </div>
        )}
      </div>
      <div
        className="flex gap-1 flex-none"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          disabled={readOnly || busy || isSupport}
          onClick={() => run(() => buyerAction(item.mpn, "approve"))}
          className="px-2 py-1 text-xs rounded bg-emerald-600 text-white disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          Approve
        </button>
        <button
          disabled={readOnly || busy || isSupport}
          onClick={() => run(() => buyerAction(item.mpn, "deny"))}
          className="px-2 py-1 text-xs rounded bg-rose-600 text-white disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          Deny
        </button>
        <button
          disabled={readOnly || busy || isSupport}
          onClick={() => run(() => buyerHold(item.mpn, "Held from Cockpit V1"))}
          className="px-2 py-1 text-xs rounded bg-amber-500 text-white disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          Hold
        </button>
      </div>
    </div>
  );
}
