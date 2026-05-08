/**
 * Track 3 Cockpit V1 — MAP conflict section.
 * Minimal V1: list + Accept MAP / Flag for Contact buttons. Disabled when readOnly.
 */
import { useState } from "react";
import { resolveMapConflict } from "../../lib/api";
import type { MapConflictItem } from "../../lib/api";

interface Props {
  items: MapConflictItem[];
  readOnly?: boolean;
  onAction: () => void;
}

export default function CockpitMapSection({ items, readOnly, onAction }: Props) {
  return (
    <section className="mb-6">
      <h2 className="text-lg font-semibold mb-2">MAP Conflicts ({items.length})</h2>
      {items.length === 0 ? (
        <div className="text-sm text-slate-500">No MAP conflicts.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {items.map((it) => (
            <MapRow key={it.mpn} item={it} readOnly={readOnly} onAction={onAction} />
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
}: {
  item: MapConflictItem;
  readOnly?: boolean;
  onAction: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function run(action: "accept_map" | "flag_for_contact") {
    if (readOnly || busy) return;
    setBusy(true);
    try {
      await resolveMapConflict(item.mpn, { action, note: "Resolved from Cockpit V1" });
      onAction();
    } catch (e) {
      console.error("[cockpit map] action failed:", e);
      alert("Action failed. See console.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="text-sm font-medium">
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
  );
}
