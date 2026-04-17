import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  fetchAdvisoryLatest,
  fetchAdvisoryHistory,
  markAdvisoryRead,
  type WeeklyAdvisoryReport,
  type AdvisoryLatestResponse,
} from "../lib/api";

function formatDate(s: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function SectionHeader({ emoji, label }: { emoji: string; label: string }) {
  return (
    <div className="flex items-center gap-2 mt-8 mb-3 border-b pb-2">
      <span className="text-xl">{emoji}</span>
      <h2 className="text-lg font-semibold text-gray-900">{label}</h2>
    </div>
  );
}

function DeadWoodTable({ report }: { report: WeeklyAdvisoryReport }) {
  const rows = report.dead_wood?.products || [];
  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-500 italic">
        No dead wood flagged this week.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b">
            <th className="py-2 pr-4">MPN</th>
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Brand</th>
            <th className="py-2 pr-4">Days Old</th>
            <th className="py-2 pr-4">Inv</th>
            <th className="py-2 pr-4">STR%</th>
            <th className="py-2 pr-4">WOS</th>
            <th className="py-2 pr-4">GM%</th>
            <th className="py-2 pr-4"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.mpn} className="border-b last:border-0 hover:bg-gray-50">
              <td className="py-2 pr-4 font-mono text-xs">{p.mpn}</td>
              <td className="py-2 pr-4">{p.name || "—"}</td>
              <td className="py-2 pr-4">{p.brand}</td>
              <td className="py-2 pr-4">{p.days_old}d</td>
              <td className="py-2 pr-4">{p.inventory_total}</td>
              <td className="py-2 pr-4">{(p.str_pct || 0).toFixed(1)}%</td>
              <td className="py-2 pr-4">{(p.wos || 0).toFixed(1)}</td>
              <td className="py-2 pr-4">{(p.store_gm_pct || 0).toFixed(1)}%</td>
              <td className="py-2 pr-4">
                <Link
                  to={`/products/${encodeURIComponent(p.mpn)}`}
                  className="text-blue-600 hover:underline"
                >
                  ↗
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WarningTable({ report }: { report: WeeklyAdvisoryReport }) {
  const rows = report.inventory_warning?.products || [];
  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-500 italic">
        No inventory warnings this week.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b">
            <th className="py-2 pr-4">MPN</th>
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Brand</th>
            <th className="py-2 pr-4">WOS</th>
            <th className="py-2 pr-4">Inv</th>
            <th className="py-2 pr-4">Weekly Sales</th>
            <th className="py-2 pr-4"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.mpn} className="border-b last:border-0 hover:bg-gray-50">
              <td className="py-2 pr-4 font-mono text-xs">{p.mpn}</td>
              <td className="py-2 pr-4">{p.name || "—"}</td>
              <td className="py-2 pr-4">{p.brand}</td>
              <td className="py-2 pr-4">{(p.wos || 0).toFixed(1)}wk</td>
              <td className="py-2 pr-4">{p.inventory_total}</td>
              <td className="py-2 pr-4">
                {(p.weekly_sales_rate || 0).toFixed(1)}/wk
              </td>
              <td className="py-2 pr-4">
                <Link
                  to={`/products/${encodeURIComponent(p.mpn)}`}
                  className="text-blue-600 hover:underline"
                >
                  ↗
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportBody({ report }: { report: WeeklyAdvisoryReport }) {
  return (
    <div>
      <SectionHeader emoji="💀" label="Dead Wood" />
      {report.dead_wood?.summary ? (
        <p className="text-sm text-gray-800 whitespace-pre-line mb-3">
          {report.dead_wood.summary}
        </p>
      ) : null}
      <DeadWoodTable report={report} />

      <SectionHeader emoji="📉" label="Markdown Optimizer" />
      {report.markdown_optimizer?.summary ? (
        <p className="text-sm text-gray-800 whitespace-pre-line mb-3">
          {report.markdown_optimizer.summary}
        </p>
      ) : null}
      {report.markdown_optimizer?.insights?.length ? (
        <ul className="list-disc pl-6 text-sm text-gray-800 space-y-1">
          {report.markdown_optimizer.insights.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500 italic">No insights surfaced.</p>
      )}

      <SectionHeader emoji="⚠️" label="Inventory Warning" />
      {report.inventory_warning?.summary ? (
        <p className="text-sm text-gray-800 whitespace-pre-line mb-3">
          {report.inventory_warning.summary}
        </p>
      ) : null}
      <WarningTable report={report} />
    </div>
  );
}

export default function AdvisoryPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [data, setData] = useState<AdvisoryLatestResponse | null>(null);
  const [history, setHistory] = useState<WeeklyAdvisoryReport[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [historyIndex, setHistoryIndex] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [latest, hist] = await Promise.all([
          fetchAdvisoryLatest(),
          fetchAdvisoryHistory(8),
        ]);
        setData(latest);
        setHistory(hist.reports || []);
        if (latest.is_exec && latest.buyer_reports?.length) {
          setActiveTab(latest.buyer_reports[0].buyer_uid);
        }
        // Auto-mark-read the most recent own report
        if (latest.report && !latest.report.read_by_buyer) {
          markAdvisoryRead(latest.report.report_id).catch(() => {});
        }
      } catch (e: any) {
        setErr(e?.message || "Failed to load advisory");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const displayedReport = useMemo<WeeklyAdvisoryReport | null>(() => {
    if (!data) return null;
    if (data.is_exec && activeTab && data.buyer_reports?.length) {
      const match = data.buyer_reports.find((r) => r.buyer_uid === activeTab);
      if (match) return match;
    }
    if (historyIndex > 0 && history[historyIndex]) {
      return history[historyIndex];
    }
    return data.report || null;
  }, [data, activeTab, history, historyIndex]);

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Loading advisory…</div>;
  }
  if (err) {
    return <div className="p-6 text-sm text-red-600">{err}</div>;
  }
  if (!data) {
    return null;
  }

  const report = displayedReport;
  const globalReport = data.global_report;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Weekly Advisory</h1>
        <div className="text-sm text-gray-500">
          {report?.week_label || globalReport?.week_label || ""}
        </div>
      </div>

      {/* Global roll-up for exec */}
      {data.is_exec && globalReport && (
        <div className="bg-indigo-50 border border-indigo-200 rounded p-4 mb-6">
          <h2 className="text-sm font-semibold text-indigo-900 mb-2">
            Global Health Summary (All Buyers)
          </h2>
          <p className="text-sm text-indigo-900 whitespace-pre-line">
            {globalReport.global_health_summary ||
              "No global summary generated this week."}
          </p>
          {data.buyer_reports && data.buyer_reports.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {data.buyer_reports.map((r) => (
                <button
                  key={r.buyer_uid}
                  onClick={() => {
                    setActiveTab(r.buyer_uid);
                    setHistoryIndex(0);
                  }}
                  className={
                    "px-3 py-1 rounded text-xs font-medium border " +
                    (activeTab === r.buyer_uid
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-indigo-700 border-indigo-300 hover:bg-indigo-100")
                  }
                >
                  {r.buyer_name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Selected report */}
      {report ? (
        <div className="bg-white border rounded p-6">
          <div className="flex items-center justify-between border-b pb-3 mb-2">
            <div>
              <div className="text-sm text-gray-500">
                {report.buyer_name}
              </div>
              <div className="text-xs text-gray-400">
                Generated {formatDate(report.generated_at)}
              </div>
            </div>
            {/* history nav — only for own-report scope */}
            {!data.is_exec && history.length > 1 && (
              <div className="flex items-center gap-2 text-sm">
                <button
                  className="px-2 py-1 border rounded disabled:opacity-50"
                  onClick={() =>
                    setHistoryIndex((i) =>
                      Math.min(history.length - 1, i + 1)
                    )
                  }
                  disabled={historyIndex >= history.length - 1}
                >
                  ← Previous Week
                </button>
                <button
                  className="px-2 py-1 border rounded disabled:opacity-50"
                  onClick={() =>
                    setHistoryIndex((i) => Math.max(0, i - 1))
                  }
                  disabled={historyIndex <= 0}
                >
                  Next Week →
                </button>
              </div>
            )}
          </div>
          <ReportBody report={report} />
        </div>
      ) : (
        <div className="bg-white border rounded p-6 text-sm text-gray-500">
          No advisory report available yet. Reports generate after each Weekly
          Operations Import commit.
        </div>
      )}
    </div>
  );
}
