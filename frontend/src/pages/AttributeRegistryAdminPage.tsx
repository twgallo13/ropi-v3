/**
 * TALLY-SETTINGS-UX Phase 3 / B.2 — Attribute Registry admin page.
 *
 * Heaviest registry editor: 14 fields including R.8 field_type enum,
 * R.7 destination_tab enum, R.9 dropdown_source enum, R.10 depends_on
 * two-input pair (FE-only validation; BE does not validate shape).
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
import { ModalTabBar } from "../components/admin/ModalTabBar";
import {
  fetchAttributeRegistry,
  createAttributeRegistry,
  updateAttributeRegistry,
  deactivateAttributeRegistry,
  reactivateAttributeRegistry,
  AttributeRegistryEntry,
} from "../lib/api";

const DEACTIVATE_BODY = (field_key: string) =>
  `Deactivate attribute '${field_key}'? It can be reactivated later. Inactive attributes are hidden from the product editor and from Smart Rules / Completion Rules / Import Mapping field dropdowns. Historical product data on this attribute is preserved. Reactivating restores the field everywhere.`;

const FIELD_TYPE_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Textarea" },
  { value: "dropdown", label: "Dropdown" },
  { value: "multi_select", label: "Multi-select" },
  { value: "number", label: "Number" },
  { value: "toggle", label: "Toggle" },
  { value: "boolean", label: "Boolean" },
  { value: "date", label: "Date" },
];
const KNOWN_FIELD_TYPES = new Set(FIELD_TYPE_OPTIONS.map((o) => o.value));

const DESTINATION_TAB_OPTIONS = [
  { value: "core_information", label: "Core Information" },
  { value: "product_attributes", label: "Product Attributes" },
  { value: "descriptions_seo", label: "Descriptions & SEO" },
  { value: "launch_media", label: "Launch & Media" },
  { value: "system", label: "System" },
];

const DROPDOWN_SOURCE_OPTIONS = [
  { value: "", label: "(none)" },
  { value: "site_registry", label: "Site Registry" },
  { value: "brand_registry", label: "Brand Registry" },
  { value: "department_registry", label: "Department Registry" },
];

function formatError(err: any): string {
  if (!err) return "Unknown error.";
  if (typeof err === "string") return err;
  return err.error || err.message || JSON.stringify(err);
}

const isRowActive = (r: AttributeRegistryEntry) => r.active === true;

function compareRows(
  a: AttributeRegistryEntry,
  b: AttributeRegistryEntry,
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
  // Compound: tiebreak by display_label asc.
  if (cmp === 0 && s.key !== "display_label") {
    cmp = String(a.display_label ?? "").localeCompare(String(b.display_label ?? ""));
    return s.dir === "asc" ? cmp : -cmp;
  }
  return s.dir === "asc" ? cmp : -cmp;
}

export default function AttributeRegistryAdminPage() {
  const [rows, setRows] = useState<AttributeRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  // Phase 3.1 PR #5 — 'Show advanced' reveals the field_key column.
  // Component-local state only; not persisted across reload (out of scope).
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [sortState, setSortState] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "display_order",
    dir: "asc",
  });

  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorKey, setEditorKey] = useState<string | null>(null);

  const [deactivateTarget, setDeactivateTarget] = useState<AttributeRegistryEntry | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const [reactivateTarget, setReactivateTarget] = useState<AttributeRegistryEntry | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const all = await fetchAttributeRegistry({ admin: true, includeInactive: true });
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

  const baseColumns: AdminCrudColumn<AttributeRegistryEntry>[] = [
    { key: "display_label", header: "Display Label", sortable: true, render: (r) => r.display_label },
    { key: "field_type", header: "Type", sortable: true, render: (r) => r.field_type },
    { key: "destination_tab", header: "Tab", sortable: true, render: (r) => r.destination_tab },
    { key: "display_order", header: "Order", sortable: true, render: (r) => r.display_order ?? 0 },
    {
      key: "severity",
      header: "Severity",
      sortable: true,
      render: (r) => {
        if (!r.severity) return <span className="text-gray-400">—</span>;
        const cls =
          r.severity === "error"
            ? "bg-red-100 text-red-800"
            : r.severity === "warn"
              ? "bg-amber-100 text-amber-800"
              : "bg-blue-100 text-blue-800";
        return <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{r.severity}</span>;
      },
    },
    {
      key: "why_it_matters",
      header: "Why It Matters",
      render: (r) => {
        if (!r.why_it_matters) return <span className="text-gray-400">—</span>;
        const text = r.why_it_matters;
        return (
          <span className="text-xs" title={text}>
            {text.length > 60 ? `${text.slice(0, 60)}…` : text}
          </span>
        );
      },
    },
    {
      key: "active",
      header: "Active",
      sortable: true,
      render: (r) =>
        r.active ? (
          <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">active</span>
        ) : (
          <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">inactive</span>
        ),
    },
  ];

  const reactivateColumn: AdminCrudColumn<AttributeRegistryEntry> = {
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

  // Phase 3.1 PR #5 — field_key column shown only when 'Show advanced' is on.
  // Mirrors exact shape of original col 1 (Tailwind, render, sortable preserved).
  const fieldKeyColumn: AdminCrudColumn<AttributeRegistryEntry> = {
    key: "field_key",
    header: "Field Key",
    sortable: true,
    render: (r) => <code className="text-xs">{r.field_key}</code>,
  };

  const columns = [
    ...(showAdvanced ? [fieldKeyColumn] : []),
    ...baseColumns,
    ...(showInactive ? [reactivateColumn] : []),
  ];

  return (
    <RoleGate>
      <div className="max-w-6xl mx-auto p-6">
        <Link to="/admin/registries" className="text-sm text-blue-600 hover:underline">
          ← Data Registries
        </Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">⚙️ Attribute Registry</h1>
        <p className="text-gray-600 mb-6">Manage 66+ active product fields.</p>

        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={() => {
              setEditorMode("create");
              setEditorKey(null);
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            + New Attribute
          </button>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              Show inactive
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showAdvanced}
                onChange={(e) => setShowAdvanced(e.target.checked)}
              />
              Show advanced
            </label>
          </div>
        </div>

        <div className="mb-4">
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        </div>

        <AdminCrudTable
          rows={visibleRows}
          columns={columns}
          rowKey={(r) => r.field_key}
          onEdit={(r) => {
            setEditorMode("edit");
            setEditorKey(r.field_key);
          }}
          onDeactivate={(r) => setDeactivateTarget(r)}
          isLoading={loading}
          emptyMessage="No attributes."
          sortState={sortState}
          onSortChange={setSortState}
        />

        {editorMode !== null && (
          <AttributeEditor
            mode={editorMode}
            initial={editorMode === "edit" ? rows.find((r) => r.field_key === editorKey) ?? null : null}
            onSaved={async (savedKey: string, action: "created" | "updated") => {
              setEditorMode(null);
              setEditorKey(null);
              try {
                await load();
                showToast(`Attribute "${savedKey}" ${action}.`);
              } catch {
                showToast(`Attribute "${savedKey}" ${action}. (Reload failed; refresh.)`);
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
          title={`Deactivate "${deactivateTarget?.display_label ?? ""}"?`}
          body={deactivateTarget ? DEACTIVATE_BODY(deactivateTarget.field_key) : ""}
          confirmLabel="Deactivate"
          confirmVariant="primary"
          onConfirm={async () => {
            if (!deactivateTarget) return;
            const justKey = deactivateTarget.field_key;
            try {
              await deactivateAttributeRegistry(justKey);
              setDeactivateTarget(null);
              setDeactivateError(null);
              try {
                await load();
                showToast(`Attribute "${justKey}" deactivated.`);
              } catch {
                showToast(`Attribute "${justKey}" deactivated. (Reload failed; refresh.)`);
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
          title={`Reactivate "${reactivateTarget?.display_label ?? ""}"?`}
          body={`This will reactivate the attribute. It will become visible to operators again.`}
          confirmLabel="Reactivate"
          confirmVariant="primary"
          onConfirm={async () => {
            if (!reactivateTarget) return;
            const justKey = reactivateTarget.field_key;
            try {
              await reactivateAttributeRegistry(justKey);
              setReactivateTarget(null);
              setReactivateError(null);
              try {
                await load();
                showToast(`Attribute "${justKey}" reactivated.`);
              } catch {
                showToast(`Attribute "${justKey}" reactivated. (Reload failed; refresh.)`);
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
// Editor (14 fields)
// ────────────────────────────────────────────────────────────
interface AttributeEditorProps {
  mode: "create" | "edit";
  initial: AttributeRegistryEntry | null | undefined;
  onSaved: (savedKey: string, action: "created" | "updated") => void | Promise<void>;
  onCancel: () => void;
}

function hydrateDependsOn(
  d: AttributeRegistryEntry["depends_on"]
): { field: string; value: string } {
  if (!d) return { field: "", value: "" };
  if (typeof d === "object" && typeof d.field === "string" && typeof d.value === "string") {
    return { field: d.field, value: d.value };
  }
  // eslint-disable-next-line no-console
  console.warn("[AttributeEditor] malformed depends_on; treating as null:", d);
  return { field: "", value: "" };
}

function AttributeEditor({ mode, initial, onSaved, onCancel }: AttributeEditorProps) {
  const [fieldKey, setFieldKey] = useState<string>(initial?.field_key ?? "");
  const [displayLabel, setDisplayLabel] = useState<string>(initial?.display_label ?? "");
  const [fieldType, setFieldType] = useState<string>(initial?.field_type ?? "text");
  const [destinationTab, setDestinationTab] = useState<string>(initial?.destination_tab ?? "core_information");
  const [displayGroup, setDisplayGroup] = useState<string>(initial?.display_group ?? "");
  const [displayOrder, setDisplayOrder] = useState<number>(initial?.display_order ?? 0);
  const [tabGroupOrder, setTabGroupOrder] = useState<number>(initial?.tab_group_order ?? 0);
  const [requiredForCompletion, setRequiredForCompletion] = useState<boolean>(initial?.required_for_completion ?? false);
  const [includeInAiPrompt, setIncludeInAiPrompt] = useState<boolean>(initial?.include_in_ai_prompt ?? false);
  const [active, setActive] = useState<boolean>(initial?.active ?? true);
  const [exportEnabled, setExportEnabled] = useState<boolean>(initial?.export_enabled ?? true);
  const [dropdownOptions, setDropdownOptions] = useState<string[]>(initial?.dropdown_options ?? []);
  const [dropdownSource, setDropdownSource] = useState<string>(initial?.dropdown_source ?? "");
  const [fullWidth, setFullWidth] = useState<boolean>(initial?.full_width ?? false);
  const [isEditable, setIsEditable] = useState<boolean>(initial?.is_editable ?? true);
  const dependsHydrated = useMemo(() => hydrateDependsOn(initial?.depends_on), [initial]);
  const [dependsOnField, setDependsOnField] = useState<string>(dependsHydrated.field);
  const [dependsOnValue, setDependsOnValue] = useState<string>(dependsHydrated.value);
  // TALLY-SETTINGS-UX Phase 3 / A.3 PR5 — enrichment fields.
  const [severity, setSeverity] = useState<"" | "error" | "warn" | "info">(
    (initial?.severity as "error" | "warn" | "info" | undefined) ?? ""
  );
  const [whyItMatters, setWhyItMatters] = useState<string>(initial?.why_it_matters ?? "");

  const [isSaving, setIsSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  // Phase 3.1 PR #6 — modal tab state. Three tabs: Identity / Behavior / AI Logic.
  const [activeTab, setActiveTab] = useState<"identity" | "behavior" | "ai-logic">("identity");
  // Phase 3.1 PR #6 — show advanced reveals field_key input on create.
  // Component-local; not persisted (matches outer page Show advanced pattern).
  const [showAdvancedFields, setShowAdvancedFields] = useState<boolean>(false);

  // R.8 hydrate: if loaded row has unknown field_type, prepend disabled option
  // preserving the legacy value until the user explicitly picks a canonical one.
  const isUnknownType =
    mode === "edit" && !!initial && !KNOWN_FIELD_TYPES.has(initial.field_type);
  const fieldTypeOptions = useMemo(() => {
    if (isUnknownType && initial) {
      return [
        { value: initial.field_type, label: `(unknown: ${initial.field_type})`, disabled: true },
        ...FIELD_TYPE_OPTIONS,
      ];
    }
    return FIELD_TYPE_OPTIONS;
  }, [isUnknownType, initial]);

  async function handleSave() {
    setEditorError(null);
    if (mode === "create" && !fieldKey.trim()) {
      setEditorError("field_key is required.");
      return;
    }
    if (!displayLabel.trim()) {
      setEditorError("display_label is required.");
      return;
    }
    if (!fieldType.trim()) {
      setEditorError("field_type is required.");
      return;
    }
    if (!destinationTab.trim()) {
      setEditorError("destination_tab is required.");
      return;
    }

    // R.10 — depends_on FE validation: both filled or both empty.
    const depField = dependsOnField.trim();
    const depValue = dependsOnValue.trim();
    let dependsOnPayload: { field: string; value: string } | null;
    if (!depField && !depValue) {
      dependsOnPayload = null;
    } else if (depField && depValue) {
      dependsOnPayload = { field: depField, value: depValue };
    } else {
      setEditorError(
        "depends_on requires both 'Depends on field' and 'with value', or clear both to remove the dependency."
      );
      return;
    }

    setIsSaving(true);
    try {
      const cleanDropdownOptions = dropdownOptions.map((o) => o.trim()).filter((o) => o.length > 0);
      const patch: Partial<AttributeRegistryEntry> = {
        display_label: displayLabel.trim(),
        field_type: fieldType,
        destination_tab: destinationTab,
        display_group: displayGroup.trim() || undefined,
        display_order: Number.isFinite(displayOrder) ? displayOrder : 0,
        tab_group_order: Number.isFinite(tabGroupOrder) ? tabGroupOrder : 0,
        required_for_completion: requiredForCompletion,
        include_in_ai_prompt: includeInAiPrompt,
        active: active,
        export_enabled: exportEnabled,
        dropdown_options: cleanDropdownOptions,
        dropdown_source: dropdownSource ? dropdownSource : null,
        full_width: fullWidth,
        is_editable: isEditable,
        depends_on: dependsOnPayload,
        // PR5 enrichment — blank persists as null (clean removal); no backfill.
        severity: severity ? severity : null,
        why_it_matters: whyItMatters.trim() ? whyItMatters.trim() : null,
      };
      if (mode === "create") {
        const created = await createAttributeRegistry({
          field_key: fieldKey.trim(),
          ...patch,
        });
        await onSaved(created.field_key, "created");
      } else {
        const updated = await updateAttributeRegistry(initial!.field_key, patch);
        await onSaved(updated.field_key, "updated");
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
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">
          {mode === "create" ? "New Attribute" : `Edit Attribute: ${initial?.display_label ?? initial?.field_key ?? ""}`}
        </h2>

        {/* Phase 3.1 PR #6 — ModalTabBar (Identity / Behavior / AI Logic) */}
        <ModalTabBar
          tabs={[
            { id: "identity", label: "Identity" },
            { id: "behavior", label: "Behavior" },
            { id: "ai-logic", label: "AI Logic" },
          ]}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as "identity" | "behavior" | "ai-logic")}
          className="mb-4"
        />

        <div className="space-y-3">
          {/* ──────────── Tab 1: Identity ──────────── */}
          {activeTab === "identity" && (
            <div className="space-y-3" role="tabpanel" aria-label="Identity">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Display Name *</label>
                  <input
                    type="text"
                    value={displayLabel}
                    onChange={(e) => setDisplayLabel(e.target.value)}
                    className="border rounded px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Tab *</label>
                  <AdminSelect
                    value={destinationTab}
                    onChange={setDestinationTab}
                    options={DESTINATION_TAB_OPTIONS}
                  />
                </div>
              </div>

              {/* Field Key — behind Show Advanced on create; visible (disabled) on edit */}
              {mode === "edit" ? (
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Field Key</label>
                  <input
                    type="text"
                    value={fieldKey}
                    disabled
                    className="border rounded px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                  />
                  <span className="text-xs text-gray-500">Unique identifier; immutable after creation.</span>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={showAdvancedFields}
                      onChange={(e) => setShowAdvancedFields(e.target.checked)}
                    />
                    Show Advanced
                  </label>
                  {showAdvancedFields && (
                    <div className="flex flex-col gap-1 mt-1">
                      <label className="text-sm font-medium">Field Key *</label>
                      <input
                        type="text"
                        value={fieldKey}
                        onChange={(e) => setFieldKey(e.target.value)}
                        className="border rounded px-3 py-2 text-sm"
                      />
                      <span className="text-xs text-gray-500">Unique identifier; immutable after creation.</span>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Group</label>
                  <input
                    type="text"
                    value={displayGroup}
                    onChange={(e) => setDisplayGroup(e.target.value)}
                    className="border rounded px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Display Order</label>
                  <input
                    type="number"
                    value={displayOrder}
                    onChange={(e) => setDisplayOrder(parseInt(e.target.value, 10) || 0)}
                    className="border rounded px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Group Order Within Tab</label>
                  <input
                    type="number"
                    value={tabGroupOrder}
                    onChange={(e) => setTabGroupOrder(parseInt(e.target.value, 10) || 0)}
                    className="border rounded px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-1 flex flex-col gap-1">
                  <label className="text-sm font-medium">Severity Level</label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as "" | "error" | "warn" | "info")}
                    className="border rounded px-3 py-2 text-sm"
                  >
                    <option value="">(none)</option>
                    <option value="error">error</option>
                    <option value="warn">warn</option>
                    <option value="info">info</option>
                  </select>
                  <span className="text-xs text-gray-500">Empty persists as null.</span>
                </div>
                <div className="md:col-span-2 flex flex-col gap-1">
                  <label className="text-sm font-medium">Why It Matters</label>
                  <textarea
                    value={whyItMatters}
                    onChange={(e) => setWhyItMatters(e.target.value)}
                    rows={3}
                    placeholder="Free-form explanation of why this attribute matters."
                    className="border rounded px-3 py-2 text-sm"
                  />
                  <span className="text-xs text-gray-500">Empty persists as null.</span>
                </div>
              </div>
            </div>
          )}

          {/* ──────────── Tab 2: Behavior ──────────── */}
          {activeTab === "behavior" && (
            <div className="space-y-3" role="tabpanel" aria-label="Behavior">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Field Type *</label>
                <AdminSelect value={fieldType} onChange={setFieldType} options={fieldTypeOptions} />
              </div>

              {/* dropdown_options — visible only when field_type is dropdown or multi_select */}
              {(fieldType === "dropdown" || fieldType === "multi_select") && (
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Dropdown Options</label>
                  <div className="space-y-1">
                    {dropdownOptions.map((o, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          type="text"
                          value={o}
                          onChange={(e) => {
                            const next = [...dropdownOptions];
                            next[i] = e.target.value;
                            setDropdownOptions(next);
                          }}
                          className="flex-1 border rounded px-3 py-1.5 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => setDropdownOptions(dropdownOptions.filter((_, j) => j !== i))}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setDropdownOptions([...dropdownOptions, ""])}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      + Add option
                    </button>
                  </div>
                </div>
              )}

              {/* dropdown_source — visible only when field_type === "dropdown" */}
              {fieldType === "dropdown" && (
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Dropdown Source</label>
                  <AdminSelect
                    value={dropdownSource}
                    onChange={setDropdownSource}
                    options={DROPDOWN_SOURCE_OPTIONS}
                  />
                </div>
              )}

              {/* depends_on two-input pair (R.10) */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Depends On</label>
                <span className="text-xs text-gray-500">Field must equal value to display. Both fields required, or both empty.</span>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={dependsOnField}
                    onChange={(e) => setDependsOnField(e.target.value)}
                    placeholder="Field key (e.g. is_fast_fashion)"
                    className="border rounded px-3 py-2 text-sm"
                  />
                  <input
                    type="text"
                    value={dependsOnValue}
                    onChange={(e) => setDependsOnValue(e.target.value)}
                    placeholder="Value (e.g. true)"
                    className="border rounded px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                  />
                  Active
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={requiredForCompletion}
                    onChange={(e) => setRequiredForCompletion(e.target.checked)}
                  />
                  Required for Completion
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={exportEnabled}
                    onChange={(e) => setExportEnabled(e.target.checked)}
                  />
                  Include in Exports
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={fullWidth}
                    onChange={(e) => setFullWidth(e.target.checked)}
                  />
                  Full Width Display
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isEditable}
                    onChange={(e) => setIsEditable(e.target.checked)}
                  />
                  User-Editable
                </label>
              </div>
            </div>
          )}

          {/* ──────────── Tab 3: AI Logic ──────────── */}
          {activeTab === "ai-logic" && (
            <div className="space-y-3" role="tabpanel" aria-label="AI Logic">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeInAiPrompt}
                  onChange={(e) => setIncludeInAiPrompt(e.target.checked)}
                />
                Include in AI Prompts
              </label>
              <p className="text-xs text-gray-500">
                Future AI hints, generation rules, and prompt templates will appear here.
              </p>
            </div>
          )}

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
