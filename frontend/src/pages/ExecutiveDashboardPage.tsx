import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import {
  fetchExecutiveHealth,
  fetchOperatorThroughput,
  type ExecutiveHealth,
  type ThroughputResponse,
} from "../lib/api";

function money(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `$${Number(n).toFixed(2)}`;
}
function pct(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `${Number(n).toFixed(1)}%`;
}

function strTone(value: number, avg: number) {
  if (value >= avg * 1.1) return { bar: "bg-green-500", label: "🟢 Above avg" };
  if (value >= avg * 0.9) return { bar: "bg-amber-500", label: "🟡 Average" };
  return { bar: "bg-red-500", label: "🔴 Below avg" };
}

export default function ExecutiveDashboardPage() {
  const [health, setHealth] = useState<ExecutiveHealth | null>(null);
  const [throughput, setThroughput] = useState<ThroughputResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [h, t] = await Promise.all([
          fetchExecutiveHealth(),
          fetchOperatorThroughput().catch(() => null),
        ]);
        setHealth(h);
        setThroughput(t);
      } catch (e: any) {
        setError(e?.message || "Failed to load executive dashboard");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;
  if (!health) return null;

  const thisMonth = health.products_added_this_month;
  const lastMonth = health.products_added_last_month;
  const momPct =
    lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : null;

  const strAvg =
    health.str_heatmap.length > 0
      ? health.str_heatmap.reduce((s, x) => s + x.str_pct, 0) /
        health.str_heatmap.length
      : 0;
  const strMax =
    health.str_heatmap.length > 0
      ? Math.max(...health.str_heatmap.map((x) => x.str_pct))
      : 1;

  const latestGm =
    health.gm_trend.length > 0
      ? health.gm_trend[health.gm_trend.length - 1].value
      : null;
  const fourWeeksAgoGm =
    health.gm_trend.length >= 5
      ? health.gm_trend[health.gm_trend.length - 5].value
      : null;
  const earliestGm =
    health.gm_trend.length > 0 ? health.gm_trend[0].value : null;

  // Group markdown forecast by date (top 5 dates, overflow collapsed)
  const byDate: Record<string, typeof health.markdown_forecast> = {};
  for (const row of health.markdown_forecast) {
    const d = row.effective_date || "unknown";
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(row);
  }
  const dateKeys = Object.keys(byDate).sort();

  const throughputMax =
    throughput && throughput.operators.length > 0
      ? Math.max(...throughput.operators.map((o) => o.count))
      : 1;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Executive Dashboard</h1>
        <div className="flex items-center gap-4">
          <Link
            to="/buyer-performance"
            className="text-sm text-blue-600 hover:underline"
          >
            View Buyer Performance →
          </Link>
          <div className="text-sm text-gray-500">
            Last snapshot: {health.snapshot_freshness || "—"}
          </div>
        </div>
      </div>

      {/* Products Added */}
      <section className="bg-white border rounded p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Products Added
        </h2>
        <div className="flex items-baseline gap-6">
          <div>
            <div className="text-3xl font-bold">{thisMonth}</div>
            <div className="text-xs text-gray-500">This Month</div>
          </div>
          <div>
            <div className="text-xl font-semibold text-gray-600">
              {lastMonth}
            </div>
            <div className="text-xs text-gray-500">Last Month</div>
          </div>
          {momPct !== null && (
            <div
              className={`text-sm font-medium ${
                momPct >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {momPct >= 0 ? "▲" : "▼"} {momPct.toFixed(0)}% month-over-month
            </div>
          )}
        </div>
      </section>

      {/* GM% Trend */}
      <section className="bg-white border rounded p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Catalog GM% Trend (12 weeks)
        </h2>
        {health.gm_trend.length === 0 ? (
          <div className="text-sm text-gray-500">
            No snapshots yet — run Weekly Operations Import to generate the first
            snapshot.
          </div>
        ) : (
          <>
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={health.gm_trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 60]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v: any) => `${v}%`} />
                  <ReferenceLine
                    y={health.gm_target_pct}
                    stroke="#16a34a"
                    strokeDasharray="4 4"
                    label={{
                      value: `Target ${health.gm_target_pct}%`,
                      position: "right",
                      fontSize: 11,
                      fill: "#16a34a",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="text-xs text-gray-600 mt-2 flex gap-4">
              {latestGm !== null && <span>Current: {pct(latestGm)}</span>}
              {fourWeeksAgoGm !== null && (
                <span>4 weeks ago: {pct(fourWeeksAgoGm)}</span>
              )}
              {earliestGm !== null && (
                <span>12 weeks ago: {pct(earliestGm)}</span>
              )}
            </div>
          </>
        )}
      </section>

      {/* STR Heatmap */}
      <section className="bg-white border rounded p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Category STR% Heatmap
        </h2>
        {health.str_heatmap.length === 0 ? (
          <div className="text-sm text-gray-500">
            No STR% snapshots yet.
          </div>
        ) : (
          <div className="space-y-2">
            {health.str_heatmap.map((row) => {
              const widthPct = strMax > 0 ? (row.str_pct / strMax) * 100 : 0;
              const tone = strTone(row.str_pct, strAvg);
              return (
                <div
                  key={row.department}
                  className="flex items-center gap-3 text-sm"
                >
                  <div className="w-32 text-gray-700">{row.department}</div>
                  <div className="flex-1 bg-gray-100 rounded h-5 overflow-hidden">
                    <div
                      className={`h-5 ${tone.bar}`}
                      style={{ width: `${Math.max(5, widthPct)}%` }}
                    />
                  </div>
                  <div className="w-20 text-right font-mono text-gray-800">
                    {pct(row.str_pct)}
                  </div>
                  <div className="w-32 text-xs text-gray-500">{tone.label}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 7-day Markdown Forecast */}
      <section className="bg-white border rounded p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          7-Day Markdown Forecast
        </h2>
        {dateKeys.length === 0 ? (
          <div className="text-sm text-gray-500">
            No scheduled markdowns in the next 7 days.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500 border-b">
                <th className="py-1">Effective</th>
                <th>Product</th>
                <th>Price</th>
                <th>GM%</th>
              </tr>
            </thead>
            <tbody>
              {dateKeys.flatMap((d) => {
                const rows = byDate[d].slice(0, 3);
                const extra = byDate[d].length - rows.length;
                return [
                  ...rows.map((r) => (
                    <tr key={`${d}-${r.mpn}`} className="border-b last:border-b-0">
                      <td className="py-1 text-gray-600">{d}</td>
                      <td>
                        <Link
                          to={`/products/${encodeURIComponent(r.mpn)}`}
                          className="text-blue-700 hover:underline"
                        >
                          {r.brand ? `${r.brand} ` : ""}
                          {r.name || r.mpn}
                        </Link>
                      </td>
                      <td className="font-mono text-xs">
                        {money(r.current_rics_offer)} → {money(r.scheduled_rics_offer)}
                      </td>
                      <td className="font-mono text-xs">
                        {pct(r.gm_pct_current)} → {pct(r.gm_pct_projected)}
                      </td>
                    </tr>
                  )),
                  extra > 0 && (
                    <tr key={`${d}-more`} className="border-b last:border-b-0">
                      <td className="py-1 text-gray-500 italic" colSpan={4}>
                        {extra} more markdown{extra === 1 ? "" : "s"} on {d}
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Operator Throughput */}
      <section className="bg-white border rounded p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Operator Throughput{" "}
          {throughput && (
            <span className="text-xs font-normal text-gray-500">
              (Week {throughput.week_key})
            </span>
          )}
        </h2>
        {!throughput || throughput.operators.length === 0 ? (
          <div className="text-sm text-gray-500">
            No completions recorded for this week yet.
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {throughput.operators.map((o) => {
                const w =
                  throughputMax > 0 ? (o.count / throughputMax) * 100 : 0;
                const deps = Object.entries(o.departments)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(", ");
                return (
                  <div key={o.uid} className="flex items-center gap-3 text-sm">
                    <div className="w-32 text-gray-700 truncate">{o.name}</div>
                    <div className="flex-1 bg-gray-100 rounded h-5 overflow-hidden">
                      <div
                        className="h-5 bg-blue-500"
                        style={{ width: `${Math.max(5, w)}%` }}
                      />
                    </div>
                    <div className="w-10 text-right font-mono">{o.count}</div>
                    <div className="flex-1 text-xs text-gray-500 truncate">
                      ({deps})
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 pt-2 border-t text-xs text-gray-600">
              Total: {throughput.total_completions} completions
            </div>
          </>
        )}
      </section>

      <div className="flex gap-4 text-sm">
        <Link to="/neglected-inventory" className="text-blue-700 hover:underline">
          View Neglected Inventory →
        </Link>
        <Link to="/channel-disparity" className="text-blue-700 hover:underline">
          View Channel Disparity →
        </Link>
      </div>
    </div>
  );
}
