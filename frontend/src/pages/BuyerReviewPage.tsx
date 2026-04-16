import { useEffect, useState, useCallback, useRef } from "react";
import {
  fetchBuyerReview,
  fetchPriceProjection,
  postBuyerAction,
  postLossLeaderAcknowledge,
  type BuyerReviewItem,
  type PriceProjection,
} from "../lib/api";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ── .99 rounding (client-side preview) ──
function apply99Rounding(price: number): number {
  if (price <= 0 || price < 1) return price;
  if (Math.round((price % 1) * 100) === 99) return price;
  return Math.floor(price) - 0.01;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function pctFmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

// ── Density ──
type Density = "comfortable" | "compact";
function loadDensity(): Density {
  return (localStorage.getItem("buyer-grid-density") as Density) || "comfortable";
}
function saveDensity(d: Density) {
  localStorage.setItem("buyer-grid-density", d);
}

// ── Adjust Popover ──
function AdjustPopover({
  item,
  onApply,
  onCancel,
}: {
  item: BuyerReviewItem;
  onApply: (adj: { type: string; value: number; effective_date?: string }) => void;
  onCancel: () => void;
}) {
  const [adjType, setAdjType] = useState<"pct" | "dollar" | "price">("pct");
  const [adjValue, setAdjValue] = useState("15");
  const [effectiveDate, setEffectiveDate] = useState("");

  const numVal = parseFloat(adjValue) || 0;
  let preview = 0;
  if (adjType === "pct") preview = item.rics_retail * (1 - numVal / 100);
  else if (adjType === "dollar") preview = item.rics_retail - numVal;
  else preview = numVal;
  preview = Math.round(preview * 100) / 100;
  const exportPreview = apply99Rounding(preview);

  return (
    <div className="mt-3 p-4 bg-gray-50 border rounded-lg">
      <h4 className="font-semibold text-sm mb-3">Adjust Markdown</h4>
      <div className="space-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" checked={adjType === "pct"} onChange={() => setAdjType("pct")} />
          <span className="w-24">Percentage:</span>
          <input
            type="number"
            className="border rounded px-2 py-1 w-20"
            value={adjType === "pct" ? adjValue : ""}
            onChange={(e) => { setAdjType("pct"); setAdjValue(e.target.value); }}
            placeholder="15"
          />
          <span>%</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={adjType === "dollar"} onChange={() => setAdjType("dollar")} />
          <span className="w-24">Dollar off:</span>
          <input
            type="number"
            className="border rounded px-2 py-1 w-20"
            value={adjType === "dollar" ? adjValue : ""}
            onChange={(e) => { setAdjType("dollar"); setAdjValue(e.target.value); }}
            placeholder="0"
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={adjType === "price"} onChange={() => setAdjType("price")} />
          <span className="w-24">New price:</span>
          <input
            type="number"
            className="border rounded px-2 py-1 w-20"
            value={adjType === "price" ? adjValue : ""}
            onChange={(e) => { setAdjType("price"); setAdjValue(e.target.value); }}
            placeholder="0"
          />
        </label>
        <div className="pt-2">
          <label className="text-xs text-gray-500">Effective date (optional — blank = immediate)</label>
          <input
            type="date"
            className="border rounded px-2 py-1 w-full mt-1"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
        </div>
        <div className="pt-2 flex gap-4 text-sm">
          <span>Preview: <strong>{fmt(preview)}</strong></span>
          <span>Export: <strong>{fmt(exportPreview)}</strong></span>
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          onClick={() =>
            onApply({
              type: adjType,
              value: numVal,
              ...(effectiveDate ? { effective_date: effectiveDate } : {}),
            })
          }
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

// ── Price Projection Chart ──
function PriceProjectionChart({ projection }: { projection: PriceProjection }) {
  const data = projection.steps.map((s) => ({
    name: s.label,
    price: s.rics_offer,
    exportPrice: s.export_price,
    gm: s.gm_pct,
    isBelowCost: s.is_below_cost,
  }));

  return (
    <div className="mt-3 p-3 bg-gray-50 border rounded">
      <h4 className="text-xs font-semibold text-gray-500 mb-2">Price Projection</h4>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data}>
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip
            formatter={(value: any, name: any) =>
              name === "gm" ? `${value}%` : `$${Number(value).toFixed(2)}`
            }
          />
          <ReferenceLine
            y={projection.below_cost_threshold}
            stroke="#ef4444"
            strokeDasharray="5 5"
            label={{ value: "Cost", fill: "#ef4444", fontSize: 10 }}
          />
          {projection.map_floor && (
            <ReferenceLine
              y={projection.map_floor}
              stroke="#f59e0b"
              strokeDasharray="5 5"
              label={{ value: "MAP", fill: "#f59e0b", fontSize: 10 }}
            />
          )}
          <Line type="monotone" dataKey="price" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
      {projection.cost_is_estimated && (
        <p className="text-xs text-amber-600 mt-1">⚠ Cost is estimated (50% of retail)</p>
      )}
    </div>
  );
}

// ── Loss Leader Acknowledge Modal ──
function LossLeaderAcknowledge({
  minChars,
  onSubmit,
  onCancel,
}: {
  mpn: string;
  minChars: number;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="mt-3 p-4 bg-red-50 border border-red-200 rounded-lg">
      <h4 className="font-semibold text-sm text-red-700 mb-2">
        Acknowledge Below-Cost Pricing
      </h4>
      <textarea
        className="w-full border rounded p-2 text-sm"
        rows={3}
        placeholder={`Explain why this below-cost price is necessary (min ${minChars} characters)…`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <p className="text-xs text-gray-500 mt-1">{reason.length}/{minChars} characters</p>
      <div className="flex gap-2 mt-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100">
          Cancel
        </button>
        <button
          onClick={() => onSubmit(reason)}
          disabled={reason.length < minChars}
          className={`px-3 py-1.5 text-sm rounded text-white ${
            reason.length >= minChars ? "bg-red-600 hover:bg-red-700" : "bg-gray-400 cursor-not-allowed"
          }`}
        >
          Acknowledge & Submit
        </button>
      </div>
    </div>
  );
}

// ── Product Card ──
function ProductCard({
  item,
  density,
  isFocused,
  onApprove,
  onDeny,
  onAdjust,
  onAcknowledge,
}: {
  item: BuyerReviewItem;
  density: Density;
  isFocused: boolean;
  onApprove: (mpn: string) => void;
  onDeny: (mpn: string) => void;
  onAdjust: (mpn: string, adj: { type: string; value: number; effective_date?: string }) => void;
  onAcknowledge: (mpn: string, reason: string) => void;
}) {
  const [showAdjust, setShowAdjust] = useState(false);
  const [showAcknowledge, setShowAcknowledge] = useState(false);
  const [projection, setProjection] = useState<PriceProjection | null>(null);
  const [error] = useState("");
  const isCompact = density === "compact";

  const loadProjection = useCallback(async () => {
    if (projection) return;
    try {
      const p = await fetchPriceProjection(item.mpn);
      setProjection(p);
    } catch { /* ignore */ }
  }, [item.mpn, projection]);

  const handleAdjustToggle = () => {
    setShowAdjust(!showAdjust);
    setShowAcknowledge(false);
    if (!showAdjust) loadProjection();
  };

  const isLossLeader = item.is_loss_leader;
  const borderClass = isLossLeader
    ? "border-red-400 animate-pulse"
    : isFocused
    ? "border-blue-500 ring-2 ring-blue-200"
    : "border-gray-200";

  const rec = item.recommendation;

  return (
    <div
      className={`bg-white border-2 rounded-lg ${borderClass} transition-all ${
        isCompact ? "p-3" : "p-4"
      }`}
      data-mpn={item.mpn}
      tabIndex={0}
    >
      {isLossLeader && (
        <div className="bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-t -mx-4 -mt-4 mb-3 text-center">
          ⚠️ NEGATIVE MARGIN — This price is below estimated cost
        </div>
      )}

      {/* Header */}
      <div className="flex items-start gap-3">
        <div className={`bg-gray-100 rounded flex items-center justify-center text-gray-400 text-xs ${
          isCompact ? "w-10 h-10" : "w-16 h-16"
        }`}>
          No Img
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-gray-500">{item.mpn}</span>
            <span className="text-xs text-gray-400">·</span>
            <span className="text-xs font-medium text-gray-700">{item.brand}</span>
          </div>
          <p className={`font-medium text-gray-900 truncate ${isCompact ? "text-xs" : "text-sm"}`}>
            {item.name || item.mpn}
          </p>
          <p className="text-xs text-gray-500">
            {item.department} › {item.class}
          </p>
          <div className="flex items-center gap-2 mt-1">
            {item.site_targets.map((st) => (
              <span key={st.site_id} className="text-xs text-blue-600">
                {st.domain} ↗
              </span>
            ))}
            <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
              Not Live
            </span>
          </div>
        </div>
        {item.days_in_queue > 0 && (
          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded shrink-0">
            {item.days_in_queue}d
          </span>
        )}
      </div>

      {/* KPI Grid */}
      <div className={`grid grid-cols-3 gap-3 ${isCompact ? "mt-2 text-xs" : "mt-4 text-sm"}`}>
        {/* Pricing */}
        <div>
          <h5 className="text-xs font-semibold text-gray-400 uppercase mb-1">Pricing</h5>
          <div className="space-y-0.5">
            <div>Retail: <strong>{fmt(item.rics_retail)}</strong></div>
            <div>Sale: <strong>{fmt(item.rics_offer)}</strong></div>
            <div>Web: <strong>{fmt(item.scom)}</strong></div>
            <div>MAP: <strong>{item.is_map_protected ? fmt(item.map_floor) : "None"}</strong></div>
          </div>
        </div>
        {/* Performance */}
        <div>
          <h5 className="text-xs font-semibold text-gray-400 uppercase mb-1">Performance</h5>
          <div className="space-y-0.5">
            <div>STR%: <strong>{pctFmt(item.str_pct)}</strong></div>
            <div>WOS: <strong>{item.wos != null ? item.wos.toFixed(1) : "—"}</strong></div>
            <div>GM%: <strong>{pctFmt(item.store_gm_pct)}</strong></div>
            <div>Inv: <strong>{item.inventory_total} units</strong></div>
          </div>
        </div>
        {/* Recommendation */}
        <div>
          <h5 className="text-xs font-semibold text-gray-400 uppercase mb-1">Recommendation</h5>
          <div className="space-y-0.5">
            <div className="text-blue-600 font-medium">↓ {rec.pct}% Markdown</div>
            <div>New: <strong>{fmt(rec.new_rics_offer)}</strong></div>
            <div>Export: <strong>{fmt(rec.export_price)}</strong></div>
            <div className="text-xs text-gray-400">{rec.rule_name.replace("Phase 1 Default — ", "")}</div>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-2 text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
          {error}
        </div>
      )}

      {/* MAP conflict blocker */}
      {item.map_conflict_active && (
        <div className="mt-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
          ⚠️ MAP conflict must be resolved before markdown
          {item.map_conflict_reason ? ` — ${item.map_conflict_reason}` : ""}
        </div>
      )}

      {/* Actions */}
      <div className={`flex items-center gap-2 ${isCompact ? "mt-2" : "mt-4"}`}>
        {isLossLeader ? (
          <button
            onClick={() => { setShowAcknowledge(true); setShowAdjust(false); loadProjection(); }}
            className="flex-1 px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700"
          >
            Acknowledge & Submit Reason
          </button>
        ) : (
          <>
            <button
              onClick={() => onApprove(item.mpn)}
              disabled={item.map_conflict_active}
              className={`px-3 py-1.5 rounded text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed ${
                isCompact ? "text-xs" : "text-sm"
              }`}
              title={item.map_conflict_active ? "MAP conflict must be resolved before markdown" : "Approve (A)"}
            >
              {isCompact ? "✓" : "✓ Approve"}
            </button>
            <button
              onClick={() => onDeny(item.mpn)}
              className={`px-3 py-1.5 rounded text-white bg-red-500 hover:bg-red-600 ${
                isCompact ? "text-xs" : "text-sm"
              }`}
              title="Deny (D)"
            >
              {isCompact ? "✗" : "✗ Deny"}
            </button>
            <button
              onClick={handleAdjustToggle}
              className={`px-3 py-1.5 rounded border hover:bg-gray-50 ${
                isCompact ? "text-xs" : "text-sm"
              } ${showAdjust ? "bg-blue-50 border-blue-300" : ""}`}
              title="Adjust"
            >
              {isCompact ? "⚙" : "⚙ Adjust ▾"}
            </button>
          </>
        )}
      </div>

      {/* Adjust Popover */}
      {showAdjust && (
        <AdjustPopover
          item={item}
          onCancel={() => setShowAdjust(false)}
          onApply={(adj) => {
            setShowAdjust(false);
            onAdjust(item.mpn, adj);
          }}
        />
      )}

      {/* Loss Leader Acknowledge */}
      {showAcknowledge && (
        <LossLeaderAcknowledge
          mpn={item.mpn}
          minChars={20}
          onCancel={() => setShowAcknowledge(false)}
          onSubmit={(reason) => {
            setShowAcknowledge(false);
            onAcknowledge(item.mpn, reason);
          }}
        />
      )}

      {/* Price Projection — auto-show for loss-leader or when adjust is open */}
      {projection && (showAdjust || isLossLeader) && (
        <PriceProjectionChart projection={projection} />
      )}
    </div>
  );
}

// ── Main Page ──
export default function BuyerReviewPage() {
  const [items, setItems] = useState<BuyerReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [density, setDensity] = useState<Density>(loadDensity);
  const [focusIndex, setFocusIndex] = useState(0);
  const [sort, setSort] = useState("aging");
  const [department, setDepartment] = useState("");
  const [brand, setBrand] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string> = { sort };
      if (department) params.department = department;
      if (brand) params.brand = brand;
      const data = await fetchBuyerReview(params);
      setItems(data.items);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [sort, department, brand]);

  useEffect(() => { load(); }, [load]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Don't capture when typing in inputs
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;

      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        if (items[focusIndex] && !items[focusIndex].is_loss_leader) {
          handleApprove(items[focusIndex].mpn);
        }
      }
      if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        if (items[focusIndex]) handleDeny(items[focusIndex].mpn);
      }
      if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) {
          setFocusIndex((i) => Math.max(0, i - 1));
        } else {
          setFocusIndex((i) => Math.min(items.length - 1, i + 1));
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [items, focusIndex]);

  // Focus management
  useEffect(() => {
    const cards = containerRef.current?.querySelectorAll("[data-mpn]");
    if (cards && cards[focusIndex]) {
      (cards[focusIndex] as HTMLElement).focus();
    }
  }, [focusIndex]);

  const removeCard = (mpn: string) => {
    setItems((prev) => prev.filter((i) => i.mpn !== mpn));
  };

  const handleApprove = async (mpn: string) => {
    removeCard(mpn); // optimistic
    try {
      await postBuyerAction({ mpn, action_type: "approve" });
    } catch (err: any) {
      // Re-insert on failure
      load();
    }
  };

  const handleDeny = async (mpn: string) => {
    removeCard(mpn);
    try {
      await postBuyerAction({ mpn, action_type: "deny" });
    } catch {
      load();
    }
  };

  const handleAdjust = async (
    mpn: string,
    adj: { type: string; value: number; effective_date?: string }
  ) => {
    removeCard(mpn);
    try {
      await postBuyerAction({ mpn, action_type: "adjust", adjustment: adj });
    } catch {
      load();
    }
  };

  const handleAcknowledge = async (mpn: string, reason: string) => {
    removeCard(mpn);
    try {
      await postLossLeaderAcknowledge({ mpn, reason });
    } catch {
      load();
    }
  };

  const toggleDensity = () => {
    const next = density === "comfortable" ? "compact" : "comfortable";
    setDensity(next);
    saveDensity(next);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Buyer Markdown Review</h1>
          <p className="text-sm text-gray-500 mt-1">
            {items.length} product{items.length !== 1 ? "s" : ""} awaiting review
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="text-sm border rounded px-2 py-1.5"
          >
            <option value="aging">Sort: Aging (oldest first)</option>
            <option value="str_asc">Sort: STR% (lowest first)</option>
            <option value="wos_desc">Sort: WOS (highest first)</option>
            <option value="gm_asc">Sort: GM% (lowest first)</option>
          </select>
          <button
            onClick={toggleDensity}
            className="text-sm border rounded px-3 py-1.5 hover:bg-gray-50"
            title={`Switch to ${density === "comfortable" ? "compact" : "comfortable"} view`}
          >
            {density === "comfortable" ? "Compact" : "Comfortable"}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Department filter…"
          className="text-sm border rounded px-3 py-1.5 w-44"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <input
          type="text"
          placeholder="Brand filter…"
          className="text-sm border rounded px-3 py-1.5 w-44"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button
          onClick={load}
          className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded hover:bg-blue-700"
        >
          Apply
        </button>
      </div>

      {/* Content */}
      {loading && (
        <div className="text-center text-gray-400 py-12">Loading buyer review queue…</div>
      )}
      {error && (
        <div className="text-center text-red-600 py-8">{error}</div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="text-center text-gray-400 py-12">
          No products in buyer review queue.
          <br />
          <span className="text-xs">
            Products need pricing_domain_state = "Pricing Current" AND completion_state = "complete"
          </span>
        </div>
      )}

      <div
        ref={containerRef}
        className={`grid gap-4 ${
          density === "compact" ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" : "grid-cols-1 md:grid-cols-2"
        }`}
      >
        {items.map((item, idx) => (
          <ProductCard
            key={item.mpn}
            item={item}
            density={density}
            isFocused={idx === focusIndex}
            onApprove={handleApprove}
            onDeny={handleDeny}
            onAdjust={handleAdjust}
            onAcknowledge={handleAcknowledge}
          />
        ))}
      </div>

      {/* Keyboard hint */}
      <div className="mt-6 text-center text-xs text-gray-400">
        Keyboard: <kbd className="px-1 bg-gray-100 rounded">A</kbd> Approve ·{" "}
        <kbd className="px-1 bg-gray-100 rounded">D</kbd> Deny ·{" "}
        <kbd className="px-1 bg-gray-100 rounded">Tab</kbd> Next ·{" "}
        <kbd className="px-1 bg-gray-100 rounded">Shift+Tab</kbd> Previous
      </div>
    </div>
  );
}
