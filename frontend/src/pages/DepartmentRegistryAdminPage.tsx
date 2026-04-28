/**
 * TALLY-SETTINGS-UX Phase 3 / B.2 — Department Registry admin page.
 * Flat schema (PO ruling D.2): key, display_name, aliases, is_active,
 * priority, po_confirmed. NO parent_key, NO category_keys.
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
  fetchDepartmentRegistry,
  createDepartmentRegistry,
  updateDepartmentRegistry,
  deactivateDepartmentRegistry,
  reactivateDepartmentRegistry,
  DepartmentRegistryEntry,
} from "../lib/api";

const DEACTIVATE_BODY = (key: string) =>
  `Deactivate department '${key}'? It can be reactivated later. Products currently mapped to this department retain the mapping; new product creation cannot select an inactive department.`;

function formatError(err: any): string {
  if (!err) return "Unknown error.";
  if (typeof err === "string") return err;
  // Department BE uses { error, key, alias? } (verified at backend/functions/src/routes/departmentRegistry.ts L240-251).
  if (err.error === "alias collision" && err.alias && err.key) {
    return `Alias "${err.alias}" is already used by department "${err.key}".`;
  }
  if (err.error === "key collides with existing alias" && err.key) {
    return `Key collides with an existing alias on department "${err.key}".`;
  }
  if (err.error === "key already exists") {
    return `A department with this key already exists.`;
  }
  return err.error || err.message || JSON.stringify(err);
}

const isRowActive = (r: DepartmentRegistryEntry) => r.is_active === true;

function compareRows(
  a: DepartmentRegistryEntry,
  b: DepartmentRegistryEntry,
  s: { key: string; dir: "asc" | "desc" }
): number {
  const av = (a as any)[s.key];
  const bv = (b as any)[s.key];
  let cmp = 0;
  if (Array.isArray(av) && Array.isArray(bv)) cmp = av.length - bv.length;
  else if (av == null && bv == null) cmp = 0;
  else if (av == null) cmp = -1;
  else if (bv == null) cmp = 1;
  else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
  else cmp = String(av).localeCompare(String(bv));
  return s.dir === "asc" ? cmp : -cmp;
}

export default function DepartmentRegistryAdminPage() {
  const [rows, setRows] = useState<DepartmentRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const [sortState, setSortState] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "display_name",
    dir: "asc",
  });

  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorKey, setEditorKey] = useState<string | null>(null);

  const [deactivateTarget, setDeactivateTarget] = useState<DepartmentRegistryEntry | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const [reactivateTarget, setReactivateTarget] = useState<DepartmentRegistryEntry | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const all = await fetchDepartmentRegistry(false);
      setRows(all);
    } catch (e: any) {
      setError(formatError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const visibleRows = useMemo(() => {
    let r = rows;
    if (!showInactive) r = r.filter(isRowActive);
    return [...r].sort((a, b) => compareRows(a, b, sortState));
  }, [rows, showInactive, sortState]);

  const baseColumns: AdminCrudColumn<DepartmentRegistryEntry>[] = [
    { key: "key", header: "Key", sortable: true, render: (r) => <code className="text-xs">{r.key}</code> },
    { key: "display_name", header: "Display Name", sortable: true, render: (r) => r.display_name },
    { key: "aliases", header: "Aliases", sortable: true, render: (r) => (r.aliases?.length ?? 0) },
    { key: "priority", header: "Priority", sortable: true, render: (r) => r.priority },
    {
      key: "is_active",
      header: "Active",
      sortable: true,
      render: (r) =>
        r.is_active ? (
          <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">active</span>
        ) : (
          <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">inactive</span>
        ),
    },
  ];

  const reactivateColumn: AdminCrudColumn<DepartmentRegistryEntry> = {
    key: "_reactivate",
    header: "",
    render: (row) =>
      !isRowActive(row) ? (
        <button
          type="button"
          onClick={() => setReactivateTarget(row)}
          className="text-blue-600 hover:underline text-sm"
        >
          Reactivate
        </button>
      ) : null,
  };

  const columns = showInactive ? [...baseColumns, reactivateColumn] : baseColumns;

  return (
    <RoleGate>
      <div className="max-w-6xl mx-auto p-6">
        <Link to="/admin/registries" className="text-sm text-blue-600 hover:underline">
          ← Data Registries
        </Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">📁 Department Registry</h1>
        <p className="text-gray-600 mb-6">Manage category hierarchies.</p>

        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={() => {
              setEditorMode("create");
              setEditorKey(null);
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            + New Department
          </button>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Show inactive
          </label>
        </div>

        <div className="mb-4">
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        </div>

        <AdminCrudTable
          rows={visibleRows}
          columns={columns}
          rowKey={(r) => r.key}
          onEdit={(r) => {
            setEditorMode("edit");
            setEditorKey(r.key);
          }}
          onDeactivate={(r) => setDeactivateTarget(r)}
          isLoading={loading}
          emptyMessage="No departments."
          sortState={sortState}
          onSortChange={setSortState}
        />

        {editorMode !== null && (
          <DepartmentEditor
            mode={editorMode}
            initial={editorMode === "edit" ? rows.find((r) => r.key === editorKey) ?? null : null}
            onSaved={async (savedKey: string, action: "created" | "updated") => {
              setEditorMode(null);
              setEditorKey(null);
              try {
                await load();
                showToast(`Department "${savedKey}" ${action}.`);
              } catch {
                showToast(`Department "${savedKey}" ${action}. (Reload failed; refresh.)`);
                setError("Saved, but failed to reload table. Refresh to see latest.");
              }
            }}
            onCancel={() => {
              setEditorMode(null);
              setEditorKey(null);
            }}
          />
        )}

        <ConfirmModal
          open={deactivateTarget !== null}
          title={`Deactivate "${deactivateTarget?.display_name ?? ""}"?`}
          body={deactivateTarget ? DEACTIVATE_BODY(deactivateTarget.key) : ""}
          confirmLabel="Deactivate"
          confirmVariant="primary"
          onConfirm={async () => {
            if (!deactivateTarget) return;
            const justKey = deactivateTarget.key;
            try {
              await deactivateDepartmentRegistry(justKey);
              setDeactivateTarget(null);
              setDeactivateError(null);
              try {
                await load();
                showToast(`Department "${justKey}" deactivated.`);
              } catch {
                showToast(`Department "${justKey}" deactivated. (Reload failed; refresh.)`);
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

        <ConfirmModal
          open={reactivateTarget !== null}
          title={`Reactivate "${reactivateTarget?.display_name ?? ""}"?`}
          body={`This will reactivate the department. It will become visible to operators again.`}
          confirmLabel="Reactivate"
          confirmVariant="primary"
          onConfirm={async () => {
            if (!reactivateTarget) return;
            const justKey = reactivateTarget.key;
            try {
              await reactivateDepartmentRegistry(justKey);
              setReactivateTarget(null);
              setReactivateError(null);
              try {
                await load();
                showToast(`Department "${justKey}" reactivated.`);
              } catch {
                showToast(`Department "${justKey}" reactivated. (Reload failed; refresh.)`);
                setError("Reactivated, but failed to reload table. Refresh to see latest.");
              }
            } catch (e: any) {
              setReactivateError(formatError(e));
            }
          }}
          onCancel={() => {
            setReactivateTarget(null);
            setReactivateError(null);
          }}
          errorSlot={reactivateError}
        />
      </div>
    </RoleGate>
  );
}

// ────────────────────────────────────────────────────────────
// Editor
// ────────────────────────────────────────────────────────────
interface DepartmentEditorProps {
  mode: "create" | "edit";
  initial: DepartmentRegistryEntry | null | undefined;
  onSaved: (savedKey: string, action: "created" | "updated") => void | Promise<void>;
  onCancel: () => void;
}

function DepartmentEditor({ mode, initial, onSaved, onCancel }: DepartmentEditorProps) {
  const [key, setKey] = useState<string>(initial?.key ?? "");
  const [displayName, setDisplayName] = useState<string>(initial?.display_name ?? "");
  const [aliases, setAliases] = useState<string[]>(initial?.aliases ?? []);
  const [isActive, setIsActive] = useState<boolean>(initial?.is_active ?? true);
  const [priority, setPriority] = useState<number>(initial?.priority ?? 0);
  const [poConfirmed, setPoConfirmed] = useState<boolean>(initial?.po_confirmed ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  async function handleSave() {
    setEditorError(null);
    if (mode === "create" && !key.trim()) {
      setEditorError("key is required.");
      return;
    }
    if (!displayName.trim()) {
      setEditorError("display_name is required.");
      return;
    }
    setIsSaving(true);
    try {
      const cleanAliases = aliases.map((a) => a.trim()).filter((a) => a.length > 0);
      const patch: Partial<DepartmentRegistryEntry> = {
        display_name: displayName.trim(),
        aliases: cleanAliases,
        is_active: isActive,
        priority: Number.isFinite(priority) ? priority : 0,
        po_confirmed: poConfirmed,
      };
      if (mode === "create") {
        const created = await createDepartmentRegistry({
          key: key.trim(),
          ...patch,
        });
        await onSaved(created.key, "created");
      } else {
        const updated = await updateDepartmentRegistry(initial!.key, patch);
        await onSaved(updated.key, "updated");
      }
    } catch (e: any) {
      setEditorError(formatError(e));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onCancel();
      }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">
          {mode === "create" ? "New Department" : `Edit Department: ${initial?.key ?? ""}`}
        </h2>

        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">key *</label>
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={mode === "edit"}
              className="border rounded px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">display_name *</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">aliases</label>
            <div className="space-y-1">
              {aliases.map((a, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    value={a}
                    onChange={(e) => {
                      const next = [...aliases];
                      next[i] = e.target.value;
                      setAliases(next);
                    }}
                    className="flex-1 border rounded px-3 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setAliases(aliases.filter((_, j) => j !== i))}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setAliases([...aliases, ""])}
                className="text-xs text-blue-600 hover:underline"
              >
                + Add option
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="dept-is-active"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <label htmlFor="dept-is-active" className="text-sm">is_active</label>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">priority</label>
            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value, 10) || 0)}
              className="border rounded px-3 py-2 text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="dept-po-confirmed"
              type="checkbox"
              checked={poConfirmed}
              onChange={(e) => setPoConfirmed(e.target.checked)}
            />
            <label htmlFor="dept-po-confirmed" className="text-sm">po_confirmed</label>
          </div>

          <ErrorBanner message={editorError} onDismiss={() => setEditorError(null)} />
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded text-sm"
          >
            Cancel
          </button>
          <SaveButton onClick={handleSave} isSaving={isSaving} />
        </div>
      </div>
    </div>
  );
}
