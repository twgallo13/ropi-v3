/**
 * TALLY-SETTINGS-UX Phase 3 / A.3 PR4 — SOP Panels admin page.
 * Mounted at /admin/experience/sop-panels.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  RoleGate, AdminCrudTable, AdminCrudColumn, ConfirmModal,
  ErrorBanner, SaveButton, showToast,
} from "../components/admin";
import {
  fetchSopPanels, createSopPanel, updateSopPanel,
  deactivateSopPanel, reactivateSopPanel, SopPanelEntry,
} from "../lib/api";

const HUB_OPTIONS: SopPanelEntry["hub"][] = [
  "import_hub", "completion_queue", "cadence_review", "launch_admin", "export_center",
];

function formatError(err: any): string {
  if (!err) return "Unknown error.";
  if (typeof err === "string") return err;
  return err.error || err.message || JSON.stringify(err);
}
const isRowActive = (r: SopPanelEntry) => r.is_active === true;
function compareRows(a: SopPanelEntry, b: SopPanelEntry, s: { key: string; dir: "asc" | "desc" }): number {
  const av = (a as any)[s.key]; const bv = (b as any)[s.key];
  let cmp = 0;
  if (av == null && bv == null) cmp = 0;
  else if (av == null) cmp = -1;
  else if (bv == null) cmp = 1;
  else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
  else cmp = String(av).localeCompare(String(bv));
  return s.dir === "asc" ? cmp : -cmp;
}

export default function SopPanelsPage() {
  const [rows, setRows] = useState<SopPanelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [sortState, setSortState] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "sort_order", dir: "asc" });
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorKey, setEditorKey] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<SopPanelEntry | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<SopPanelEntry | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await fetchSopPanels(false)); }
    catch (e: any) { setError(formatError(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const visibleRows = useMemo(() => {
    let r = rows;
    if (!showInactive) r = r.filter(isRowActive);
    return [...r].sort((a, b) => compareRows(a, b, sortState));
  }, [rows, showInactive, sortState]);

  const baseColumns: AdminCrudColumn<SopPanelEntry>[] = [
    { key: "panel_key", header: "Key", sortable: true, render: (r) => <code className="text-xs">{r.panel_key}</code> },
    { key: "hub", header: "Hub", sortable: true, render: (r) => <span className="text-xs">{r.hub}</span> },
    { key: "title", header: "Title", sortable: true, render: (r) => r.title },
    { key: "sort_order", header: "Order", sortable: true, render: (r) => r.sort_order },
    {
      key: "is_active", header: "Active", sortable: true,
      render: (r) => r.is_active
        ? <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">active</span>
        : <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">inactive</span>,
    },
  ];
  const reactivateColumn: AdminCrudColumn<SopPanelEntry> = {
    key: "_reactivate", header: "",
    render: (row) => !isRowActive(row)
      ? <button type="button" onClick={() => setReactivateTarget(row)} className="text-blue-600 hover:underline text-sm">Reactivate</button>
      : null,
  };
  const columns = showInactive ? [...baseColumns, reactivateColumn] : baseColumns;

  return (
    <RoleGate>
      <div className="max-w-6xl mx-auto p-6">
        <Link to="/admin/experience" className="text-sm text-blue-600 hover:underline">← Experience</Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">📘 SOP Panels</h1>
        <p className="text-gray-600 mb-6">Manage hub-scoped SOP panels (sidebar reference content).</p>

        <div className="flex items-center justify-between mb-4">
          <button type="button" onClick={() => { setEditorMode("create"); setEditorKey(null); }}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">+ New Panel</button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        </div>
        <div className="mb-4"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>
        <AdminCrudTable
          rows={visibleRows} columns={columns} rowKey={(r) => r.panel_key}
          onEdit={(r) => { setEditorMode("edit"); setEditorKey(r.panel_key); }}
          onDeactivate={(r) => setDeactivateTarget(r)}
          isLoading={loading} emptyMessage="No SOP panels."
          sortState={sortState} onSortChange={setSortState}
        />
        {editorMode !== null && (
          <SopPanelEditor mode={editorMode}
            initial={editorMode === "edit" ? rows.find((r) => r.panel_key === editorKey) ?? null : null}
            onSaved={async (savedKey, action) => {
              setEditorMode(null); setEditorKey(null);
              try { await load(); showToast(`Panel "${savedKey}" ${action}.`); }
              catch { showToast(`Panel "${savedKey}" ${action}. (Reload failed; refresh.)`);
                setError("Saved, but failed to reload table. Refresh to see latest."); }
            }}
            onCancel={() => { setEditorMode(null); setEditorKey(null); }}
          />
        )}
        <ConfirmModal
          open={deactivateTarget !== null}
          title={`Deactivate "${deactivateTarget?.title ?? ""}"?`}
          body={deactivateTarget ? `Deactivate panel '${deactivateTarget.panel_key}'? It can be reactivated later.` : ""}
          confirmLabel="Deactivate" confirmVariant="primary"
          onConfirm={async () => {
            if (!deactivateTarget) return;
            const justKey = deactivateTarget.panel_key;
            try {
              await deactivateSopPanel(justKey);
              setDeactivateTarget(null); setDeactivateError(null);
              try { await load(); showToast(`Panel "${justKey}" deactivated.`); }
              catch { showToast(`Panel "${justKey}" deactivated. (Reload failed; refresh.)`);
                setError("Deactivated, but failed to reload table. Refresh to see latest."); }
            } catch (e: any) { setDeactivateError(formatError(e)); }
          }}
          onCancel={() => { setDeactivateTarget(null); setDeactivateError(null); }}
          errorSlot={deactivateError}
        />
        <ConfirmModal
          open={reactivateTarget !== null}
          title={`Reactivate "${reactivateTarget?.title ?? ""}"?`}
          body={`This will reactivate the panel.`}
          confirmLabel="Reactivate" confirmVariant="primary"
          onConfirm={async () => {
            if (!reactivateTarget) return;
            const justKey = reactivateTarget.panel_key;
            try {
              await reactivateSopPanel(justKey);
              setReactivateTarget(null); setReactivateError(null);
              try { await load(); showToast(`Panel "${justKey}" reactivated.`); }
              catch { showToast(`Panel "${justKey}" reactivated. (Reload failed; refresh.)`);
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
  initial: SopPanelEntry | null | undefined;
  onSaved: (savedKey: string, action: "created" | "updated") => void | Promise<void>;
  onCancel: () => void;
}

function SopPanelEditor({ mode, initial, onSaved, onCancel }: EditorProps) {
  const [panelKey, setPanelKey] = useState(initial?.panel_key ?? "");
  const [hub, setHub] = useState<SopPanelEntry["hub"]>(initial?.hub ?? "import_hub");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [contentMd, setContentMd] = useState(initial?.content_md ?? "");
  const [sortOrder, setSortOrder] = useState<number>(initial?.sort_order ?? 0);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [isSaving, setIsSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  async function handleSave() {
    setEditorError(null);
    if (mode === "create" && !panelKey.trim()) { setEditorError("panel_key is required."); return; }
    if (!title.trim()) { setEditorError("title is required."); return; }
    setIsSaving(true);
    try {
      const payload: Partial<SopPanelEntry> = {
        hub,
        title: title.trim(),
        content_md: contentMd,
        sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
        is_active: isActive,
      };
      if (mode === "create") {
        const created = await createSopPanel({ panel_key: panelKey.trim(), ...payload });
        await onSaved(created.panel_key, "created");
      } else {
        const updated = await updateSopPanel(initial!.panel_key, payload);
        await onSaved(updated.panel_key, "updated");
      }
    } catch (e: any) { setEditorError(formatError(e)); }
    finally { setIsSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !isSaving) onCancel(); }}>
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">
          {mode === "create" ? "New SOP Panel" : `Edit: ${initial?.panel_key ?? ""}`}
        </h2>
        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">panel_key *</label>
            <input type="text" value={panelKey}
              onChange={(e) => setPanelKey(e.target.value)} disabled={mode === "edit"}
              className="border rounded px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">hub *</label>
            <select value={hub}
              onChange={(e) => setHub(e.target.value as SopPanelEntry["hub"])}
              className="border rounded px-3 py-2 text-sm">
              {HUB_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">title *</label>
            <input type="text" value={title}
              onChange={(e) => setTitle(e.target.value)} className="border rounded px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">content_md (markdown)</label>
            <textarea value={contentMd} onChange={(e) => setContentMd(e.target.value)}
              rows={8} className="border rounded px-3 py-2 text-xs font-mono" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">sort_order</label>
            <input type="number" value={sortOrder}
              onChange={(e) => setSortOrder(parseInt(e.target.value, 10) || 0)}
              className="border rounded px-3 py-2 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <input id="sop-is-active" type="checkbox" checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)} />
            <label htmlFor="sop-is-active" className="text-sm">is_active</label>
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
