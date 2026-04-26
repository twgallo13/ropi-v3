import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  fetchProducts,
  fetchSiteRegistry,
  fetchBrandRegistry,
  fetchDepartmentRegistry,
  type ProductListItem,
  type SiteRegistryEntry,
  type BrandRegistryEntry,
  type DepartmentRegistryEntry,
} from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import HoverImagePreview from "../components/HoverImagePreview";

// TALLY-PRODUCT-LIST-UX Phase 3B — temporal-only sort (PO Ruling Option 1,
// 2026-04-25). Three sortable columns: First Received, Last Modified,
// Completion %. MPN/Brand/Department/Site render as plain text headers.
// Sort tokens are now canonical (3A backend alias layer removed in 3B).
type SortKey = "first_received_at" | "updated_at" | "completion_percent";
type SortDir = "asc" | "desc";

const SORT_DEFAULT_DIR: Record<SortKey, SortDir> = {
  first_received_at: "asc",
  updated_at: "desc",
  completion_percent: "desc",
};
const SORT_LABEL: Record<SortKey, string> = {
  first_received_at: "First Received",
  updated_at: "Last Modified",
  completion_percent: "Completion %",
};
const SORTABLE_KEYS: SortKey[] = ["first_received_at", "updated_at", "completion_percent"];

const DEFAULT_FILTERS = {
  completion_state: "",
  site_owner: "",
  brand_key: "",
  department_key: "",
  search: "",
};
const DEFAULT_SORT: SortKey = "updated_at";
const DEFAULT_DIR: SortDir = SORT_DEFAULT_DIR[DEFAULT_SORT];
const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [25, 50, 100];

