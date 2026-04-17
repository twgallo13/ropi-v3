import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { fetchProducts, type ProductListItem } from "../lib/api";

const SITE_COLORS: Record<string, string> = {
  shiekh: "bg-blue-100 text-blue-800",
  karmaloop: "bg-green-100 text-green-800",
  mltd: "bg-purple-100 text-purple-800",
};

function siteBadge(siteOwner: string) {
  const key = siteOwner.toLowerCase();
  const color = SITE_COLORS[key] || "bg-gray-100 text-gray-700";
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded ${color}`}>
      {siteOwner}
    </span>
  );
}

type SortKey = "priority" | "first_received" | "last_modified" | "completion_pct";

export default function CompletionQueuePage() {
  const [items, setItems] = useState<ProductListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<SortKey>("priority");
  const [filters, setFilters] = useState({
    completion_state: "",
    site_owner: "",
    brand: "",
    department: "",
    search: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string> = { sort, limit: "50" };
      if (filters.completion_state) params.completion_state = filters.completion_state;
      if (filters.site_owner) params.site_owner = filters.site_owner;
      if (filters.brand) params.brand = filters.brand;
      if (filters.department) params.department = filters.department;
      if (filters.search) params.search = filters.search;
      const data = await fetchProducts(params);
      setItems(data.items);
      setTotal(data.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [sort, filters]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-4">Completion Queue</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={filters.completion_state}
          onChange={(e) => setFilters((p) => ({ ...p, completion_state: e.target.value }))}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">All States</option>
          <option value="incomplete">Incomplete</option>
          <option value="complete">Complete</option>
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

        <input
          type="text"
          placeholder="Brand…"
          value={filters.brand}
          onChange={(e) => setFilters((p) => ({ ...p, brand: e.target.value }))}
          className="border rounded px-3 py-1.5 text-sm w-36"
        />

        <input
          type="text"
          placeholder="Department…"
          value={filters.department}
          onChange={(e) => setFilters((p) => ({ ...p, department: e.target.value }))}
          className="border rounded px-3 py-1.5 text-sm w-40"
        />

        <input
          type="text"
          placeholder="Search MPN / name…"
          value={filters.search}
          onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
          className="border rounded px-3 py-1.5 text-sm w-56"
        />

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="priority">Priority</option>
          <option value="first_received">First Received</option>
          <option value="last_modified">Last Modified</option>
          <option value="completion_pct">Completion %</option>
        </select>
      </div>

      {/* Summary */}
      <p className="text-sm text-gray-500 mb-3">
        {loading ? "Loading…" : `${total} products`}
      </p>

      {error && <p className="text-red-600 mb-3">{error}</p>}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">MPN</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Brand</th>
              <th className="px-3 py-2 font-medium">Site</th>
              <th className="px-3 py-2 font-medium">Image</th>
              <th className="px-3 py-2 font-medium">Completion</th>
              <th className="px-3 py-2 font-medium">Priority</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((p) => (
              <tr key={p.doc_id} className="hover:bg-gray-50">
                <td className="px-3 py-2">
                  <Link
                    to={`/products/${encodeURIComponent(p.mpn)}`}
                    className="text-blue-600 hover:underline font-mono text-xs"
                  >
                    {p.mpn}
                  </Link>
                </td>
                <td className="px-3 py-2 max-w-[200px] truncate">{p.name}</td>
                <td className="px-3 py-2">{p.brand}</td>
                <td className="px-3 py-2">{siteBadge(p.site_owner)}</td>
                <td className="px-3 py-2">
                  <span
                    className={
                      p.image_status === "YES"
                        ? "text-green-600"
                        : "text-red-500"
                    }
                  >
                    {p.image_status}
                  </span>
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
                  {p.is_high_priority && (
                    <span
                      className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded mr-1"
                      title="Upcoming launch — high priority"
                    >
                      🚀 Launch in {p.launch_days_remaining}d
                    </span>
                  )}
                  {p.map_conflict_active && (
                    <span
                      className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded"
                      title="MAP conflict active"
                    >
                      MAP
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
