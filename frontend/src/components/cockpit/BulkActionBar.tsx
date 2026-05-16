/**
 * TALLY-146 PR 2 — Sticky BulkActionBar.
 *
 * Marge placement (binding):
 *   Sticky at top of viewport, anchored directly under CockpitTabs.
 *   Slide-down 120ms when first selection appears; hidden when count === 0.
 *
 * Per-tab action menus:
 *   - cadence : Approve markdown / Reject markdown / Assign support buyer
 *   - map     : Approve markdown
 *   - pricing : Approve markdown
 *
 * Selection cap surface: server-side hard cap is 100 per request. Bar shows
 * "Max 100 per request" hint when count > 100 and disables Apply.
 */
import { useEffect, useMemo, useState } from "react";
import BulkConfirmModal, { type BulkActionKind } from "./BulkConfirmModal";
import {
  useCockpitSelection,
  type CockpitTabId,
} from "./cockpitSelection";
import { useAuth } from "../../contexts/AuthContext";
import { canCallBulkAssignSupport } from "../../lib/roleGates";

interface Props {
  activeTab: CockpitTabId;
  readOnly?: boolean;
  onCommitted: () => void;
}

const TAB_ACTIONS: Record<CockpitTabId, Array<{ kind: BulkActionKind["kind"]; label: string }>> = {
  cadence: [
    { kind: "markdown_approve", label: "Approve markdown" },
    // TALLY-146 PR 2 v2.5 Matt-VQA Fix #4: surface label canonicalized to "Deny".
    { kind: "markdown_reject", label: "Deny markdown" },
    { kind: "assign_support", label: "Assign support buyer" },
  ],
  map: [{ kind: "markdown_approve", label: "Approve markdown" }],
  pricing: [{ kind: "markdown_approve", label: "Approve markdown" }],
};

const HARD_CAP = 100;

export default function BulkActionBar({ activeTab, readOnly, onCommitted }: Props) {
  const sel = useCockpitSelection();
  const { role } = useAuth();
  const selected = sel.selectedFor(activeTab);
  const count = selected.length;

  // TALLY-146 PR 2 v2.5 — per-action role gate. The BE `bulk/assign-support`
  // endpoint (products.ts:1907) is `requireRole(["admin","owner"])`; the bar
  // dropdown was previously surfacing "Assign support buyer" to buyer +
  // head_buyer roles (Anomaly C in prior fix-up STOP). Filter it out at the
  // dropdown level via the canonical role-gate helper.
  const actions = useMemo(() => {
    const all = TAB_ACTIONS[activeTab];
    return all.filter((a) => {
      if (a.kind === "assign_support") return canCallBulkAssignSupport(role);
      return true;
    });
  }, [activeTab, role]);

  const [pendingAction, setPendingAction] =
    useState<BulkActionKind["kind"] | null>(actions[0]?.kind ?? null);
  const [modalAction, setModalAction] = useState<BulkActionKind | null>(null);

  // Keep pendingAction valid when active tab or available actions change.
  useEffect(() => {
    const valid = actions.some((a) => a.kind === pendingAction);
    if (!valid) setPendingAction(actions[0]?.kind ?? null);
  }, [activeTab, actions, pendingAction]);

  // Hide when nothing selected. Per Marge: anchored to viewport (sticky)
  // directly under CockpitTabs.
  if (count === 0) {
    return null;
  }

  const overCap = count > HARD_CAP;
  const canApply = !readOnly && !overCap && pendingAction !== null;

  function handleApply() {
    if (!canApply || !pendingAction) return;
    setModalAction({ kind: pendingAction } as BulkActionKind);
  }

  return (
    <>
      {/* Sticky directly under CockpitTabs. Slide-down 120ms on mount. */}
      <div
        className="sticky top-0 z-30 bg-white border border-slate-200 shadow-sm rounded-md mb-3 animate-[slideDownBar_120ms_ease-out]"
        role="region"
        aria-label="Bulk action bar"
        style={{
          // Inline keyframes so the bar slides in even if Tailwind config
          // doesn't include a matching utility; keeps PR 2 self-contained.
          animationName: "slideDownBar",
          animationDuration: "120ms",
          animationTimingFunction: "ease-out",
        }}
      >
        <style>{`@keyframes slideDownBar { from { transform: translateY(-8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
        <div className="flex items-center gap-2 px-3 py-2 text-sm">
          <span className="font-medium text-slate-700">
            {count} selected
          </span>
          {overCap && (
            <span className="text-xs text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded">
              Max {HARD_CAP} per request
            </span>
          )}
          <div className="flex-1" />
          <label className="text-xs text-slate-500" htmlFor="bulk-action-select">
            Action:
          </label>
          <select
            id="bulk-action-select"
            value={pendingAction ?? ""}
            onChange={(e) => setPendingAction(e.target.value as BulkActionKind["kind"])}
            disabled={readOnly}
            className="text-sm border border-slate-300 rounded px-2 py-1 bg-white disabled:bg-slate-100"
          >
            {actions.map((a) => (
              <option key={a.kind} value={a.kind}>
                {a.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleApply}
            disabled={!canApply}
            className="px-3 py-1 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => sel.clear(activeTab)}
            className="px-2 py-1 text-xs rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
            aria-label="Clear selection"
          >
            Clear
          </button>
        </div>
      </div>

      <BulkConfirmModal
        open={modalAction !== null}
        action={modalAction ?? { kind: "markdown_approve" }}
        mpns={selected}
        onClose={() => setModalAction(null)}
        onCommitted={() => {
          // Clear THIS tab's selection on a successful commit; parent
          // refetches cockpit data via onCommitted hook.
          sel.clear(activeTab);
          onCommitted();
        }}
      />
    </>
  );
}
