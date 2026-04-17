import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchDashboard, type DashboardResponse } from "../lib/api";

const KPI_DEFS: Record<
  string,
  { label: string; route: string; color: string }
> = {
  incomplete_count: { label: "Incomplete Products", route: "/queue/completion", color: "bg-blue-50 text-blue-800" },
  cadence_review_count: { label: "Cadence Review", route: "/cadence-review", color: "bg-amber-50 text-amber-800" },
  map_conflict_count: { label: "MAP Conflict Items", route: "/map-conflict-review", color: "bg-red-50 text-red-800" },
  pricing_discrepancy_count: { label: "Pricing Discrepancy", route: "/pricing-discrepancy", color: "bg-red-50 text-red-800" },
  site_verification_count: { label: "Site Verification", route: "/site-verification", color: "bg-purple-50 text-purple-800" },
};

function prettyFamily(f: string | null) {
  if (!f) return "—";
  if (f === "full-product" || f === "full_product") return "Full Product Import";
  if (f === "weekly-operations" || f === "weekly_operations") return "Weekly Operations";
  if (f === "map_policy") return "MAP Policy";
  if (f === "site_verification") return "Site Verification";
  return f;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchDashboard();
        setData(res);
      } catch (e: any) {
        setError(e?.error || e?.message || "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const hour = today.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading dashboard…</div>;
  if (error)
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded text-sm">{error}</div>
      </div>
    );
  if (!data) return null;

  const visibleKpis = Object.entries(data.kpis).filter(
    ([k]) => KPI_DEFS[k]
  );

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Greeting */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {greeting}, {data.greeting_name}
        </h1>
        <span className="text-sm text-gray-500">{dateStr}</span>
      </div>

      {/* Needs Attention */}
      <section>
        <h2 className="text-xs font-semibold uppercase text-gray-500 tracking-wide mb-2">
          Needs Attention
        </h2>
        {visibleKpis.length === 0 ? (
          <p className="text-sm text-gray-500 italic">
            No queues are scoped to your role.
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {visibleKpis.map(([key, count]) => {
              const def = KPI_DEFS[key];
              return (
                <Link
                  key={key}
                  to={def.route}
                  className={`block ${def.color} rounded-lg p-4 hover:shadow transition`}
                >
                  <div className="text-3xl font-bold">{count ?? 0}</div>
                  <div className="text-xs mt-1">{def.label}</div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent Activity */}
      <section>
        <h2 className="text-xs font-semibold uppercase text-gray-500 tracking-wide mb-2">
          Recent Activity
        </h2>
        <div className="bg-white border rounded divide-y text-sm">
          {data.recent_imports.length === 0 && data.recent_exports.length === 0 ? (
            <p className="p-3 text-gray-500 italic">No recent activity.</p>
          ) : (
            <>
              {data.recent_imports.map((b) => (
                <div key={b.batch_id} className="px-3 py-2 flex justify-between">
                  <span>
                    <span className="font-medium">Import:</span>{" "}
                    {prettyFamily(b.family)} — {b.committed_rows} rows
                  </span>
                  <span className="text-gray-500 text-xs">
                    {b.created_at ? new Date(b.created_at).toLocaleString() : ""}
                  </span>
                </div>
              ))}
              {data.recent_exports.map((j) => (
                <div key={j.job_id} className="px-3 py-2 flex justify-between">
                  <span>
                    <span className="font-medium">Export:</span> {j.kind || "—"} — {j.product_count} products
                  </span>
                  <span className="text-gray-500 text-xs">
                    {j.created_at ? new Date(j.created_at).toLocaleString() : ""}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </section>

      {/* Launch Alerts */}
      {data.high_priority_launches && data.high_priority_launches.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase text-gray-500 tracking-wide mb-2">
            Launch Alerts
          </h2>
          <div className="bg-white border rounded divide-y text-sm">
            {data.high_priority_launches.map((l, i) => (
              <div key={i} className="px-3 py-2 flex items-center justify-between">
                <span>
                  🚀 <span className="font-medium">{l.launch_name}</span> launching in{" "}
                  <span className="font-semibold">{l.days_remaining} days</span> — product incomplete (
                  <Link to={`/products/${encodeURIComponent(l.mpn)}`} className="text-blue-600 hover:underline font-mono">
                    {l.mpn}
                  </Link>
                  )
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* System Health */}
      <section>
        <h2 className="text-xs font-semibold uppercase text-gray-500 tracking-wide mb-2">
          System Health
        </h2>
        <div className="bg-white border rounded p-3 text-sm space-y-1">
          <div>
            {data.system_health.projections_stale ? "⚠️" : "✅"} Projections{" "}
            {data.system_health.projections_stale ? "stale" : "current"}
          </div>
          <div>
            {data.system_health.failed_jobs > 0 ? "⚠️" : "✅"}{" "}
            {data.system_health.failed_jobs > 0
              ? `${data.system_health.failed_jobs} failed jobs`
              : "No failed jobs"}
          </div>
          {typeof data.kpis.pricing_discrepancy_count === "number" &&
            data.kpis.pricing_discrepancy_count > 0 && (
              <div>
                ⚠️ {data.kpis.pricing_discrepancy_count} products in Pricing Discrepancy — action required
              </div>
            )}
        </div>
      </section>
    </div>
  );
}
