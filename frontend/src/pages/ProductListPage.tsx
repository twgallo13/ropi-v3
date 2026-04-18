import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { fetchProducts, type ProductListItem } from "../lib/api";
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

        <select
          value={filters.brand}
          onChange={(e) => setFilters((p) => ({ ...p, brand: e.target.value }))}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">All Brands</option>
        </select>

        <select
          value={filters.department}
          onChange={(e) => setFilters((p) => ({ ...p, department: e.target.value }))}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">All Departments</option>
        </select>

        <select
          value={filters.site_owner}
          onChange={(e) => setFilters((p) => ({ ...p, site_owner: e.target.value }))}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">All Sites</option>
          <option value="shiekh">Shiekh</option>
          <option value="karmaloop">Karmaloop</option>
          <option value="mltd">MLTD</option>
          <option value="SHOES.COM">SHOES.COM</option>
        </select>

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
