import { useEffect, useState, useCallback } from "react";
import {
  fetchMapRemovals,
  resolveMapRemoval,
  type MapRemovalItem,
} from "../lib/api";

type Action = "approve_removal" | "keep_map" | "defer";

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function RemovalCard({
  item,
  onResolved,
}: {
  item: MapRemovalItem;
  onResolved: () => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState("");
  const [deferDays, setDeferDays] = useState(7);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!action) return;
    setSubmitting(true);
    setError("");
    try {
      const body: any = { action, note };
      if (action === "defer") body.defer_days = deferDays;
      await resolveMapRemoval(item.mpn, body);
      onResolved();
    } catch (err: any) {
      setError(err?.error || err?.message || "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white border-2 border-amber-300 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="font-mono text-xs text-gray-500">{item.mpn}</span>
          <span className="mx-2 text-xs text-gray-400">·</span>
          <span className="text-xs font-medium text-gray-700">{item.brand}</span>
          <p className="text-sm font-medium text-gray-900 truncate">
            {item.name || item.mpn}
          </p>
        </div>
        <span className="bg-amber-500 text-white text-xs font-bold px-3 py-1 rounded">
          MAP REMOVAL PROPOSED
        </span>
      </div>

      <div className="text-sm mt-2">
        Current MAP: <strong className="text-amber-700">{fmt(item.map_price)}</strong>
        <span className="mx-3 text-gray-400">·</span>
        Source batch:{" "}
        <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
          {item.map_removal_source_batch?.slice(0, 8) || "—"}
        </code>
      </div>

      <div className="mt-3 flex gap-2 flex-wrap">
        <button
          onClick={() => setAction("approve_removal")}
          className={`px-3 py-1.5 text-sm rounded border ${
            action === "approve_removal" ? "bg-red-600 text-white border-red-700" : "border-gray-300 hover:bg-gray-50"
          }`}
        >
          Approve Removal
        </button>
        <button
          onClick={() => setAction("keep_map")}
          className={`px-3 py-1.5 text-sm rounded border ${
            action === "keep_map" ? "bg-green-600 text-white border-green-700" : "border-gray-300 hover:bg-gray-50"
          }`}
        >
          Keep MAP
        </button>
        <button
          onClick={() => setAction("defer")}
          className={`px-3 py-1.5 text-sm rounded border ${
            action === "defer" ? "bg-blue-600 text-white border-blue-700" : "border-gray-300 hover:bg-gray-50"
          }`}
        >
          Defer
        </button>
      </div>

      {action && (
        <div className="mt-3 p-3 bg-gray-50 border rounded">
          {action === "defer" && (
            <div className="mb-3">
              <label className="text-xs font-semibold text-gray-500 mb-1 block">
                Defer days
              </label>
              <input
                type="number"
                min={1}
                max={90}
                value={deferDays}
                onChange={(e) => setDeferDays(parseInt(e.target.value || "7", 10))}
                className="border rounded px-2 py-1 text-sm w-24"
              />
            </div>
          )}
          <label className="text-xs font-semibold text-gray-500 mb-1 block">
            Note
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full border rounded p-2 text-sm"
            placeholder="Optional note…"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={submit}
              disabled={submitting}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
            <button
              onClick={() => setAction(null)}
              className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
        </div>
      )}
    </div>
  );
}

export default function MapRemovalReviewPage() {
  const [items, setItems] = useState<MapRemovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchMapRemovals();
      setItems(data.items);
    } catch (err: any) {
      setError(err?.error || err?.message || "Failed to load removals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">MAP Removal Review</h1>
          <p className="text-sm text-gray-500 mt-1">
            {items.length} product{items.length !== 1 ? "s" : ""} proposed for MAP removal
          </p>
        </div>
        <button
          onClick={load}
          className="text-sm border rounded px-3 py-1.5 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {loading && <div className="text-center text-gray-400 py-12">Loading…</div>}
      {error && <div className="text-center text-red-600 py-8">{error}</div>}
      {!loading && items.length === 0 && (
        <div className="text-center text-gray-400 py-12">
          No MAP removals pending review.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {items.map((item) => (
          <RemovalCard key={item.mpn} item={item} onResolved={load} />
        ))}
      </div>
    </div>
  );
}