export default function ProductListPage() {
  const { role } = useAuth();
  const isExport = role === "admin" || role === "owner" || role === "head_buyer";

  // ── URL state (Phase 3B) ────────────────────────────────────────────
  // page, sort, dir, brand_key, department_key, completion_state,
  // site_owner, search live in the URL via useSearchParams. Browser
  // back/forward + bookmarking now naturally restore list state.
  // Mirrors AdminSettingsPage pattern.
  const [searchParams, setSearchParams] = useSearchParams();

  const sort: SortKey = (() => {
    const v = searchParams.get("sort");
    return SORTABLE_KEYS.includes(v as SortKey) ? (v as SortKey) : DEFAULT_SORT;
  })();
  const dir: SortDir = searchParams.get("dir") === "asc" ? "asc" : searchParams.get("dir") === "desc" ? "desc" : DEFAULT_DIR;
  const page: number = Math.max(parseInt(searchParams.get("page") || "1", 10) || 1, 1);
  const pageSize: number = (() => {
    const v = parseInt(searchParams.get("page_size") || "", 10);
    return PAGE_SIZE_OPTIONS.includes(v) ? v : DEFAULT_PAGE_SIZE;
  })();
  const filters = useMemo(
    () => ({
      completion_state: searchParams.get("completion_state") || "",
      site_owner: searchParams.get("site_owner") || "",
      brand_key: searchParams.get("brand_key") || "",
      department_key: searchParams.get("department_key") || "",
      search: searchParams.get("search") || "",
    }),
    [searchParams]
  );

  // updateParams: merge URL param patch; resetPage=true bumps to page=1.
  // Empty/null values strip the key. Single source of state mutation.
  const updateParams = useCallback(
    (patch: Record<string, string | number | null | undefined>, resetPage = false) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === undefined || v === "") next.delete(k);
          else next.set(k, String(v));
        }
        if (resetPage) next.delete("page");
        return next;
      }, { replace: false });
    },
    [setSearchParams]
  );

  const [items, setItems] = useState<ProductListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [siteRegistry, setSiteRegistry] = useState<SiteRegistryEntry[]>([]);
  const [siteRegistryError, setSiteRegistryError] = useState(false);
  const [siteRegistryLoaded, setSiteRegistryLoaded] = useState(false);
  const [brandRegistry, setBrandRegistry] = useState<BrandRegistryEntry[]>([]);
  const [brandRegistryError, setBrandRegistryError] = useState(false);
  const [brandRegistryLoaded, setBrandRegistryLoaded] = useState(false);
  const [departmentRegistry, setDepartmentRegistry] = useState<DepartmentRegistryEntry[]>([]);
  const [departmentRegistryError, setDepartmentRegistryError] = useState(false);
  const [departmentRegistryLoaded, setDepartmentRegistryLoaded] = useState(false);

  // TALLY-PRODUCT-LIST-UX Phase 2B — single-active-row hover preview.
  // Single state at the table level (no per-row independent state).
  // onMouseEnter/onFocus set hoveredMpn immediately; onMouseLeave/onBlur
  // start a ~100ms close timer that's cancelled if hover/focus re-enters.
  const [hoveredMpn, setHoveredMpn] = useState<string | null>(null);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleHoverEnter = useCallback((mpn: string) => {
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
    setHoveredMpn(mpn);
  }, []);
  const handleHoverLeave = useCallback(() => {
    if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = setTimeout(() => {
      setHoveredMpn(null);
      hoverCloseTimerRef.current = null;
    }, 100);
  }, []);
  useEffect(() => () => {
    if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current);
  }, []);

  useEffect(() => {
    // Phase 4.4 §3.1.1 — dropdown options sourced from site_registry, active-only.
    // Phase 5 Pass 2 — explicit failure contracts:
    //   fetch-fails    → disabled select + error message
    //   empty-registry → disabled select + admin guidance
    //   stored-value orphaned → selected option still rendered, marked "(inactive)"
    fetchSiteRegistry(true)
      .then((rows) => {
        setSiteRegistry(rows);
        setSiteRegistryError(false);
      })
      .catch(() => {
        setSiteRegistry([]);
        setSiteRegistryError(true);
      })
      .finally(() => setSiteRegistryLoaded(true));
  }, []);

  useEffect(() => {
    // TALLY-PRODUCT-LIST-UX Phase 1 — brand dropdown options sourced from
    // brand_registry, active-only. Same failure contract as site dropdown.
    fetchBrandRegistry(true)
      .then((rows) => {
        setBrandRegistry(rows);
        setBrandRegistryError(false);
      })
      .catch(() => {
        setBrandRegistry([]);
        setBrandRegistryError(true);
      })
      .finally(() => setBrandRegistryLoaded(true));
  }, []);

  useEffect(() => {
    // TALLY-PRODUCT-LIST-UX Phase 1 — department dropdown options sourced from
    // department_registry, active-only. Same failure contract as site dropdown.
    fetchDepartmentRegistry(true)
      .then((rows) => {
        setDepartmentRegistry(rows);
        setDepartmentRegistryError(false);
      })
      .catch(() => {
        setDepartmentRegistry([]);
        setDepartmentRegistryError(true);
      })
      .finally(() => setDepartmentRegistryLoaded(true));
  }, []);

  const buildParams = useCallback((): Record<string, string> => {
    const params: Record<string, string> = {
      sort,
      dir,
      limit: String(pageSize),
      page: String(page),
    };
    if (filters.completion_state) params.completion_state = filters.completion_state;
    if (filters.site_owner) params.site_owner = filters.site_owner;
    // Backend still accepts the wire-level keys `brand` / `department`
    // (canonical fields are brand_key/department_key on the document).
    if (filters.brand_key) params.brand = filters.brand_key;
    if (filters.department_key) params.department = filters.department_key;
    if (filters.search) params.search = filters.search;
    return params;
  }, [sort, dir, page, pageSize, filters]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchProducts(buildParams())
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setTotalCount(data.total_count);
        setTotalPages(data.total_pages);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [buildParams]);

  // ── Sort header click handler (Phase 3B) ────────────────────────────
  // Same column → flip dir. Different column → set to that column's
  // configured default dir. Always resets to page 1.
  const handleSortClick = useCallback((key: SortKey) => {
    if (key === sort) {
      updateParams({ dir: dir === "asc" ? "desc" : "asc" }, true);
    } else {
      updateParams({ sort: key, dir: SORT_DEFAULT_DIR[key] }, true);
    }
  }, [sort, dir, updateParams]);

  const filtersDirty =
    sort !== DEFAULT_SORT ||
    dir !== DEFAULT_DIR ||
    page !== 1 ||
    pageSize !== DEFAULT_PAGE_SIZE ||
    (Object.keys(DEFAULT_FILTERS) as Array<keyof typeof DEFAULT_FILTERS>).some(
      (k) => filters[k] !== DEFAULT_FILTERS[k]
    );

  function resetFilters() {
    setSearchParams(new URLSearchParams(), { replace: false });
  }

  function exportCsv() {
    const rows = items.map((p) => [
      p.mpn, p.brand, p.name, p.department, p.site_owner,
      p.completion_state, String(p.completion_progress.pct),
    ]);
    const header = ["MPN", "Brand", "Name", "Department", "Site", "Status", "Completion%"];
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `products-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Products</h1>
        {isExport && (
          <button
            onClick={exportCsv}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Export CSV
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search MPN / name / brand…"
          value={filters.search}
          onChange={(e) => updateParams({ search: e.target.value }, true)}
          className="border rounded px-3 py-1.5 text-sm w-56"
        />

        <div className="flex flex-col">
          <select
            value={filters.brand_key}
            onChange={(e) => updateParams({ brand_key: e.target.value }, true)}
            disabled={brandRegistryError || (brandRegistryLoaded && brandRegistry.length === 0)}
            className="border rounded px-3 py-1.5 text-sm disabled:bg-gray-100 disabled:text-gray-400"
            title={
              brandRegistryError
                ? "Could not load brand list \u2014 brand filter disabled."
                : brandRegistryLoaded && brandRegistry.length === 0
                ? "No active brands in registry \u2014 ask an admin to seed brand_registry."
                : undefined
            }
          >
            <option value="">All Brands</option>
            {brandRegistry.map((b) => (
              <option key={b.brand_key} value={b.brand_key}>{b.display_name}</option>
            ))}
            {filters.brand_key &&
              !brandRegistry.some((b) => b.brand_key === filters.brand_key) && (
                <option value={filters.brand_key}>
                  {filters.brand_key} (inactive)
                </option>
              )}
          </select>
          {brandRegistryError && (
            <span className="text-xs text-red-600 mt-1">Could not load brand list.</span>
          )}
          {!brandRegistryError && brandRegistryLoaded && brandRegistry.length === 0 && (
            <span className="text-xs text-amber-600 mt-1">
              No active brands — ask an admin to seed brand_registry.
            </span>
          )}
        </div>

        <div className="flex flex-col">
          <select
            value={filters.department_key}
            onChange={(e) => updateParams({ department_key: e.target.value }, true)}
            disabled={departmentRegistryError || (departmentRegistryLoaded && departmentRegistry.length === 0)}
            className="border rounded px-3 py-1.5 text-sm disabled:bg-gray-100 disabled:text-gray-400"
            title={
              departmentRegistryError
                ? "Could not load department list \u2014 department filter disabled."
                : departmentRegistryLoaded && departmentRegistry.length === 0
                ? "No active departments in registry \u2014 ask an admin to seed department_registry."
                : undefined
            }
          >
            <option value="">All Departments</option>
            {departmentRegistry.map((d) => (
              <option key={d.key} value={d.key}>{d.display_name}</option>
            ))}
            {filters.department_key &&
              !departmentRegistry.some((d) => d.key === filters.department_key) && (
                <option value={filters.department_key}>
                  {filters.department_key} (inactive)
                </option>
              )}
          </select>
          {departmentRegistryError && (
            <span className="text-xs text-red-600 mt-1">Could not load department list.</span>
          )}
          {!departmentRegistryError && departmentRegistryLoaded && departmentRegistry.length === 0 && (
            <span className="text-xs text-amber-600 mt-1">
              No active departments — ask an admin to seed department_registry.
            </span>
          )}
        </div>

        <div className="flex flex-col">
          <select
            value={filters.site_owner}
            onChange={(e) => updateParams({ site_owner: e.target.value }, true)}
            disabled={siteRegistryError || (siteRegistryLoaded && siteRegistry.length === 0)}
            className="border rounded px-3 py-1.5 text-sm disabled:bg-gray-100 disabled:text-gray-400"
            title={
              siteRegistryError
                ? "Could not load site list \u2014 site filter disabled."
                : siteRegistryLoaded && siteRegistry.length === 0
                ? "No active sites in registry \u2014 ask an admin to seed site_registry."
                : undefined
            }
          >
            <option value="">All Sites</option>
            {siteRegistry.map((s) => (
              <option key={s.site_key} value={s.site_key}>{s.display_name}</option>
            ))}
            {filters.site_owner &&
              !siteRegistry.some((s) => s.site_key === filters.site_owner) && (
                <option value={filters.site_owner}>
                  {filters.site_owner} (inactive)
                </option>
              )}
          </select>
          {siteRegistryError && (
            <span className="text-xs text-red-600 mt-1">Could not load site list.</span>
          )}
          {!siteRegistryError && siteRegistryLoaded && siteRegistry.length === 0 && (
            <span className="text-xs text-amber-600 mt-1">
              No active sites — ask an admin to seed site_registry.
            </span>
          )}
        </div>

        <select
          value={filters.completion_state}
          onChange={(e) => updateParams({ completion_state: e.target.value }, true)}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="incomplete">Incomplete</option>
          <option value="complete">Complete</option>
        </select>

        {/* Phase 3B \u2014 sort dropdown removed; sort is now header-driven
            (temporal-only per PO Ruling Option 1, 2026-04-25). */}

        {filtersDirty && (
          <button
            type="button"
            onClick={resetFilters}
            className="px-3 py-1.5 text-sm text-gray-600 border rounded hover:bg-gray-50"
          >
            Reset
          </button>
        )}
      </div>

      {/* Summary */}
      <p className="text-sm text-gray-500 mb-3">
        {loading
          ? "Loading…"
          : totalCount === 0
            ? "Showing 0 products"
            : `Showing ${(page - 1) * pageSize + 1}-${(page - 1) * pageSize + items.length} of ${totalCount} product${totalCount === 1 ? "" : "s"}`}
      </p>

      {error && <p className="text-red-600 mb-3">{error}</p>}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="min-w-full text-sm">
          {/* Phase 3B \u2014 sticky header (z-10). HoverImagePreview is z-50
              so the popup still renders above the sticky row. */}
          <thead className="bg-gray-50 dark:bg-gray-800 text-left sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 font-medium">MPN</th>
              <th className="px-3 py-2 font-medium">Brand</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Department</th>
              <th className="px-3 py-2 font-medium">Site</th>
              <SortableHeader sortKey="first_received_at" activeSort={sort} activeDir={dir} onClick={handleSortClick}>
                First Received
              </SortableHeader>
              <SortableHeader sortKey="updated_at" activeSort={sort} activeDir={dir} onClick={handleSortClick}>
                Last Modified
              </SortableHeader>
              <SortableHeader sortKey="completion_percent" activeSort={sort} activeDir={dir} onClick={handleSortClick}>
                Completion %
              </SortableHeader>
              <th className="px-3 py-2 font-medium">Image</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((p) => (
              <tr key={p.doc_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                {/* Phase 2B — MPN cell hosts hover/focus preview. `relative`
                    anchors the absolutely-positioned HoverImagePreview popup.
                    Focus handlers mirror mouse handlers for keyboard a11y. */}
                <td
                  className="px-3 py-2 relative"
                  onMouseEnter={() => handleHoverEnter(p.mpn)}
                  onMouseLeave={handleHoverLeave}
                  onFocus={() => handleHoverEnter(p.mpn)}
                  onBlur={handleHoverLeave}
                >
                  <Link
                    to={`/products/${encodeURIComponent(p.mpn)}`}
                    className="text-blue-600 hover:underline font-mono text-xs"
                  >
                    {p.mpn}
                  </Link>
                  <HoverImagePreview
                    imageUrl={p.primary_image_url}
                    imageStatus={p.image_status}
                    isVisible={hoveredMpn === p.mpn}
                    altText={p.name || p.mpn}
                  />
                </td>
                <td className="px-3 py-2">{p.brand}</td>
                <td className="px-3 py-2 max-w-[200px] truncate">{p.name}</td>
                <td className="px-3 py-2">{p.department}</td>
                <td className="px-3 py-2">{p.site_owner}</td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {p.first_received_at ? new Date(p.first_received_at).toLocaleDateString() : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {p.updated_at ? new Date(p.updated_at).toLocaleDateString() : "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-24 bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${
                          p.completion_progress.pct === 100
                            ? "bg-green-500"
                            : p.completion_progress.pct >= 50
                            ? "bg-yellow-500"
                            : "bg-red-500"
                        }`}
                        style={{ width: `${p.completion_progress.pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500">
                      {p.completion_progress.pct}%
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className={p.image_status === "YES" ? "text-green-600" : "text-red-500"}>
                    {p.image_status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination (Phase 3B) */}
      <div className="flex flex-wrap items-center gap-3 mt-4 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-gray-600">Rows per page:</span>
          <select
            value={pageSize}
            onChange={(e) => updateParams({ page_size: e.target.value }, true)}
            className="border rounded px-2 py-1 text-sm"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => updateParams({ page: 1 })}
            disabled={page <= 1 || loading}
            className="px-2 py-1 border rounded text-sm disabled:opacity-40"
          >
            «
          </button>
          <button
            type="button"
            onClick={() => updateParams({ page: Math.max(1, page - 1) })}
            disabled={page <= 1 || loading}
            className="px-2 py-1 border rounded text-sm disabled:opacity-40"
          >
            ‹ Prev
          </button>
          <span className="px-2 text-gray-600">
            Page {page} of {Math.max(1, totalPages)}
          </span>
          <button
            type="button"
            onClick={() => updateParams({ page: page + 1 })}
            disabled={page >= totalPages || loading}
            className="px-2 py-1 border rounded text-sm disabled:opacity-40"
          >
            Next ›
          </button>
          <button
            type="button"
            onClick={() => updateParams({ page: totalPages })}
            disabled={page >= totalPages || loading}
            className="px-2 py-1 border rounded text-sm disabled:opacity-40"
          >
            »
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SortableHeader (Phase 3B) ──────────────────────────────────────────
// Temporal-only sortable column header (PO Ruling Option 1, 2026-04-25).
// Renders as a button-styled <th> with arrow indicator when active.
function SortableHeader({
  sortKey,
  activeSort,
  activeDir,
  onClick,
  children,
}: {
  sortKey: SortKey;
  activeSort: SortKey;
  activeDir: SortDir;
  onClick: (key: SortKey) => void;
  children: React.ReactNode;
}) {
  const isActive = activeSort === sortKey;
  const arrow = isActive ? (activeDir === "asc" ? "↑" : "↓") : "↕";
  return (
    <th
      role="button"
      tabIndex={0}
      aria-sort={isActive ? (activeDir === "asc" ? "ascending" : "descending") : "none"}
      onClick={() => onClick(sortKey)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(sortKey);
        }
      }}
      className="px-3 py-2 font-medium cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-700"
      title={`Sort by ${SORT_LABEL[sortKey]}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <span className={`text-xs ${isActive ? "text-blue-600" : "text-gray-300"}`}>{arrow}</span>
      </span>
    </th>
  );
}
