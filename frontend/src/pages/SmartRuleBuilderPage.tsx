import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  fetchAttributeRegistry,
  fetchSmartRule,
  createSmartRule,
  updateSmartRule,
  testSmartRule,
  AttributeRegistryEntry,
  SmartRule,
  SmartRuleCondition,
  SmartRuleAction,
} from "../lib/api";

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

function emptyCondition(): SmartRuleCondition {
  return { field: "", operator: "equals", value: "", logic: "AND", case_sensitive: true };
}

function emptyAction(): SmartRuleAction {
  return { target_field: "", value: "" };
}

export default function SmartRuleBuilderPage() {
  const { ruleId } = useParams<{ ruleId: string }>();
  const isNew = !ruleId || ruleId === "new";
  const nav = useNavigate();
  const { role, loading: authLoading } = useAuth();

  const [registry, setRegistry] = useState<AttributeRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [ruleName, setRuleName] = useState("");
  const [priority, setPriority] = useState<number>(10);
  const [isActive, setIsActive] = useState(true);
  const [alwaysOverwrite, setAlwaysOverwrite] = useState(false);
  const [conditions, setConditions] = useState<SmartRuleCondition[]>([emptyCondition()]);
  const [actions, setActions] = useState<SmartRuleAction[]>([emptyAction()]);

  // Dry-run
  const [testMpn, setTestMpn] = useState("");
  const [testResult, setTestResult] = useState<any>(null);

  useEffect(() => {
    if (authLoading) return;
    if (role !== "admin" && role !== "owner") return;
    (async () => {
      try {
        const reg = await fetchAttributeRegistry();
        setRegistry(reg);
        if (!isNew && ruleId) {
          const r = await fetchSmartRule(ruleId);
          setRuleName(r.rule_name);
          setPriority(r.priority);
          setIsActive(r.is_active);
          setAlwaysOverwrite(r.always_overwrite);
          setConditions(
            (r.conditions || []).length > 0
              ? (r.conditions as SmartRuleCondition[])
              : [emptyCondition()]
          );
          setActions(
            (r.actions || []).length > 0 ? (r.actions as SmartRuleAction[]) : [emptyAction()]
          );
        }
      } catch (e: any) {
        setErr(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [ruleId, isNew, authLoading, role]);

  // Fields available for condition.field — registry + raw source inputs
  const conditionFieldOptions = useMemo(() => {
    return [
      ...registry.map((r) => ({ field_key: r.field_key, display_label: r.display_label })),
      ...SOURCE_INPUT_FIELDS,
    ].sort((a, b) => a.field_key.localeCompare(b.field_key));
  }, [registry]);

  const actionFieldOptions = useMemo(() => {
    return registry
      .map((r) => ({ field_key: r.field_key, display_label: r.display_label }))
      .sort((a, b) => a.field_key.localeCompare(b.field_key));
  }, [registry]);

  function registryEntry(field: string): AttributeRegistryEntry | undefined {
    return registry.find((r) => r.field_key === field);
  }

  // ── Dynamic value input for CONDITION rows ────────────────────────────
  function renderConditionValueInput(c: SmartRuleCondition, idx: number) {
    if (NO_VALUE_OPS.has(c.operator)) {
      return <span className="text-gray-400 italic text-sm">(no value)</span>;
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
  function renderActionValueInput(a: SmartRuleAction, idx: number) {
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

  function updateCondition(i: number, patch: Partial<SmartRuleCondition>) {
    setConditions((prev) =>
      prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c))
    );
  }
  function updateAction(i: number, patch: Partial<SmartRuleAction>) {
    setActions((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }

  async function save() {
    setErr(null);
    if (!ruleName.trim()) {
      setErr("rule_name required");
      return;
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
          <div key={i} className="flex items-center gap-2 mb-2 flex-wrap">
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
          <div key={i} className="flex items-center gap-2 mb-2 flex-wrap">
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
