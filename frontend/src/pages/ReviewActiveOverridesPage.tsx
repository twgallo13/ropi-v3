/**
 * TALLY-SHIPPING-OVERRIDE-CLEANUP PR 2 — Review Active Overrides page.
 *
 * Mounted at /admin/pipeline/review-active-overrides. Lists products with
 * an active shipping override (standard_shipping_override IS NOT NULL OR
 * expedited_shipping_override IS NOT NULL) plus Office Rule defaults,
 * letting buyers / head_buyer / admin adjust or zero out per row.
 *
 * BE: GET /api/v1/review/active-overrides (PR 1.6, commit 6f38c8a,
 * squash-merged 62d4efc).
 *
 * Page-internal inline gate replaces a shared RoleGate wrapper because
 * the shared RoleGate at components/admin only admits admin|owner; this
 * page audience is buyer | head_buyer | admin per BE auth gate.
 */
import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  fetchActiveOverrideCandidates,
  fetchBrandRegistry,
  type ActiveOverrideCandidate,
  type ActiveOverrideSortBy,
  type BrandRegistryEntry,
} from "../lib/api";
import { ShippingOverrideAdjustPanel } from "../components/ShippingOverrideAdjustPanel";

// Page-local error formatter — matches existing 5-page convention
// (SopPanelsPage, FeatureTogglesPage, LaunchSettingsPage,
// AIProvidersListPage, SearchSettingsPage). NOT exported from
// components/admin barrel; per Frink F10 + memory rule 36 ext,
// intentional duplication is the dominant pattern.
// (Promotion to barrel + 5-page migration logged as separate
// follow-up: TALLY-ADMIN-FORMATTERROR-BARREL.)
function formatError(err: any): string {
  if (!err) return "Unknown error.";
  if (typeof err === "string") return err;
  return err.error || err.message || JSON.stringify(err);
}

// Office Rule defaults (PR 2.3)
const DEFAULT_DAYS_MIN = 30;
const DEFAULT_SALES_MAX = 1;
const DEFAULT_INVENTORY_MIN = 1;
const DEFAULT_BRAND_KEY = "";
const DEFAULT_SORT_BY: ActiveOverrideSortBy = "last_verified_at_asc";

function hostnameOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function fmtMoney(v: number | null): string {
  if (v === null) return "—";
  return `$${v}`;
}

export default function ReviewActiveOverridesPage() {
  const { loading: authLoading, role } = useAuth();
  if (authLoading) return null;
  if (role !== "buyer" && role !== "head_buyer" && role !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }

  return <ReviewActiveOverridesPageInner />;
}

