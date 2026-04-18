import { useEffect, useState } from "react";
import { fetchImportStatus, cancelImportJob, type ImportStatus } from "../lib/api";

interface Props {
  batchId: string;
  onComplete?: (result: ImportStatus) => void;
}

/**
 * Polls /api/v1/imports/status/{batchId} every 2 s until the batch reaches
 * a terminal state, then fires onComplete.  Used by every import card on the
 * Import Hub so the user can navigate away while an import is processing.
 */
export function ImportProgressCard({ batchId, onComplete }: Props) {
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!batchId) return;
    let stopped = false;

    const tick = async () => {
      try {
        const s = await fetchImportStatus(batchId);
        if (stopped) return;
        setStatus(s);
        setError(null);
        if (s.status === "complete" || s.status === "failed" || s.status === "cancelled") {
          stopped = true;
          clearInterval(interval);
          if (s.status !== "cancelled") onComplete?.(s);
        }
      } catch (err: any) {
        if (!stopped) setError(err?.message || "polling error");
      }
    };

    tick();
    const interval = setInterval(tick, 2000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [batchId, onComplete]);

  async function handleCancel() {
    if (cancelling) return;
    if (!confirm("Cancel this import? Already-committed rows will remain.")) return;
    setCancelling(true);
    try {
      await cancelImportJob(batchId);
    } catch (err: any) {
      setError(err?.error || err?.message || "Cancel failed");
    } finally {
      setCancelling(false);
    }
  }

  if (error && !status) {
    return (
      <div className="text-sm text-red-600">Could not check import status: {error}</div>
    );
  }
  if (!status) {
    return <div className="text-sm text-gray-500 animate-pulse">Starting…</div>;
  }

  if (status.status === "processing" || status.status === "pending") {
    return (
      <div className="space-y-2">
        <div className="flex justify-between text-sm text-gray-600">
          <span>
            Processing
            {status.row_count > 0 ? ` ${status.row_count.toLocaleString()} rows` : ""}…
          </span>
          <span className="font-medium">{status.progress_pct}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
          <div
            className="bg-blue-600 h-2.5 rounded-full transition-all duration-700"
            style={{ width: `${Math.max(2, status.progress_pct)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span>
            {(status.committed_rows || 0).toLocaleString()} committed
            {" · "}
            {(status.failed_rows || 0).toLocaleString()} failed
            {status.skipped_rows
              ? ` · ${status.skipped_rows.toLocaleString()} skipped`
              : ""}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-blue-600">You can navigate away</span>
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="text-red-500 hover:text-red-700 underline disabled:opacity-50"
            >
              {cancelling ? "Cancelling…" : "Cancel"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status.status === "cancelled") {
    return (
      <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg text-sm">
        <div className="font-medium text-yellow-800">⚠️ Import cancelled</div>
        <div className="text-yellow-700">
          {(status.committed_rows || 0).toLocaleString()} rows were committed before cancellation.
        </div>
        <button
          onClick={() => onComplete?.(status)}
          className="mt-2 text-xs text-gray-500 underline hover:text-gray-700"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (status.status === "complete") {
    return (
      <div className="bg-green-50 border border-green-200 text-green-800 p-3 rounded-lg text-sm">
        <div className="font-medium">✅ Import complete</div>
        <div>
          {(status.committed_rows || 0).toLocaleString()} committed
          {" · "}
          {(status.failed_rows || 0).toLocaleString()} failed
          {status.skipped_rows
            ? ` · ${status.skipped_rows.toLocaleString()} skipped`
            : ""}
        </div>
      </div>
    );
  }

  if (status.status === "failed") {
    return (
      <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-lg text-sm">
        <div className="font-medium">❌ Import failed</div>
        <div>{status.error_message || "Unknown error"}</div>
      </div>
    );
  }

  return (
    <div className="text-sm text-gray-500">Status: {status.status}</div>
  );
}

export default ImportProgressCard;
