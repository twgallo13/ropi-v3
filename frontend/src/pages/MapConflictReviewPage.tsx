import { useEffect, useState, useCallback } from "react";
import {
  fetchMapConflicts,
  resolveMapConflict,
  type MapConflictItem,
} from "../lib/api";

type Action = "accept_map" | "request_buyer_map" | "flag_for_contact";

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function ConflictCard({
  item,
  onResolved,
}: {
  item: MapConflictItem;
  onResolved: () => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState("");
  const [cap, setCap] = useState("NO");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!action) return;
    setSubmitting(true);
    setError("");
    try {
      const body: any = { action, note };
      if (action === "request_buyer_map") body.web_discount_cap = cap;
      await resolveMapConflict(item.mpn, body);
      onResolved();
    } catch (err: any) {
      setError(err?.error || err?.message || "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white border-2 border-red-300 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="font-mono text-xs text-gray-500">{item.mpn}</span>
          <span className="mx-2 text-xs text-gray-400">·</span>
          <span className="text-xs font-medium text-gray-700">{item.brand}</span>
          <p className="text-sm font-medium text-gray-900 truncate">
            {item.name || item.mpn}
          </p>
        </div>
        <span className="bg-red-600 text-white text-xs font-bold px-3 py-1 rounded">
          ⚠️ MAP CONFLICT
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm mt-3">
        <div>
          <h5 className="text-xs font-semibold text-gray-400 uppercase mb-1">Current</h5>
          <div>SCOM: <strong>{fmt(item.scom)}</strong></div>
          <div>SCOM Sale: <strong>{fmt(item.scom_sale)}</strong></div>
          <div>RICS Offer: <strong>{fmt(item.rics_offer)}</strong></div>
        </div>
        <div>
          <h5 className="text-xs font-semibold text-gray-400 uppercase mb-1">MAP Floor</h5>
          <div>MAP: <strong className="text-amber-700">{fmt(item.map_price)}</strong></div>
          <div>Promo: <strong>{fmt(item.map_promo_price)}</strong></div>
        </div>
        <div>
          <h5 className="text-xs font-semibold text-gray-400 uppercase mb-1">Reason</h5>
          <div className="text-xs text-red-700">{item.map_conflict_reason || "—"}</div>
        </div>
      </div>

      <div className="mt-4 flex gap-2 flex-wrap">
        <button
          onClick={() => setAction("accept_map")}
          className={`px-3 py-1.5 text-sm rounded border ${
            action === "accept_map" ? "bg-green-600 text-white border-green-700" : "border-gray-300 hover:bg-gray-50"
          }`}
        >
          Accept MAP (scom = scom_sale = MAP)
        </button>
        <button
          onClick={() => setAction("request_buyer_map")}
          className={`px-3 py-1.5 text-sm rounded border ${
            action === "request_buyer_map" ? "bg-blue-600 text-white border-blue-700" : "border-gray-300 hover:bg-gray-50"
          }`}
        >
          In-Cart Promo (buyer cap)
        </button>
        <button
          onClick={() => setAction("flag_for_contact")}
          className={`px-3 py-1.5 text-sm rounded border ${
            action === "flag_for_contact" ? "bg-amber-600 text-white border-amber-700" : "border-gray-300 hover:bg-gray-50"
          }`}
        >
          Flag for Vendor Contact
        </button>
      </div>

      {action && (
        <div className="mt-3 p-3 bg-gray-50 border rounded">
          {action === "request_buyer_map" && (
            <div className="mb-3">
              <label className="text-xs font-semibold text-gray-500 mb-1 block">
                Web Discount Cap (in-cart %)
              </label>
              <select
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                className="border rounded px-2 py-1 text-sm"
              >
                {["NO", "5", "10", "15", "20", "25", "30"].map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
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
            placeholder="Optional resolution note…"
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

export default function MapConflictReviewPage() {
  const [items, setItems] = useState<MapConflictItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchMapConflicts();
      setItems(data.items);
    } catch (err: any) {
      setError(err?.error || err?.message || "Failed to load conflicts");
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
          <h1 className="text-2xl font-bold text-gray-900">MAP Conflict Review</h1>
          <p className="text-sm text-gray-500 mt-1">
            {items.length} product{items.length !== 1 ? "s" : ""} with an active MAP conflict
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
          No active MAP conflicts.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {items.map((item) => (
          <ConflictCard key={item.mpn} item={item} onResolved={load} />
        ))}
      </div>
    </div>
  );
}
