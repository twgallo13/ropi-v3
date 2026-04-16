import { useState } from "react";
import {
  uploadImport,
  commitImport,
  type ImportUploadResponse,
  type ImportCommitResponse,
} from "../lib/api";

type Family = "full-product" | "weekly-operations";

interface UploadState {
  file: File | null;
  uploading: boolean;
  uploadResult: ImportUploadResponse | null;
  uploadError: string;
  committing: boolean;
  commitResult: ImportCommitResponse | null;
  commitError: string;
}

const INITIAL: UploadState = {
  file: null,
  uploading: false,
  uploadResult: null,
  uploadError: "",
  committing: false,
  commitResult: null,
  commitError: "",
};

function ImportCard({
  title,
  family,
}: {
  title: string;
  family: Family;
}) {
  const [state, setState] = useState<UploadState>({ ...INITIAL });

  async function handleUpload() {
    if (!state.file) return;
    setState((s) => ({ ...s, uploading: true, uploadError: "", uploadResult: null, commitResult: null, commitError: "" }));
    try {
      const result = await uploadImport(family, state.file);
      setState((s) => ({ ...s, uploading: false, uploadResult: result }));
    } catch (err: any) {
      setState((s) => ({
        ...s,
        uploading: false,
        uploadError: err?.message || err?.error || "Upload failed",
      }));
    }
  }

  async function handleCommit() {
    if (!state.uploadResult?.batch_id) return;
    setState((s) => ({ ...s, committing: true, commitError: "", commitResult: null }));
    try {
      const result = await commitImport(family, state.uploadResult.batch_id);
      setState((s) => ({ ...s, committing: false, commitResult: result }));
    } catch (err: any) {
      setState((s) => ({
        ...s,
        committing: false,
        commitError: err?.message || err?.error || "Commit failed",
      }));
    }
  }

  function handleReset() {
    setState({ ...INITIAL });
  }

  return (
    <div className="bg-white rounded-lg border p-6">
      <h2 className="text-lg font-semibold mb-4">{title}</h2>

      {/* File picker */}
      <div className="flex items-center gap-3 mb-4">
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setState(() => ({ ...INITIAL, file: e.target.files?.[0] || null }))}
          className="text-sm"
        />
        <button
          onClick={handleUpload}
          disabled={!state.file || state.uploading}
          className="px-4 py-2 rounded text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state.uploading ? "Uploading…" : "Upload & Validate"}
        </button>
      </div>

      {/* Upload error */}
      {state.uploadError && (
        <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-sm text-red-700">
          {state.uploadError}
        </div>
      )}

      {/* Upload result */}
      {state.uploadResult && (
        <div className="mb-4 p-4 rounded bg-green-50 border border-green-200">
          <div className="flex items-center gap-4 text-sm">
            <span>
              <strong>Batch ID:</strong>{" "}
              <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">{state.uploadResult.batch_id}</code>
            </span>
            <span><strong>Rows:</strong> {state.uploadResult.row_count}</span>
          </div>
          {state.uploadResult.warnings.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-yellow-700">Warnings:</p>
              <ul className="text-xs text-yellow-700 list-disc ml-4">
                {state.uploadResult.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Commit controls */}
          {!state.commitResult && (
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={handleCommit}
                disabled={state.committing}
                className="px-4 py-2 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {state.committing ? "Committing…" : "Commit Import"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Commit error */}
      {state.commitError && (
        <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-sm text-red-700">
          {state.commitError}
        </div>
      )}

      {/* Commit result */}
      {state.commitResult && (
        <div className="p-4 rounded bg-blue-50 border border-blue-200">
          <p className="text-sm font-medium text-blue-800 mb-2">Import Complete</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <span className="text-gray-500">Committed:</span>{" "}
              <strong className="text-green-700">{state.commitResult.committed_rows}</strong>
            </div>
            <div>
              <span className="text-gray-500">Failed:</span>{" "}
              <strong className={state.commitResult.failed_rows > 0 ? "text-red-700" : "text-gray-700"}>
                {state.commitResult.failed_rows}
              </strong>
            </div>
            {state.commitResult.uuid_names_cleaned !== undefined && (
              <div>
                <span className="text-gray-500">UUID Names Cleaned:</span>{" "}
                <strong>{state.commitResult.uuid_names_cleaned}</strong>
              </div>
            )}
            {state.commitResult.smart_rules_applied !== undefined && (
              <div>
                <span className="text-gray-500">Smart Rules Applied:</span>{" "}
                <strong>{state.commitResult.smart_rules_applied}</strong>
              </div>
            )}
          </div>
          {state.commitResult.errors && state.commitResult.errors.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-red-700">Errors:</p>
              <ul className="text-xs text-red-600 list-disc ml-4 max-h-40 overflow-y-auto">
                {state.commitResult.errors.map((e, i) => (
                  <li key={i}>
                    {typeof e === "string" ? e : `Row ${e.row}${e.mpn ? ` (${e.mpn})` : ""}: ${e.error}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={handleReset}
            className="mt-3 px-3 py-1 text-xs text-gray-500 hover:text-gray-700 border rounded"
          >
            Upload Another
          </button>
        </div>
      )}
    </div>
  );
}

export default function ImportHubPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Import Hub</h1>
      <div className="space-y-6">
        <ImportCard title="Full Product Import" family="full-product" />
        <ImportCard title="Weekly Operations Import" family="weekly-operations" />
      </div>
    </div>
  );
}
