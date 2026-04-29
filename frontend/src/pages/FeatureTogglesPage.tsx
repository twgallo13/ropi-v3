/**
 * TALLY-SETTINGS-UX Phase 3 / A.3 PR4 — Feature Toggles admin page.
 * Mounted at /admin/governance/feature-toggles.
 * Schema has no is_active; "deactivate" sets is_enabled=false.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  RoleGate, AdminCrudTable, AdminCrudColumn, ConfirmModal,
  ErrorBanner, SaveButton, showToast,
} from "../components/admin";
import {
  fetchFeatureToggles, createFeatureToggle, updateFeatureToggle,
  deactivateFeatureToggle, reactivateFeatureToggle, FeatureToggleEntry,
} from "../lib/api";

function formatError(err: any): string {
  if (!err) return "Unknown error.";
  if (typeof err === "string") return err;
  return err.error || err.message || JSON.stringify(err);
}
const isRowEnabled = (r: FeatureToggleEntry) => r.is_enabled === true;
function compareRows(a: FeatureToggleEntry, b: FeatureToggleEntry, s: { key: string; dir: "asc" | "desc" }): number {
  const av = (a as any)[s.key]; const bv = (b as any)[s.key];
  let cmp = 0;
  if (av == null && bv == null) cmp = 0;
  else if (av == null) cmp = -1;
  else if (bv == null) cmp = 1;
  else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
  else cmp = String(av).localeCompare(String(bv));
  return s.dir === "asc" ? cmp : -cmp;
}

export default function FeatureTogglesPage() {
  const [rows, setRows] = useState<FeatureToggleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDisabled, setShowDisabled] = useState(false);
  const [sortState, setSortState] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "toggle_key", dir: "asc" });
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorKey, setEditorKey] = useState<string | null>(null);
  const [disableTarget, setDisableTarget] = useState<FeatureToggleEntry | null>(null);
  const [disableError, setDisableError] = useState<string | null>(null);
  const [enableTarget, setEnableTarget] = useState<FeatureToggleEntry | null>(null);
  const [enableError, setEnableError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await fetchFeatureToggles(false)); }
    catch (e: any) { setError(formatError(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const visibleRows = useMemo(() => {
    let r = rows;
    if (!showDisabled) r = r.filter(isRowEnabled);
    return [...r].sort((a, b) => compareRows(a, b, sortState));
  }, [rows, showDisabled, sortState]);

  const baseColumns: AdminCrudColumn<FeatureToggleEntry>[] = [
    { key: "toggle_key", header: "Toggle Key", sortable: true, render: (r) => <code className="text-xs">{r.toggle_key}</code> },
    { key: "display_label", header: "Label", sortable: true, render: (r) => r.display_label },
    { key: "description", header: "Description", render: (r) => <span className="text-xs text-gray-600">{r.description || "—"}</span> },
    {
      key: "is_enabled", header: "Enabled", sortable: true,
      render: (r) => r.is_enabled
        ? <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">enabled</span>
        : <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">disabled</span>,
    },
  ];
  const enableColumn: AdminCrudColumn<FeatureToggleEntry> = {
    key: "_enable", header: "",
    render: (row) => !isRowEnabled(row)
      ? <button type="button" onClick={() => setEnableTarget(row)} className="text-blue-600 hover:underline text-sm">Enable</button>
      : null,
  };
  const columns = showDisabled ? [...baseColumns, enableColumn] : baseColumns;

  return (
    <RoleGate>
      <div className="max-w-6xl mx-auto p-6">
        <Link to="/admin/governance" className="text-sm text-blue-600 hover:underline">← Governance</Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">🚩 Feature Toggles</h1>
        <p className="text-gray-600 mb-6">Manage feature gates. Disabling hides the feature for all users.</p>

        <div className="flex items-center justify-between mb-4">
          <button type="button" onClick={() => { setEditorMode("create"); setEditorKey(null); }}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">+ New Toggle</button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showDisabled} onChange={(e) => setShowDisabled(e.target.checked)} />
            Show disabled
          </label>
        </div>
        <div className="mb-4"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>
        <AdminCrudTable
          rows={visibleRows} columns={columns} rowKey={(r) => r.toggle_key}
          onEdit={(r) => { setEditorMode("edit"); setEditorKey(r.toggle_key); }}
          onDeactivate={(r) => setDisableTarget(r)}
          isLoading={loading} emptyMessage="No feature toggles."
          sortState={sortState} onSortChange={setSortState}
        />
        {editorMode !== null && (
          <FeatureToggleEditor mode={editorMode}
            initial={editorMode === "edit" ? rows.find((r) => r.toggle_key === editorKey) ?? null : null}
            onSaved={async (savedKey, action) => {
              setEditorMode(null); setEditorKey(null);
              try { await load(); showToast(`Toggle "${savedKey}" ${action}.`); }
              catch { showToast(`Toggle "${savedKey}" ${action}. (Reload failed; refresh.)`);
                setError("Saved, but failed to reload table. Refresh to see latest."); }
            }}
            onCancel={() => { setEditorMode(null); setEditorKey(null); }}
          />
        )}
        <ConfirmModal
          open={disableTarget !== null}
          title={`Disable "${disableTarget?.display_label ?? ""}"?`}
          body={disableTarget ? `Disable feature toggle '${disableTarget.toggle_key}'? This will hide the gated feature from all users immediately.` : ""}
          confirmLabel="Disable" confirmVariant="primary"
          onConfirm={async () => {
            if (!disableTarget) return;
            const justKey = disableTarget.toggle_key;
            try {
              await deactivateFeatureToggle(justKey);
              setDisableTarget(null); setDisableError(null);
              try { await load(); showToast(`Toggle "${justKey}" disabled.`); }
              catch { showToast(`Toggle "${justKey}" disabled. (Reload failed; refresh.)`);
                setError("Disabled, but failed to reload table. Refresh to see latest."); }
            } catch (e: any) { setDisableError(formatError(e)); }
          }}
          onCancel={() => { setDisableTarget(null); setDisableError(null); }}
          errorSlot={disableError}
        />
        <ConfirmModal
          open={enableTarget !== null}
          title={`Enable "${enableTarget?.display_label ?? ""}"?`}
          body={`This will re-enable the feature for all users.`}
          confirmLabel="Enable" confirmVariant="primary"
          onConfirm={async () => {
            if (!enableTarget) return;
            const justKey = enableTarget.toggle_key;
            try {
              await reactivateFeatureToggle(justKey);
              setEnableTarget(null); setEnableError(null);
              try { await load(); showToast(`Toggle "${justKey}" enabled.`); }
              catch { showToast(`Toggle "${justKey}" enabled. (Reload failed; refresh.)`);
                setError("Enabled, but failed to reload table. Refresh to see latest."); }
            } catch (e: any) { setEnableError(formatError(e)); }
          }}
          onCancel={() => { setEnableTarget(null); setEnableError(null); }}
          errorSlot={enableError}
        />
      </div>
    </RoleGate>
  );
}

interface EditorProps {
  mode: "create" | "edit";
  initial: FeatureToggleEntry | null | undefined;
  onSaved: (savedKey: string, action: "created" | "updated") => void | Promise<void>;
  onCancel: () => void;
}

function FeatureToggleEditor({ mode, initial, onSaved, onCancel }: EditorProps) {
  const [toggleKey, setToggleKey] = useState(initial?.toggle_key ?? "");
  const [displayLabel, setDisplayLabel] = useState(initial?.display_label ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [isEnabled, setIsEnabled] = useState(initial?.is_enabled ?? true);
  const [isSaving, setIsSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  async function handleSave() {
    setEditorError(null);
    if (mode === "create" && !toggleKey.trim()) { setEditorError("toggle_key is required."); return; }
    if (!displayLabel.trim()) { setEditorError("display_label is required."); return; }
    setIsSaving(true);
    try {
      const payload: Partial<FeatureToggleEntry> = {
        display_label: displayLabel.trim(),
        description: description.trim(),
        is_enabled: isEnabled,
      };
      if (mode === "create") {
        const created = await createFeatureToggle({ toggle_key: toggleKey.trim(), ...payload });
        await onSaved(created.toggle_key, "created");
      } else {
        const updated = await updateFeatureToggle(initial!.toggle_key, payload);
        await onSaved(updated.toggle_key, "updated");
      }
    } catch (e: any) { setEditorError(formatError(e)); }
    finally { setIsSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !isSaving) onCancel(); }}>
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">
          {mode === "create" ? "New Feature Toggle" : `Edit: ${initial?.toggle_key ?? ""}`}
        </h2>
        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">toggle_key *</label>
            <input type="text" value={toggleKey}
              onChange={(e) => setToggleKey(e.target.value)} disabled={mode === "edit"}
              className="border rounded px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">display_label *</label>
            <input type="text" value={displayLabel}
              onChange={(e) => setDisplayLabel(e.target.value)} className="border rounded px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              rows={3} className="border rounded px-3 py-2 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <input id="ft-is-enabled" type="checkbox" checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)} />
            <label htmlFor="ft-is-enabled" className="text-sm">is_enabled</label>
          </div>
          <ErrorBanner message={editorError} onDismiss={() => setEditorError(null)} />
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button type="button" onClick={onCancel} disabled={isSaving}
            className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded text-sm">Cancel</button>
          <SaveButton onClick={handleSave} isSaving={isSaving} />
        </div>
      </div>
    </div>
  );
}
