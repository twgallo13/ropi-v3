import { useEffect, useState } from "react";
import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchNotificationPreferences();
        setPrefs(res.preferences);
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
    </div>
  );
}
