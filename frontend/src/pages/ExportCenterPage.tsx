import { useState, useEffect, useCallback } from "react";
import {
  fetchExportPending,
  triggerExport,
  notifyBuyer,
  fetchExportJobs,
  promoteScheduled,
  ExportPendingProduct,
  ExportBlockedProduct,
  ExportTriggerResponse,
  ExportJob,
} from "../lib/api";

type Tab = "pending" | "completed";

export default function ExportCenterPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [pending, setPending] = useState<ExportPendingProduct[]>([]);
  const [blocked, setBlocked] = useState<ExportBlockedProduct[]>([]);
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportTriggerResponse | null>(null);
  const [notifiedMpns, setNotifiedMpns] = useState<Record<string, number>>({});
  const [promoting, setPromoting] = useState(false);
  const [promoteResult, setPromoteResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPending = useCallback(async () => {
    try {
      const data = await fetchExportPending();
      setPending(data.pending);
      setBlocked(data.blocked);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const data = await fetchExportJobs();
      setJobs(data.jobs);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadPending(), loadJobs()]).finally(() => setLoading(false));
  }, [loadPending, loadJobs]);

  async function handleTriggerExport() {
    setExporting(true);
    setExportResult(null);
    setError(null);
    try {
      const result = await triggerExport();
      setExportResult(result);
      // Refresh pending + jobs
      await Promise.all([loadPending(), loadJobs()]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  async function handleNotifyBuyer(mpn: string) {
    try {
      await notifyBuyer(mpn);
      setNotifiedMpns((prev) => ({ ...prev, [mpn]: Date.now() }));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handlePromoteScheduled() {
    setPromoting(true);
    setPromoteResult(null);
    try {
      const result = await promoteScheduled();
      setPromoteResult(result);
      await loadPending();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPromoting(false);
    }
  }

  function isRecentlyNotified(mpn: string): boolean {
    const ts = notifiedMpns[mpn];
    if (!ts) return false;
    return Date.now() - ts < 60 * 60 * 1000; // 1 hour cooldown
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Loading export data…
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Export Center</h1>
        <div className="flex gap-2">
          <button
            onClick={handlePromoteScheduled}
            disabled={promoting}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {promoting ? "Promoting…" : "Promote Scheduled"}
          </button>
          <button
            onClick={handleTriggerExport}
            disabled={exporting}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {exporting ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Exporting…
              </>
            ) : (
              "Trigger Export"
            )}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            dismiss
          </button>
        </div>
      )}

      {/* Export Result Banner */}
      {exportResult && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <h3 className="font-semibold text-green-800 mb-1">Export Complete</h3>
          <p className="text-sm text-green-700">
            Serialized: <strong>{exportResult.serialized}</strong> &middot;
            Blocked: <strong>{exportResult.blocked}</strong>
            {exportResult.errors.length > 0 && (
              <> &middot; Errors: <strong>{exportResult.errors.length}</strong></>
            )}
          </p>
          {exportResult.download_url && (
            <a
              href={exportResult.download_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 text-sm text-blue-600 hover:underline"
            >
              Download Export JSON →
            </a>
          )}
        </div>
      )}

      {/* Promote Result Banner */}
      {promoteResult && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="font-semibold text-blue-800 mb-1">Scheduled Promotion Complete</h3>
          <p className="text-sm text-blue-700">
            Promoted: <strong>{promoteResult.promoted}</strong> &middot;
            Skipped: <strong>{promoteResult.skipped}</strong>
            {promoteResult.errors?.length > 0 && (
              <> &middot; Errors: <strong>{promoteResult.errors.length}</strong></>
            )}
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        <button
          onClick={() => setTab("pending")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "pending"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Pending ({pending.length})
        </button>
        <button
          onClick={() => setTab("completed")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "completed"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Completed ({jobs.length})
        </button>
      </div>

      {/* Pending Tab */}
      {tab === "pending" && (
        <div className="space-y-6">
          {/* Eligible Products */}
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Pending Export ({pending.length} products)
            </h2>
            {pending.length === 0 ? (
              <p className="text-gray-400 text-sm">No products ready for export.</p>
            ) : (
              <div className="bg-white border rounded-lg divide-y">
                {pending.map((p) => (
                  <div key={p.mpn} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <span className="font-mono text-sm text-gray-600 mr-3">{p.mpn}</span>
                      <span className="text-sm text-gray-900">{p.name || "—"}</span>
                      {p.brand && (
                        <span className="ml-2 text-xs text-gray-400">{p.brand}</span>
                      )}
                    </div>
                    <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded">
                      {p.pricing_domain_state}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Blocked Products */}
          {blocked.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Blocked ({blocked.length} products)
              </h2>
              <div className="bg-white border rounded-lg divide-y">
                {blocked.map((b) => (
                  <div key={b.mpn} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-mono text-sm text-gray-600 mr-3">{b.mpn}</span>
                        {b.reasons.map((r, i) => (
                          <span
                            key={i}
                            className="inline-block ml-2 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded"
                          >
                            ⚠ {r}
                          </span>
                        ))}
                      </div>
                      <button
                        onClick={() => handleNotifyBuyer(b.mpn)}
                        disabled={isRecentlyNotified(b.mpn)}
                        className={`text-xs px-3 py-1 rounded border ${
                          isRecentlyNotified(b.mpn)
                            ? "border-green-300 text-green-600 bg-green-50 cursor-not-allowed"
                            : "border-gray-300 text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {isRecentlyNotified(b.mpn) ? "Notified ✓" : "Notify Buyer"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Completed Tab */}
      {tab === "completed" && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Past Exports
          </h2>
          {jobs.length === 0 ? (
            <p className="text-gray-400 text-sm">No export jobs yet.</p>
          ) : (
            <div className="bg-white border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium text-gray-500">Date</th>
                    <th className="px-4 py-2 font-medium text-gray-500">Status</th>
                    <th className="px-4 py-2 font-medium text-gray-500">Serialized</th>
                    <th className="px-4 py-2 font-medium text-gray-500">Blocked</th>
                    <th className="px-4 py-2 font-medium text-gray-500">Errors</th>
                    <th className="px-4 py-2 font-medium text-gray-500">Download</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {jobs.map((job) => (
                    <tr key={job.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-700">
                        {job.triggered_at
                          ? new Date(job.triggered_at).toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded ${
                            job.status === "complete"
                              ? "bg-green-50 text-green-700"
                              : job.status === "complete_with_errors"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {job.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-700">{job.serialized_count}</td>
                      <td className="px-4 py-2 text-gray-700">{job.blocked_count}</td>
                      <td className="px-4 py-2 text-gray-700">{job.failed_count}</td>
                      <td className="px-4 py-2">
                        {job.download_url ? (
                          <a
                            href={job.download_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            JSON ↓
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
