/**
 * Phase 3.3 PR 3.3a — AI Provider Registry list page.
 * Phase 3.3 PR 3.3b — Add Create / Edit / Deactivate (Option A: metadata only).
 *
 * Reads providers from BE GET /api/v1/admin/ai/providers (routes/aiPlane.ts).
 * Mutations via POST/PUT/DELETE — metadata-only. API key VALUES live in GCP
 * Secret Manager and are mounted into Cloud Run via the deploy script; this
 * page only manages provider metadata + the env var name mapping.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AdminCrudTable,
  ConfirmModal,
  RoleGate,
  showToast,
} from "../components/admin";
import type { AdminCrudColumn } from "../components/admin/AdminCrudTable";
import { AIProviderEditor } from "../components/admin/AIProviderEditor";
import {
  deactivateAIProvider,
  fetchAIProviders,
  type AIProvider,
} from "../lib/api";

const COLUMNS_BASE: AdminCrudColumn<AIProvider>[] = [
  {
    key: "display_name",
    header: "Display Name",
    render: (p) => <span className="font-medium">{p.display_name}</span>,
  },
  {
    key: "api_key_source",
    header: "Key Source",
    render: (p) => <code className="text-xs">{p.api_key_source}</code>,
  },
  {
    key: "api_key_env_var_name",
    header: "Env Var Name",
    render: (p) =>
      p.api_key_source === "env_var" ? (
        <code className="text-xs">{p.api_key_env_var_name ?? "—"}</code>
      ) : (
        <span className="text-gray-400">—</span>
      ),
  },
  {
    key: "is_active",
    header: "Active",
    render: (p) =>
      p.is_active ? (
        <span className="px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded">
          Active
        </span>
      ) : (
        <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
          Inactive
        </span>
      ),
  },
  {
    key: "models",
    header: "Models",
    render: (p) => <span>{p.models?.length ?? 0}</span>,
  },
];

const ADVANCED_COLUMN: AdminCrudColumn<AIProvider> = {
  key: "provider_key",
  header: "Provider Key",
  render: (p) => <code className="text-xs">{p.provider_key}</code>,
};

function formatError(err: any): string {
  if (!err) return "Unknown error.";
  if (typeof err === "string") return err;
  return err.error || err.message || JSON.stringify(err);
}

type EditorState =
  | { mode: "create"; provider: null }
  | { mode: "edit"; provider: AIProvider }
  | null;

export default function AIProvidersListPage() {
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editorState, setEditorState] = useState<EditorState>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<AIProvider | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAIProviders();
      setProviders(data);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const sorted = [...providers].sort(
    (a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
      a.display_name.localeCompare(b.display_name)
  );

  const columns: AdminCrudColumn<AIProvider>[] = showAdvanced
    ? [COLUMNS_BASE[0], ADVANCED_COLUMN, ...COLUMNS_BASE.slice(1)]
    : COLUMNS_BASE;

  return (
    <RoleGate>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-4">
          <Link
            to="/admin/ai-automation"
            className="text-sm text-gray-500 hover:text-blue-600"
          >
            ← AI &amp; Automation
          </Link>
        </div>

        <div className="flex justify-between items-start mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-bold">🤖 AI Provider Registry</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              View and manage configured AI providers used by the automation pipeline.
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 max-w-2xl">
              Note: API key values live in GCP Secret Manager and are mounted
              into Cloud Run via the deploy script. This page manages provider
              metadata and the env var name mapping only. Key rotation requires
              GCP Console + redeploy.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm whitespace-nowrap">
            <input
              type="checkbox"
              checked={showAdvanced}
              onChange={(e) => setShowAdvanced(e.target.checked)}
            />
            Show advanced
          </label>
        </div>

        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={() => setEditorState({ mode: "create", provider: null })}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            + New Provider
          </button>
        </div>

        {error ? (
          <div className="p-4 rounded border border-red-200 bg-red-50 text-red-700 text-sm">
            Error loading providers: {error}
          </div>
        ) : (
          <AdminCrudTable<AIProvider>
            rows={sorted}
            columns={columns}
            rowKey={(p) => p.provider_key}
            isLoading={loading}
            emptyMessage="No AI providers configured."
            onEdit={(p) => setEditorState({ mode: "edit", provider: p })}
            onDeactivate={(p) => setDeactivateTarget(p)}
          />
        )}

        {editorState !== null && (
          <AIProviderEditor
            mode={editorState.mode}
            initial={editorState.mode === "edit" ? editorState.provider : null}
            onSaved={async (saved, action) => {
              setEditorState(null);
              try {
                await load();
                showToast(`Provider "${saved.display_name}" ${action}.`);
              } catch {
                showToast(
                  `Provider "${saved.display_name}" ${action}. (Reload failed; refresh.)`
                );
                setError("Saved, but failed to reload table. Refresh to see latest.");
              }
            }}
            onCancel={() => setEditorState(null)}
          />
        )}

        <ConfirmModal
          open={deactivateTarget !== null}
          title="Deactivate Provider"
          body={
            deactivateTarget
              ? `Deactivate ${deactivateTarget.display_name}? Provider will become inactive and unavailable for AI workflows. This is reversible via direct Firestore edit (no UI for reactivation in this PR).`
              : ""
          }
          confirmLabel="Deactivate"
          confirmVariant="destructive"
          onConfirm={async () => {
            if (!deactivateTarget) return;
            const target = deactivateTarget;
            try {
              await deactivateAIProvider(target.provider_key);
              setDeactivateTarget(null);
              setDeactivateError(null);
              try {
                await load();
                showToast(`Provider "${target.display_name}" deactivated.`);
              } catch {
                showToast(
                  `Provider "${target.display_name}" deactivated. (Reload failed; refresh.)`
                );
                setError("Deactivated, but failed to reload table. Refresh to see latest.");
              }
            } catch (e: any) {
              setDeactivateError(formatError(e));
            }
          }}
          onCancel={() => {
            setDeactivateTarget(null);
            setDeactivateError(null);
          }}
          errorSlot={deactivateError}
        />
      </div>
    </RoleGate>
  );
}
