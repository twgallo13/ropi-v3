import { useEffect, useState, useCallback, useRef } from "react";
import {
  fetchBuyerReview,
  fetchPriceProjection,
  postBuyerAction,
  type BuyerReviewItem,
  type PriceProjection,
  type SiteVerificationEntry,
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
import HoverImagePreview from "../components/HoverImagePreview";

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

// ── Site verification helpers (Task 3) ─────────────────────────────
// Backend response shape for buyer-review rows:
//   site_verification: ordered map keyed by site_key (primary first, then by registry priority)
//   primary_site_key: string | null   (null = no primary, e.g. site_owner unset)
// Iterating Object.entries() on the map preserves the backend's order.

function siteEntries(item: BuyerReviewItem): SiteVerificationEntry[] {
  const sv = item.site_verification || {};
  return Object.values(sv);
}

// Subtask 3b — Primary image fallback hierarchy.
// 1. primary_site_key + non-null image_url → use it
// 2. first verified_live entry by priority (backend already sorted) with non-null image_url
// 3. {url:null, site_key:null} → no-image placeholder
function resolvePrimaryImage(item: BuyerReviewItem): {
  url: string | null;
  site_key: string | null;
} {
  const sv = item.site_verification || {};
  const primaryKey = item.primary_site_key;
  if (primaryKey && sv[primaryKey]?.image_url) {
    return { url: sv[primaryKey].image_url, site_key: primaryKey };
  }
  for (const entry of siteEntries(item)) {
    if (entry.verification_state === "verified_live" && entry.image_url) {
      return { url: entry.image_url, site_key: entry.site_key };
    }
  }
  return { url: null, site_key: null };
}

// Subtask 3e — Click resolves to primary product_url first, then any-site URL.
function resolvePrimaryProductUrl(item: BuyerReviewItem): {
  url: string | null;
  site_key: string | null;
} {
  const sv = item.site_verification || {};
  const primaryKey = item.primary_site_key;
  if (primaryKey && sv[primaryKey]?.product_url) {
    return { url: sv[primaryKey].product_url, site_key: primaryKey };
  }
  for (const entry of siteEntries(item)) {
    if (entry.product_url) {
      return { url: entry.product_url, site_key: entry.site_key };
    }
  }
  return { url: null, site_key: null };
}

// Subtask 3d — Per-site badge styling (color + text, never color-only).
// State color rules per §7.1.3 of the brief:
//   verified_live → green   mismatch → red   unverified/unknown → gray
function badgeClasses(state: string): string {
  switch (state) {
    case "verified_live":
      return "bg-green-100 text-green-800 border-green-300";
    case "mismatch":
      return "bg-red-100 text-red-800 border-red-300";
    case "stale":
      return "bg-amber-100 text-amber-800 border-amber-300";
    case "unverified":
    default:
      return "bg-gray-100 text-gray-600 border-gray-300";
  }
}

function badgeLabel(state: string): string {
  switch (state) {
    case "verified_live": return "Live";
    case "mismatch":      return "Mismatch";
    case "stale":         return "Stale";
    case "unverified":    return "Unverified";
    default:              return state;
  }
}

// Subtask 3c — Hover preview popover.
// TALLY-PRODUCT-LIST-UX Phase 2B (PO 2026-04-25): inline ImageHoverPreview
// lifted into shared component at components/HoverImagePreview. URL
// extraction stays here (BuyerReviewItem.site_verification is BuyerReview-
// specific). Open-delay preserved at 300ms via graceMs.

// ── Product Card ──
function ProductCard({
  item,
  density,
  isFocused,
  onApprove,
  onDeny,
  onAdjust,
}: {
  item: BuyerReviewItem;
  density: Density;
  isFocused: boolean;
  onApprove: (mpn: string) => void;
  onDeny: (mpn: string) => void;
  onAdjust: (mpn: string, adj: { type: string; value: number; effective_date?: string }) => void;
}) {
  const [showAdjust, setShowAdjust] = useState(false);
  const [projection, setProjection] = useState<PriceProjection | null>(null);
  const [error] = useState("");
  const isCompact = density === "compact";

  // Task 3 — image fallback + hover preview state.
  // Phase 2B: simplified to immediate hover/focus toggle; the shared
  // HoverImagePreview component owns the open-delay (graceMs).
  const primaryImage = resolvePrimaryImage(item);
  const primaryProductUrl = resolvePrimaryProductUrl(item);
  const hasImage = primaryImage.url !== null;
  const [isHovered, setIsHovered] = useState(false);

  const armHover = () => {
    if (!hasImage) return;
    setIsHovered(true);
  };
  const disarmHover = () => {
    setIsHovered(false);
  };

  const loadProjection = useCallback(async () => {
    if (projection) return;
    try {
      const p = await fetchPriceProjection(item.mpn);
      setProjection(p);
    } catch { /* ignore */ }
  }, [item.mpn, projection]);

  const handleAdjustToggle = () => {
    setShowAdjust(!showAdjust);
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
        {/* Subtask 3b/3c/3e/3f — image tile with fallback hierarchy + hover preview + click-through */}
        <div
          className="relative shrink-0"
          onMouseEnter={armHover}
          onMouseLeave={disarmHover}
        >
          {hasImage ? (
            primaryProductUrl.url ? (
              <a
                href={primaryProductUrl.url}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open product on ${primaryProductUrl.site_key ?? "site"} ↗`}
                className="block"
              >
                <img
                  src={primaryImage.url!}
                  alt={item.name || item.mpn}
                  className={`object-cover rounded border border-gray-200 bg-gray-50 ${
                    isCompact ? "w-10 h-10" : "w-16 h-16"
                  }`}
                  onError={(e) => {
                    // Hide broken image and fall back to placeholder; preserves trust
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              </a>
            ) : (
              <img
                src={primaryImage.url!}
                alt={item.name || item.mpn}
                title={`source: ${primaryImage.site_key ?? "site"} (no product URL available)`}
                className={`object-cover rounded border border-gray-200 bg-gray-50 ${
                  isCompact ? "w-10 h-10" : "w-16 h-16"
                }`}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            )
          ) : (
            // Subtask 3f — no-image trust preservation: gray tile + tooltip
            <div
              className={`bg-gray-100 rounded border border-gray-200 flex items-center justify-center text-gray-400 text-[10px] text-center leading-tight px-1 ${
                isCompact ? "w-10 h-10" : "w-16 h-16"
              }`}
              title="No image available — no verified site has an image_url for this product"
            >
              No image
              <br />
              available
            </div>
          )}
          {hasImage && primaryImage.url && (
            <HoverImagePreview
              imageUrl={primaryImage.url}
              imageStatus="YES"
              isVisible={isHovered}
              graceMs={300}
              altText={item.name || item.mpn}
              footerText={primaryImage.site_key ? `source: ${primaryImage.site_key}` : undefined}
            />
          )}
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
          {/* Subtask 3d — per-site badges, primary first then priority (backend order preserved) */}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {siteEntries(item).map((entry) => {
              const isPrimary = entry.site_key === item.primary_site_key;
              const tooltipParts = [
                `${entry.site_display_name || entry.site_key}: ${badgeLabel(entry.verification_state)}`,
              ];
              if (isPrimary) tooltipParts.push("(primary)");
              if (entry.mismatch_reason) tooltipParts.push(`reason: ${entry.mismatch_reason}`);
              if (entry.last_verified_at) tooltipParts.push(`last verified ${entry.last_verified_at}`);
              return (
                <span
                  key={entry.site_key}
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${badgeClasses(
                    entry.verification_state,
                  )} ${isPrimary ? "ring-1 ring-offset-0 ring-blue-300" : ""}`}
                  title={tooltipParts.join(" · ")}
                >
                  {entry.site_key}: {badgeLabel(entry.verification_state)}
                </span>
              );
            })}
          </div>
          {/* Compact site links row — preserves any-site URL access even when image is missing */}
          {!hasImage && primaryProductUrl.url && (
            <div className="mt-1">
              <a
                href={primaryProductUrl.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-blue-600 hover:underline"
                title={`Open on ${primaryProductUrl.site_key ?? "site"}`}
              >
                Open on {primaryProductUrl.site_key} ↗
              </a>
            </div>
          )}
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

      {/* Price Projection — shown when adjust is open */}
      {projection && showAdjust && (
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
        if (items[focusIndex]) {
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
      // Restore queue first — load() clears error as its first sync
      // statement, so setError must come AFTER load() resolves to avoid
      // being clobbered. PO 2026-05-08 / Frink Round 4.
      await load();
      setError(err?.error || err?.message || "Approve failed");
    }
  };

  const handleDeny = async (mpn: string) => {
    removeCard(mpn);
    try {
      await postBuyerAction({ mpn, action_type: "deny" });
    } catch (err: any) {
      // Restore queue first — load() clears error as its first sync
      // statement, so setError must come AFTER load() resolves to avoid
      // being clobbered. PO 2026-05-08 / Frink Round 4.
      await load();
      setError(err?.error || err?.message || "Deny failed");
    }
  };

  const handleAdjust = async (
    mpn: string,
    adj: { type: string; value: number; effective_date?: string }
  ) => {
    removeCard(mpn);
    try {
      await postBuyerAction({ mpn, action_type: "adjust", adjustment: adj });
    } catch (err: any) {
      // Restore queue first — load() clears error as its first sync
      // statement, so setError must come AFTER load() resolves to avoid
      // being clobbered. PO 2026-05-08 / Frink Round 4.
      await load();
      setError(err?.error || err?.message || "Adjust failed");
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
