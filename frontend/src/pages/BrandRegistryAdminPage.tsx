/**
 * TALLY-SETTINGS-UX Phase 3 / B.2 — Brand Registry admin page.
 * FK: default_site_owner -> active site_registry entries.
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
  AdminSelect,
  showToast,
} from "../components/admin";
import {
  fetchBrandRegistry,
  createBrandRegistry,
  updateBrandRegistry,
  deactivateBrandRegistry,
  reactivateBrandRegistry,
  fetchSiteRegistry,
  BrandRegistryEntry,
  SiteRegistryEntry,
} from "../lib/api";

const DEACTIVATE_BODY = (brand_key: string) =>
  `Deactivate brand '${brand_key}'? It can be reactivated later. Products currently mapped to this brand retain the mapping; new product creation cannot select an inactive brand.`;

function formatError(err: any): string {
  if (!err) return "Unknown error.";
  if (typeof err === "string") return err;
  if (err.error === "alias collision" && err.alias && err.brand_key) {
    return `Alias "${err.alias}" is already used by brand "${err.brand_key}".`;
  }
  if (err.error === "brand_key collides with existing alias" && err.brand_key) {
    return `Brand key collides with an existing alias on brand "${err.brand_key}".`;
  }
  return err.error || err.message || JSON.stringify(err);
}

const isRowActive = (r: BrandRegistryEntry) => r.is_active === true;

function compareRows(
  a: BrandRegistryEntry,
  b: BrandRegistryEntry,
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

function normalizeBrandKey(input: string): string {
  return input.toLowerCase().trim();
}

export default function BrandRegistryAdminPage() {
  const [rows, setRows] = useState<BrandRegistryEntry[]>([]);
  const [sites, setSites] = useState<SiteRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const [sortState, setSortState] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "display_name",
    dir: "asc",
  });

  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorKey, setEditorKey] = useState<string | null>(null);

  const [deactivateTarget, setDeactivateTarget] = useState<BrandRegistryEntry | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const [reactivateTarget, setReactivateTarget] = useState<BrandRegistryEntry | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [allBrands, activeSites] = await Promise.all([
        fetchBrandRegistry(false),
        fetchSiteRegistry(true),
      ]);
      setRows(allBrands);
      setSites(activeSites);
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

  // PHASE-3.7 sub-PR 1.7 — group rows by default_site_owner; render sticky group headers.
  // Hardcoded order matches Phase 5A canonical site_registry order: shiekh, karmaloop, mltd.
  // Null bucket ("Unassigned") catches brands without default_site_owner set.
  const BRAND_GROUP_ORDER: Array<{ key: string | null; label: string }> = [
    { key: "shiekh", label: "Shiekh" },
    { key: "karmaloop", label: "Karmaloop" },
    { key: "mltd", label: "MLTD" },
    { key: null, label: "Unassigned" },
  ];

  const groupedRows = useMemo(() => {
    const map = new Map<string | null, BrandRegistryEntry[]>();
    for (const row of visibleRows) {
      const key = row.default_site_owner ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return BRAND_GROUP_ORDER
      .map((g) => ({ ...g, rows: map.get(g.key) || [] }))
      .filter((g) => g.rows.length > 0);
  }, [visibleRows]);

  const baseColumns: AdminCrudColumn<BrandRegistryEntry>[] = [
    { key: "brand_key", header: "Brand Key", sortable: true, render: (r) => <code className="text-xs">{r.brand_key}</code> },
    { key: "display_name", header: "Display Name", sortable: true, render: (r) => r.display_name },
    { key: "aliases", header: "Aliases", sortable: true, render: (r) => (r.aliases?.length ?? 0) },
    { key: "default_site_owner", header: "Default Site Owner", sortable: true, render: (r) => r.default_site_owner ?? "—" },
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

  const reactivateColumn: AdminCrudColumn<BrandRegistryEntry> = {
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
        <h1 className="text-2xl font-bold mt-2 mb-1">🏷️ Brand Registry</h1>
        <p className="text-gray-600 mb-6">Map brand aliases to canonical owners.</p>

        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={() => {
              setEditorMode("create");
              setEditorKey(null);
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            + New Brand
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

        {/* PHASE-3.7 sub-PR 1.7 — sticky-header grouping by default_site_owner. */}
        {loading || groupedRows.length === 0 ? (
          <AdminCrudTable
            rows={visibleRows}
            columns={columns}
            rowKey={(r) => r.brand_key}
            onEdit={(r) => {
              setEditorMode("edit");
              setEditorKey(r.brand_key);
            }}
            onDeactivate={(r) => setDeactivateTarget(r)}
            isLoading={loading}
            emptyMessage="No brands."
            sortState={sortState}
            onSortChange={setSortState}
          />
        ) : (
          groupedRows.map((group) => (
            <div key={group.key ?? "_unassigned"} className="mb-6">
              <div className="sticky top-0 z-20 bg-white dark:bg-gray-900 border-b px-2 py-2 text-lg font-semibold">
                {group.label}{" "}
                <span className="text-sm text-gray-500 font-normal">({group.rows.length})</span>
              </div>
              <AdminCrudTable
                rows={group.rows}
                columns={columns}
                rowKey={(r) => r.brand_key}
                onEdit={(r) => {
                  setEditorMode("edit");
                  setEditorKey(r.brand_key);
                }}
                onDeactivate={(r) => setDeactivateTarget(r)}
                isLoading={false}
                emptyMessage="No brands."
                sortState={sortState}
                onSortChange={setSortState}
              />
            </div>
          ))
        )}

        {editorMode !== null && (
          <BrandEditor
            mode={editorMode}
            initial={editorMode === "edit" ? rows.find((r) => r.brand_key === editorKey) ?? null : null}
            sites={sites}
            onSaved={async (savedKey: string, action: "created" | "updated") => {
              setEditorMode(null);
              setEditorKey(null);
              try {
                await load();
                showToast(`Brand "${savedKey}" ${action}.`);
              } catch {
                showToast(`Brand "${savedKey}" ${action}. (Reload failed; refresh.)`);
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
          body={deactivateTarget ? DEACTIVATE_BODY(deactivateTarget.brand_key) : ""}
          confirmLabel="Deactivate"
          confirmVariant="primary"
          onConfirm={async () => {
            if (!deactivateTarget) return;
            const justKey = deactivateTarget.brand_key;
            try {
              await deactivateBrandRegistry(justKey);
              setDeactivateTarget(null);
              setDeactivateError(null);
              try {
                await load();
                showToast(`Brand "${justKey}" deactivated.`);
              } catch {
                showToast(`Brand "${justKey}" deactivated. (Reload failed; refresh.)`);
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
          body={`This will reactivate the brand. It will become visible to operators again.`}
          confirmLabel="Reactivate"
          confirmVariant="primary"
          onConfirm={async () => {
            if (!reactivateTarget) return;
            const justKey = reactivateTarget.brand_key;
            try {
              await reactivateBrandRegistry(justKey);
              setReactivateTarget(null);
              setReactivateError(null);
              try {
                await load();
                showToast(`Brand "${justKey}" reactivated.`);
              } catch {
                showToast(`Brand "${justKey}" reactivated. (Reload failed; refresh.)`);
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
interface BrandEditorProps {
  mode: "create" | "edit";
  initial: BrandRegistryEntry | null | undefined;
  sites: SiteRegistryEntry[];
  onSaved: (savedKey: string, action: "created" | "updated") => void | Promise<void>;
  onCancel: () => void;
}

function BrandEditor({ mode, initial, sites, onSaved, onCancel }: BrandEditorProps) {
  const [brandKey, setBrandKey] = useState<string>(initial?.brand_key ?? "");
  const [displayName, setDisplayName] = useState<string>(initial?.display_name ?? "");
  const [aliases, setAliases] = useState<string[]>(initial?.aliases ?? []);
  const [defaultSiteOwner, setDefaultSiteOwner] = useState<string>(initial?.default_site_owner ?? "");
  const [isActive, setIsActive] = useState<boolean>(initial?.is_active ?? true);
  const [poConfirmed, setPoConfirmed] = useState<boolean>(initial?.po_confirmed ?? false);
  const [notes, setNotes] = useState<string>(initial?.notes ?? "");
  const [logoUrl, setLogoUrl] = useState<string>(initial?.logo_url ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  const siteOptions = useMemo(
    () => [
      { value: "", label: "(none)" },
      ...sites.map((s) => ({ value: s.site_key, label: `${s.display_name} (${s.site_key})` })),
    ],
    [sites]
  );

  async function handleSave() {
    setEditorError(null);
    if (mode === "create" && !brandKey.trim()) {
      setEditorError("brand_key is required.");
      return;
    }
    if (!displayName.trim()) {
      setEditorError("display_name is required.");
      return;
    }
    setIsSaving(true);
    try {
      const cleanAliases = aliases.map((a) => a.trim()).filter((a) => a.length > 0);
      const patch: Partial<BrandRegistryEntry> = {
        display_name: displayName.trim(),
        aliases: cleanAliases,
        default_site_owner: defaultSiteOwner.trim() ? defaultSiteOwner.trim() : null,
        is_active: isActive,
        po_confirmed: poConfirmed,
        notes: notes.trim() || null,
        logo_url: logoUrl.trim() || null,
      };
      if (mode === "create") {
        const created = await createBrandRegistry({
          brand_key: brandKey.trim(),
          ...patch,
        });
        await onSaved(created.brand_key, "created");
      } else {
        const updated = await updateBrandRegistry(initial!.brand_key, patch);
        await onSaved(updated.brand_key, "updated");
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
          {mode === "create" ? "New Brand" : `Edit Brand: ${initial?.brand_key ?? ""}`}
        </h2>

        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">brand_key *</label>
            <input
              type="text"
              value={brandKey}
              onChange={(e) => setBrandKey(e.target.value)}
              disabled={mode === "edit"}
              className="border rounded px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
            />
            {mode === "create" && brandKey.trim() && (
              <span className="text-xs text-gray-500">
                Normalized: <code>{normalizeBrandKey(brandKey)}</code>
              </span>
            )}
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

          <ArrayEditor
            label="aliases"
            values={aliases}
            onChange={setAliases}
            placeholder="alias text"
          />

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">default_site_owner</label>
            <AdminSelect
              value={defaultSiteOwner}
              onChange={setDefaultSiteOwner}
              options={siteOptions}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="brand-is-active"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <label htmlFor="brand-is-active" className="text-sm">is_active</label>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="brand-po-confirmed"
              type="checkbox"
              checked={poConfirmed}
              onChange={(e) => setPoConfirmed(e.target.checked)}
            />
            <label htmlFor="brand-po-confirmed" className="text-sm">po_confirmed</label>
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

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">logo_url</label>
            <input
              type="text"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
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

// Inline string[] editor (also used by Department & Attribute pages —
// kept colocated per dispatch §1 conventions; no shared util.)
function ArrayEditor({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium">{label}</label>
      <div className="space-y-1">
        {values.map((v, i) => (
          <div key={i} className="flex gap-2">
            <input
              type="text"
              value={v}
              onChange={(e) => {
                const next = [...values];
                next[i] = e.target.value;
                onChange(next);
              }}
              placeholder={placeholder}
              className="flex-1 border rounded px-3 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={() => onChange(values.filter((_, j) => j !== i))}
              className="text-xs text-red-600 hover:underline"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...values, ""])}
          className="text-xs text-blue-600 hover:underline"
        >
          + Add option
        </button>
      </div>
    </div>
  );
}
