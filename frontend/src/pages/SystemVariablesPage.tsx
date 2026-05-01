/**
 * Phase 3.5 PR B — System Variables page.
 *
 * Mounted at /admin/infrastructure/system-variables.
 *
 * Body extracted from AdminSettingsPage::VariablesTab and wrapped in the
 * standard pillar-page shell (mirrors PricingGuardrailsPage). Reads/writes via
 * existing fetchAdminSettings + updateAdminSetting endpoints in lib/api.ts.
 *
 * FILTERED scope per Phase 3.5 PR B Step 0.8: settings whose category is one
 * of `smtp`, `pricing`, `ai` are excluded — those have dedicated pages
 * (SmtpSettingsPage, PricingGuardrailsPage, AIProvidersListPage). The
 * remaining ~43 docs are grouped by category and rendered as typed editors.
 *
 * Field + inputClass duplicated inline per Lisa-default (cleanup tally is a
 * future PR).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RoleGate } from "../components/admin";
import {
  fetchAdminSettings,
  updateAdminSetting,
  type AdminSetting,
} from "../lib/api";

// Categories owned by dedicated pages — excluded from the general System
// Variables editor to prevent double-edit surfaces.
const EXCLUDED_CATEGORIES = new Set(["smtp", "pricing", "ai"]);

export default function SystemVariablesPage() {
  const [settings, setSettings] = useState<AdminSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [edits, setEdits] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const s = await fetchAdminSettings();
      // FILTER: drop docs owned by dedicated pages (smtp, pricing, ai).
      const filtered = s.filter(
        (doc) => !EXCLUDED_CATEGORIES.has(String(doc.category || "").toLowerCase())
      );
      setSettings(filtered);
      setEdits({});
    } catch (e: any) {
      setError(e?.error || e?.message || "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const grouped = useMemo(() => {
    const g: Record<string, AdminSetting[]> = {};
    for (const s of settings) {
      const cat = s.category || "general";
      if (!g[cat]) g[cat] = [];
      g[cat].push(s);
    }
    return g;
  }, [settings]);

  const dirty = Object.keys(edits).length > 0;

  async function saveAll() {
    setSaving(true);
    setError("");
    try {
      for (const [key, value] of Object.entries(edits)) {
        const s = settings.find((x) => x.key === key);
        const coerced =
          s?.type === "number" && typeof value === "string" && value !== ""
            ? Number(value)
            : value;
        await updateAdminSetting(key, coerced);
      }
      setSavedMsg(
        `Saved ${Object.keys(edits).length} change${Object.keys(edits).length === 1 ? "" : "s"}.`
      );
      setTimeout(() => setSavedMsg(""), 3000);
      load();
    } catch (e: any) {
      setError(e?.error || e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <RoleGate>
      <div className="max-w-4xl mx-auto p-6">
        <Link to="/admin/infrastructure" className="text-sm text-blue-600 hover:underline">
          ← System &amp; Infrastructure
        </Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">System Variables</h1>
        <p className="text-gray-600 mb-6">
          Admin reference editor for application-wide settings. SMTP, Pricing,
          and AI settings have dedicated pages.
        </p>

        {loading ? (
          <p className="text-sm text-gray-500 italic">Loading settings…</p>
        ) : (
          <div>
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            {savedMsg && (
              <p className="text-sm text-green-600 mb-3">{savedMsg}</p>
            )}

            {settings.length === 0 && (
              <p className="text-sm text-gray-500">
                No admin_settings documents in scope. (SMTP, Pricing, and AI
                categories are excluded — edit them via their dedicated pages.)
              </p>
            )}

            <div className="space-y-6">
              {Object.entries(grouped).map(([cat, rows]) => (
                <div
                  key={cat}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
                >
                  <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                    {cat.replace(/_/g, " ")}
                  </div>
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {rows.map((s) => {
                      const current =
                        edits[s.key] !== undefined ? edits[s.key] : s.value;
                      return (
                        <div
                          key={s.key}
                          className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2"
                        >
                          <div className="flex-1">
                            <div className="text-sm font-medium">{s.label || s.key}</div>
                            <div className="text-[11px] text-gray-400 font-mono">
                              {s.key}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {s.type === "boolean" ? (
                              <input
                                type="checkbox"
                                checked={Boolean(current)}
                                onChange={(e) =>
                                  setEdits((p) => ({
                                    ...p,
                                    [s.key]: e.target.checked,
                                  }))
                                }
                              />
                            ) : (
                              <input
                                type={s.type === "number" ? "number" : "text"}
                                value={current ?? ""}
                                onChange={(e) =>
                                  setEdits((p) => ({
                                    ...p,
                                    [s.key]: e.target.value,
                                  }))
                                }
                                className="w-48 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-sm bg-white dark:bg-gray-900"
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                disabled={!dirty || saving}
                onClick={() => setEdits({})}
                className="text-sm border border-gray-200 dark:border-gray-700 rounded px-3 py-1.5 disabled:opacity-50"
              >
                Discard Changes
              </button>
              <button
                disabled={!dirty || saving}
                onClick={saveAll}
                className="bg-blue-600 text-white text-sm rounded px-3 py-1.5 disabled:opacity-50"
              >
                {saving
                  ? "Saving…"
                  : `Save All Changes${dirty ? ` (${Object.keys(edits).length})` : ""}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </RoleGate>
  );
}
