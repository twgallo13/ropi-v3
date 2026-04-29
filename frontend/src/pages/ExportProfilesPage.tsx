/**
 * TALLY-SETTINGS-UX Phase 3 / A.3 PR4 — Export Profiles admin page.
 * Mounted at /admin/pipeline/export-profiles (existing route mount;
 * placeholder body filled — file replaced in-place per dispatch step 8).
 *
 * E.5 NOTE: filter_query is METADATA ONLY in A.3; NOT evaluated as a
 * query. Renders as a plain textarea — no execution-suggestive UI.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  RoleGate, AdminCrudTable, AdminCrudColumn, ConfirmModal,
  ErrorBanner, SaveButton, showToast,
} from "../components/admin";
import {
  fetchExportProfiles, createExportProfile, updateExportProfile,
  deactivateExportProfile, reactivateExportProfile,
  ExportProfileEntry, ExportProfileFieldMapEntry,
} from "../lib/api";

const FORMAT_OPTIONS: ExportProfileEntry["target_format"][] = ["csv", "json", "xml"];

function formatError(err: any): string {
  if (!err) return "Unknown error.";
  if (typeof err === "string") return err;
  return err.error || err.message || JSON.stringify(err);
}
const isRowActive = (r: ExportProfileEntry) => r.is_active === true;
function compareRows(a: ExportProfileEntry, b: ExportProfileEntry, s: { key: string; dir: "asc" | "desc" }): number {
  const av = (a as any)[s.key]; const bv = (b as any)[s.key];
  let cmp = 0;
  if (av == null && bv == null) cmp = 0;
  else if (av == null) cmp = -1;
  else if (bv == null) cmp = 1;
  else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
  else cmp = String(av).localeCompare(String(bv));
  return s.dir === "asc" ? cmp : -cmp;
}

export default function ExportProfilesPage() {
  const [rows, setRows] = useState<ExportProfileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [sortState, setSortState] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "profile_key", dir: "asc" });
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorKey, setEditorKey] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<ExportProfileEntry | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<ExportProfileEntry | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await fetchExportProfiles(false)); }
    catch (e: any) { setError(formatError(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const visibleRows = useMemo(() => {
    let r = rows;
    if (!showInactive) r = r.filter(isRowActive);
    return [...r].sort((a, b) => compareRows(a, b, sortState));
  }, [rows, showInactive, sortState]);

  const baseColumns: AdminCrudColumn<ExportProfileEntry>[] = [
    { key: "profile_key", header: "Profile Key", sortable: true, render: (r) => <code className="text-xs">{r.profile_key}</code> },
    { key: "display_label", header: "Label", sortable: true, render: (r) => r.display_label },
    { key: "target_format", header: "Format", sortable: true, render: (r) => <span className="text-xs uppercase">{r.target_format}</span> },
    { key: "field_map", header: "Fields", render: (r) => <span className="text-xs">{(r.field_map || []).length}</span> },
    {
      key: "is_active", header: "Active", sortable: true,
      render: (r) => r.is_active
        ? <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">active</span>
        : <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">inactive</span>,
    },
  ];
  const reactivateColumn: AdminCrudColumn<ExportProfileEntry> = {
    key: "_reactivate", header: "",
    render: (row) => !isRowActive(row)
      ? <button type="button" onClick={() => setReactivateTarget(row)} className="text-blue-600 hover:underline text-sm">Reactivate</button>
      : null,
  };
  const columns = showInactive ? [...baseColumns, reactivateColumn] : baseColumns;

  return (
    <RoleGate>
      <div className="max-w-6xl mx-auto p-6">
        <Link to="/admin/pipeline" className="text-sm text-blue-600 hover:underline">← Pipeline</Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">📤 Export Profiles</h1>
        <p className="text-gray-600 mb-6">Manage channel-specific export field mappings and target formats.</p>

        <div className="flex items-center justify-between mb-4">
          <button type="button" onClick={() => { setEditorMode("create"); setEditorKey(null); }}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">+ New Profile</button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        </div>
        <div className="mb-4"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>
        <AdminCrudTable
          rows={visibleRows} columns={columns} rowKey={(r) => r.profile_key}
          onEdit={(r) => { setEditorMode("edit"); setEditorKey(r.profile_key); }}
          onDeactivate={(r) => setDeactivateTarget(r)}
          isLoading={loading} emptyMessage="No export profiles."
          sortState={sortState} onSortChange={setSortState}
        />
        {editorMode !== null && (
          <ExportProfileEditor mode={editorMode}
            initial={editorMode === "edit" ? rows.find((r) => r.profile_key === editorKey) ?? null : null}
            onSaved={async (savedKey, action) => {
              setEditorMode(null); setEditorKey(null);
              try { await load(); showToast(`Profile "${savedKey}" ${action}.`); }
              catch { showToast(`Profile "${savedKey}" ${action}. (Reload failed; refresh.)`);
                setError("Saved, but failed to reload table. Refresh to see latest."); }
            }}
            onCancel={() => { setEditorMode(null); setEditorKey(null); }}
          />
        )}
        <ConfirmModal
          open={deactivateTarget !== null}
          title={`Deactivate "${deactivateTarget?.display_label ?? ""}"?`}
          body={deactivateTarget ? `Deactivate profile '${deactivateTarget.profile_key}'? It can be reactivated later.` : ""}
          confirmLabel="Deactivate" confirmVariant="primary"
          onConfirm={async () => {
            if (!deactivateTarget) return;
            const justKey = deactivateTarget.profile_key;
            try {
              await deactivateExportProfile(justKey);
              setDeactivateTarget(null); setDeactivateError(null);
              try { await load(); showToast(`Profile "${justKey}" deactivated.`); }
              catch { showToast(`Profile "${justKey}" deactivated. (Reload failed; refresh.)`);
                setError("Deactivated, but failed to reload table. Refresh to see latest."); }
            } catch (e: any) { setDeactivateError(formatError(e)); }
          }}
          onCancel={() => { setDeactivateTarget(null); setDeactivateError(null); }}
          errorSlot={deactivateError}
        />
        <ConfirmModal
          open={reactivateTarget !== null}
          title={`Reactivate "${reactivateTarget?.display_label ?? ""}"?`}
          body={`This will reactivate the profile.`}
          confirmLabel="Reactivate" confirmVariant="primary"
          onConfirm={async () => {
            if (!reactivateTarget) return;
            const justKey = reactivateTarget.profile_key;
            try {
              await reactivateExportProfile(justKey);
              setReactivateTarget(null); setReactivateError(null);
              try { await load(); showToast(`Profile "${justKey}" reactivated.`); }
              catch { showToast(`Profile "${justKey}" reactivated. (Reload failed; refresh.)`);
                setError("Reactivated, but failed to reload table. Refresh to see latest."); }
            } catch (e: any) { setReactivateError(formatError(e)); }
          }}
          onCancel={() => { setReactivateTarget(null); setReactivateError(null); }}
          errorSlot={reactivateError}
        />
      </div>
    </RoleGate>
  );
}

interface EditorProps {
  mode: "create" | "edit";
  initial: ExportProfileEntry | null | undefined;
  onSaved: (savedKey: string, action: "created" | "updated") => void | Promise<void>;
  onCancel: () => void;
}

function ExportProfileEditor({ mode, initial, onSaved, onCancel }: EditorProps) {
  const [profileKey, setProfileKey] = useState(initial?.profile_key ?? "");
  const [displayLabel, setDisplayLabel] = useState(initial?.display_label ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [targetFormat, setTargetFormat] = useState<ExportProfileEntry["target_format"]>(initial?.target_format ?? "csv");
  const [fieldMap, setFieldMap] = useState<ExportProfileFieldMapEntry[]>(initial?.field_map ?? []);
  const [filterQuery, setFilterQuery] = useState(initial?.filter_query ?? "");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [isSaving, setIsSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  function addField() {
    setFieldMap((s) => [...s, { source_field: "", target_field: "" }]);
  }
  function removeField(idx: number) {
    setFieldMap((s) => s.filter((_, i) => i !== idx));
  }
  function updateField(idx: number, patch: Partial<ExportProfileFieldMapEntry>) {
    setFieldMap((s) => s.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }

  async function handleSave() {
    setEditorError(null);
    if (mode === "create" && !profileKey.trim()) { setEditorError("profile_key is required."); return; }
    if (!displayLabel.trim()) { setEditorError("display_label is required."); return; }
    for (let i = 0; i < fieldMap.length; i++) {
      const f = fieldMap[i];
      if (!f.source_field.trim()) { setEditorError(`Field ${i + 1}: source_field is required.`); return; }
      if (!f.target_field.trim()) { setEditorError(`Field ${i + 1}: target_field is required.`); return; }
    }
    setIsSaving(true);
    try {
      const cleanFields: ExportProfileFieldMapEntry[] = fieldMap.map((f) => {
        const out: ExportProfileFieldMapEntry = {
          source_field: f.source_field.trim(),
          target_field: f.target_field.trim(),
        };
        if (f.transform && f.transform.trim()) out.transform = f.transform.trim();
        return out;
      });
      const payload: Partial<ExportProfileEntry> = {
        display_label: displayLabel.trim(),
        description: description.trim(),
        target_format: targetFormat,
        field_map: cleanFields,
        filter_query: filterQuery,
        is_active: isActive,
      };
      if (mode === "create") {
        const created = await createExportProfile({ profile_key: profileKey.trim(), ...payload });
        await onSaved(created.profile_key, "created");
      } else {
        const updated = await updateExportProfile(initial!.profile_key, payload);
        await onSaved(updated.profile_key, "updated");
      }
    } catch (e: any) { setEditorError(formatError(e)); }
    finally { setIsSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !isSaving) onCancel(); }}>
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">
          {mode === "create" ? "New Export Profile" : `Edit: ${initial?.profile_key ?? ""}`}
        </h2>
        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">profile_key *</label>
            <input type="text" value={profileKey}
              onChange={(e) => setProfileKey(e.target.value)} disabled={mode === "edit"}
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
              rows={2} className="border rounded px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">target_format *</label>
            <select value={targetFormat}
              onChange={(e) => setTargetFormat(e.target.value as ExportProfileEntry["target_format"])}
              className="border rounded px-3 py-2 text-sm">
              {FORMAT_OPTIONS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
          </div>

          <div className="border-t pt-3 mt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Field Map ({fieldMap.length})</label>
              <button type="button" onClick={addField}
                className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded">+ Add Field</button>
            </div>
            {fieldMap.length === 0 && <p className="text-xs text-gray-500 italic">No fields mapped yet.</p>}
            <div className="space-y-2">
              {fieldMap.map((f, idx) => (
                <div key={idx} className="border rounded p-2 bg-gray-50 dark:bg-gray-800 grid grid-cols-1 md:grid-cols-12 gap-2 items-start">
                  <input type="text" value={f.source_field}
                    onChange={(e) => updateField(idx, { source_field: e.target.value })}
                    placeholder="source_field *"
                    className="md:col-span-4 border rounded px-2 py-1 text-xs" />
                  <input type="text" value={f.target_field}
                    onChange={(e) => updateField(idx, { target_field: e.target.value })}
                    placeholder="target_field *"
                    className="md:col-span-4 border rounded px-2 py-1 text-xs" />
                  <input type="text" value={f.transform ?? ""}
                    onChange={(e) => updateField(idx, { transform: e.target.value })}
                    placeholder="transform (optional)"
                    className="md:col-span-3 border rounded px-2 py-1 text-xs" />
                  <button type="button" onClick={() => removeField(idx)}
                    className="md:col-span-1 text-xs px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 border rounded">×</button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">filter_query (metadata only)</label>
            <textarea value={filterQuery} onChange={(e) => setFilterQuery(e.target.value)}
              rows={3} className="border rounded px-3 py-2 text-xs font-mono"
              placeholder="Free-text. Stored as metadata only — not evaluated by the export pipeline." />
            <p className="text-xs text-gray-500">
              This field is stored as metadata only and is not evaluated as a query in this release.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input id="ep-is-active" type="checkbox" checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)} />
            <label htmlFor="ep-is-active" className="text-sm">is_active</label>
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
