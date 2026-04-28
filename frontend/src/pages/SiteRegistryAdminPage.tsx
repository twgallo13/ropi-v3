/**
 * TALLY-SETTINGS-UX Phase 3 / B.2 — Site Registry admin page.
 *
 * Reference admin page for the 4 Data Registries pillar surfaces.
 * Pattern: editorMode/editorKey two-state (R.D), conditional Reactivate
 * column (R.3), default-hide inactive (R.2), toast-after-write (R.4).
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
  fetchSiteRegistry,
  createSiteRegistry,
  updateSiteRegistry,
  deactivateSiteRegistry,
  reactivateSiteRegistry,
  SiteRegistryEntry,
} from "../lib/api";

const DEACTIVATE_BODY = (site_key: string) =>
  `Deactivate site '${site_key}'? It can be reactivated later. Inactive sites stop appearing in operator dropdowns and product list filters, but historical data is preserved.`;

function formatError(err: any): string {
  if (!err) return "Unknown error.";
  if (typeof err === "string") return err;
  return err.error || err.message || JSON.stringify(err);
}

const isRowActive = (r: SiteRegistryEntry) => r.is_active === true;

function compareRows(
  a: SiteRegistryEntry,
  b: SiteRegistryEntry,
  s: { key: string; dir: "asc" | "desc" }
): number {
  const av = (a as any)[s.key];
  const bv = (b as any)[s.key];
  let cmp = 0;
  if (av == null && bv == null) cmp = 0;
  else if (av == null) cmp = -1;
  else if (bv == null) cmp = 1;
  else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
  else cmp = String(av).localeCompare(String(bv));
  return s.dir === "asc" ? cmp : -cmp;
}

export default function SiteRegistryAdminPage() {
  const [rows, setRows] = useState<SiteRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const [sortState, setSortState] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "display_name",
    dir: "asc",
  });

  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorKey, setEditorKey] = useState<string | null>(null);

  const [deactivateTarget, setDeactivateTarget] = useState<SiteRegistryEntry | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const [reactivateTarget, setReactivateTarget] = useState<SiteRegistryEntry | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const all = await fetchSiteRegistry(false);
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

  const baseColumns: AdminCrudColumn<SiteRegistryEntry>[] = [
    { key: "site_key", header: "Site Key", sortable: true, render: (r) => <code className="text-xs">{r.site_key}</code> },
    { key: "display_name", header: "Display Name", sortable: true, render: (r) => r.display_name },
    { key: "domain", header: "Domain", sortable: true, render: (r) => r.domain ?? "—" },
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

  const reactivateColumn: AdminCrudColumn<SiteRegistryEntry> = {
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
        <h1 className="text-2xl font-bold mt-2 mb-1">🌐 Site Registry</h1>
        <p className="text-gray-600 mb-6">Manage canonical e-commerce sites.</p>

        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={() => {
              setEditorMode("create");
              setEditorKey(null);
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            + New Site
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
          rowKey={(r) => r.site_key}
          onEdit={(r) => {
            setEditorMode("edit");
            setEditorKey(r.site_key);
          }}
          onDeactivate={(r) => setDeactivateTarget(r)}
          isLoading={loading}
          emptyMessage="No sites."
          sortState={sortState}
          onSortChange={setSortState}
        />

        {editorMode !== null && (
          <SiteEditor
            mode={editorMode}
            initial={editorMode === "edit" ? rows.find((r) => r.site_key === editorKey) ?? null : null}
            onSaved={async (savedKey: string, action: "created" | "updated") => {
              setEditorMode(null);
              setEditorKey(null);
              try {
                await load();
                showToast(`Site "${savedKey}" ${action}.`);
              } catch {
                showToast(`Site "${savedKey}" ${action}. (Reload failed; refresh.)`);
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
          body={deactivateTarget ? DEACTIVATE_BODY(deactivateTarget.site_key) : ""}
          confirmLabel="Deactivate"
          confirmVariant="primary"
          onConfirm={async () => {
            if (!deactivateTarget) return;
            const justKey = deactivateTarget.site_key;
            try {
              await deactivateSiteRegistry(justKey);
              setDeactivateTarget(null);
              setDeactivateError(null);
              try {
                await load();
                showToast(`Site "${justKey}" deactivated.`);
              } catch {
                showToast(`Site "${justKey}" deactivated. (Reload failed; refresh.)`);
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
          body={`This will reactivate the site. It will become visible to operators again.`}
          confirmLabel="Reactivate"
          confirmVariant="primary"
          onConfirm={async () => {
            if (!reactivateTarget) return;
            const justKey = reactivateTarget.site_key;
            try {
              await reactivateSiteRegistry(justKey);
              setReactivateTarget(null);
              setReactivateError(null);
              try {
                await load();
                showToast(`Site "${justKey}" reactivated.`);
              } catch {
                showToast(`Site "${justKey}" reactivated. (Reload failed; refresh.)`);
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
// Editor (colocated)
// ────────────────────────────────────────────────────────────
interface SiteEditorProps {
  mode: "create" | "edit";
  initial: SiteRegistryEntry | null | undefined;
  onSaved: (savedKey: string, action: "created" | "updated") => void | Promise<void>;
  onCancel: () => void;
}

function SiteEditor({ mode, initial, onSaved, onCancel }: SiteEditorProps) {
  const [siteKey, setSiteKey] = useState<string>(initial?.site_key ?? "");
  const [displayName, setDisplayName] = useState<string>(initial?.display_name ?? "");
  const [domain, setDomain] = useState<string>(initial?.domain ?? "");
  const [isActive, setIsActive] = useState<boolean>(initial?.is_active ?? true);
  const [priority, setPriority] = useState<number>(initial?.priority ?? 0);
  const [badgeColor, setBadgeColor] = useState<string>(initial?.badge_color ?? "");
  const [notes, setNotes] = useState<string>(initial?.notes ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  async function handleSave() {
    setEditorError(null);
    if (mode === "create" && !siteKey.trim()) {
      setEditorError("site_key is required.");
      return;
    }
    if (!displayName.trim()) {
      setEditorError("display_name is required.");
      return;
    }
    setIsSaving(true);
    try {
      const payload: Partial<SiteRegistryEntry> = {
        display_name: displayName.trim(),
        domain: domain.trim(),
        is_active: isActive,
        priority: Number.isFinite(priority) ? priority : 0,
        badge_color: badgeColor.trim() || null,
        notes: notes.trim() || null,
      };
      if (mode === "create") {
        const created = await createSiteRegistry({
          site_key: siteKey.trim(),
          ...payload,
        } as SiteRegistryEntry);
        await onSaved(created.site_key, "created");
      } else {
        const updated = await updateSiteRegistry(initial!.site_key, payload);
        await onSaved(updated.site_key, "updated");
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
          {mode === "create" ? "New Site" : `Edit Site: ${initial?.site_key ?? ""}`}
        </h2>

        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">site_key *</label>
            <input
              type="text"
              value={siteKey}
              onChange={(e) => setSiteKey(e.target.value)}
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
            <label className="text-sm font-medium">domain</label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="site-is-active"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <label htmlFor="site-is-active" className="text-sm">is_active</label>
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

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">badge_color</label>
            <input
              type="text"
              value={badgeColor}
              onChange={(e) => setBadgeColor(e.target.value)}
              placeholder="free-text (e.g. #ff0000 or 'red')"
              className="border rounded px-3 py-2 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="border rounded px-3 py-2 text-sm"
            />
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
