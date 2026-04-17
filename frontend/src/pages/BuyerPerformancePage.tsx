import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  fetchBuyerPerformance,
  fetchBuyerPerformanceList,
  BuyerPerformance,
} from "../lib/api";

function colorClass(c: string) {
  if (c === "green") return "bg-green-100 text-green-800";
  if (c === "amber") return "bg-amber-100 text-amber-800";
  if (c === "red") return "bg-red-100 text-red-800";
  return "bg-gray-100 text-gray-800";
}

function colorDot(c: string) {
  if (c === "green") return "bg-green-500";
  if (c === "amber") return "bg-amber-500";
  if (c === "red") return "bg-red-500";
  return "bg-gray-300";
}

function fmtTs(v: any): string {
  if (!v) return "—";
  if (typeof v === "string") return new Date(v).toLocaleString();
  if (typeof v === "object" && v._seconds) {
    return new Date(v._seconds * 1000).toLocaleString();
  }
  return "—";
}

function CategoryBreakdownTable({ bp }: { bp: BuyerPerformance }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left">Department</th>
            <th className="px-3 py-2 text-right">Products</th>
            <th className="px-3 py-2 text-right">Avg GM%</th>
            <th className="px-3 py-2 text-right">GM Target</th>
            <th className="px-3 py-2 text-right">Δ vs Target</th>
            <th className="px-3 py-2 text-right">Avg STR%</th>
            <th className="px-3 py-2 text-right">Catalog STR%</th>
            <th className="px-3 py-2 text-right">Δ vs Catalog</th>
            <th className="px-3 py-2 text-right">Recent Actions</th>
          </tr>
        </thead>
        <tbody>
          {bp.category_breakdown.map((c) => (
            <tr key={c.department} className="border-t">
              <td className="px-3 py-2">{c.department}</td>
              <td className="px-3 py-2 text-right">{c.product_count}</td>
              <td className="px-3 py-2 text-right">{c.avg_gm_pct.toFixed(1)}%</td>
              <td className="px-3 py-2 text-right">{c.gm_target}%</td>
              <td
                className={`px-3 py-2 text-right ${
                  c.gm_vs_target >= 0 ? "text-green-700" : "text-red-700"
                }`}
              >
                {c.gm_vs_target >= 0 ? "+" : ""}
                {c.gm_vs_target.toFixed(1)}
              </td>
              <td className="px-3 py-2 text-right">{c.avg_str_pct.toFixed(1)}%</td>
              <td className="px-3 py-2 text-right">{c.catalog_str_pct.toFixed(1)}%</td>
              <td
                className={`px-3 py-2 text-right ${
                  c.str_vs_catalog >= 0 ? "text-green-700" : "text-red-700"
                }`}
              >
                {c.str_vs_catalog >= 0 ? "+" : ""}
                {c.str_vs_catalog.toFixed(1)}
              </td>
              <td className="px-3 py-2 text-right">
                {c.recent_action_count} / {c.product_count}
              </td>
            </tr>
          ))}
          {bp.category_breakdown.length === 0 && (
            <tr>
              <td colSpan={9} className="px-3 py-6 text-center text-gray-500">
                No categories found for this buyer.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function BuyerCard({ bp, defaultOpen = false }: { bp: BuyerPerformance; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white border rounded-lg">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50"
      >
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full ${colorDot(bp.composite_color)}`} />
          <span className="font-semibold text-gray-900">{bp.buyer_name}</span>
          <span className="text-xs text-gray-500">{bp.products_assigned} products</span>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <span className="text-gray-600">Margin {bp.margin_health_score}</span>
          <span className="text-gray-600">Velocity {bp.inventory_velocity_score}</span>
          <span className="text-gray-600">Attention {bp.attention_score}</span>
          <span className={`px-2 py-1 rounded font-semibold ${colorClass(bp.composite_color)}`}>
            {bp.composite_score}
          </span>
          <span className="text-gray-400">{open ? "▲" : "▼"}</span>
        </div>
      </button>
      {open && (
        <div className="border-t px-4 py-3 bg-gray-50">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
            <div>
              <div className="text-gray-500 text-xs">Avg GM%</div>
              <div className="font-semibold">{bp.avg_gm_pct.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs">Avg STR%</div>
              <div className="font-semibold">{bp.avg_str_pct.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs">Catalog STR%</div>
              <div className="font-semibold">{bp.catalog_avg_str_pct.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs">Recent Actions ({bp.review_window_days}d)</div>
              <div className="font-semibold">
                {bp.products_with_recent_action} / {bp.products_assigned}
              </div>
            </div>
          </div>
          <CategoryBreakdownTable bp={bp} />
        </div>
      )}
    </div>
  );
}

export default function BuyerPerformancePage() {
  const { user, role } = useAuth();
  const params = useParams<{ buyer_uid?: string }>();
  const [items, setItems] = useState<BuyerPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isExec = role === "admin" || role === "owner" || role === "head_buyer";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        if (params.buyer_uid) {
          const bp = await fetchBuyerPerformance(params.buyer_uid);
          if (!cancelled) setItems([bp]);
        } else if (isExec) {
          const res = await fetchBuyerPerformanceList();
          if (!cancelled) setItems(res.items);
        } else if (user) {
          try {
            const bp = await fetchBuyerPerformance(user.uid);
            if (!cancelled) setItems([bp]);
          } catch (_e) {
            if (!cancelled) setItems([]);
          }
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [params.buyer_uid, isExec, user]);

  const computedAt = items[0]?.computed_at;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Buyer Performance Matrix</h1>
          <p className="text-sm text-gray-500">
            Composite score blends Margin Health, Inventory Velocity, and Attention.
            {computedAt && <> &middot; Last computed {fmtTs(computedAt)}</>}
          </p>
        </div>
        {isExec && (
          <Link to="/executive" className="text-sm text-blue-600 hover:underline">
            ← Executive Dashboard
          </Link>
        )}
      </div>

      {loading && <div className="text-gray-500">Loading…</div>}
      {error && <div className="text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</div>}

      {!loading && !error && items.length === 0 && (
        <div className="bg-white border rounded-lg p-8 text-center text-gray-500">
          No buyer performance data available yet. Run a Weekly Operations Import or trigger
          the <code>jobs/buyer-performance</code> job.
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="space-y-3">
          {items.map((bp, idx) => (
            <BuyerCard key={bp.buyer_uid} bp={bp} defaultOpen={items.length === 1 || idx === 0} />
          ))}
        </div>
      )}
    </div>
  );
}
