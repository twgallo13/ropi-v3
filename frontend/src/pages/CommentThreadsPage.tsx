/**
 * TALLY-SETTINGS-UX Phase 3 / A.3 PR4 — Comment Threads admin page.
 * Mounted at /admin/governance/comment-threads.
 * Auto-id collection: BE allocates thread_id; create POST omits id.
 * "Deactivate" sets is_archived=true; "reactivate" sets is_archived=false.
 * is_resolved is independent (toggled in editor).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  RoleGate, AdminCrudTable, AdminCrudColumn, ConfirmModal,
  ErrorBanner, SaveButton, showToast,
} from "../components/admin";
import {
  fetchCommentThreads, createCommentThread, updateCommentThread,
  deactivateCommentThread, reactivateCommentThread, CommentThreadEntry,
} from "../lib/api";

function formatError(err: any): string {
  if (!err) return "Unknown error.";
  if (typeof err === "string") return err;
  return err.error || err.message || JSON.stringify(err);
}
const isRowActive = (r: CommentThreadEntry) => r.is_archived !== true;
function compareRows(a: CommentThreadEntry, b: CommentThreadEntry, s: { key: string; dir: "asc" | "desc" }): number {
  const av = (a as any)[s.key]; const bv = (b as any)[s.key];
  let cmp = 0;
  if (av == null && bv == null) cmp = 0;
  else if (av == null) cmp = -1;
  else if (bv == null) cmp = 1;
  else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
  else cmp = String(av).localeCompare(String(bv));
  return s.dir === "asc" ? cmp : -cmp;
}

export default function CommentThreadsPage() {
  const [rows, setRows] = useState<CommentThreadEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [sortState, setSortState] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "title", dir: "asc" });
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorKey, setEditorKey] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<CommentThreadEntry | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [unarchiveTarget, setUnarchiveTarget] = useState<CommentThreadEntry | null>(null);
  const [unarchiveError, setUnarchiveError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await fetchCommentThreads(false)); }
    catch (e: any) { setError(formatError(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const visibleRows = useMemo(() => {
    let r = rows;
    if (!showArchived) r = r.filter(isRowActive);
    return [...r].sort((a, b) => compareRows(a, b, sortState));
  }, [rows, showArchived, sortState]);

  const baseColumns: AdminCrudColumn<CommentThreadEntry>[] = [
    { key: "thread_id", header: "Thread ID", sortable: true, render: (r) => <code className="text-xs">{r.thread_id}</code> },
    { key: "title", header: "Title", sortable: true, render: (r) => r.title },
    { key: "entity_type", header: "Entity", sortable: true, render: (r) => <span className="text-xs">{r.entity_type}/{r.entity_id}</span> },
    {
      key: "is_resolved", header: "Resolved", sortable: true,
      render: (r) => r.is_resolved
        ? <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">resolved</span>
        : <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">open</span>,
    },
    {
      key: "is_archived", header: "Archived", sortable: true,
      render: (r) => r.is_archived
        ? <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">archived</span>
        : <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">active</span>,
    },
  ];
  const unarchiveColumn: AdminCrudColumn<CommentThreadEntry> = {
    key: "_unarchive", header: "",
    render: (row) => row.is_archived
      ? <button type="button" onClick={() => setUnarchiveTarget(row)} className="text-blue-600 hover:underline text-sm">Unarchive</button>
      : null,
  };
  const columns = showArchived ? [...baseColumns, unarchiveColumn] : baseColumns;

  return (
    <RoleGate>
      <div className="max-w-6xl mx-auto p-6">
        <Link to="/admin/governance" className="text-sm text-blue-600 hover:underline">← Governance</Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">💬 Comment Threads</h1>
        <p className="text-gray-600 mb-6">Manage admin-curated discussion threads attached to entities.</p>

        <div className="flex items-center justify-between mb-4">
          <button type="button" onClick={() => { setEditorMode("create"); setEditorKey(null); }}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">+ New Thread</button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
        </div>
        <div className="mb-4"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>
        <AdminCrudTable
          rows={visibleRows} columns={columns} rowKey={(r) => r.thread_id}
          onEdit={(r) => { setEditorMode("edit"); setEditorKey(r.thread_id); }}
          onDeactivate={(r) => setArchiveTarget(r)}
          isLoading={loading} emptyMessage="No comment threads."
          sortState={sortState} onSortChange={setSortState}
        />
        {editorMode !== null && (
          <CommentThreadEditor mode={editorMode}
            initial={editorMode === "edit" ? rows.find((r) => r.thread_id === editorKey) ?? null : null}
            onSaved={async (savedKey, action) => {
              setEditorMode(null); setEditorKey(null);
              try { await load(); showToast(`Thread "${savedKey}" ${action}.`); }
              catch { showToast(`Thread "${savedKey}" ${action}. (Reload failed; refresh.)`);
                setError("Saved, but failed to reload table. Refresh to see latest."); }
            }}
            onCancel={() => { setEditorMode(null); setEditorKey(null); }}
          />
        )}
        <ConfirmModal
          open={archiveTarget !== null}
          title={`Archive "${archiveTarget?.title ?? ""}"?`}
          body={archiveTarget ? `Archive thread '${archiveTarget.thread_id}'? It can be unarchived later.` : ""}
          confirmLabel="Archive" confirmVariant="primary"
          onConfirm={async () => {
            if (!archiveTarget) return;
            const justKey = archiveTarget.thread_id;
            try {
              await deactivateCommentThread(justKey);
              setArchiveTarget(null); setArchiveError(null);
              try { await load(); showToast(`Thread "${justKey}" archived.`); }
              catch { showToast(`Thread "${justKey}" archived. (Reload failed; refresh.)`);
                setError("Archived, but failed to reload table. Refresh to see latest."); }
            } catch (e: any) { setArchiveError(formatError(e)); }
          }}
          onCancel={() => { setArchiveTarget(null); setArchiveError(null); }}
          errorSlot={archiveError}
        />
        <ConfirmModal
          open={unarchiveTarget !== null}
          title={`Unarchive "${unarchiveTarget?.title ?? ""}"?`}
          body={`This will unarchive the thread.`}
          confirmLabel="Unarchive" confirmVariant="primary"
          onConfirm={async () => {
            if (!unarchiveTarget) return;
            const justKey = unarchiveTarget.thread_id;
            try {
              await reactivateCommentThread(justKey);
              setUnarchiveTarget(null); setUnarchiveError(null);
              try { await load(); showToast(`Thread "${justKey}" unarchived.`); }
              catch { showToast(`Thread "${justKey}" unarchived. (Reload failed; refresh.)`);
                setError("Unarchived, but failed to reload table. Refresh to see latest."); }
            } catch (e: any) { setUnarchiveError(formatError(e)); }
          }}
          onCancel={() => { setUnarchiveTarget(null); setUnarchiveError(null); }}
          errorSlot={unarchiveError}
        />
      </div>
    </RoleGate>
  );
}

interface EditorProps {
  mode: "create" | "edit";
  initial: CommentThreadEntry | null | undefined;
  onSaved: (savedKey: string, action: "created" | "updated") => void | Promise<void>;
  onCancel: () => void;
}

function CommentThreadEditor({ mode, initial, onSaved, onCancel }: EditorProps) {
  const [entityType, setEntityType] = useState(initial?.entity_type ?? "");
  const [entityId, setEntityId] = useState(initial?.entity_id ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [bodyMd, setBodyMd] = useState(initial?.body_md ?? "");
  const [isResolved, setIsResolved] = useState(initial?.is_resolved ?? false);
  const [isArchived, setIsArchived] = useState(initial?.is_archived ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  async function handleSave() {
    setEditorError(null);
    if (!entityType.trim()) { setEditorError("entity_type is required."); return; }
    if (!entityId.trim()) { setEditorError("entity_id is required."); return; }
    if (!title.trim()) { setEditorError("title is required."); return; }
    setIsSaving(true);
    try {
      const payload: Partial<CommentThreadEntry> = {
        entity_type: entityType.trim(),
        entity_id: entityId.trim(),
        title: title.trim(),
        body_md: bodyMd,
        is_resolved: isResolved,
        is_archived: isArchived,
      };
      if (mode === "create") {
        // Auto-id: BE allocates thread_id; payload omits it.
        const created = await createCommentThread(payload);
        await onSaved(created.thread_id, "created");
      } else {
        const updated = await updateCommentThread(initial!.thread_id, payload);
        await onSaved(updated.thread_id, "updated");
      }
    } catch (e: any) { setEditorError(formatError(e)); }
    finally { setIsSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !isSaving) onCancel(); }}>
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">
          {mode === "create" ? "New Comment Thread" : `Edit: ${initial?.thread_id ?? ""}`}
        </h2>
        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">entity_type *</label>
            <input type="text" value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              placeholder="e.g. product, launch"
              className="border rounded px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">entity_id *</label>
            <input type="text" value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              className="border rounded px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">title *</label>
            <input type="text" value={title}
              onChange={(e) => setTitle(e.target.value)} className="border rounded px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">body_md (markdown)</label>
            <textarea value={bodyMd} onChange={(e) => setBodyMd(e.target.value)}
              rows={6} className="border rounded px-3 py-2 text-xs font-mono" />
          </div>
          <div className="flex items-center gap-2">
            <input id="ct-is-resolved" type="checkbox" checked={isResolved}
              onChange={(e) => setIsResolved(e.target.checked)} />
            <label htmlFor="ct-is-resolved" className="text-sm">is_resolved</label>
          </div>
          <div className="flex items-center gap-2">
            <input id="ct-is-archived" type="checkbox" checked={isArchived}
              onChange={(e) => setIsArchived(e.target.checked)} />
            <label htmlFor="ct-is-archived" className="text-sm">is_archived</label>
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
