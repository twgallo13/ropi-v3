/**
 * Track 3 Cockpit V1 — MAP conflict section.
 * TALLY-146 PR 2 — adds selection checkbox column for bulk markdown apply.
 *
 * TALLY-155 — Optimistic UI + toast feedback. accept_map / flag_for_contact
 * actions emit success toast + hide row locally on success; failures keep
 * the row visible with inline rose error block. MAP_CONFLICT_BLOCKED renders
 * as a persistent dismiss-required toast per dispatch binding.
 */
import { useState } from "react";
import { resolveMapConflict } from "../../lib/api";
import type { MapConflictItem } from "../../lib/api";
import { useCockpitSelection } from "./cockpitSelection";
import { showToast } from "../../lib/toast";
import {
  extractErrorCode,
  extractErrorMessage,
  isPersistentErrorCode,
} from "../../lib/errorMessage";

interface Props {
  items: MapConflictItem[];
  readOnly?: boolean;
  onAction: () => void;
  onRowSuccess: (mpn: string) => void;
  onRowFailure: (mpn: string, errMsg: string) => void;
  getRowError: (mpn: string) => string | undefined;
  clearRowError: (mpn: string) => void;
}

const ACTION_LABEL: Record<"accept_map" | "flag_for_contact", string> = {
  accept_map: "Accept MAP",
  flag_for_contact: "Flag for Contact",
};

export default function CockpitMapSection({
  items,
  readOnly,
  onAction,
  onRowSuccess,
  onRowFailure,
  getRowError,
  clearRowError,
}: Props) {
  const sel = useCockpitSelection();
  const allMpns = items.map((i) => i.mpn);
  const selectedCount = allMpns.filter((m) => sel.isSelected("map", m)).length;
  const allChecked = items.length > 0 && selectedCount === items.length;
  const someChecked = selectedCount > 0 && !allChecked;

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">MAP Conflicts ({items.length})</h2>
        {items.length > 0 && (
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={allChecked}
              ref={(el) => {
                if (el) el.indeterminate = someChecked;
              }}
              onChange={(e) => sel.setMany("map", allMpns, e.target.checked)}
              aria-label="Select all MAP conflict items"
            />
            <span>Select all</span>
          </label>
        )}
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-slate-500">No MAP conflicts.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {items.map((it) => (
            <MapRow
              key={it.mpn}
              item={it}
              readOnly={readOnly}
              onAction={onAction}
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

function MapRow({
  item,
  readOnly,
  onAction,
  onRowSuccess,
  onRowFailure,
  rowError,
  clearRowError,
}: {
  item: MapConflictItem;
  readOnly?: boolean;
  onAction: () => void;
  onRowSuccess: (mpn: string) => void;
  onRowFailure: (mpn: string, errMsg: string) => void;
  rowError: string | undefined;
  clearRowError: (mpn: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const sel = useCockpitSelection();
  const checked = sel.isSelected("map", item.mpn);

  async function run(action: "accept_map" | "flag_for_contact") {
    if (readOnly || busy) return;
    setBusy(true);
    clearRowError(item.mpn);
    try {
      await resolveMapConflict(item.mpn, { action, note: "Resolved from Cockpit V1" });
      showToast({
        message: `${ACTION_LABEL[action]} succeeded for ${item.mpn}.`,
        variant: "success",
      });
      onRowSuccess(item.mpn);
      onAction();
    } catch (e) {
      console.error("[cockpit map] action failed:", e);
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
      className={`rounded border bg-white px-3 py-2 flex flex-col gap-2 ${
        checked ? "border-blue-300 bg-blue-50/30" : "border-slate-200"
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => sel.toggle("map", item.mpn)}
          aria-label={`Select ${item.mpn}`}
          className="mt-1 flex-none"
        />
        <div className="flex-1 min-w-0 leading-tight">
          <div className="text-sm font-medium truncate">
            {item.name} <span className="text-slate-400">({item.mpn})</span>
          </div>
          <div className="text-xs text-slate-500 mb-2">
            {item.brand} • MAP ${item.map_price} • SCOM ${item.scom} • RICS ${item.rics_offer}
          </div>
          <div className="flex gap-1">
            <button
              disabled={readOnly || busy}
              onClick={() => run("accept_map")}
              className="px-2 py-1 text-xs rounded bg-emerald-600 text-white disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              Accept MAP
            </button>
            <button
              disabled={readOnly || busy}
              onClick={() => run("flag_for_contact")}
              className="px-2 py-1 text-xs rounded bg-amber-500 text-white disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              Flag for Contact
            </button>
          </div>
        </div>
      </div>
      {rowError && (
        <div className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded px-2 py-1">
          {rowError}
        </div>
      )}
    </div>
  );
}
