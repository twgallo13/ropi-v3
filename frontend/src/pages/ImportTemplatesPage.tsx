/**
 * TALLY-SETTINGS-UX Phase 3 / A.3 PR4 — Import Templates admin page.
 * Pattern: B.2 SiteRegistryAdminPage exemplar (inline overlay editor,
 * editorMode/editorKey two-state, default-hide inactive, toast-after-write).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  RoleGate,
  AdminCrudTable,
  AdminCrudColumn,
  ConfirmModal,
  ErrorBanner,
  SaveButton,
  showToast,
} from "../components/admin";
import {
  fetchImportTemplates,
  createImportTemplate,
  updateImportTemplate,
  deactivateImportTemplate,
  reactivateImportTemplate,
  ImportTemplateEntry,
} from "../lib/api";

function formatError(err: any): string {
  if (!err) return "Unknown error.";
  if (typeof err === "string") return err;
  return err.error || err.message || JSON.stringify(err);
}
const isRowActive = (r: ImportTemplateEntry) => r.is_active === true;
function compareRows(a: ImportTemplateEntry, b: ImportTemplateEntry, s: { key: string; dir: "asc" | "desc" }): number {
  const av = (a as any)[s.key]; const bv = (b as any)[s.key];
  let cmp = 0;
  if (av == null && bv == null) cmp = 0;
  else if (av == null) cmp = -1;
  else if (bv == null) cmp = 1;
  else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
  else cmp = String(av).localeCompare(String(bv));
  return s.dir === "asc" ? cmp : -cmp;
}

export default function ImportTemplatesPage() {
  const [rows, setRows] = useState<ImportTemplateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [sortState, setSortState] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "template_key", dir: "asc" });
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorKey, setEditorKey] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<ImportTemplateEntry | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<ImportTemplateEntry | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await fetchImportTemplates(false)); }
    catch (e: any) { setError(formatError(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const visibleRows = useMemo(() => {
    let r = rows;
    if (!showInactive) r = r.filter(isRowActive);
    return [...r].sort((a, b) => compareRows(a, b, sortState));
  }, [rows, showInactive, sortState]);

  const baseColumns: AdminCrudColumn<ImportTemplateEntry>[] = [
    { key: "template_key", header: "Template Key", sortable: true, render: (r) => <code className="text-xs">{r.template_key}</code> },
    { key: "display_label", header: "Label", sortable: true, render: (r) => r.display_label },
    { key: "target_collection", header: "Target Collection", sortable: true, render: (r) => <code className="text-xs">{r.target_collection}</code> },
    { key: "description", header: "Description", render: (r) => <span className="text-xs text-gray-600">{r.description || "—"}</span> },
    {
      key: "is_active", header: "Active", sortable: true,
      render: (r) => r.is_active
        ? <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">active</span>
        : <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">inactive</span>,
    },
  ];
  const reactivateColumn: AdminCrudColumn<ImportTemplateEntry> = {
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
        <h1 className="text-2xl font-bold mt-2 mb-1">📥 Import Templates</h1>
        <p className="text-gray-600 mb-6">Manage CSV/JSON import schemas mapped to target collections.</p>

        <div className="flex items-center justify-between mb-4">
          <button type="button"
            onClick={() => { setEditorMode("create"); setEditorKey(null); }}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
            + New Template
          </button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        </div>

        <div className="mb-4"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>

        <AdminCrudTable
          rows={visibleRows} columns={columns} rowKey={(r) => r.template_key}
          onEdit={(r) => { setEditorMode("edit"); setEditorKey(r.template_key); }}
          onDeactivate={(r) => setDeactivateTarget(r)}
          isLoading={loading} emptyMessage="No import templates."
          sortState={sortState} onSortChange={setSortState}
        />

        {editorMode !== null && (
          <ImportTemplateEditor
            mode={editorMode}
            initial={editorMode === "edit" ? rows.find((r) => r.template_key === editorKey) ?? null : null}
            onSaved={async (savedKey, action) => {
              setEditorMode(null); setEditorKey(null);
              try { await load(); showToast(`Import template "${savedKey}" ${action}.`); }
              catch { showToast(`Import template "${savedKey}" ${action}. (Reload failed; refresh.)`);
                setError("Saved, but failed to reload table. Refresh to see latest."); }
            }}
            onCancel={() => { setEditorMode(null); setEditorKey(null); }}
          />
        )}

        <ConfirmModal
          open={deactivateTarget !== null}
          title={`Deactivate "${deactivateTarget?.display_label ?? ""}"?`}
          body={deactivateTarget ? `Deactivate template '${deactivateTarget.template_key}'? It can be reactivated later. Inactive templates stop appearing in import dropdowns.` : ""}
          confirmLabel="Deactivate" confirmVariant="primary"
          onConfirm={async () => {
            if (!deactivateTarget) return;
            const justKey = deactivateTarget.template_key;
            try {
              await deactivateImportTemplate(justKey);
              setDeactivateTarget(null); setDeactivateError(null);
              try { await load(); showToast(`Template "${justKey}" deactivated.`); }
              catch { showToast(`Template "${justKey}" deactivated. (Reload failed; refresh.)`);
                setError("Deactivated, but failed to reload table. Refresh to see latest."); }
            } catch (e: any) { setDeactivateError(formatError(e)); }
          }}
          onCancel={() => { setDeactivateTarget(null); setDeactivateError(null); }}
          errorSlot={deactivateError}
        />

        <ConfirmModal
          open={reactivateTarget !== null}
          title={`Reactivate "${reactivateTarget?.display_label ?? ""}"?`}
          body={`This will reactivate the template. It will become visible to operators again.`}
          confirmLabel="Reactivate" confirmVariant="primary"
          onConfirm={async () => {
            if (!reactivateTarget) return;
            const justKey = reactivateTarget.template_key;
            try {
              await reactivateImportTemplate(justKey);
              setReactivateTarget(null); setReactivateError(null);
              try { await load(); showToast(`Template "${justKey}" reactivated.`); }
              catch { showToast(`Template "${justKey}" reactivated. (Reload failed; refresh.)`);
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
  initial: ImportTemplateEntry | null | undefined;
  onSaved: (savedKey: string, action: "created" | "updated") => void | Promise<void>;
  onCancel: () => void;
}

function ImportTemplateEditor({ mode, initial, onSaved, onCancel }: EditorProps) {
  const [templateKey, setTemplateKey] = useState(initial?.template_key ?? "");
  const [displayLabel, setDisplayLabel] = useState(initial?.display_label ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [targetCollection, setTargetCollection] = useState(initial?.target_collection ?? "");
  const [schemaJsonText, setSchemaJsonText] = useState(
    initial?.schema_json ? JSON.stringify(initial.schema_json, null, 2) : "{}"
  );
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [isSaving, setIsSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  async function handleSave() {
    setEditorError(null);
    if (mode === "create" && !templateKey.trim()) { setEditorError("template_key is required."); return; }
    if (!displayLabel.trim()) { setEditorError("display_label is required."); return; }
    if (!targetCollection.trim()) { setEditorError("target_collection is required."); return; }
    let schemaJson: Record<string, any>;
    try { schemaJson = JSON.parse(schemaJsonText || "{}"); }
    catch { setEditorError("schema_json must be valid JSON."); return; }
    if (typeof schemaJson !== "object" || Array.isArray(schemaJson) || schemaJson === null) {
      setEditorError("schema_json must be a JSON object."); return;
    }
    setIsSaving(true);
    try {
      const payload: Partial<ImportTemplateEntry> = {
        display_label: displayLabel.trim(),
        description: description.trim(),
        target_collection: targetCollection.trim(),
        schema_json: schemaJson,
        is_active: isActive,
      };
      if (mode === "create") {
        const created = await createImportTemplate({ template_key: templateKey.trim(), ...payload });
        await onSaved(created.template_key, "created");
      } else {
        const updated = await updateImportTemplate(initial!.template_key, payload);
        await onSaved(updated.template_key, "updated");
      }
    } catch (e: any) { setEditorError(formatError(e)); }
    finally { setIsSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !isSaving) onCancel(); }}>
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">
          {mode === "create" ? "New Import Template" : `Edit: ${initial?.template_key ?? ""}`}
        </h2>
        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">template_key *</label>
            <input type="text" value={templateKey}
              onChange={(e) => setTemplateKey(e.target.value)} disabled={mode === "edit"}
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
            <label className="text-sm font-medium">target_collection *</label>
            <input type="text" value={targetCollection}
              onChange={(e) => setTargetCollection(e.target.value)}
              placeholder="e.g. products" className="border rounded px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">schema_json (JSON object)</label>
            <textarea value={schemaJsonText} onChange={(e) => setSchemaJsonText(e.target.value)}
              rows={8} className="border rounded px-3 py-2 text-xs font-mono" />
          </div>
          <div className="flex items-center gap-2">
            <input id="it-is-active" type="checkbox" checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)} />
            <label htmlFor="it-is-active" className="text-sm">is_active</label>
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
