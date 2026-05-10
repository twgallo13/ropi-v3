/**
 * Track 3 Cockpit V1 — Cadence section.
 * Minimal V1: list + Approve / Deny / Hold buttons. Disabled when readOnly.
 */
import { useState } from "react";
import { buyerAction, buyerHold } from "../../lib/api";
import type { CadenceReviewItem } from "../../lib/api";

interface Props {
  items: CadenceReviewItem[];
  readOnly?: boolean;
  onAction: () => void;
}

export default function CockpitCadenceSection({ items, readOnly, onAction }: Props) {
  return (
    <section className="mb-6">
      <h2 className="text-lg font-semibold mb-2">Cadence Review ({items.length})</h2>
      {items.length === 0 ? (
        <div className="text-sm text-slate-500">No cadence items.</div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <CadenceRow key={it.mpn} item={it} readOnly={readOnly} onAction={onAction} />
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
}: {
  item: CadenceReviewItem;
  readOnly?: boolean;
  onAction: () => void;
}) {
  const [busy, setBusy] = useState(false);

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
    <div className="rounded border border-slate-200 bg-white p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <div className="text-sm">
        <div className="flex items-center gap-2 font-medium">
          <span>
            {item.name} <span className="text-slate-400">({item.mpn})</span>
          </span>
          {item.is_primary === true && (
            <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800">
              Primary
            </span>
          )}
          {isSupport && (
            <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">
              Support
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500">
          {item.brand} • {item.department} / {item.class} • Step {item.current_step} •{" "}
          {item.days_in_queue}d in queue
        </div>
        {isSupport && item.primary_display_name && (
          <div className="text-xs text-slate-500">
            Shared by {item.primary_display_name}
          </div>
        )}
      </div>
      <div className="flex gap-1">
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
