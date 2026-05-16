/**
 * Track 3 Cockpit V1 — Pricing discrepancy section.
 * TALLY-146 PR 2 — adds selection checkbox column for bulk markdown apply.
 *
 * NOTE: "Correct Pricing" requires corrected_rics_offer / corrected_scom inputs
 * not yet wired in V1 — only the safe "flag_for_review" action is exposed here.
 */
import { useState } from "react";
import { resolvePricingDiscrepancy } from "../../lib/api";
import type { CockpitPricingItem } from "../../lib/api";
import { useCockpitSelection } from "./cockpitSelection";

interface Props {
  items: CockpitPricingItem[];
  readOnly?: boolean;
  onAction: () => void;
}

export default function CockpitPricingSection({ items, readOnly, onAction }: Props) {
  const sel = useCockpitSelection();
  const allMpns = items.map((i) => i.mpn);
  const selectedCount = allMpns.filter((m) => sel.isSelected("pricing", m)).length;
  const allChecked = items.length > 0 && selectedCount === items.length;
  const someChecked = selectedCount > 0 && !allChecked;

  return (
    <section className="mb-6">
      <h2 className="text-lg font-semibold mb-2">Pricing Discrepancies ({items.length})</h2>
      {items.length === 0 ? (
        <div className="text-sm text-slate-500">No pricing discrepancies.</div>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-1 w-8">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = someChecked;
                    }}
                    onChange={(e) => sel.setMany("pricing", allMpns, e.target.checked)}
                    aria-label="Select all pricing items"
                  />
                </th>
                <th className="text-left px-2 py-1">MPN</th>
                <th className="text-left px-2 py-1">Name</th>
                <th className="text-right px-2 py-1">RICS</th>
                <th className="text-right px-2 py-1">SCOM</th>
                <th className="text-left px-2 py-1">Reason</th>
                <th className="text-right px-2 py-1">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <PricingRow key={it.mpn} item={it} readOnly={readOnly} onAction={onAction} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PricingRow({
  item,
  readOnly,
  onAction,
}: {
  item: CockpitPricingItem;
  readOnly?: boolean;
  onAction: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const sel = useCockpitSelection();
  const checked = sel.isSelected("pricing", item.mpn);

  async function flag() {
    if (readOnly || busy) return;
    setBusy(true);
    try {
      await resolvePricingDiscrepancy(item.mpn, {
        action: "flag_for_review",
        note: "Flagged from Cockpit V1",
      });
      onAction();
    } catch (e) {
      console.error("[cockpit pricing] action failed:", e);
      alert("Action failed. See console.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className={`border-t border-slate-100 ${checked ? "bg-blue-50/30" : ""}`}>
      <td className="px-2 py-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => sel.toggle("pricing", item.mpn)}
          aria-label={`Select ${item.mpn}`}
        />
      </td>
      <td className="px-2 py-2 font-mono text-xs">{item.mpn}</td>
      <td className="px-2 py-2">{item.name || "—"}</td>
      <td className="px-2 py-2 text-right">{item.rics_offer ?? "—"}</td>
      <td className="px-2 py-2 text-right">{item.scom ?? "—"}</td>
      <td className="px-2 py-2 text-xs text-slate-500">{item.reason || "—"}</td>
      <td className="px-2 py-2 text-right">
        <button
          disabled={readOnly || busy}
          onClick={flag}
          className="px-2 py-1 text-xs rounded bg-amber-500 text-white disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          Flag
        </button>
      </td>
    </tr>
  );
}
