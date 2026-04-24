import { useEffect, useState } from "react";
import {
  fetchCadenceRules,
  createCadenceRule,
  updateCadenceRule,
  deactivateCadenceRule,
  type CadenceRule,
  type CadenceTargetFilter,
  type CadenceTriggerCondition,
  type CadenceMarkdownStep,
} from "../lib/api";

const TARGET_FIELDS = [
  "department",
  "brand",
  "category",
  "class",
  "gender",
  "site_owner",
  "season",
];
const STRING_OPS = ["equals", "not_equals", "contains", "starts_with"];

const TRIGGER_FIELDS = [
  "str_pct",
  "wos",
  "product_age_days",
  "inventory_total",
  "inventory_store",
  "is_slow_moving",
  "store_gm_pct",
  "web_gm_pct",
  "days_in_queue",
  "is_map_protected",
];
const NUMERIC_OPS = [
  "less_than",
  "greater_than",
  "less_than_or_equal",
  "greater_than_or_equal",
  "equals",
];

const ACTION_TYPES = ["markdown_pct", "custom_price", "off_sale", "set_in_cart_promo"];
const SCOPES = ["store_and_web", "store_only", "web_only"];

type Draft = Omit<CadenceRule, "rule_id" | "version" | "created_at" | "updated_at"> & {
  rule_id?: string;
  version?: number;
};

function emptyDraft(): Draft {
  return {
    rule_name: "",
    is_active: true,
    owner_buyer_id: "",
    owner_site_owner: "",
    target_filters: [
      { field: "department", operator: "equals", value: "", case_sensitive: true, logic: "AND" as const },
    ],
    trigger_conditions: [
      { field: "str_pct", operator: "less_than", value: 15, logic: "AND" },
    ],
    markdown_steps: [
      {
        step_number: 1,
        day_threshold: 30,
        action_type: "markdown_pct",
        markdown_scope: "store_and_web",
        value: 15,
        apply_99_rounding: true,
      },
    ],
  };
}

