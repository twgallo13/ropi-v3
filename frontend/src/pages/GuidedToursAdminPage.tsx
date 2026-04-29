/**
 * TALLY-SETTINGS-UX Phase 3 / A.3 PR4 — Guided Tours admin page.
 * Mounted at /admin/experience/guided-tours.
 * Editor includes nested TourStep[] editor with add/remove/reorder.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  RoleGate, AdminCrudTable, AdminCrudColumn, ConfirmModal,
  ErrorBanner, SaveButton, showToast,
} from "../components/admin";
import {
  fetchGuidedTours, createGuidedTour, updateGuidedTour,
  deactivateGuidedTour, reactivateGuidedTour,
  GuidedTourEntry, GuidedTourStep,
} from "../lib/api";

const HUB_OPTIONS: GuidedTourEntry["hub"][] = [
  "import_hub", "completion_queue", "cadence_review", "launch_admin", "export_center",
];
const POSITION_OPTIONS: Array<"" | "top" | "bottom" | "left" | "right"> = [
  "", "top", "bottom", "left", "right",
];

function formatError(err: any): string {
  if (!err) return "Unknown error.";
  if (typeof err === "string") return err;
  return err.error || err.message || JSON.stringify(err);
}
const isRowActive = (r: GuidedTourEntry) => r.is_active === true;
function compareRows(a: GuidedTourEntry, b: GuidedTourEntry, s: { key: string; dir: "asc" | "desc" }): number {
  const av = (a as any)[s.key]; const bv = (b as any)[s.key];
  let cmp = 0;
  if (av == null && bv == null) cmp = 0;
  else if (av == null) cmp = -1;
  else if (bv == null) cmp = 1;
  else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
  else cmp = String(av).localeCompare(String(bv));
  return s.dir === "asc" ? cmp : -cmp;
}

export default function GuidedToursAdminPage() {
  const [rows, setRows] = useState<GuidedTourEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [sortState, setSortState] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "tour_id", dir: "asc" });
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorKey, setEditorKey] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<GuidedTourEntry | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<GuidedTourEntry | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await fetchGuidedTours(false)); }
    catch (e: any) { setError(formatError(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const visibleRows = useMemo(() => {
    let r = rows;
    if (!showInactive) r = r.filter(isRowActive);
    return [...r].sort((a, b) => compareRows(a, b, sortState));
  }, [rows, showInactive, sortState]);

  const baseColumns: AdminCrudColumn<GuidedTourEntry>[] = [
    { key: "tour_id", header: "Tour ID", sortable: true, render: (r) => <code className="text-xs">{r.tour_id}</code> },
    { key: "hub", header: "Hub", sortable: true, render: (r) => <span className="text-xs">{r.hub}</span> },
    { key: "title", header: "Title", sortable: true, render: (r) => r.title },
    { key: "steps", header: "Steps", render: (r) => <span className="text-xs">{(r.steps || []).length}</span> },
    {
      key: "is_active", header: "Active", sortable: true,
      render: (r) => r.is_active
        ? <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">active</span>
        : <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">inactive</span>,
    },
  ];
  const reactivateColumn: AdminCrudColumn<GuidedTourEntry> = {
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
        <h1 className="text-2xl font-bold mt-2 mb-1">🧭 Guided Tours</h1>
        <p className="text-gray-600 mb-6">Manage hub-scoped onboarding tours.</p>

        <div className="flex items-center justify-between mb-4">
          <button type="button" onClick={() => { setEditorMode("create"); setEditorKey(null); }}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">+ New Tour</button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        </div>
        <div className="mb-4"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>
        <AdminCrudTable
          rows={visibleRows} columns={columns} rowKey={(r) => r.tour_id}
          onEdit={(r) => { setEditorMode("edit"); setEditorKey(r.tour_id); }}
          onDeactivate={(r) => setDeactivateTarget(r)}
          isLoading={loading} emptyMessage="No tours."
          sortState={sortState} onSortChange={setSortState}
        />
        {editorMode !== null && (
          <GuidedTourEditor mode={editorMode}
            initial={editorMode === "edit" ? rows.find((r) => r.tour_id === editorKey) ?? null : null}
            onSaved={async (savedKey, action) => {
              setEditorMode(null); setEditorKey(null);
              try { await load(); showToast(`Tour "${savedKey}" ${action}.`); }
              catch { showToast(`Tour "${savedKey}" ${action}. (Reload failed; refresh.)`);
                setError("Saved, but failed to reload table. Refresh to see latest."); }
            }}
            onCancel={() => { setEditorMode(null); setEditorKey(null); }}
          />
        )}
        <ConfirmModal
          open={deactivateTarget !== null}
          title={`Deactivate "${deactivateTarget?.title ?? ""}"?`}
          body={deactivateTarget ? `Deactivate tour '${deactivateTarget.tour_id}'? It can be reactivated later.` : ""}
          confirmLabel="Deactivate" confirmVariant="primary"
          onConfirm={async () => {
            if (!deactivateTarget) return;
            const justKey = deactivateTarget.tour_id;
            try {
              await deactivateGuidedTour(justKey);
              setDeactivateTarget(null); setDeactivateError(null);
              try { await load(); showToast(`Tour "${justKey}" deactivated.`); }
              catch { showToast(`Tour "${justKey}" deactivated. (Reload failed; refresh.)`);
                setError("Deactivated, but failed to reload table. Refresh to see latest."); }
            } catch (e: any) { setDeactivateError(formatError(e)); }
          }}
          onCancel={() => { setDeactivateTarget(null); setDeactivateError(null); }}
          errorSlot={deactivateError}
        />
        <ConfirmModal
          open={reactivateTarget !== null}
          title={`Reactivate "${reactivateTarget?.title ?? ""}"?`}
          body={`This will reactivate the tour.`}
          confirmLabel="Reactivate" confirmVariant="primary"
          onConfirm={async () => {
            if (!reactivateTarget) return;
            const justKey = reactivateTarget.tour_id;
            try {
              await reactivateGuidedTour(justKey);
              setReactivateTarget(null); setReactivateError(null);
              try { await load(); showToast(`Tour "${justKey}" reactivated.`); }
              catch { showToast(`Tour "${justKey}" reactivated. (Reload failed; refresh.)`);
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
  initial: GuidedTourEntry | null | undefined;
  onSaved: (savedKey: string, action: "created" | "updated") => void | Promise<void>;
  onCancel: () => void;
}

function GuidedTourEditor({ mode, initial, onSaved, onCancel }: EditorProps) {
  const [tourId, setTourId] = useState(initial?.tour_id ?? "");
  const [hub, setHub] = useState<GuidedTourEntry["hub"]>(initial?.hub ?? "import_hub");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [steps, setSteps] = useState<GuidedTourStep[]>(initial?.steps ?? []);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [isSaving, setIsSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  function addStep() {
    setSteps((s) => [...s, { target_selector: "", title: "", content: "" }]);
  }
  function removeStep(idx: number) {
    setSteps((s) => s.filter((_, i) => i !== idx));
  }
  function moveStep(idx: number, dir: -1 | 1) {
    setSteps((s) => {
      const next = [...s];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return s;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }
  function updateStep(idx: number, patch: Partial<GuidedTourStep>) {
    setSteps((s) => s.map((st, i) => (i === idx ? { ...st, ...patch } : st)));
  }

  async function handleSave() {
    setEditorError(null);
    if (mode === "create" && !tourId.trim()) { setEditorError("tour_id is required."); return; }
    if (!title.trim()) { setEditorError("title is required."); return; }
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      if (!st.target_selector.trim()) { setEditorError(`Step ${i + 1}: target_selector is required.`); return; }
      if (!st.title.trim()) { setEditorError(`Step ${i + 1}: title is required.`); return; }
      if (!st.content.trim()) { setEditorError(`Step ${i + 1}: content is required.`); return; }
    }
    setIsSaving(true);
    try {
      const cleanSteps: GuidedTourStep[] = steps.map((st) => {
        const out: GuidedTourStep = {
          target_selector: st.target_selector.trim(),
          title: st.title.trim(),
          content: st.content.trim(),
        };
        if (st.position) out.position = st.position;
        return out;
      });
      const payload: Partial<GuidedTourEntry> = {
        hub, title: title.trim(), steps: cleanSteps, is_active: isActive,
      };
      if (mode === "create") {
        const created = await createGuidedTour({ tour_id: tourId.trim(), ...payload });
        await onSaved(created.tour_id, "created");
      } else {
        const updated = await updateGuidedTour(initial!.tour_id, payload);
        await onSaved(updated.tour_id, "updated");
      }
    } catch (e: any) { setEditorError(formatError(e)); }
    finally { setIsSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !isSaving) onCancel(); }}>
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">
          {mode === "create" ? "New Guided Tour" : `Edit: ${initial?.tour_id ?? ""}`}
        </h2>
        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">tour_id *</label>
            <input type="text" value={tourId}
              onChange={(e) => setTourId(e.target.value)} disabled={mode === "edit"}
              className="border rounded px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">hub *</label>
            <select value={hub}
              onChange={(e) => setHub(e.target.value as GuidedTourEntry["hub"])}
              className="border rounded px-3 py-2 text-sm">
              {HUB_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">title *</label>
            <input type="text" value={title}
              onChange={(e) => setTitle(e.target.value)} className="border rounded px-3 py-2 text-sm" />
          </div>

          <div className="border-t pt-3 mt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Steps ({steps.length})</label>
              <button type="button" onClick={addStep}
                className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded">+ Add Step</button>
            </div>
            {steps.length === 0 && <p className="text-xs text-gray-500 italic">No steps yet.</p>}
            <div className="space-y-3">
              {steps.map((st, idx) => (
                <div key={idx} className="border rounded p-3 bg-gray-50 dark:bg-gray-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">Step {idx + 1}</span>
                    <div className="flex gap-1">
                      <button type="button" onClick={() => moveStep(idx, -1)}
                        disabled={idx === 0}
                        className="text-xs px-2 py-0.5 bg-white hover:bg-gray-100 border rounded disabled:opacity-30">↑</button>
                      <button type="button" onClick={() => moveStep(idx, 1)}
                        disabled={idx === steps.length - 1}
                        className="text-xs px-2 py-0.5 bg-white hover:bg-gray-100 border rounded disabled:opacity-30">↓</button>
                      <button type="button" onClick={() => removeStep(idx)}
                        className="text-xs px-2 py-0.5 bg-red-50 hover:bg-red-100 text-red-700 border rounded">Remove</button>
                    </div>
                  </div>
                  <input type="text" value={st.target_selector}
                    onChange={(e) => updateStep(idx, { target_selector: e.target.value })}
                    placeholder="target_selector (CSS selector) *"
                    className="border rounded px-2 py-1 text-xs w-full" />
                  <input type="text" value={st.title}
                    onChange={(e) => updateStep(idx, { title: e.target.value })}
                    placeholder="title *"
                    className="border rounded px-2 py-1 text-xs w-full" />
                  <select value={st.position ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      updateStep(idx, { position: (v === "" ? undefined : (v as "top" | "bottom" | "left" | "right")) });
                    }}
                    className="border rounded px-2 py-1 text-xs w-full">
                    {POSITION_OPTIONS.map((p) => (
                      <option key={p} value={p}>{p === "" ? "(no position)" : p}</option>
                    ))}
                  </select>
                  <textarea value={st.content}
                    onChange={(e) => updateStep(idx, { content: e.target.value })}
                    placeholder="content *" rows={2}
                    className="border rounded px-2 py-1 text-xs w-full" />
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input id="gt-is-active" type="checkbox" checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)} />
            <label htmlFor="gt-is-active" className="text-sm">is_active</label>
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
