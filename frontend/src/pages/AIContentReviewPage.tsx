import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  fetchContentVersions,
  approveContentVersion,
  rejectContentVersion,
  editContentVersion,
  restoreContentVersion,
  aiDescribe,
  ContentVersion,
} from "../lib/api";

function formatDate(ts: any): string {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function StateBadge({ state }: { state: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    approved: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
    review_pending: "bg-purple-100 text-purple-800",
  };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded ${colors[state] || "bg-gray-100 text-gray-600"}`}
    >
      {state.replace("_", " ")}
    </span>
  );
}

export default function AIContentReviewPage() {
  const { mpn: rawMpn } = useParams<{ mpn: string }>();
  const mpn = decodeURIComponent(rawMpn || "");

  const [siteOwners] = useState<string[]>(["shiekh", "karmaloop", "mltd"]);
  const [activeSite, setActiveSite] = useState("shiekh");
  const [versions, setVersions] = useState<ContentVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Inline editing state
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // Observations textarea state (Correction 3)
  const [observations, setObservations] = useState("");

  const loadVersions = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const data = await fetchContentVersions(mpn, activeSite);
      setVersions(data);
    } catch (err: any) {
      setError(err.error || "Failed to load content versions");
    } finally {
      setLoading(false);
    }
  }, [mpn, activeSite]);

  useEffect(() => {
    if (mpn) loadVersions();
  }, [mpn, loadVersions]);

  // Show up to 3 most recent versions
  const displayVersions = versions.slice(0, 3);
  const currentVersion = displayVersions[0] || null;

  async function handleRegenerate() {
    setActionLoading(true);
    setError("");
    setSuccessMsg("");
    try {
      await aiDescribe(mpn, [activeSite], observations || undefined);
      await loadVersions();
      setSuccessMsg("New version generated");
    } catch (err: any) {
      setError(err.error || "Generation failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleApprove() {
    if (!currentVersion) return;
    setActionLoading(true);
    setError("");
    setSuccessMsg("");
    try {
      const result = await approveContentVersion(mpn, currentVersion.version_id);
      if (result.status === "review_pending") {
        setSuccessMsg("Content submitted for review approval");
      } else {
        setSuccessMsg("Content approved and written to attributes");
      }
      await loadVersions();
    } catch (err: any) {
      setError(err.error || "Approval failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReject() {
    if (!currentVersion) return;
    const reason = prompt("Rejection reason (optional):");
    setActionLoading(true);
    setError("");
    setSuccessMsg("");
    try {
      await rejectContentVersion(mpn, currentVersion.version_id, reason || undefined);
      setSuccessMsg("Content rejected");
      await loadVersions();
    } catch (err: any) {
      setError(err.error || "Rejection failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleInlineEdit(field: string) {
    if (!currentVersion) return;
    setActionLoading(true);
    try {
      await editContentVersion(mpn, currentVersion.version_id, { [field]: editValue });
      setEditingField(null);
      setEditValue("");
      await loadVersions();
    } catch (err: any) {
      setError(err.error || "Edit failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRestore(versionId: string) {
    setActionLoading(true);
    setError("");
    setSuccessMsg("");
    try {
      await restoreContentVersion(mpn, versionId);
      setSuccessMsg("Version restored as new pending version");
      await loadVersions();
    } catch (err: any) {
      setError(err.error || "Restore failed");
    } finally {
      setActionLoading(false);
    }
  }

  function startEdit(field: string, value: string) {
    setEditingField(field);
    setEditValue(value);
  }

  const parsed = currentVersion?.parsed_output || {};

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-4">
        <Link
          to={`/products/${encodeURIComponent(mpn)}`}
          className="text-blue-600 text-sm hover:underline"
        >
          ← Back to Product
        </Link>
      </div>

      <h1 className="text-2xl font-bold mb-1">AI Content Review</h1>
      <p className="text-gray-500 text-sm mb-6">{mpn}</p>

      {/* Observations textarea (Correction 3) */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Observations (optional context for AI generation)
        </label>
        <textarea
          value={observations}
          onChange={e => setObservations(e.target.value)}
          placeholder="Add any specific context, details, or notes to guide the AI generation..."
          className="w-full border rounded p-2 text-sm h-20"
        />
      </div>

      {/* Site Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {siteOwners.map((site) => (
          <button
            key={site}
            onClick={() => setActiveSite(site)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeSite === site
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {site.charAt(0).toUpperCase() + site.slice(1)}
          </button>
        ))}
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-4 text-sm">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded mb-4 text-sm">
          {successMsg}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : !currentVersion ? (
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">No AI content generated for {activeSite} yet.</p>
          <button
            onClick={handleRegenerate}
            disabled={actionLoading}
            className="bg-blue-600 text-white px-6 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {actionLoading ? "Generating…" : "Generate Content"}
          </button>
        </div>
      ) : (
        <>
          {/* Version Meta */}
          <div className="flex items-center justify-between bg-gray-50 rounded px-4 py-3 mb-6">
            <div className="text-sm text-gray-600">
              <span>Generated: {formatDate(currentVersion.generated_at)}</span>
              <span className="mx-2">|</span>
              <span>Template: {currentVersion.template_name}</span>
              <span className="mx-2">|</span>
              <span>Tone: {currentVersion.tone_profile}</span>
              <span className="mx-2">|</span>
              <span>
                Version {currentVersion.version_number} of {versions.length}
              </span>
              {currentVersion.operator_edited && (
                <span className="ml-2 text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded">
                  operator-edited
                </span>
              )}
            </div>
            <button
              onClick={handleRegenerate}
              disabled={actionLoading}
              className="text-blue-600 text-sm hover:underline disabled:opacity-50"
            >
              ⟳ Regenerate
            </button>
          </div>

          {/* Banned Words Warning */}
          {currentVersion.banned_words_found?.length > 0 && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-4 text-sm">
              ⚠️ Banned words found: {currentVersion.banned_words_found.join(", ")}
            </div>
          )}

          {/* Content Fields */}
          <div className="space-y-6 mb-8">
            {/* Description field with HTML preview (TALLY-117) */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Description (HTML)
              </label>
              {editingField === "description" ? (
                <div>
                  <textarea
                    className="w-full border rounded px-3 py-2 text-sm font-mono"
                    rows={6}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                  />
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={() => handleInlineEdit("description")}
                      disabled={actionLoading}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingField(null)}
                      className="text-xs text-gray-500 hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div
                    className="border rounded px-3 py-2 text-sm font-mono bg-white cursor-pointer hover:bg-gray-50 min-h-[38px]"
                    onClick={() => startEdit("description", parsed["description"] || "")}
                  >
                    {parsed["description"] || (
                      <span className="text-gray-400 italic">Click to edit</span>
                    )}
                  </div>
                  {parsed["description"] && (
                    <div className="mt-2 p-3 bg-gray-50 border rounded text-sm">
                      <span className="text-xs text-gray-400 block mb-1">Preview:</span>
                      <div dangerouslySetInnerHTML={{ __html: parsed["description"] }} />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Other content fields */}
            {(
              [
                ["meta_name", "Meta Name"],
                ["meta_description", "Meta Description"],
                ["keywords", "Keywords"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  {label}
                </label>
                {editingField === key ? (
                  <div>
                    <input
                      className="w-full border rounded px-3 py-2 text-sm"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                    />
                    <div className="flex gap-2 mt-1">
                      <button
                        onClick={() => handleInlineEdit(key)}
                        disabled={actionLoading}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingField(null)}
                        className="text-xs text-gray-500 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="border rounded px-3 py-2 text-sm bg-white cursor-pointer hover:bg-gray-50 min-h-[38px]"
                    onClick={() => startEdit(key, parsed[key] || "")}
                  >
                    {parsed[key] || (
                      <span className="text-gray-400 italic">Click to edit</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Version History */}
          <div className="border-t pt-4 mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              Version History
            </h3>
            <div className="space-y-2">
              {displayVersions.map((v, i) => (
                <div
                  key={v.version_id}
                  className="flex items-center justify-between text-sm border rounded px-3 py-2 bg-white"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">v{v.version_number}</span>
                    {i === 0 && (
                      <span className="text-xs text-gray-400">Current</span>
                    )}
                    <StateBadge state={v.approval_state} />
                    {v.approved_by && (
                      <span className="text-xs text-gray-400">
                        by {v.approved_by}
                      </span>
                    )}
                    {v.rejected_by && (
                      <span className="text-xs text-gray-400">
                        by {v.rejected_by}
                        {v.rejection_reason && ` — "${v.rejection_reason}"`}
                      </span>
                    )}
                    <span className="text-xs text-gray-400">
                      {formatDate(v.generated_at)}
                    </span>
                  </div>
                  {i > 0 && (
                    <button
                      onClick={() => handleRestore(v.version_id)}
                      disabled={actionLoading}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Restore v{v.version_number}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          {currentVersion.approval_state === "pending" && (
            <div className="flex items-center justify-between border-t pt-4">
              <button
                onClick={handleReject}
                disabled={actionLoading}
                className="bg-red-50 text-red-700 border border-red-200 px-6 py-2 rounded text-sm hover:bg-red-100 disabled:opacity-50"
              >
                ✗ Reject
              </button>
              <button
                onClick={handleApprove}
                disabled={actionLoading}
                className="bg-green-600 text-white px-6 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50"
              >
                {actionLoading
                  ? "Processing…"
                  : `✓ Approve for ${activeSite.charAt(0).toUpperCase() + activeSite.slice(1)}`}
              </button>
            </div>
          )}

          {currentVersion.approval_state === "review_pending" && (
            <div className="bg-purple-50 border border-purple-200 text-purple-700 px-4 py-3 rounded text-sm">
              Awaiting senior review approval
            </div>
          )}
        </>
      )}
    </div>
  );
}
