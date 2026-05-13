import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  fetchAttributeRegistry,
  fetchSmartRule,
  createSmartRule,
  updateSmartRule,
  testSmartRule,
  fetchBrandRegistry,
  fetchDepartmentRegistry,
  AttributeRegistryEntry,
  BrandRegistryEntry,
  DepartmentRegistryEntry,
  SmartRule,
  SmartRuleCondition,
  SmartRuleAction,
} from "../lib/api";

// TALLY-D2D-SMART-RULE-UI-GAP — Strategy B (Registry-Native Dropdowns).
// Backend (ruleFieldValidation.ts L19-L41) hard-rejects condition.field
// "brand"/"department". Builder must emit canonical "brand_key"/"department_key"
// for both conditions and actions, with values sourced from brand/department
// registries. Mirrors CadenceRulesAdminPage pattern.
const LEGACY_FIELD_MAP: Record<string, string> = {
  brand: "brand_key",
  department: "department_key",
};
const REGISTRY_DRIVEN_FIELDS = new Set(["brand_key", "department_key"]);
const REGISTRY_HELPER_TEXT = "Uses registry keys for accurate routing.";

function canonicalizeFieldName(field: string): string {
  return LEGACY_FIELD_MAP[field] || field;
}

// Internal builder row types: extend the API types with optional legacy
// markers used purely for UI state. Stripped before save.
type BuilderCondition = SmartRuleCondition & {
  _legacyOriginalField?: string;
  _legacyOriginalValue?: unknown;
};
type BuilderAction = SmartRuleAction & {
  _legacyOriginalField?: string;
  _legacyOriginalValue?: unknown;
};

// Raw source input fields — free text only (no taxonomy)
const SOURCE_INPUT_FIELDS = [
  { field_key: "rics_category", display_label: "RICS Category" },
  { field_key: "rics_color", display_label: "RICS Color" },
  { field_key: "rics_brand", display_label: "RICS Brand" },
  { field_key: "rics_short_description", display_label: "RICS Short Description" },
  { field_key: "rics_long_description", display_label: "RICS Long Description" },
];

const OPERATORS = [
  { v: "equals", label: "equals" },
  { v: "not_equals", label: "not equals" },
  { v: "contains", label: "contains" },
  { v: "starts_with", label: "starts with" },
  { v: "is_empty", label: "is empty" },
  { v: "is_not_empty", label: "is not empty" },
  { v: "matches", label: "matches (regex)" },
];

const EXACT_MATCH_OPS = new Set(["equals", "not_equals"]);
const NO_VALUE_OPS = new Set(["is_empty", "is_not_empty"]);

function emptyCondition(): BuilderCondition {
  return { field: "", operator: "equals", value: "", logic: "AND", case_sensitive: true };
}

function emptyAction(): BuilderAction {
  return { target_field: "", value: "" };
}

