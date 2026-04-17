import { useEffect, useState } from "react";
import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
  fetchAdvisoryPreferences,
  updateAdvisoryPreferences,
  type NotificationPreferences,
  type AdvisoryPreferences,
} from "../lib/api";

const ROWS: { key: keyof NotificationPreferences; label: string; locked?: boolean }[] = [
  { key: "mention", label: "@mention on a product comment", locked: true },
  { key: "pricing_discrepancy", label: "Pricing Discrepancy detected" },
  { key: "high_priority_launch", label: "High Priority Launch flag fires" },
  { key: "loss_leader", label: "Loss-Leader routing (always-on)", locked: true },
  { key: "map_conflict", label: "MAP Conflict detected" },
  { key: "export_complete", label: "Export completed" },
];

export default function NotificationSettingsPage() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [advPrefs, setAdvPrefs] = useState<AdvisoryPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingAdv, setSavingAdv] = useState(false);
  const [msg, setMsg] = useState("");
  const [advMsg, setAdvMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [nRes, aRes] = await Promise.all([
          fetchNotificationPreferences(),
          fetchAdvisoryPreferences(),
        ]);
        setPrefs(nRes.preferences);
        setAdvPrefs(aRes.advisory_preferences);
      } catch (e: any) {
        setMsg(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleToggle(key: keyof NotificationPreferences, locked?: boolean) {
    if (!prefs || locked) return;
    setPrefs({ ...prefs, [key]: !prefs[key] });
  }

  async function handleSave() {
    if (!prefs) return;
    setSaving(true);
    setMsg("");
    try {
      await updateNotificationPreferences(prefs);
      setMsg("Saved.");
    } catch (e: any) {
      setMsg(e?.error || e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">Notification Preferences</h1>
      <p className="text-sm text-gray-600 mb-6">
        @mention and Loss-Leader alerts are always-on (per Section 15.2) and cannot be disabled.
      </p>
      {loading || !prefs ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="bg-white border rounded divide-y">
          {ROWS.map((row) => (
            <label
              key={row.key}
              className="flex items-center justify-between px-4 py-3 cursor-pointer"
            >
              <span className="text-sm">
                {row.label}
                {row.locked && (
                  <span className="ml-2 text-xs text-gray-500">(locked)</span>
                )}
              </span>
              <input
                type="checkbox"
                checked={!!prefs[row.key]}
                disabled={row.locked}
                onChange={() => handleToggle(row.key, row.locked)}
                className="h-4 w-4"
              />
            </label>
          ))}
        </div>
      )}
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !prefs}
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>

      {/* ── Weekly Advisory Settings ── */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Weekly Advisory Settings
        </h2>
        <p className="text-sm text-gray-600 mb-4">
          Personalize the focus and format of your AI-generated weekly advisory.
        </p>
        {advPrefs ? (
          <div className="bg-white border rounded p-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Advisory Focus
              </label>
              <select
                value={advPrefs.focus_area}
                onChange={(e) =>
                  setAdvPrefs((p) =>
                    p ? { ...p, focus_area: e.target.value as AdvisoryPreferences["focus_area"] } : p
                  )
                }
                className="w-full border rounded p-2 text-sm"
              >
                <option value="balanced">
                  Balanced — equal weight across all sections
                </option>
                <option value="margin_health">
                  Margin Health — lead with GM% analysis
                </option>
                <option value="inventory_clearance">
                  Inventory Clearance — lead with dead wood and velocity
                </option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Report Format
              </label>
              <select
                value={advPrefs.format_preference}
                onChange={(e) =>
                  setAdvPrefs((p) =>
                    p
                      ? {
                          ...p,
                          format_preference: e.target
                            .value as AdvisoryPreferences["format_preference"],
                        }
                      : p
                  )
                }
                className="w-full border rounded p-2 text-sm"
              >
                <option value="prose">Prose — flowing paragraphs</option>
                <option value="bullet_points">
                  Bullet Points — concise lists
                </option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  if (!advPrefs) return;
                  setSavingAdv(true);
                  setAdvMsg("");
                  try {
                    await updateAdvisoryPreferences(advPrefs);
                    setAdvMsg("Saved.");
                  } catch (e: any) {
                    setAdvMsg(e?.error || e?.message || "Failed to save");
                  } finally {
                    setSavingAdv(false);
                  }
                }}
                disabled={savingAdv}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded disabled:opacity-50"
              >
                {savingAdv ? "Saving…" : "Save Advisory Settings"}
              </button>
              {advMsg && (
                <span className="text-sm text-gray-600">{advMsg}</span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Loading advisory preferences…</p>
        )}
      </section>
    </div>
  );
}