function ReviewActiveOverridesPageInner() {
  // Filter state (PR 2.3)
  const [daysMin, setDaysMin] = useState<number>(DEFAULT_DAYS_MIN);
  const [salesMax, setSalesMax] = useState<number>(DEFAULT_SALES_MAX);
  const [inventoryMin, setInventoryMin] = useState<number>(DEFAULT_INVENTORY_MIN);
  const [brandKey, setBrandKey] = useState<string>(DEFAULT_BRAND_KEY);

  // Sort state (PR 2.4)
  const [sortBy, setSortBy] = useState<ActiveOverrideSortBy>(DEFAULT_SORT_BY);

  // Result state
  const [items, setItems] = useState<ActiveOverrideCandidate[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Brand registry for filter dropdown
  const [brandOptions, setBrandOptions] = useState<BrandRegistryEntry[]>([]);

  // Card grid panel toggle (PR 2.5)
  const [expandedMpn, setExpandedMpn] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchActiveOverrideCandidates({
        days_min: daysMin,
        sales_max: salesMax,
        inventory_min: inventoryMin,
        brand_key: brandKey || undefined,
        sort_by: sortBy,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch (e: any) {
      setError(formatError(e));
      setItems([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [daysMin, salesMax, inventoryMin, brandKey, sortBy]);

  // Brand registry: fetch once on mount (PR 2.3)
  useEffect(() => {
    fetchBrandRegistry(true)
      .then((brands) => setBrandOptions(brands))
      .catch(() => setBrandOptions([]));
  }, []);

  // Debounced re-query on filter change (300ms via setTimeout in deps array,
  // matches BuyerReviewPage convention — NOT a custom hook).
  // Sort change is included in `load` deps so any change triggers; sort
  // gets the same 300ms timer here, which is acceptable per dispatch
  // (sort: "no debounce" means no extra debounce; this single timer covers).
  useEffect(() => {
    const t = setTimeout(() => {
      load();
    }, 300);
    return () => clearTimeout(t);
  }, [load]);

  function handleResetFilters() {
    setDaysMin(DEFAULT_DAYS_MIN);
    setSalesMax(DEFAULT_SALES_MAX);
    setInventoryMin(DEFAULT_INVENTORY_MIN);
    setBrandKey(DEFAULT_BRAND_KEY);
  }

  function handleAdjustClick(mpn: string) {
    setExpandedMpn((cur) => (cur === mpn ? null : mpn));
  }

  function handlePanelCancel() {
    setExpandedMpn(null);
  }

  function handlePanelApplied() {
    setExpandedMpn(null);
    load();
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold mt-2 mb-1">📦 Review Active Overrides</h1>
      <p className="text-gray-600 mb-6">
        Review products with active shipping overrides set by ROPI ops. Adjust or zero out as needed.
      </p>

      {/* Filter bar: PR 2.3 */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Days since verified ≥</label>
            <input
              type="number"
              value={daysMin}
              onChange={(e) => setDaysMin(Number(e.target.value))}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Sales &lt;</label>
            <input
              type="number"
              value={salesMax}
              onChange={(e) => setSalesMax(Number(e.target.value))}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Inventory &gt;</label>
            <input
              type="number"
              value={inventoryMin}
              onChange={(e) => setInventoryMin(Number(e.target.value))}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Brand</label>
            <select
              value={brandKey}
              onChange={(e) => setBrandKey(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white"
            >
              <option value="">All brands</option>
              {brandOptions.map((b) => (
                <option key={b.brand_key} value={b.brand_key}>{b.display_name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={handleResetFilters}
            className="px-3 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50"
          >
            Reset to Office Rules
          </button>

          {/* Sort dropdown: PR 2.4 */}
          <label className="text-xs font-medium text-gray-700 ml-auto">Sort:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as ActiveOverrideSortBy)}
            className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
          >
            <option value="last_verified_at_asc">Oldest verified first</option>
            <option value="last_verified_at_desc">Newest verified first</option>
            <option value="mpn_asc">MPN A–Z</option>
            <option value="brand_asc">Brand A–Z</option>
            <option value="sales_asc">Sales (lowest)</option>
            <option value="inventory_desc">Inventory (highest)</option>
            <option value="std_shipping_desc">Std shipping (highest)</option>
            <option value="exp_shipping_desc">Exp shipping (highest)</option>
          </select>
        </div>
      </div>

      {/* Error banner */}
      {error !== null && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded flex items-start justify-between gap-2">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-700 hover:text-red-900 text-xs"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Loading / Empty / Card grid: PR 2.5 */}
      {isLoading ? (
        <div className="text-center text-gray-400 py-12">Loading…</div>
      ) : total === 0 ? (
        <div className="text-center text-gray-500 py-12">
          No products match the current filters. Try widening the filter range or click 'Reset to Office Rules'.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-gray-500">{total} candidate{total === 1 ? "" : "s"}</div>
          {items.map((c) => {
            const host = hostnameOf(c.product_url);
            const brandLetter = (
              host?.[0] ?? c.brand_display_name?.[0] ?? c.brand_key?.[0] ?? "?"
            ).toUpperCase();
            const isExpanded = expandedMpn === c.mpn;
            return (
              <div key={c.mpn} className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-start gap-4">
                  {/* Image */}
                  {c.primary_image_url ? (
                    <img
                      src={c.primary_image_url}
                      alt={c.name ?? c.mpn}
                      className="w-20 h-20 object-cover rounded border border-gray-200 flex-shrink-0"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded border border-gray-200 bg-gray-100 flex items-center justify-center text-gray-400 flex-shrink-0">
                      🖼
                    </div>
                  )}

                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Brand display */}
                      {c.brand_logo_url ? (
                        <img src={c.brand_logo_url} alt={c.brand_display_name ?? ""} className="h-5" />
                      ) : (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-gray-200 text-gray-700 text-xs font-medium">
                          {brandLetter}
                        </span>
                      )}
                      {c.brand_display_name && (
                        <span className="text-sm text-gray-700">{c.brand_display_name}</span>
                      )}
                      {/* Website link */}
                      {c.product_url && host && (
                        <a
                          href={c.product_url}
                          target="_blank"
                          rel="noopener"
                          className="text-sm text-blue-600 hover:underline"
                        >
                          {host}
                        </a>
                      )}
                    </div>
                    <div className="mt-1 text-sm font-medium text-gray-900">
                      {c.name ?? c.mpn}
                    </div>
                    <div className="mt-1 text-xs text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
                      <span>MPN: {c.mpn}</span>
                      <span>Inventory: {c.inventory_total}</span>
                      <span>Sales (30d): {c.sales_total}</span>
                      {c.days_since_verified !== null && (
                        <span>Days since verified: {c.days_since_verified}</span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-gray-700">
                      <div>Std: {fmtMoney(c.standard_shipping_override)}</div>
                      <div>Exp: {fmtMoney(c.expedited_shipping_override)}</div>
                    </div>
                  </div>

                  {/* Action */}
                  <div className="flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleAdjustClick(c.mpn)}
                      className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      {isExpanded ? "Close" : "Adjust"}
                    </button>
                  </div>
                </div>

                {/* Adjust panel mounting: PR 2.6 */}
                {isExpanded && (
                  <ShippingOverrideAdjustPanel
                    mpn={c.mpn}
                    currentStandard={c.standard_shipping_override}
                    currentExpedited={c.expedited_shipping_override}
                    onApplied={handlePanelApplied}
                    onCancel={handlePanelCancel}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
