import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchNeglectedInventory,
  type NeglectedResponse,
} from "../lib/api";

function fmtDate(ts: any): string {
  if (!ts) return "—";
  if (typeof ts === "string") return ts;
  if (ts._seconds) return new Date(ts._seconds * 1000).toLocaleString();
  if (ts.seconds) return new Date(ts.seconds * 1000).toLocaleString();
  return "—";
}

export default function NeglectedInventoryPage() {
  const [data, setData] = useState<NeglectedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchNeglectedInventory();
        setData(res);
      } catch (e: any) {
        setError(e?.message || "Failed to load neglected inventory");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;
  if (!data) return null;

  const thresholds = data.thresholds;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Neglected Inventory{" "}
            <span className="text-base font-normal text-gray-500">
              [{data.total_count} product{data.total_count === 1 ? "" : "s"}]
            </span>
          </h1>
          <p className="text-sm text-gray-600">
            Products &gt; {thresholds?.age_days ?? 60} days old with no attention
            in {thresholds?.attention_days ?? 14}+ days
            {data.scoped && <span className="ml-2 text-xs text-gray-500">(scoped to your products)</span>}
          </p>
        </div>
        <div className="text-xs text-gray-500">
          Computed: {fmtDate(data.computed_at)}
        </div>
      </div>

      {data.items.length === 0 ? (
        <div className="bg-white border rounded p-6 text-center text-gray-500">
          No neglected products. Nightly projection may not have run yet.
        </div>
      ) : (
        <div className="bg-white border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600 border-b">
              <tr>
                <th className="px-3 py-2 text-left">MPN</th>
                <th className="px-3 py-2 text-left">Brand</th>
                <th className="px-3 py-2 text-left">Dept</th>
                <th className="px-3 py-2 text-right">Days Old</th>
                <th className="px-3 py-2 text-right">Last Touch</th>
                <th className="px-3 py-2 text-right">Inv</th>
                <th className="px-3 py-2 text-right">STR%</th>
                <th className="px-3 py-2 text-right">WOS</th>
                <th className="px-3 py-2 text-right">GM%</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.mpn} className="border-b last:border-b-0">
                  <td className="px-3 py-2 font-mono text-xs">{row.mpn}</td>
                  <td className="px-3 py-2">{row.brand || "—"}</td>
                  <td className="px-3 py-2 text-gray-700">{row.department}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {row.days_old}d
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-600">
                    {row.days_since_touch}d ago
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {row.inventory_total}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {row.str_pct !== null ? `${row.str_pct.toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {row.wos !== null ? row.wos.toFixed(1) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {row.store_gm_pct !== null
                      ? `${row.store_gm_pct.toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/products/${encodeURIComponent(row.mpn)}`}
                      className="text-blue-700 hover:underline text-xs"
                    >
                      Open Product
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