export default function SmartRuleBuilderPage() {
  const { ruleId } = useParams<{ ruleId: string }>();
  const isNew = !ruleId || ruleId === "new";
  const nav = useNavigate();
  const { role, loading: authLoading } = useAuth();

  const [registry, setRegistry] = useState<AttributeRegistryEntry[]>([]);
  const [brandRegistry, setBrandRegistry] = useState<BrandRegistryEntry[]>([]);
  const [departmentRegistry, setDepartmentRegistry] = useState<DepartmentRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [ruleName, setRuleName] = useState("");
  const [priority, setPriority] = useState<number>(10);
  const [isActive, setIsActive] = useState(true);
  const [alwaysOverwrite, setAlwaysOverwrite] = useState(false);
  const [conditions, setConditions] = useState<BuilderCondition[]>([emptyCondition()]);
  const [actions, setActions] = useState<BuilderAction[]>([emptyAction()]);

  // Dry-run
  const [testMpn, setTestMpn] = useState("");
  const [testResult, setTestResult] = useState<any>(null);

  useEffect(() => {
    if (authLoading) return;
    if (role !== "admin" && role !== "owner") return;
    (async () => {
      try {
        const [reg, brands, depts] = await Promise.all([
          fetchAttributeRegistry(),
          fetchBrandRegistry(true),
          fetchDepartmentRegistry(true),
        ]);
        setRegistry(reg);
        setBrandRegistry(brands);
        setDepartmentRegistry(depts);
        if (!isNew && ruleId) {
          const r = await fetchSmartRule(ruleId);
          setRuleName(r.rule_name);
          setPriority(r.priority);
          setIsActive(r.is_active);
          setAlwaysOverwrite(r.always_overwrite);
          // TALLY-D2D — legacy fallback: rules saved before TALLY-146B may carry
          // condition.field="brand"/"department" or action.target_field same.
          // Auto-map field name to canonical, preserve original value as legacy
          // marker so the UI can warn + force the operator to re-pick from the
          // registry dropdown before save.
          const brandKeys = new Set(brands.map((b) => b.brand_key));
          const deptKeys = new Set(depts.map((d) => d.key));
          const adoptedConds: BuilderCondition[] = (r.conditions || []).map((c) => {
            const isLegacyField = c.field === "brand" || c.field === "department";
            const canonicalField = canonicalizeFieldName(c.field);
            if (isLegacyField) {
              return {
                ...c,
                field: canonicalField,
                value: "",
                _legacyOriginalField: c.field,
                _legacyOriginalValue: c.value,
              };
            }
            // Field is already canonical — but the value may be stale display
            // text (e.g. "Nike") from a hand-edited rule. Flag if so.
            if (canonicalField === "brand_key" && c.value && !brandKeys.has(String(c.value))) {
              return { ...c, value: "", _legacyOriginalField: c.field, _legacyOriginalValue: c.value };
            }
            if (canonicalField === "department_key" && c.value && !deptKeys.has(String(c.value))) {
              return { ...c, value: "", _legacyOriginalField: c.field, _legacyOriginalValue: c.value };
            }
            return c as BuilderCondition;
          });
          const adoptedActs: BuilderAction[] = (r.actions || []).map((a) => {
            const isLegacyField =
              a.target_field === "brand" || a.target_field === "department";
            const canonicalField = canonicalizeFieldName(a.target_field);
            if (isLegacyField) {
              return {
                ...a,
                target_field: canonicalField,
                value: "",
                _legacyOriginalField: a.target_field,
                _legacyOriginalValue: a.value,
              };
            }
            if (canonicalField === "brand_key" && a.value && !brandKeys.has(String(a.value))) {
              return { ...a, value: "", _legacyOriginalField: a.target_field, _legacyOriginalValue: a.value };
            }
            if (canonicalField === "department_key" && a.value && !deptKeys.has(String(a.value))) {
              return { ...a, value: "", _legacyOriginalField: a.target_field, _legacyOriginalValue: a.value };
            }
            return a as BuilderAction;
          });
          setConditions(adoptedConds.length > 0 ? adoptedConds : [emptyCondition()]);
          setActions(adoptedActs.length > 0 ? adoptedActs : [emptyAction()]);
        }
      } catch (e: any) {
        setErr(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [ruleId, isNew, authLoading, role]);

  // TALLY-D2D — strip legacy registry doc IDs ("brand", "department") from
  // the field menus and inject canonical "brand_key" / "department_key".
  // Registry docs themselves are still used by the Product Editor for the
  // editor-facing display fields, so we do NOT touch the registry data —
  // only how this builder presents it.
  const CANONICAL_BRAND_DEPT = [
    { field_key: "brand_key", display_label: "Brand" },
    { field_key: "department_key", display_label: "Department" },
  ];

  const conditionFieldOptions = useMemo(() => {
    const filtered = registry
      .filter((r) => r.field_key !== "brand" && r.field_key !== "department")
      .map((r) => ({ field_key: r.field_key, display_label: r.display_label }));
    return [...filtered, ...CANONICAL_BRAND_DEPT, ...SOURCE_INPUT_FIELDS].sort(
      (a, b) => a.field_key.localeCompare(b.field_key)
    );
  }, [registry]);

  const actionFieldOptions = useMemo(() => {
    const filtered = registry
      .filter((r) => r.field_key !== "brand" && r.field_key !== "department")
      .map((r) => ({ field_key: r.field_key, display_label: r.display_label }));
    return [...filtered, ...CANONICAL_BRAND_DEPT].sort((a, b) =>
      a.field_key.localeCompare(b.field_key)
    );
  }, [registry]);

  // Has any condition/action been loaded with legacy data still pending
  // operator re-selection?
  const hasLegacyPending = useMemo(() => {
    return (
      conditions.some((c) => c._legacyOriginalField) ||
      actions.some((a) => a._legacyOriginalField)
    );
  }, [conditions, actions]);

  function registryEntry(field: string): AttributeRegistryEntry | undefined {
    return registry.find((r) => r.field_key === field);
  }

  // ── Dynamic value input for CONDITION rows ────────────────────────────
  function renderConditionValueInput(c: BuilderCondition, idx: number) {
    if (NO_VALUE_OPS.has(c.operator)) {
      return <span className="text-gray-400 italic text-sm">(no value)</span>;
    }
    // TALLY-D2D — registry-native dropdowns for canonical brand/department.
    if (c.field === "brand_key") {
      return (
        <select
          className="border rounded px-2 py-1 text-sm"
          value={String(c.value ?? "")}
          onChange={(e) => updateCondition(idx, { value: e.target.value })}
        >
          <option value="">— Select Brand —</option>
          {brandRegistry.map((b) => (
            <option key={b.brand_key} value={b.brand_key}>
              {b.display_name}
            </option>
          ))}
        </select>
      );
    }
    if (c.field === "department_key") {
      return (
        <select
          className="border rounded px-2 py-1 text-sm"
          value={String(c.value ?? "")}
          onChange={(e) => updateCondition(idx, { value: e.target.value })}
        >
          <option value="">— Select Department —</option>
          {departmentRegistry.map((d) => (
            <option key={d.key} value={d.key}>
              {d.display_name}
            </option>
          ))}
        </select>
      );
    }
    const reg = registryEntry(c.field);
    const isExact = EXACT_MATCH_OPS.has(c.operator);
    const isTaxonomy =
      reg && (reg.field_type === "dropdown" || reg.field_type === "multi_select");

    if (isExact && isTaxonomy && (reg!.dropdown_options || []).length > 0) {
      return (
        <select
          className="border rounded px-2 py-1 text-sm"
          value={String(c.value ?? "")}
          onChange={(e) => updateCondition(idx, { value: e.target.value })}
        >
          <option value="">Select…</option>
          {reg!.dropdown_options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    if (reg?.field_type === "boolean") {
      return (
        <select
          className="border rounded px-2 py-1 text-sm"
          value={String(c.value)}
          onChange={(e) => updateCondition(idx, { value: e.target.value })}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    }

    return (
      <input
        type="text"
        className="border rounded px-2 py-1 text-sm w-48"
        value={String(c.value ?? "")}
        onChange={(e) => updateCondition(idx, { value: e.target.value })}
        placeholder="value"
      />
    );
  }

  // ── Dynamic value input for ACTION rows ──────────────────────────────
  function renderActionValueInput(a: BuilderAction, idx: number) {
    // TALLY-D2D — registry-native dropdowns for canonical brand/department.
    if (a.target_field === "brand_key") {
      return (
        <select
          className="border rounded px-2 py-1 text-sm"
          value={String(a.value ?? "")}
          onChange={(e) => updateAction(idx, { value: e.target.value })}
        >
          <option value="">— Select Brand —</option>
          {brandRegistry.map((b) => (
            <option key={b.brand_key} value={b.brand_key}>
              {b.display_name}
            </option>
          ))}
        </select>
      );
    }
    if (a.target_field === "department_key") {
      return (
        <select
          className="border rounded px-2 py-1 text-sm"
          value={String(a.value ?? "")}
          onChange={(e) => updateAction(idx, { value: e.target.value })}
        >
          <option value="">— Select Department —</option>
          {departmentRegistry.map((d) => (
            <option key={d.key} value={d.key}>
              {d.display_name}
            </option>
          ))}
        </select>
      );
    }
    const reg = registryEntry(a.target_field);
    if (!reg) {
      return (
        <input
          type="text"
          className="border rounded px-2 py-1 text-sm w-48"
          value={String(a.value ?? "")}
          onChange={(e) => updateAction(idx, { value: e.target.value })}
          placeholder="value"
        />
      );
    }
    switch (reg.field_type) {
      case "dropdown":
      case "multi_select":
        return (
          <select
            className="border rounded px-2 py-1 text-sm"
            value={String(a.value ?? "")}
            onChange={(e) => updateAction(idx, { value: e.target.value })}
          >
            <option value="">Select…</option>
            {(reg.dropdown_options || []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      case "boolean":
        return (
          <select
            className="border rounded px-2 py-1 text-sm"
            value={String(a.value)}
            onChange={(e) =>
              updateAction(idx, { value: e.target.value === "true" })
            }
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        );
      case "number":
        return (
          <input
            type="number"
            step="any"
            className="border rounded px-2 py-1 text-sm w-32"
            value={String(a.value ?? "")}
            onChange={(e) =>
              updateAction(idx, {
                value: e.target.value === "" ? "" : parseFloat(e.target.value),
              })
            }
          />
        );
      default:
        return (
          <input
            type="text"
            className="border rounded px-2 py-1 text-sm w-48"
            value={String(a.value ?? "")}
            onChange={(e) => updateAction(idx, { value: e.target.value })}
          />
        );
    }
  }

  function updateCondition(i: number, patch: Partial<BuilderCondition>) {
    setConditions((prev) =>
      prev.map((c, idx) => {
        if (idx !== i) return c;
        const next: BuilderCondition = { ...c, ...patch };
        // Legacy markers are intentionally NOT cleared on field-only changes:
        // the warning must remain visible until the operator also picks a
        // non-empty registry-backed value (handled below).
        if (
          patch.value !== undefined &&
          patch.value !== "" &&
          c._legacyOriginalField
        ) {
          delete next._legacyOriginalField;
          delete next._legacyOriginalValue;
        }
        return next;
      })
    );
  }
  function updateAction(i: number, patch: Partial<BuilderAction>) {
    setActions((prev) =>
      prev.map((a, idx) => {
        if (idx !== i) return a;
        const next: BuilderAction = { ...a, ...patch };
        if (
          patch.value !== undefined &&
          patch.value !== "" &&
          a._legacyOriginalField
        ) {
          delete next._legacyOriginalField;
          delete next._legacyOriginalValue;
        }
        return next;
      })
    );
  }

  async function save() {
    setErr(null);
    if (!ruleName.trim()) {
      setErr("rule_name required");
      return;
    }
    // TALLY-D2D — frontend save validation BEFORE backend round-trip.
    // Backend (ruleFieldValidation.ts) will 400 on legacy field names; we
    // catch them here with a readable inline error and also enforce that
    // brand_key/department_key values come from the registries.
    const brandKeys = new Set(brandRegistry.map((b) => b.brand_key));
    const deptKeys = new Set(departmentRegistry.map((d) => d.key));

    for (let i = 0; i < conditions.length; i++) {
      const c = conditions[i];
      if (!c.field) continue; // dropped by the filter below
      if (c.field === "brand" || c.field === "department") {
        setErr(
          `Condition #${i + 1}: legacy field "${c.field}" is not allowed. Pick "${LEGACY_FIELD_MAP[c.field]}" instead.`
        );
        return;
      }
      if (c._legacyOriginalField) {
        setErr(
          `Condition #${i + 1}: this rule was saved with a legacy field. Pick a registry-backed value before saving.`
        );
        return;
      }
      if (NO_VALUE_OPS.has(c.operator)) continue;
      if (c.field === "brand_key") {
        if (!c.value || !brandKeys.has(String(c.value))) {
          setErr(`Condition #${i + 1}: pick a Brand from the registry.`);
          return;
        }
      }
      if (c.field === "department_key") {
        if (!c.value || !deptKeys.has(String(c.value))) {
          setErr(`Condition #${i + 1}: pick a Department from the registry.`);
          return;
        }
      }
    }
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (!a.target_field) continue;
      if (a.target_field === "brand" || a.target_field === "department") {
        setErr(
          `Action #${i + 1}: legacy target_field "${a.target_field}" is not allowed. Pick "${LEGACY_FIELD_MAP[a.target_field]}" instead.`
        );
        return;
      }
      if (a._legacyOriginalField) {
        setErr(
          `Action #${i + 1}: this rule was saved with a legacy target. Pick a registry-backed value before saving.`
        );
        return;
      }
      if (a.target_field === "brand_key") {
        if (!a.value || !brandKeys.has(String(a.value))) {
          setErr(`Action #${i + 1}: pick a Brand from the registry.`);
          return;
        }
      }
      if (a.target_field === "department_key") {
        if (!a.value || !deptKeys.has(String(a.value))) {
          setErr(`Action #${i + 1}: pick a Department from the registry.`);
          return;
        }
      }
    }

    const cleanedConds = conditions
      .filter((c) => c.field && c.operator)
      .map((c) => ({
        field: c.field,
        operator: c.operator,
        value: NO_VALUE_OPS.has(c.operator) ? "" : c.value,
        logic: c.logic || "AND",
        case_sensitive: c.case_sensitive !== false,
      }));
    const cleanedActs = actions
      .filter((a) => a.target_field)
      .map((a) => ({ target_field: a.target_field, value: a.value }));
    if (cleanedConds.length === 0) {
      setErr("At least one condition required");
      return;
    }
    if (cleanedActs.length === 0) {
      setErr("At least one action required");
      return;
    }
    const body: Partial<SmartRule> = {
      rule_name: ruleName,
      rule_type: "type_1",
      is_active: isActive,
      priority,
      always_overwrite: alwaysOverwrite,
      conditions: cleanedConds,
      actions: cleanedActs,
    };
    setSaving(true);
    try {
      if (isNew) {
        const created = await createSmartRule(body);
        nav(`/admin/smart-rules/${created.rule_id}`, { replace: true });
      } else {
        await updateSmartRule(ruleId!, body);
      }
    } catch (e: any) {
      setErr(e.error || e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTestResult(null);
    if (!testMpn.trim() || isNew) return;
    try {
      const res = await testSmartRule(ruleId!, testMpn.trim());
      setTestResult(res);
    } catch (e: any) {
      setErr(e.error || e.message || String(e));
    }
  }

  if (authLoading) return <div className="p-6 text-gray-500">Loading…</div>;
  if (role !== "admin" && role !== "owner") return <Navigate to="/dashboard" replace />;

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {isNew ? "New Smart Rule" : `Edit: ${ruleName}`}
        </h1>
        <div className="space-x-2">
          <button
            onClick={() => nav("/admin/smart-rules")}
            className="text-gray-600 hover:underline text-sm"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            {saving ? "Saving…" : "Save Rule"}
          </button>
        </div>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded text-sm">
          {err}
        </div>
      )}

      {hasLegacyPending && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded text-sm">
          ⚠ This rule uses a legacy field. Choose a registry-backed value before saving.
        </div>
      )}

      <div className="bg-white border rounded p-4 space-y-3">
        <div className="flex gap-4 items-end flex-wrap">
          <label className="block">
            <span className="text-xs text-gray-600">Rule Name</span>
            <input
              className="border rounded px-2 py-1 text-sm w-80 block"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-600">Priority (asc — lower fires first)</span>
            <input
              type="number"
              className="border rounded px-2 py-1 text-sm w-24 block"
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Active
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={alwaysOverwrite}
              onChange={(e) => setAlwaysOverwrite(e.target.checked)}
            />
            Always Overwrite
          </label>
        </div>
        {alwaysOverwrite && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-2 rounded text-xs">
            ⚠ This rule will overwrite System-Applied values. It will never overwrite Human-Verified values.
          </div>
        )}
      </div>

      {/* ── Conditions ── */}
      <div className="bg-white border rounded p-4">
        <h2 className="text-sm font-semibold mb-2">IF (Conditions)</h2>
        {conditions.map((c, i) => (
          <div key={i} className="mb-2">
            <div className="flex items-center gap-2 flex-wrap">
            <select
              className="border rounded px-2 py-1 text-sm w-52"
              value={c.field}
              onChange={(e) => updateCondition(i, { field: e.target.value })}
            >
              <option value="">Select field…</option>
              {conditionFieldOptions.map((f) => (
                <option key={f.field_key} value={f.field_key}>
                  {f.field_key} {f.display_label ? `(${f.display_label})` : ""}
                </option>
              ))}
            </select>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={c.operator}
              onChange={(e) => updateCondition(i, { operator: e.target.value })}
            >
              {OPERATORS.map((op) => (
                <option key={op.v} value={op.v}>
                  {op.label}
                </option>
              ))}
            </select>
            {renderConditionValueInput(c, i)}
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={c.case_sensitive !== false}
                onChange={(e) =>
                  updateCondition(i, { case_sensitive: e.target.checked })
                }
              />
              case-sensitive
            </label>
            {i < conditions.length - 1 && (
              <select
                className="border rounded px-2 py-1 text-xs font-bold"
                value={c.logic || "AND"}
                onChange={(e) =>
                  updateCondition(i, { logic: e.target.value as "AND" | "OR" })
                }
              >
                <option value="AND">AND</option>
                <option value="OR">OR</option>
              </select>
            )}
            <button
              onClick={() =>
                setConditions((prev) => prev.filter((_, idx) => idx !== i))
              }
              className="text-red-500 text-xs"
              disabled={conditions.length <= 1}
            >
              ×
            </button>
            </div>
            {REGISTRY_DRIVEN_FIELDS.has(c.field) && (
              <div className="text-[11px] text-gray-500 mt-1 ml-1">
                {REGISTRY_HELPER_TEXT}
              </div>
            )}
            {c._legacyOriginalField && (
              <div className="text-[11px] text-amber-700 mt-1 ml-1">
                Legacy: was field="{c._legacyOriginalField}", value="{String(c._legacyOriginalValue ?? "")}"
              </div>
            )}
          </div>
        ))}
        <button
          onClick={() => setConditions((p) => [...p, emptyCondition()])}
          className="text-blue-600 text-xs hover:underline"
        >
          + Add condition
        </button>
      </div>

      {/* ── Actions ── */}
      <div className="bg-white border rounded p-4">
        <h2 className="text-sm font-semibold mb-2">THEN (Actions)</h2>
        {actions.map((a, i) => (
          <div key={i} className="mb-2">
            <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Set</span>
            <select
              className="border rounded px-2 py-1 text-sm w-52"
              value={a.target_field}
              onChange={(e) => updateAction(i, { target_field: e.target.value })}
            >
              <option value="">Select field…</option>
              {actionFieldOptions.map((f) => (
                <option key={f.field_key} value={f.field_key}>
                  {f.field_key} {f.display_label ? `(${f.display_label})` : ""}
                </option>
              ))}
            </select>
            <span className="text-xs text-gray-500">=</span>
            {renderActionValueInput(a, i)}
            <button
              onClick={() =>
                setActions((prev) => prev.filter((_, idx) => idx !== i))
              }
              className="text-red-500 text-xs"
              disabled={actions.length <= 1}
            >
              ×
            </button>
            </div>
            {REGISTRY_DRIVEN_FIELDS.has(a.target_field) && (
              <div className="text-[11px] text-gray-500 mt-1 ml-1">
                {REGISTRY_HELPER_TEXT}
              </div>
            )}
            {a._legacyOriginalField && (
              <div className="text-[11px] text-amber-700 mt-1 ml-1">
                Legacy: was target_field="{a._legacyOriginalField}", value="{String(a._legacyOriginalValue ?? "")}"
              </div>
            )}
          </div>
        ))}
        <button
          onClick={() => setActions((p) => [...p, emptyAction()])}
          className="text-blue-600 text-xs hover:underline"
        >
          + Add action
        </button>
      </div>

      {/* ── Test (dry-run) ── */}
      {!isNew && (
        <div className="bg-gray-50 border rounded p-4">
          <h2 className="text-sm font-semibold mb-2">Test against real MPN (dry-run — no writes)</h2>
          <div className="flex items-center gap-2">
            <input
              className="border rounded px-2 py-1 text-sm w-60"
              placeholder="e.g. 1006302"
              value={testMpn}
              onChange={(e) => setTestMpn(e.target.value)}
            />
            <button
              onClick={runTest}
              className="bg-gray-700 text-white px-3 py-1 rounded text-sm hover:bg-gray-800"
            >
              Test
            </button>
          </div>
          {testResult && (
            <div className="mt-3 text-sm bg-white border rounded p-3 font-mono whitespace-pre">
              {JSON.stringify(testResult, null, 2)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
