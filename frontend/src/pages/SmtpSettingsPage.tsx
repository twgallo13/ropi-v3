/**
 * Phase 3.5 PR B — SMTP Settings page.
 *
 * Mounted at /admin/infrastructure/smtp.
 *
 * Body extracted verbatim from AdminSettingsPage::SmtpTab and wrapped in the
 * standard pillar-page shell (mirrors PricingGuardrailsPage). Reads/writes via
 * existing fetchAdminSettings + updateAdminSetting + testSmtp endpoints in
 * lib/api.ts. No new BE endpoints. Field + inputClass helpers duplicated
 * inline per Phase 3.5 PR B Lisa-default (cleanup tally is a future PR).
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RoleGate } from "../components/admin";
import {
  fetchAdminSettings,
  updateAdminSetting,
  testSmtp,
  type AdminSetting,
} from "../lib/api";

const inputClass =
  "w-full border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-900";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      {children}
    </div>
  );
}

export default function SmtpSettingsPage() {
  const [settings, setSettings] = useState<AdminSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    try {
      setSettings(await fetchAdminSettings());
    } catch (e: any) {
      setErr(e?.error || "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function get(key: string, fallback: any = "") {
    const s = settings.find((x) => x.key === key);
    return s?.value ?? fallback;
  }

  const [provider, setProvider] = useState("sendgrid");
  const [host, setHost] = useState("");
  const [port, setPort] = useState<number>(587);
  const [username, setUsername] = useState("");
  const [fromAddr, setFromAddr] = useState("");
  const [fromName, setFromName] = useState("ROPI Operations");
  const [throttle, setThrottle] = useState<number>(24);

  useEffect(() => {
    if (!settings.length) return;
    setProvider(get("email_provider", "sendgrid"));
    setHost(get("smtp_host", ""));
    setPort(Number(get("smtp_port", 587)) || 587);
    setUsername(get("smtp_username", ""));
    setFromAddr(get("smtp_from_address", ""));
    setFromName(get("smtp_from_name", "ROPI Operations"));
    setThrottle(Number(get("smtp_throttle_hours", 24)) || 24);
  }, [settings.length]);

  async function save() {
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      await updateAdminSetting("email_provider", provider, {
        type: "string",
        category: "smtp",
        label: "Email Provider (sendgrid | custom_smtp)",
      });
      await updateAdminSetting("smtp_host", host, {
        type: "string",
        category: "smtp",
        label: "Custom SMTP Host",
      });
      await updateAdminSetting("smtp_port", Number(port), {
        type: "number",
        category: "smtp",
        label: "Custom SMTP Port",
      });
      await updateAdminSetting("smtp_username", username, {
        type: "string",
        category: "smtp",
        label: "Custom SMTP Username",
      });
      await updateAdminSetting("smtp_from_address", fromAddr, {
        type: "string",
        category: "smtp",
        label: "From Email Address",
      });
      await updateAdminSetting("smtp_from_name", fromName, {
        type: "string",
        category: "smtp",
        label: "From Name",
      });
      await updateAdminSetting("smtp_throttle_hours", Number(throttle), {
        type: "number",
        category: "smtp",
        label: "SMTP Throttle Hours",
      });
      setMsg("SMTP settings saved.");
      setTimeout(() => setMsg(""), 3000);
      load();
    } catch (e: any) {
      setErr(e?.error || e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setMsg("Sending test email…");
    setErr("");
    try {
      const r = await testSmtp();
      if (r.ok) setMsg(r.message || "Test email sent.");
      else setErr(r.error || "Test failed");
    } catch (e: any) {
      setErr(e?.error || e?.message || "Test failed");
    }
  }

  return (
    <RoleGate>
      <div className="max-w-4xl mx-auto p-6">
        <Link to="/admin/infrastructure" className="text-sm text-blue-600 hover:underline">
          ← System &amp; Infrastructure
        </Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">SMTP Settings</h1>
        <p className="text-gray-600 mb-6">
          Email provider, transport credentials, and throttle configuration.
        </p>

        {loading ? (
          <p className="text-sm text-gray-500 italic">Loading settings…</p>
        ) : (
          <div className="space-y-5 max-w-2xl">
            {err && <p className="text-sm text-red-600">{err}</p>}
            {msg && <p className="text-sm text-green-600">{msg}</p>}

            <Field label="Email Provider">
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={provider === "sendgrid"}
                    onChange={() => setProvider("sendgrid")}
                  />
                  SendGrid
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={provider === "custom_smtp"}
                    onChange={() => setProvider("custom_smtp")}
                  />
                  Custom SMTP
                </label>
              </div>
            </Field>

            {provider === "sendgrid" ? (
              <div className="rounded border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-900 text-sm">
                <p className="font-medium mb-1">SendGrid API Key</p>
                <p className="text-xs text-gray-500">
                  The API key is stored as a Cloud Run environment variable
                  (<code className="font-mono">SENDGRID_API_KEY</code>). Update it via
                  the GCP Console.
                </p>
              </div>
            ) : (
              <div className="rounded border border-gray-200 dark:border-gray-700 p-3 space-y-3">
                <div className="font-medium text-sm">Custom SMTP</div>
                <Field label="SMTP Host">
                  <input
                    className={inputClass}
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="smtp.example.com"
                  />
                </Field>
                <Field label="SMTP Port">
                  <input
                    type="number"
                    className={inputClass}
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value) || 587)}
                  />
                </Field>
                <Field label="SMTP Username">
                  <input
                    className={inputClass}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="user@example.com"
                  />
                </Field>
                <div className="text-xs text-gray-500">
                  SMTP password is stored as a Cloud Run environment variable
                  (<code className="font-mono">SMTP_PASSWORD</code>). Update it via the
                  GCP Console.
                </div>
              </div>
            )}

            <div className="rounded border border-gray-200 dark:border-gray-700 p-3 space-y-3">
              <div className="font-medium text-sm">Shared</div>
              <Field label="From Address">
                <input
                  className={inputClass}
                  value={fromAddr}
                  onChange={(e) => setFromAddr(e.target.value)}
                  placeholder="noreply@shiekhshoes.com"
                />
              </Field>
              <Field label="From Name">
                <input
                  className={inputClass}
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                />
              </Field>
              <Field label="SMTP Throttle Hours">
                <input
                  type="number"
                  className={inputClass}
                  value={throttle}
                  onChange={(e) => setThrottle(Number(e.target.value) || 24)}
                />
              </Field>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={runTest}
                className="text-sm border border-gray-200 dark:border-gray-700 rounded px-3 py-1.5"
              >
                Test Email
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="bg-blue-600 text-white text-sm rounded px-3 py-1.5 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save SMTP Settings"}
              </button>
            </div>
          </div>
        )}
      </div>
    </RoleGate>
  );
}
