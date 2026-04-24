import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
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

type SortKey = "first_received" | "last_modified" | "completion_pct";

const DEFAULT_FILTERS = {
  completion_state: "",
  site_owner: "",
  brand: "",
  department: "",
  search: "",
};
const DEFAULT_SORT: SortKey = "last_modified";
const PAGE_SIZE = 25;

export default function ProductListPage() {
  const { role } = useAuth();
  const isExport = role === "admin" || role === "owner" || role === "head_buyer";

  const [items, setItems] = useState<ProductListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [siteRegistry, setSiteRegistry] = useState<SiteRegistryEntry[]>([]);
  const [siteRegistryError, setSiteRegistryError] = useState(false);
  const [siteRegistryLoaded, setSiteRegistryLoaded] = useState(false);
  const [brandRegistry, setBrandRegistry] = useState<BrandRegistryEntry[]>([]);
  const [brandRegistryError, setBrandRegistryError] = useState(false);
  const [brandRegistryLoaded, setBrandRegistryLoaded] = useState(false);
  const [departmentRegistry, setDepartmentRegistry] = useState<DepartmentRegistryEntry[]>([]);
  const [departmentRegistryError, setDepartmentRegistryError] = useState(false);
  const [departmentRegistryLoaded, setDepartmentRegistryLoaded] = useState(false);

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

  const buildParams = useCallback(
    (pageCursor?: string | null): Record<string, string> => {
      const params: Record<string, string> = { sort, limit: String(PAGE_SIZE) };
      if (filters.completion_state) params.completion_state = filters.completion_state;
      if (filters.site_owner) params.site_owner = filters.site_owner;
      if (filters.brand) params.brand = filters.brand;
      if (filters.department) params.department = filters.department;
      if (filters.search) params.search = filters.search;
      if (pageCursor) params.cursor = pageCursor;
      return params;
    },
    [sort, filters]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchProducts(buildParams())
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setTotal(data.total);
        setCursor(data.next_cursor || null);
        setHasMore(!!data.next_cursor);
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

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const data = await fetchProducts(buildParams(cursor));
      setItems((prev) => [...prev, ...data.items]);
      setCursor(data.next_cursor || null);
      setHasMore(!!data.next_cursor);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }

  const filtersDirty =
    sort !== DEFAULT_SORT ||
    (Object.keys(DEFAULT_FILTERS) as Array<keyof typeof DEFAULT_FILTERS>).some(
      (k) => filters[k] !== DEFAULT_FILTERS[k]
    );

  function resetFilters() {
    setSort(DEFAULT_SORT);
    setFilters(DEFAULT_FILTERS);
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
          onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
          className="border rounded px-3 py-1.5 text-sm w-56"
        />

        <div className="flex flex-col">
          <select
            value={filters.brand}
            onChange={(e) => setFilters((p) => ({ ...p, brand: e.target.value }))}
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
            {filters.brand &&
              !brandRegistry.some((b) => b.brand_key === filters.brand) && (
                <option value={filters.brand}>
                  {filters.brand} (inactive)
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
            value={filters.department}
            onChange={(e) => setFilters((p) => ({ ...p, department: e.target.value }))}
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
            {filters.department &&
              !departmentRegistry.some((d) => d.key === filters.department) && (
                <option value={filters.department}>
                  {filters.department} (inactive)
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
            onChange={(e) => setFilters((p) => ({ ...p, site_owner: e.target.value }))}
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
          onChange={(e) => setFilters((p) => ({ ...p, completion_state: e.target.value }))}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="incomplete">Incomplete</option>
          <option value="complete">Complete</option>
        </select>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="last_modified">Last Modified</option>
          <option value="first_received">First Received</option>
          <option value="completion_pct">Completion %</option>
        </select>

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
          : `Showing ${items.length} of ${total} product${total === 1 ? "" : "s"}`}
      </p>

      {error && <p className="text-red-600 mb-3">{error}</p>}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">MPN</th>
              <th className="px-3 py-2 font-medium">Brand</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Department</th>
              <th className="px-3 py-2 font-medium">Site</th>
              <th className="px-3 py-2 font-medium">Completion</th>
              <th className="px-3 py-2 font-medium">Image</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((p) => (
              <tr key={p.doc_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className="px-3 py-2">
                  <Link
                    to={`/products/${encodeURIComponent(p.mpn)}`}
                    className="text-blue-600 hover:underline font-mono text-xs"
                  >
                    {p.mpn}
                  </Link>
                </td>
                <td className="px-3 py-2">{p.brand}</td>
                <td className="px-3 py-2 max-w-[200px] truncate">{p.name}</td>
                <td className="px-3 py-2">{p.department}</td>
                <td className="px-3 py-2">{p.site_owner}</td>
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

      {/* Load more */}
      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="mt-4 w-full py-2 border rounded text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {loadingMore ? "Loading…" : "Load more products"}
        </button>
      )}
    </div>
  );
}
