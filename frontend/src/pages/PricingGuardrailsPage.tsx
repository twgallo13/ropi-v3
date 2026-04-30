/**
 * TALLY-SETTINGS-UX Phase 3 / A.3 PR5 — Pricing Guardrails admin page (placeholder fill).
 *
 * Mounted at /admin/infrastructure/pricing-guardrails.
 *
 * Per Ruling C.2 (LOCKED):
 *  - Page <h1> remains exactly "Pricing Guardrails" (UNCHANGED).
 *  - Two visible <h2> sub-sections render WITHIN the page:
 *      1) "Pricing Guardrails"           — keys 1–8
 *      2) "Cadence & Analytics Parameters" — keys 9–12
 *
 * Reads/writes via existing /api/v1/admin/settings flow (fetchAdminSettings + updateAdminSetting).
 * Per-key dirty tracking; single global Save button.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  RoleGate, ErrorBanner, SaveButton, showToast,
} from "../components/admin";
import { fetchAdminSettings, updateAdminSetting, AdminSetting } from "../lib/api";
import { safeRenderValue } from "../lib/safeRenderValue";

type ValueType = "number" | "boolean" | "string";

interface KeyDef {
  key: string;
  label: string;
  value_type: ValueType;
  default: string | number | boolean;
}

const GROUP_A: KeyDef[] = [
  { key: "gross_margin_safe_threshold",        label: "Gross Margin Safe Threshold",            value_type: "number",  default: 10 },
  { key: "estimated_cost_multiplier",          label: "Estimated Cost Multiplier",              value_type: "number",  default: 0.50 },
  { key: "below_cost_acknowledgment_required", label: "Below-Cost Acknowledgment Required",     value_type: "boolean", default: true },
  { key: "below_cost_reason_min_chars",        label: "Below-Cost Reason Minimum Characters",   value_type: "number",  default: 20 },
  { key: "master_veto_window",                 label: "Master Veto Window (hours)",             value_type: "number",  default: 2 },
  { key: "export_price_rounding_enabled",      label: "Export Price Rounding Enabled",          value_type: "boolean", default: true },
  { key: "export_price_rounding_mode",         label: "Export Price Rounding Mode",             value_type: "string",  default: "floor_minus_one_cent" },
  { key: "export_site_separator",              label: "Export Site Separator",                  value_type: "string",  default: "|" },
];

const GROUP_B: KeyDef[] = [
  { key: "slow_moving_str_threshold",   label: "Slow-Moving STR Threshold",        value_type: "number", default: 15 },
  { key: "slow_moving_wos_threshold",   label: "Slow-Moving WoS Threshold",        value_type: "number", default: 12 },
  { key: "str_calculation_window_days", label: "STR Calculation Window (days)",    value_type: "number", default: 30 },
  { key: "wos_trailing_average_days",   label: "WoS Trailing Average (days)",      value_type: "number", default: 30 },
];

const ALL_KEYS: KeyDef[] = [...GROUP_A, ...GROUP_B];

function formatError(err: any): string {
  if (!err) return "Unknown error.";
  if (typeof err === "string") return err;
  return err.error || err.message || JSON.stringify(err);
}

function coerceFromBE(raw: any, type: ValueType): string | number | boolean {
  if (raw === undefined || raw === null) return type === "boolean" ? false : type === "number" ? 0 : "";
  if (type === "boolean") {
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "string") return raw === "true" || raw === "1";
    return Boolean(raw);
  }
  if (type === "number") {
    if (typeof raw === "number") return raw;
    const n = parseFloat(String(raw));
    return Number.isFinite(n) ? n : 0;
  }
  return safeRenderValue(raw);
}

export default function PricingGuardrailsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const [originals, setOriginals] = useState<Record<string, string | number | boolean>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  // Phase 3.1 PR #7 — 'Show advanced' reveals parenthetical tech keys beside
  // each human label. Component-local state only; not persisted across reload.
  const [showAdvanced, setShowAdvanced] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const all: AdminSetting[] = await fetchAdminSettings();
      const byKey = new Map(all.map((s) => [s.key, s]));
      const next: Record<string, string | number | boolean> = {};
      const lbl: Record<string, string> = {};
      for (const def of ALL_KEYS) {
        const be = byKey.get(def.key);
        next[def.key] = be !== undefined ? coerceFromBE(be.value, def.value_type) : def.default;
        lbl[def.key] = (be?.label && be.label.trim()) || def.label;
      }
      setValues(next);
      setOriginals({ ...next });
      setLabels(lbl);
    } catch (e: any) {
      setError(formatError(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  const dirtyKeys = useMemo(() => {
    return ALL_KEYS.filter((d) => values[d.key] !== originals[d.key]).map((d) => d.key);
  }, [values, originals]);

  function setVal(key: string, v: string | number | boolean) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function handleSaveAll() {
    if (dirtyKeys.length === 0) return;
    setIsSaving(true); setError(null);
    try {
      const failures: string[] = [];
      for (const key of dirtyKeys) {
        const def = ALL_KEYS.find((d) => d.key === key)!;
        try {
          await updateAdminSetting(key, values[key], { type: def.value_type, category: "pricing", label: labels[key] });
        } catch (e: any) {
          failures.push(`${key}: ${formatError(e)}`);
        }
      }
      if (failures.length > 0) {
        setError(`Some keys failed to save:\n${failures.join("\n")}`);
        showToast(`Saved ${dirtyKeys.length - failures.length} of ${dirtyKeys.length}.`);
      } else {
        showToast(`Saved ${dirtyKeys.length} setting${dirtyKeys.length === 1 ? "" : "s"}.`);
      }
      await load();
    } catch (e: any) {
      setError(formatError(e));
    } finally {
      setIsSaving(false);
    }
  }

  function renderInput(def: KeyDef) {
    const v = values[def.key];
    const id = `pg-${def.key}`;
    if (def.value_type === "boolean") {
      return (
        <label htmlFor={id} className="flex items-center gap-2 text-sm">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(v)}
            onChange={(e) => setVal(def.key, e.target.checked)}
          />
          {labels[def.key] ?? def.label}
        </label>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {labels[def.key] ?? def.label}
          {showAdvanced && (
            <>
              {" "}
              <code className="text-xs text-gray-500">({def.key})</code>
            </>
          )}
        </label>
        {def.value_type === "number" ? (
          <input
            id={id}
            type="number"
            value={typeof v === "number" ? v : ""}
            step="any"
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              setVal(def.key, Number.isFinite(n) ? n : 0);
            }}
            className="border rounded px-3 py-2 text-sm w-full max-w-xs"
          />
        ) : (
          <input
            id={id}
            type="text"
            value={safeRenderValue(v)}
            onChange={(e) => setVal(def.key, e.target.value)}
            className="border rounded px-3 py-2 text-sm w-full max-w-md"
          />
        )}
      </div>
    );
  }

  return (
    <RoleGate>
      <div className="max-w-4xl mx-auto p-6">
        <Link to="/admin/infrastructure" className="text-sm text-blue-600 hover:underline">
          ← System &amp; Infrastructure
        </Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">Pricing Guardrails</h1>
        <p className="text-gray-600 mb-6">
          Margin thresholds, below-cost gates, export rounding, and cadence/analytics parameters.
        </p>

        {/* Phase 3.1 PR #7 — 'Show advanced' toggle (mirrors AttributeRegistry PR #5 pattern). */}
        <div className="flex justify-end mb-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showAdvanced}
              onChange={(e) => setShowAdvanced(e.target.checked)}
            />
            Show advanced
          </label>
        </div>

        <ErrorBanner message={error} onDismiss={() => setError(null)} />

        {loading ? (
          <p className="text-sm text-gray-500 italic">Loading settings…</p>
        ) : (
          <div className="space-y-8">
            <section>
              <h2 className="text-lg font-semibold border-b pb-2 mb-4">Pricing Guardrails</h2>
              <div className="space-y-4">
                {GROUP_A.map((def) => (
                  <div key={def.key}>{renderInput(def)}</div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-lg font-semibold border-b pb-2 mb-4">Cadence &amp; Analytics Parameters</h2>
              <div className="space-y-4">
                {GROUP_B.map((def) => (
                  <div key={def.key}>{renderInput(def)}</div>
                ))}
              </div>
            </section>

            <div className="flex items-center gap-4 border-t pt-4">
              <SaveButton onClick={handleSaveAll} isSaving={isSaving} disabled={dirtyKeys.length === 0} />
              <span className="text-xs text-gray-500">
                {dirtyKeys.length === 0
                  ? "No unsaved changes."
                  : `${dirtyKeys.length} unsaved change${dirtyKeys.length === 1 ? "" : "s"}.`}
              </span>
            </div>
          </div>
        )}
      </div>
    </RoleGate>
  );
}
