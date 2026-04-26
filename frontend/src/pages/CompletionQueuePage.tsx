import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  fetchProducts,
  fetchQueueStats,
  fetchSiteRegistry,
  type ProductListItem,
  type QueueStats,
  type SiteRegistryEntry,
} from "../lib/api";
import { useGridDensity } from "../hooks/useGridDensity";
import { useAuth } from "../contexts/AuthContext";

// Phase 4.4 §3.1.1 — keys are canonical site_key values.
const SITE_COLORS: Record<string, string> = {
  shiekh_com: "bg-blue-100 text-blue-800",
  karmaloop_com: "bg-green-100 text-green-800",
  mltd_com: "bg-purple-100 text-purple-800",
};

function siteBadge(
  siteOwner: string,
  registry: SiteRegistryEntry[] = []
) {
  const color = SITE_COLORS[siteOwner] || "bg-gray-100 text-gray-700";
  const entry = registry.find((r) => r.site_key === siteOwner);
  const label = entry?.display_name || siteOwner || "—";
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded ${color}`}>
      {label}
    </span>
  );
}

type SortKey = "priority" | "first_received_at" | "updated_at" | "completion_percent";

const DEFAULT_FILTERS = {
  completion_state: "incomplete",
  site_owner: "",
  brand: "",
  department: "",
  search: "",
};
const DEFAULT_SORT: SortKey = "priority";
const PAGE_SIZE = 25;

export default function CompletionQueuePage() {
  const { role } = useAuth();
  const isLead = role === "admin" || role === "owner" || role === "head_buyer";
  const [items, setItems] = useState<ProductListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [activeTab, setActiveTab] = useState<"queue" | "history">("queue");
  const [siteRegistry, setSiteRegistry] = useState<SiteRegistryEntry[]>([]);
  const [siteRegistryError, setSiteRegistryError] = useState(false);
  const [siteRegistryLoaded, setSiteRegistryLoaded] = useState(false);
  const { density, toggle: toggleDensity, isCompact } = useGridDensity(
    "completion-queue"
  );
  void density;

  // Load KPI stats
  useEffect(() => {
    fetchQueueStats().then(setStats).catch(() => {});
  }, []);

  // Phase 4.4 §3.1.1 — site filter options come from registry, active-only.
  // Phase 5 Pass 2 — explicit failure contracts:
  //   fetch-fails    → disabled select + error message
  //   empty-registry → disabled select + admin guidance
  //   stored-value orphaned → selected option still rendered, marked "(inactive)"
  useEffect(() => {
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

  const buildParams = useCallback(
    (): Record<string, string> => {
      const params: Record<string, string> = { sort, limit: String(PAGE_SIZE) };
      if (filters.completion_state) params.completion_state = filters.completion_state;
      if (filters.site_owner) params.site_owner = filters.site_owner;
      if (filters.brand) params.brand = filters.brand;
      if (filters.department) params.department = filters.department;
      if (filters.search) params.search = filters.search;
      return params;
    },
    [sort, filters]
  );

  // Load first page whenever filters or sort change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchProducts(buildParams())
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setTotal(data.total_count);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [buildParams]);

  const filtersDirty =
    sort !== DEFAULT_SORT ||
    (Object.keys(DEFAULT_FILTERS) as Array<keyof typeof DEFAULT_FILTERS>).some(
      (k) => filters[k] !== DEFAULT_FILTERS[k]
    );

  function resetFilters() {
    setSort(DEFAULT_SORT);
    setFilters(DEFAULT_FILTERS);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-4">Completion Queue</h1>

      {/* KPI Bar */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white dark:bg-gray-800 border rounded-lg p-3">
            <p className="text-xs text-gray-500 uppercase">Incomplete</p>
            <p className="text-2xl font-bold">{stats.total_incomplete}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 border rounded-lg p-3">
            <p className="text-xs text-gray-500 uppercase">Completed Today</p>
            <p className="text-2xl font-bold">{stats.completed_today}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 border rounded-lg p-3">
            <p className="text-xs text-gray-500 uppercase">My Completions</p>
            <p className="text-2xl font-bold">{stats.my_completions_today}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 border rounded-lg p-3">
            <p className="text-xs text-gray-500 uppercase">Team Edits Today</p>
            <p className="text-2xl font-bold">{stats.team_edits_today}</p>
          </div>
        </div>
      )}

      {/* Leaderboard + Brand Activity panels (admin/owner/head_buyer only) */}
      {isLead && stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Leaderboard */}
          <div className="bg-white dark:bg-gray-800 border rounded-lg p-4">
            <h3 className="text-sm font-semibold mb-2">Leaderboard (Today)</h3>
            {stats.leaderboard.length === 0 ? (
              <p className="text-xs text-gray-400">No completions yet today</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {stats.leaderboard.map((entry, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="truncate">{entry.name}</span>
                    <span className="font-mono font-bold">{entry.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* Brand Activity */}
          <div className="bg-white dark:bg-gray-800 border rounded-lg p-4">
            <h3 className="text-sm font-semibold mb-2">Products Added Today</h3>
            {stats.brands_added_today.length === 0 ? (
              <p className="text-xs text-gray-400">No new products today</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {stats.brands_added_today.slice(0, 10).map((mpn, i) => (
                  <li key={i} className="text-xs font-mono text-gray-600 dark:text-gray-300">{mpn}</li>
                ))}
                {stats.brands_added_today.length > 10 && (
                  <li className="text-xs text-gray-400">
                    +{stats.brands_added_today.length - 10} more
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Tab bar: Queue / History */}
      <div className="flex gap-4 border-b mb-4">
        <button
          onClick={() => setActiveTab("queue")}
          className={`pb-2 text-sm font-medium border-b-2 ${
            activeTab === "queue"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Queue
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`pb-2 text-sm font-medium border-b-2 ${
            activeTab === "history"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          History
        </button>
      </div>

      {activeTab === "history" ? (
        <div className="text-sm text-gray-500">
          <p className="mb-2">Recent activity from audit log:</p>
          {stats ? (
            <div className="space-y-2">
              <p><strong>{stats.team_edits_today}</strong> field edits today across <strong>{stats.products_edited_today}</strong> products</p>
              <p><strong>{stats.my_edits_today}</strong> of those are yours</p>
              <p><strong>{stats.completed_today}</strong> products completed today</p>
            </div>
          ) : (
            <p>Loading stats…</p>
          )}
        </div>
      ) : (
      <>

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

        <div className="flex flex-col">
          <select
            value={filters.site_owner}
            onChange={(e) => setFilters((p) => ({ ...p, site_owner: e.target.value }))}
            disabled={siteRegistryError || (siteRegistryLoaded && siteRegistry.length === 0)}
            className="border rounded px-3 py-1.5 text-sm disabled:bg-gray-100 disabled:text-gray-400"
            title={
              siteRegistryError
                ? "Could not load site list — site filter disabled."
                : siteRegistryLoaded && siteRegistry.length === 0
                ? "No active sites in registry — ask an admin to seed site_registry."
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
          <option value="first_received_at">First Received</option>
          <option value="updated_at">Last Modified</option>
          <option value="completion_percent">Completion %</option>
        </select>

        {filtersDirty && (
          <button
            type="button"
            onClick={resetFilters}
            className="px-3 py-1.5 text-sm text-gray-600 border rounded hover:bg-gray-50"
          >
            Reset Filters
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

      {/* Density toggle */}
      <div className="flex justify-end mb-2">
        <button
          onClick={toggleDensity}
          data-tour="density-toggle"
          className="text-xs text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800"
          title={`Switch to ${isCompact ? "comfortable" : "compact"} density`}
        >
          {isCompact ? "⊞ Comfortable" : "⊟ Compact"}
        </button>
      </div>

      {/* Table */}
      <div
        data-tour="completion-table"
        className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700"
      >
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-left">
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
              <tr
                key={p.doc_id}
                className={
                  "hover:bg-gray-50 dark:hover:bg-gray-800 " +
                  (isCompact ? "[&>td]:py-1" : "")
                }
              >
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
                <td className="px-3 py-2">{siteBadge(p.site_owner, siteRegistry)}</td>
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

      {/* Phase 3B — cursor-based "Load more" removed; queue page is
          first-page only until migrated to offset pagination. */}

      </>
      )}
    </div>
  );
}