function RuleEditor({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string;
}) {
  function updateFilter(i: number, patch: Partial<CadenceTargetFilter>) {
    const next = [...draft.target_filters];
    next[i] = { ...next[i], ...patch };
    onChange({ ...draft, target_filters: next });
  }
  function addFilter() {
    onChange({
      ...draft,
      target_filters: [
        ...draft.target_filters,
        { field: "brand", operator: "equals", value: "", case_sensitive: true, logic: "AND" as const },
      ],
    });
  }
  function removeFilter(i: number) {
    onChange({
      ...draft,
      target_filters: draft.target_filters.filter((_, idx) => idx !== i),
    });
  }

  function updateCondition(i: number, patch: Partial<CadenceTriggerCondition>) {
    const next = [...draft.trigger_conditions];
    next[i] = { ...next[i], ...patch };
    onChange({ ...draft, trigger_conditions: next });
  }
  function addCondition() {
    onChange({
      ...draft,
      trigger_conditions: [
        ...draft.trigger_conditions,
        { field: "wos", operator: "greater_than", value: 8, logic: "AND" },
      ],
    });
  }
  function removeCondition(i: number) {
    onChange({
      ...draft,
      trigger_conditions: draft.trigger_conditions.filter((_, idx) => idx !== i),
    });
  }

  function updateStep(i: number, patch: Partial<CadenceMarkdownStep>) {
    const next = [...draft.markdown_steps];
    next[i] = { ...next[i], ...patch };
    onChange({ ...draft, markdown_steps: next });
  }
  function addStep() {
    const n = draft.markdown_steps.length + 1;
    onChange({
      ...draft,
      markdown_steps: [
        ...draft.markdown_steps,
        {
          step_number: n,
          day_threshold: 30 * n,
          action_type: "markdown_pct",
          markdown_scope: "store_and_web",
          value: 15 * n,
          apply_99_rounding: true,
        },
      ],
    });
  }
  function removeStep(i: number) {
    onChange({
      ...draft,
      markdown_steps: draft.markdown_steps
        .filter((_, idx) => idx !== i)
        .map((s, idx) => ({ ...s, step_number: idx + 1 })),
    });
  }

  return (
    <div className="bg-white border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">
          {draft.rule_id ? "Edit Cadence Rule" : "New Cadence Rule"}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="text-sm border rounded px-3 py-1.5 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="text-sm bg-blue-600 text-white rounded px-3 py-1.5 hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Rule"}
          </button>
        </div>
      </div>

      <label className="block mb-4">
        <span className="text-xs font-semibold text-gray-500 uppercase mb-1 block">
          Rule Name
        </span>
        <input
          value={draft.rule_name}
          onChange={(e) => onChange({ ...draft, rule_name: e.target.value })}
          placeholder="Alex - Nike Footwear 30-day"
          className="w-full border rounded px-3 py-2 text-sm"
        />
      </label>

      {/* A. Target Filters */}
      <section className="mb-5">
        <h3 className="text-sm font-bold text-gray-800 mb-2">A. Target Filter (which products)</h3>
        {draft.target_filters.map((f, i) => (
          <div key={i} className="flex gap-2 items-center mb-2">
            <select
              value={f.field}
              onChange={(e) => updateFilter(i, { field: e.target.value })}
              className="border rounded px-2 py-1 text-sm"
            >
              {TARGET_FIELDS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <select
              value={f.operator}
              onChange={(e) => updateFilter(i, { operator: e.target.value as any })}
              className="border rounded px-2 py-1 text-sm"
            >
              {STRING_OPS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <input
              value={f.value}
              onChange={(e) => updateFilter(i, { value: e.target.value })}
              placeholder="value"
              className="flex-1 border rounded px-2 py-1 text-sm"
            />
            <label className="text-xs flex items-center gap-1">
              <input
                type="checkbox"
                checked={f.case_sensitive}
                onChange={(e) => updateFilter(i, { case_sensitive: e.target.checked })}
              />
              case-sensitive
            </label>
            <select
              value={f.logic}
              onChange={(e) =>
                updateFilter(i, { logic: e.target.value as "AND" | "OR" })
              }
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="AND">AND</option>
              <option value="OR">OR</option>
            </select>
            <button
              onClick={() => removeFilter(i)}
              className="text-xs text-red-600 hover:underline"
            >
              remove
            </button>
          </div>
        ))}
        <button
          onClick={addFilter}
          className="text-xs border rounded px-2 py-1 hover:bg-gray-50"
        >
          + Add filter
        </button>
      </section>

      {/* B. Trigger Conditions */}
      <section className="mb-5">
        <h3 className="text-sm font-bold text-gray-800 mb-2">
          B. Trigger Conditions (when to fire)
        </h3>
        {draft.trigger_conditions.map((c, i) => (
          <div key={i} className="flex gap-2 items-center mb-2">
            <select
              value={c.field}
              onChange={(e) => updateCondition(i, { field: e.target.value })}
              className="border rounded px-2 py-1 text-sm"
            >
              {TRIGGER_FIELDS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <select
              value={c.operator}
              onChange={(e) => updateCondition(i, { operator: e.target.value as any })}
              className="border rounded px-2 py-1 text-sm"
            >
              {NUMERIC_OPS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              value={String(c.value)}
              onChange={(e) =>
                updateCondition(i, { value: parseFloat(e.target.value) || 0 })
              }
              className="w-24 border rounded px-2 py-1 text-sm"
            />
            <select
              value={c.logic}
              onChange={(e) =>
                updateCondition(i, { logic: e.target.value as "AND" | "OR" })
              }
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="AND">AND</option>
              <option value="OR">OR</option>
            </select>
            <button
              onClick={() => removeCondition(i)}
              className="text-xs text-red-600 hover:underline"
            >
              remove
            </button>
          </div>
        ))}
        <button
          onClick={addCondition}
          className="text-xs border rounded px-2 py-1 hover:bg-gray-50"
        >
          + Add condition
        </button>
      </section>

      {/* C. Markdown Steps */}
      <section className="mb-3">
        <h3 className="text-sm font-bold text-gray-800 mb-2">C. Markdown Steps</h3>
        {draft.markdown_steps.map((s, i) => (
          <div key={i} className="flex gap-2 items-center mb-2">
            <span className="text-xs text-gray-500 w-14">Step {s.step_number}:</span>
            <span className="text-xs">Day</span>
            <input
              type="number"
              value={s.day_threshold}
              onChange={(e) =>
                updateStep(i, { day_threshold: parseInt(e.target.value) || 0 })
              }
              className="w-20 border rounded px-2 py-1 text-sm"
            />
            <select
              value={s.action_type}
              onChange={(e) => {
                const at = e.target.value as any;
                const patch: Partial<CadenceMarkdownStep> = { action_type: at };
                if (at === "set_in_cart_promo") patch.markdown_scope = "web_only";
                updateStep(i, patch);
              }}
              className="border rounded px-2 py-1 text-sm"
            >
              {ACTION_TYPES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            {(s.action_type === "markdown_pct" ||
              s.action_type === "custom_price" ||
              s.action_type === "set_in_cart_promo") && (
              <input
                type="number"
                step="0.01"
                value={s.value}
                onChange={(e) =>
                  updateStep(i, { value: parseFloat(e.target.value) || 0 })
                }
                className="w-24 border rounded px-2 py-1 text-sm"
                placeholder={s.action_type === "markdown_pct" ? "%" : "$"}
              />
            )}
            <select
              value={s.action_type === "set_in_cart_promo" ? "web_only" : s.markdown_scope}
              disabled={s.action_type === "set_in_cart_promo"}
              onChange={(e) =>
                updateStep(i, { markdown_scope: e.target.value as any })
              }
              className="border rounded px-2 py-1 text-sm disabled:opacity-50"
            >
              {SCOPES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <label className="text-xs flex items-center gap-1">
              <input
                type="checkbox"
                checked={s.apply_99_rounding}
                onChange={(e) =>
                  updateStep(i, { apply_99_rounding: e.target.checked })
                }
              />
              .99
            </label>
            <button
              onClick={() => removeStep(i)}
              className="text-xs text-red-600 hover:underline"
            >
              remove
            </button>
          </div>
        ))}
        <button
          onClick={addStep}
          className="text-xs border rounded px-2 py-1 hover:bg-gray-50"
        >
          + Add step
        </button>
      </section>

      {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
    </div>
  );
}

export default function CadenceRulesAdminPage() {
  const [rules, setRules] = useState<CadenceRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const d = await fetchCadenceRules();
      setRules(d.rules);
    } catch (e: any) {
      setError(e?.error || e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        rule_name: draft.rule_name,
        is_active: draft.is_active,
        owner_buyer_id: draft.owner_buyer_id,
        owner_site_owner: draft.owner_site_owner,
        target_filters: draft.target_filters,
        trigger_conditions: draft.trigger_conditions,
        markdown_steps: draft.markdown_steps,
      };
      if (draft.rule_id) {
        await updateCadenceRule(draft.rule_id, payload);
      } else {
        await createCadenceRule(payload);
      }
      setDraft(null);
      await load();
    } catch (e: any) {
      setError(e?.error || e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(rule: CadenceRule) {
    if (!confirm(`Deactivate rule "${rule.rule_name}"?`)) return;
    setError("");
    try {
      await deactivateCadenceRule(rule.rule_id);
    } catch (e: any) {
      setError(
        `Failed to deactivate "${rule.rule_name}": ${e?.error || e?.message || "Unknown error"}`
      );
      return;
    }
    try {
      await load();
    } catch (e: any) {
      setError(
        `Deactivated, but failed to refresh list: ${e?.error || e?.message || "Unknown error"}`
      );
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cadence Rules</h1>
          <p className="text-sm text-gray-500">
            {rules.length} rule{rules.length !== 1 ? "s" : ""}
          </p>
        </div>
        {!draft && (
          <button
            onClick={() => setDraft(emptyDraft())}
            className="bg-blue-600 text-white text-sm rounded px-4 py-2 hover:bg-blue-700"
          >
            + New Rule
          </button>
        )}
      </div>

      {!draft && error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm flex items-start justify-between gap-3">
          <span>{error}</span>
          <button
            onClick={() => setError("")}
            className="text-red-600 hover:text-red-900 text-xs"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {draft && (
        <div className="mb-6">
          <RuleEditor
            draft={draft}
            onChange={setDraft}
            onSave={save}
            onCancel={() => {
              setDraft(null);
              setError("");
            }}
            saving={saving}
            error={error}
          />
        </div>
      )}

      {loading && <div className="text-center text-gray-400 py-12">Loading…</div>}

      {!loading && rules.length === 0 && !draft && (
        <div className="text-center text-gray-400 py-12">
          No cadence rules yet. Click "+ New Rule" to create one.
        </div>
      )}

      <div className="grid gap-3">
        {rules.map((r) => (
          <div key={r.rule_id} className="bg-white border rounded p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium">{r.rule_name}</h3>
                <p className="text-xs text-gray-500">
                  v{r.version} · {r.is_active ? "Active" : "Inactive"} ·{" "}
                  {r.target_filters.length} filter
                  {r.target_filters.length !== 1 ? "s" : ""} ·{" "}
                  {r.markdown_steps.length} step
                  {r.markdown_steps.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    setDraft({
                      rule_id: r.rule_id,
                      version: r.version,
                      rule_name: r.rule_name,
                      is_active: r.is_active,
                      owner_buyer_id: r.owner_buyer_id,
                      owner_site_owner: r.owner_site_owner,
                      target_filters: r.target_filters,
                      trigger_conditions: r.trigger_conditions,
                      markdown_steps: r.markdown_steps,
                    })
                  }
                  className="text-xs border rounded px-2 py-1 hover:bg-gray-50"
                >
                  Edit
                </button>
                {r.is_active && (
                  <button
                    onClick={() => deactivate(r)}
                    className="text-xs text-red-600 border border-red-200 rounded px-2 py-1 hover:bg-red-50"
                  >
                    Deactivate
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
