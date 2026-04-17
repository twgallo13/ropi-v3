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

function pctFmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

const CAP_OPTIONS = [
  "NO",
  "5",
  "10",
  "15",
  "20",
  "25",
  "30",
  "35",
  "40",
  "45",
  "50",
  "Final Sale",
];

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

  // Inline price adjustment (Approve Removal)
  const [newScom, setNewScom] = useState("");
  const [newScomSale, setNewScomSale] = useState("");
  const [newRicsOffer, setNewRicsOffer] = useState("");
  const [webDiscountCap, setWebDiscountCap] = useState("NO");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!action) return;
    setSubmitting(true);
    setError("");
    try {
      const body: any = { action, note };
      if (action === "defer") body.defer_days = deferDays;
      if (action === "approve_removal") {
        body.new_scom = newScom;
        body.new_scom_sale = newScomSale;
        body.new_rics_offer = newRicsOffer;
        body.web_discount_cap = webDiscountCap;
      }
      await resolveMapRemoval(item.mpn, body);
      onResolved();
    } catch (err: any) {
      setError(err?.error || err?.message || "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  function openApprove() {
    setAction("approve_removal");
    setNewScom(item.scom ? String(item.scom) : "");
    setNewScomSale("");
    setNewRicsOffer("");
    setWebDiscountCap("NO");
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

      <div className="grid grid-cols-2 gap-3 text-sm mt-3">
        <div>
          <h5 className="text-xs font-semibold text-gray-400 uppercase mb-1">
            Pricing
          </h5>
          <div>RICS Retail: <strong>{fmt(item.rics_retail)}</strong></div>
          <div>RICS Offer: <strong>{fmt(item.rics_offer)}</strong></div>
          <div>SCOM: <strong>{fmt(item.scom)}</strong></div>
          <div>SCOM Sale: <strong>{fmt(item.scom_sale)}</strong></div>
          <div className="mt-1 text-xs text-amber-700">
            Current MAP floor: <strong>{fmt(item.map_price)}</strong>
          </div>
        </div>
        <div>
          <h5 className="text-xs font-semibold text-gray-400 uppercase mb-1">
            KPIs
          </h5>
          <div>Total inv: <strong>{item.inventory_total} units</strong></div>
          <div>
            STR%:{" "}
            <strong>
              {pctFmt(item.str_pct != null ? item.str_pct * 100 : null)}
            </strong>
          </div>
          <div>
            WOS:{" "}
            <strong>{item.wos != null ? item.wos.toFixed(1) : "—"}</strong>
          </div>
          <div>GM%: <strong>{pctFmt(item.store_gm_pct)}</strong></div>
        </div>
      </div>

      <div className="text-xs text-gray-400 mt-2">
        Source batch:{" "}
        <code className="bg-gray-100 px-1 py-0.5 rounded">
          {item.map_removal_source_batch?.slice(0, 8) || "—"}
        </code>
      </div>

      <div className="mt-3 flex gap-2 flex-wrap">
        <button
          onClick={openApprove}
          className={`px-3 py-1.5 text-sm rounded border ${
            action === "approve_removal"
              ? "bg-red-600 text-white border-red-700"
              : "border-gray-300 hover:bg-gray-50"
          }`}
        >
          Approve Removal
        </button>
        <button
          onClick={() => setAction("keep_map")}
          className={`px-3 py-1.5 text-sm rounded border ${
            action === "keep_map"
              ? "bg-green-600 text-white border-green-700"
              : "border-gray-300 hover:bg-gray-50"
          }`}
        >
          Keep MAP
        </button>
        <button
          onClick={() => setAction("defer")}
          className={`px-3 py-1.5 text-sm rounded border ${
            action === "defer"
              ? "bg-blue-600 text-white border-blue-700"
              : "border-gray-300 hover:bg-gray-50"
          }`}
        >
          Defer
        </button>
      </div>

      {action === "approve_removal" && (
        <div className="mt-3 p-3 bg-gray-50 border rounded">
          <p className="text-xs font-semibold text-gray-600 mb-2">
            Set new prices after MAP removal:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <label className="flex items-center gap-2">
              <span className="w-36 text-xs text-gray-600">SCOM (web reg)</span>
              <input
                type="number"
                step="0.01"
                value={newScom}
                onChange={(e) => setNewScom(e.target.value)}
                placeholder="$"
                className="flex-1 border rounded px-2 py-1 text-sm"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="w-36 text-xs text-gray-600">SCOM Sale (web)</span>
              <input
                type="number"
                step="0.01"
                value={newScomSale}
                onChange={(e) => setNewScomSale(e.target.value)}
                placeholder="leave blank = no change"
                className="flex-1 border rounded px-2 py-1 text-sm"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="w-36 text-xs text-gray-600">RICS Offer (store)</span>
              <input
                type="number"
                step="0.01"
                value={newRicsOffer}
                onChange={(e) => setNewRicsOffer(e.target.value)}
                placeholder="leave blank = no change"
                className="flex-1 border rounded px-2 py-1 text-sm"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="w-36 text-xs text-gray-600">Web Discount Cap</span>
              <select
                value={webDiscountCap}
                onChange={(e) => setWebDiscountCap(e.target.value)}
                className="flex-1 border rounded px-2 py-1 text-sm"
              >
                {CAP_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o === "NO" || o === "Final Sale" ? o : `${o}%`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block mt-3">
            <span className="text-xs font-semibold text-gray-500 mb-1 block">
              Note
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full border rounded p-2 text-sm"
              placeholder="Optional note…"
            />
          </label>

          <div className="flex gap-2 mt-3">
            <button
              onClick={submit}
              disabled={submitting}
              className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            >
              {submitting
                ? "Submitting…"
                : "Confirm Removal & Queue for Export"}
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

      {(action === "keep_map" || action === "defer") && (
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
                onChange={(e) =>
                  setDeferDays(parseInt(e.target.value || "7", 10))
                }
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
          <h1 className="text-2xl font-bold text-gray-900">
            MAP Removal Review
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {items.length} product{items.length !== 1 ? "s" : ""} proposed for MAP
            removal
          </p>
        </div>
        <button
          onClick={load}
          className="text-sm border rounded px-3 py-1.5 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {loading && (
        <div className="text-center text-gray-400 py-12">Loading…</div>
      )}
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
