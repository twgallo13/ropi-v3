import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  fetchProducts,
  fetchSiteRegistry,
  fetchBrandRegistry,
  fetchDepartmentRegistry,
  bulkDeleteProducts,
  type ProductListItem,
  type SiteRegistryEntry,
  type BrandRegistryEntry,
  type DepartmentRegistryEntry,
  type BulkDeleteResponse,
} from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import HoverImagePreview from "../components/HoverImagePreview";
import QuickEditPanel from "../components/QuickEditPanel";
import { SiteBadge } from "../components/SiteBadge";

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
  // Phase 4A — bulk-delete is admin/owner only (matches backend
  // requireRole(["admin","owner"]) on POST /products/bulk-delete).
  const canBulkDelete = role === "admin" || role === "owner";

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

  // ── Phase 4A — Bulk-select state ────────────────────────────────────
  // Selection persists across page navigation (PO Ruling 4A.1) but is
  // auto-cleared when filters / sort / page-size change (see effect
  // below). Held in component state, NOT URL — selection is ephemeral.
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  // Typed-DELETE confirmation modal (PO Ruling 4A.2).
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [bulkInFlight, setBulkInFlight] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ batch: number; of: number } | null>(null);
  const [bulkBanner, setBulkBanner] = useState<{ kind: "success" | "warn" | "error"; text: string } | null>(null);
  // Header tri-state checkbox needs an imperative .indeterminate.
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);

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

  // ── Phase 4B — Quick Edit per-row side panel ────────────────────────
  // Single-instance panel keyed by MPN. Open via pencil button on a row;
  // close via Close button, backdrop click, or successful Save. Filter /
  // sort / page-size / page changes leave the panel open (PO ruling — the
  // panel is operating on the explicitly-chosen MPN, not the result set).
  const [editMpn, setEditMpn] = useState<string | null>(null);
  const [editToast, setEditToast] = useState<string | null>(null);

  const refetchAfterEdit = useCallback(async (mpn: string) => {
    try {
      const data = await fetchProducts(buildParams());
      setItems(data.items);
      setTotalCount(data.total_count);
      setTotalPages(data.total_pages);
      setEditToast(`Saved ${mpn}.`);
      setTimeout(() => setEditToast(null), 3000);
    } catch {
      // Refetch failure is non-fatal; user can manually refresh.
    }
  }, [buildParams]);

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

  // ── Phase 4A — auto-clear selection on filter/sort/page-size change ──
  // PO Ruling 4A.1: selection persists across page navigation but
  // clears whenever the result set itself changes meaning. Page
  // changes (within the same query) are intentionally NOT in the deps.
  useEffect(() => {
    setSelectedDocIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, [
    sort,
    dir,
    pageSize,
    filters.search,
    filters.brand_key,
    filters.department_key,
    filters.site_owner,
    filters.completion_state,
  ]);

  // ── Phase 4A — header tri-state checkbox sync ────────────────────────
  // Drives the imperative `indeterminate` flag based on how many of the
  // current page's items are selected.
  const currentPageDocIds = useMemo(() => items.map((p) => p.doc_id), [items]);
  const currentPageSelectedCount = useMemo(
    () => currentPageDocIds.filter((id) => selectedDocIds.has(id)).length,
    [currentPageDocIds, selectedDocIds]
  );
  const headerChecked =
    currentPageDocIds.length > 0 &&
    currentPageSelectedCount === currentPageDocIds.length;
  const headerIndeterminate =
    currentPageSelectedCount > 0 && currentPageSelectedCount < currentPageDocIds.length;
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = headerIndeterminate;
    }
  }, [headerIndeterminate]);

  const toggleRow = useCallback((docId: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  }, []);

  const togglePageSelection = useCallback(() => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      const allSelected = currentPageDocIds.every((id) => next.has(id));
      if (allSelected) {
        for (const id of currentPageDocIds) next.delete(id);
      } else {
        for (const id of currentPageDocIds) next.add(id);
      }
      return next;
    });
  }, [currentPageDocIds]);

  const clearSelection = useCallback(() => setSelectedDocIds(new Set()), []);

  // ── Phase 4A — typed-DELETE confirm flow ─────────────────────────────
  // Chunks the selection into batches of 100 (server cap), POSTs sequentially,
  // shows progress, and reports success / partial-fail / error via banner.
  const runBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedDocIds);
    if (ids.length === 0) return;
    const BATCH = 100;
    const totalBatches = Math.ceil(ids.length / BATCH);
    setBulkInFlight(true);
    setBulkBanner(null);
    setBulkProgress({ batch: 0, of: totalBatches });

    const allFailedDocIds = new Set<string>();
    let totalSucceeded = 0;
    let totalFailed = 0;
    let networkError = false;
    const opIds: string[] = [];

    for (let i = 0; i < totalBatches; i++) {
      setBulkProgress({ batch: i + 1, of: totalBatches });
      const slice = ids.slice(i * BATCH, (i + 1) * BATCH);
      try {
        const resp: BulkDeleteResponse = await bulkDeleteProducts(slice);
        opIds.push(resp.bulk_operation_id);
        totalSucceeded += resp.summary.succeeded;
        totalFailed += resp.summary.failed;
        for (const r of resp.results) {
          if (!r.ok) allFailedDocIds.add(r.doc_id);
        }
      } catch (e) {
        // Total network failure on this batch — mark slice as failed and
        // bail out so we don't keep hammering a broken endpoint.
        networkError = true;
        totalFailed += slice.length;
        for (const id of slice) allFailedDocIds.add(id);
        console.error("[bulk-delete] batch network error:", e);
        break;
      }
    }

    setBulkProgress(null);
    setBulkInFlight(false);

    if (networkError) {
      // PO Ruling 4A.2: total network failure → leave selection intact,
      // close modal, error banner.
      setConfirmOpen(false);
      setConfirmText("");
      setBulkBanner({
        kind: "error",
        text: `Bulk delete failed (network error). Selection preserved. Try again.`,
      });
      return;
    }

    if (totalFailed === 0) {
      // Full success → clear selection, close modal, refetch, success banner.
      setSelectedDocIds(new Set());
      setConfirmOpen(false);
      setConfirmText("");
      setBulkBanner({
        kind: "success",
        text: `Deleted ${totalSucceeded} product${totalSucceeded === 1 ? "" : "s"}.`,
      });
    } else {
      // Partial failure → keep failed in selection, close modal, refetch, warn.
      setSelectedDocIds(new Set(allFailedDocIds));
      setConfirmOpen(false);
      setConfirmText("");
      setBulkBanner({
        kind: "warn",
        text: `Deleted ${totalSucceeded} of ${totalSucceeded + totalFailed}; ${totalFailed} failed (still selected).`,
      });
    }

    // Refetch by bumping a URL no-op — but updateParams won't trigger a
    // refetch on identical params. Use a timestamp param? Simpler: just
    // re-run the fetch by clearing items and forcing the effect via a
    // small trick — toggle page if we deleted everything on this page,
    // otherwise rely on the navigation user will do. To be deterministic,
    // we manually re-run fetchProducts here.
    try {
      const data = await fetchProducts(buildParams());
      setItems(data.items);
      setTotalCount(data.total_count);
      setTotalPages(data.total_pages);
    } catch {
      // Refetch failure is non-fatal; user can manually refresh.
    }

    if (opIds.length > 0) {
      console.log(`[bulk-delete] bulk_operation_ids: ${opIds.join(", ")}`);
    }
  }, [selectedDocIds, buildParams]);

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

      {/* Phase 4A — bulk-delete result banner. */}
      {bulkBanner && (
        <div
          className={`mb-3 px-3 py-2 rounded text-sm flex items-center justify-between ${
            bulkBanner.kind === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : bulkBanner.kind === "warn"
              ? "bg-amber-50 text-amber-800 border border-amber-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          <span>{bulkBanner.text}</span>
          <button
            type="button"
            onClick={() => setBulkBanner(null)}
            className="text-xs underline ml-3"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Phase 4A — bulk action toolbar. Renders only when at least one
          row is selected. z-index intentionally low (default stacking)
          so HoverImagePreview (z-50) renders on top. Admin/owner only;
          non-admins see the checkboxes disabled (defense-in-depth — the
          backend is the real gate). */}
      {canBulkDelete && selectedDocIds.size > 0 && (
        <div className="mb-3 px-3 py-2 rounded bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 flex items-center justify-between text-sm">
          <span className="text-blue-900 dark:text-blue-200">
            <strong>{selectedDocIds.size}</strong> selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearSelection}
              className="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
            >
              Clear selection
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmText("");
                setConfirmOpen(true);
              }}
              className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700"
            >
              Delete selected
            </button>
          </div>
        </div>
      )}

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
              {/* Phase 4A — leftmost selection column (admin/owner only). */}
              {canBulkDelete && (
                <th className="px-3 py-2 font-medium w-8">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    aria-label="Select all on current page"
                    checked={headerChecked}
                    onChange={togglePageSelection}
                    disabled={items.length === 0}
                  />
                </th>
              )}
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
              {/* Phase 4B — Quick Edit pencil column. Rightmost so it's
                  always visible without horizontal scroll on narrow viewports. */}
              <th className="px-3 py-2 font-medium w-10" aria-label="Quick edit"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((p) => (
              <tr key={p.doc_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                {/* Phase 4A — per-row selection checkbox. stopPropagation
                    so clicking the checkbox does NOT trigger the MPN
                    link nav or the row hover preview. */}
                {canBulkDelete && (
                  <td className="px-3 py-2 w-8" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${p.mpn}`}
                      checked={selectedDocIds.has(p.doc_id)}
                      onChange={() => toggleRow(p.doc_id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                )}
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
                <td className="px-3 py-2"><SiteBadge siteKey={p.site_owner} registry={siteRegistry} /></td>
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
                {/* Phase 4B — pencil button. stopPropagation so the click
                    does NOT toggle the row checkbox or trigger the MPN
                    link / hover preview. */}
                <td className="px-3 py-2 w-10" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    aria-label={`Quick edit ${p.mpn}`}
                    title="Quick edit"
                    className="text-gray-500 hover:text-blue-600 px-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditMpn(p.mpn);
                    }}
                  >
                    {/* Inline pencil glyph (no extra icon library dep). */}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="w-4 h-4"
                      aria-hidden="true"
                    >
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM12.379 4.793l2.828 2.828L6.95 15.879a2 2 0 01-.879.515l-3.235.83.83-3.235a2 2 0 01.515-.879l8.198-8.317z"/>
                    </svg>
                  </button>
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

      {/* Phase 4A — typed-DELETE confirm modal (PO Ruling 4A.2).
          z-60 sits above HoverImagePreview (z-50) and the sticky header (z-10). */}
      {confirmOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-delete-title"
        >
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h2 id="bulk-delete-title" className="text-lg font-bold text-red-700 mb-2">
              Delete {selectedDocIds.size} product{selectedDocIds.size === 1 ? "" : "s"}?
            </h2>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
              This action is <strong>irreversible</strong>. Each product and all
              of its subcollections (attribute_values, pricing_snapshots,
              site_targets, comments, site_verification, content_versions,
              audit_log) will be permanently deleted. An audit_log entry will
              be written for each deletion.
            </p>
            <label className="block text-sm font-medium mb-1">
              Type <code className="px-1 bg-gray-100 dark:bg-gray-800 rounded">DELETE</code> to confirm:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoFocus
              disabled={bulkInFlight}
              className="border rounded px-3 py-1.5 text-sm w-full mb-3 dark:bg-gray-800"
              placeholder="DELETE"
            />
            {bulkProgress && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Deleting batch {bulkProgress.batch} of {bulkProgress.of}…
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmText("");
                }}
                disabled={bulkInFlight}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runBulkDelete}
                disabled={confirmText !== "DELETE" || bulkInFlight}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bulkInFlight ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase 4B — Quick Edit toast (success notification after panel close) */}
      {editToast && (
        <div className="fixed bottom-4 right-4 z-[70] bg-green-600 text-white px-4 py-2 rounded shadow-lg text-sm">
          {editToast}
        </div>
      )}

      {/* Phase 4B — Quick Edit side panel. Single-instance, keyed by MPN.
          z-60 so it sits above the sticky thead (z-10) and HoverImagePreview
          (z-50). Backdrop click + Close button + successful save all close
          the panel; partial-fail leaves it open with inline field errors. */}
      {editMpn && (
        <QuickEditPanel
          key={editMpn}
          mpn={editMpn}
          brandRegistry={brandRegistry}
          departmentRegistry={departmentRegistry}
          siteRegistry={siteRegistry}
          onClose={() => setEditMpn(null)}
          onSaved={refetchAfterEdit}
        />
      )}
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
