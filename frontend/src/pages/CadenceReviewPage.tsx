import { useEffect, useState } from "react";
import {
  fetchCadenceReview,
  buyerAction,
  buyerHold,
  buyerSaveForSeason,
  buyerPostponeReview,
  type CadenceReviewItem,
} from "../lib/api";
import { useGridDensity } from "../hooks/useGridDensity";

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}
function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  const v = n <= 1 ? n * 100 : n;
  return `${v.toFixed(1)}%`;
}

function ReviewCard({
  item,
  onAction,
}: {
  item: CadenceReviewItem;
  onAction: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustType, setAdjustType] = useState<"pct" | "dollar" | "price">("pct");
  const [adjustValue, setAdjustValue] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [snoozeDays, setSnoozeDays] = useState(7);
  const [returnDate, setReturnDate] = useState("");

  const aging =
    item.days_in_queue >= 28
      ? "border-red-400"
      : item.days_in_queue >= 14
      ? "border-amber-400"
      : "border-gray-200";

  async function run(fn: () => Promise<any>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      onAction();
    } catch (e: any) {
      setError(e?.error || e?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  const mapBlocker = item.map_conflict_active;

  return (
    <div className={`bg-white border-2 rounded-lg p-4 ${aging}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          <span className="font-mono text-xs text-gray-500">{item.mpn}</span>
          <span className="mx-2 text-xs text-gray-400">·</span>
          <span className="text-xs font-medium text-gray-700">{item.brand}</span>
          <p className="text-sm font-medium text-gray-900 truncate">
            {item.name || item.mpn}
          </p>
          <p className="text-xs text-gray-500">
            {item.department} › {item.class}
          </p>
        </div>
        <div className="text-right">
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded ${
              item.days_in_queue >= 28
                ? "bg-red-600 text-white"
                : item.days_in_queue >= 14
                ? "bg-amber-500 text-white"
                : "bg-gray-200 text-gray-700"
            }`}
          >
            {item.days_in_queue}d in queue
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs mt-3">
        <div>
          <h5 className="font-semibold text-gray-400 uppercase mb-1">Pricing</h5>
          <div>Retail: <strong>{fmt(item.rics_retail)}</strong></div>
          <div>Sale: <strong>{fmt(item.rics_offer)}</strong></div>
          <div>Web: <strong>{fmt(item.scom)}</strong></div>
          <div>
            MAP:{" "}
            <strong>
              {item.is_map_protected ? fmt(item.map_price) : "None"}
            </strong>
          </div>
        </div>
        <div>
          <h5 className="font-semibold text-gray-400 uppercase mb-1">Performance</h5>
          <div>STR%: <strong>{pct(item.str_pct)}</strong></div>
          <div>WOS: <strong>{item.wos != null ? `${item.wos.toFixed(1)} wks` : "—"}</strong></div>
          <div>GM%: <strong>{pct(item.store_gm_pct)}</strong></div>
          <div>Inv: <strong>{item.inventory_total} units</strong></div>
        </div>
        <div>
          <h5 className="font-semibold text-gray-400 uppercase mb-1">Recommendation</h5>
          <div>
            <strong>
              {item.recommendation.action_type === "markdown_pct"
                ? `↓ ${item.recommendation.value}% Markdown`
                : item.recommendation.action_type === "custom_price"
                ? `$${item.recommendation.value.toFixed(2)} Custom`
                : item.recommendation.action_type === "off_sale"
                ? "Off-Sale"
                : item.recommendation.action_type}
            </strong>
          </div>
          <div>Step {item.recommendation.step_number}</div>
          <div>New: {fmt(item.recommendation.new_rics_offer)}</div>
          <div>Export: {fmt(item.recommendation.export_rics_offer)}</div>
          {item.recommendation.new_scom_sale != null && (
            <div className="text-[11px] text-gray-500">
              Web Sale: {fmt(item.recommendation.new_scom_sale)}
            </div>
          )}
          <div className="text-[11px] text-gray-500 truncate">
            Rule: {item.recommendation.rule_name}
          </div>
        </div>
      </div>

      <div className="mt-3 bg-gray-50 rounded p-2">
        <h5 className="text-[11px] font-semibold text-gray-500 uppercase mb-1">
          Why this fired
        </h5>
        {item.recommendation.explanation.map((e, i) => (
          <div key={i} className="text-xs text-gray-700">• {e}</div>
        ))}
      </div>

      {mapBlocker && (
        <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
          MAP conflict active — resolve in MAP Conflict Review before approving.
        </p>
      )}

      <div className="mt-3 flex gap-2 flex-wrap">
        <button
          disabled={busy || mapBlocker}
          onClick={() => run(() => buyerAction(item.mpn, "approve"))}
          className="px-3 py-1.5 text-xs rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
        >
          ✓ Approve
        </button>
        <button
          disabled={busy}
          onClick={() => run(() => buyerAction(item.mpn, "deny"))}
          className="px-3 py-1.5 text-xs rounded border hover:bg-gray-50"
        >
          ✗ Deny
        </button>
        <button
          disabled={busy}
          onClick={() => setAdjustOpen(!adjustOpen)}
          className="px-3 py-1.5 text-xs rounded border hover:bg-gray-50"
        >
          ⚙ Adjust
        </button>
        <button
          disabled={busy}
          onClick={() => setShowMore(!showMore)}
          className="px-3 py-1.5 text-xs rounded border hover:bg-gray-50"
        >
          ⋯ More
        </button>
      </div>

      {adjustOpen && (
        <div className="mt-2 p-3 bg-gray-50 border rounded flex flex-wrap items-center gap-2 text-xs">
          <select
            value={adjustType}
            onChange={(e) => setAdjustType(e.target.value as any)}
            className="border rounded px-2 py-1"
          >
            <option value="pct">% off retail</option>
            <option value="dollar">$ off retail</option>
            <option value="price">exact price</option>
          </select>
          <input
            type="number"
            step="0.01"
            value={adjustValue}
            onChange={(e) => setAdjustValue(e.target.value)}
            placeholder="value"
            className="w-24 border rounded px-2 py-1"
          />
          <label className="flex items-center gap-1">
            effective:
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="border rounded px-1 py-0.5"
            />
          </label>
          <button
            disabled={busy || mapBlocker}
            onClick={() =>
              run(() =>
                buyerAction(item.mpn, "adjust", {
                  type: adjustType,
                  value: parseFloat(adjustValue) || 0,
                  effective_date: effectiveDate || null,
                })
              )
            }
            className="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Apply Adjust
          </button>
        </div>
      )}

      {showMore && (
        <div className="mt-2 p-3 bg-gray-50 border rounded flex flex-wrap items-center gap-2 text-xs">
          <button
            disabled={busy}
            onClick={() => run(() => buyerAction(item.mpn, "off_sale"))}
            className="px-3 py-1 text-xs rounded border hover:bg-gray-50"
          >
            Off-Sale
          </button>
          <button
            disabled={busy}
            onClick={() => run(() => buyerHold(item.mpn))}
            className="px-3 py-1 text-xs rounded border hover:bg-gray-50"
          >
            Hold
          </button>
          <label className="flex items-center gap-1">
            Return:
            <input
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
              className="border rounded px-1 py-0.5"
            />
            <button
              disabled={busy || !returnDate}
              onClick={() => run(() => buyerSaveForSeason(item.mpn, returnDate))}
              className="px-2 py-1 text-xs rounded border hover:bg-gray-50 disabled:opacity-50"
            >
              Save for Season
            </button>
          </label>
          <label className="flex items-center gap-1">
            Snooze:
            <input
              type="number"
              value={snoozeDays}
              onChange={(e) => setSnoozeDays(parseInt(e.target.value) || 7)}
              className="w-16 border rounded px-1 py-0.5"
            />
            days
            <button
              disabled={busy}
              onClick={() => run(() => buyerPostponeReview(item.mpn, snoozeDays))}
              className="px-2 py-1 text-xs rounded border hover:bg-gray-50"
            >
              Postpone
            </button>
          </label>
        </div>
      )}

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}

export default function CadenceReviewPage() {
  const [items, setItems] = useState<CadenceReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { toggle: toggleDensity, isCompact } = useGridDensity("cadence-review");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const d = await fetchCadenceReview();
      setItems(d.items);
    } catch (e: any) {
      setError(e?.error || e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cadence Review</h1>
          <p className="text-sm text-gray-500">
            {items.length} product{items.length !== 1 ? "s" : ""} awaiting action
          </p>
        </div>
        <button
          onClick={load}
          className="text-sm border rounded px-3 py-1.5 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      <div className="flex justify-end mb-2">
        <button
          onClick={toggleDensity}
          className="text-xs text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800"
          title={`Switch to ${isCompact ? "comfortable" : "compact"} density`}
        >
          {isCompact ? "⊞ Comfortable" : "⊟ Compact"}
        </button>
      </div>

      {loading && <div className="text-center text-gray-400 py-12">Loading…</div>}
      {error && <div className="text-center text-red-600 py-8">{error}</div>}
      {!loading && items.length === 0 && (
        <div className="text-center text-gray-400 py-12">
          No cadence recommendations in your queue.
        </div>
      )}

      <div className={isCompact ? "grid gap-2" : "grid gap-4"} data-tour="cadence-list">
        {items.map((i) => (
          <ReviewCard key={i.mpn} item={i} onAction={load} />
        ))}
      </div>
    </div>
  );
}
