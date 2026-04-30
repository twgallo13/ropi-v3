import { useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  fetchAdminUsers,
  createAdminUser,
  updateAdminUser,
  disableAdminUser,
  fetchAdminSettings,
  updateAdminSetting,
  testSmtp,
  testAI,
  fetchSiteRegistry,
  fetchRoleOptions,
  type AdminUser,
  type AdminSetting,
  type SiteRegistryEntry,
  type RoleOption,
} from "../lib/api";
import { ConfirmModal } from "../components/admin";

type TabKey = "users" | "variables" | "smtp" | "ai";

const TABS: { key: TabKey; label: string }[] = [
  { key: "users", label: "Users" },
  { key: "variables", label: "System Variables" },
  { key: "smtp", label: "SMTP" },
  { key: "ai", label: "AI Provider" },
];

// A.4 Tier 1 (§1.3): role list is fetched from BE
// (GET /api/v1/admin/users/role-options) and threaded down to the modals.
// Hard-coded ROLE_OPTIONS removed to eliminate FE/BE drift.

export default function AdminSettingsPage() {
  const { role, loading: authLoading } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as TabKey) || "users";

  if (authLoading) return <div className="p-6 text-gray-500">Loading…</div>;
  if (role !== "admin" && role !== "owner") return <Navigate to="/dashboard" replace />;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-1">Admin Control Center</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
        Manage users, system variables, email transport, and AI provider.
      </p>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 mb-5 gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set("tab", t.key);
              setParams(next, { replace: true });
            }}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${
              tab === t.key
                ? "border-blue-600 text-blue-600 font-medium"
                : "border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "users" && <UsersTab />}
      {tab === "variables" && <VariablesTab />}
      {tab === "smtp" && <SmtpTab />}
      {tab === "ai" && <AIProviderTab />}
    </div>
  );
}

// ─────────────────────────────────────
//  USERS TAB
// ─────────────────────────────────────
function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  // TALLY-SETTINGS-UX Phase 3 / B.0 — ConfirmModal migration (was confirm())
  const [disableTarget, setDisableTarget] = useState<AdminUser | null>(null);
  const [disableError, setDisableError] = useState<string | null>(null);
  // A.4 Tier 1 (§1.3): role options sourced from BE
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [roleOptionsLoading, setRoleOptionsLoading] = useState(true);
  const [roleOptionsError, setRoleOptionsError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setUsers(await fetchAdminUsers());
    } catch (e: any) {
      setError(e?.error || e?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  async function loadRoleOptions() {
    setRoleOptionsLoading(true);
    setRoleOptionsError(null);
    try {
      setRoleOptions(await fetchRoleOptions());
    } catch (e: any) {
      setRoleOptionsError(e?.error || e?.message || "Failed to load roles");
    } finally {
      setRoleOptionsLoading(false);
    }
  }

  useEffect(() => {
    load();
    loadRoleOptions();
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {loading ? "Loading…" : `${users.length} user${users.length === 1 ? "" : "s"}`}
        </p>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-blue-600 text-white text-sm rounded-lg px-3 py-1.5 hover:bg-blue-700"
        >
          + Add User
        </button>
      </div>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-left">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {users.map((u) => (
              <tr key={u.uid} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className="px-3 py-2">{u.display_name || "—"}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{u.email}</td>
                <td className="px-3 py-2">
                  <span className="capitalize text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800">
                    {u.role || "—"}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {u.disabled ? (
                    <span className="text-xs text-red-600">Disabled</span>
                  ) : (
                    <span className="text-xs text-green-600">Active</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => setEditing(u)}
                    className="text-xs text-blue-600 hover:underline mr-3"
                  >
                    Edit
                  </button>
                  {!u.disabled && (
                    <button
                      onClick={() => setDisableTarget(u)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Disable
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <AddUserModal
          roleOptions={roleOptions}
          roleOptionsLoading={roleOptionsLoading}
          roleOptionsError={roleOptionsError}
          onRetryRoleOptions={loadRoleOptions}
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
      {editing && (
        <EditUserModal
          user={editing}
          roleOptions={roleOptions}
          roleOptionsLoading={roleOptionsLoading}
          roleOptionsError={roleOptionsError}
          onRetryRoleOptions={loadRoleOptions}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      <ConfirmModal
        open={disableTarget !== null}
        title="Disable user?"
        body={`Disable ${disableTarget?.email ?? ""}?`}
        confirmLabel="Disable"
        confirmVariant="primary"
        onConfirm={async () => {
          try {
            await disableAdminUser(disableTarget!.uid);
            await load();
            setDisableTarget(null);
            setDisableError(null);
          } catch (e: any) {
            setDisableError(e?.error ?? e?.message ?? String(e) ?? "Disable failed");
          }
        }}
        onCancel={() => {
          setDisableTarget(null);
          setDisableError(null);
        }}
        errorSlot={disableError}
      />
    </div>
  );
}

function AddUserModal({
  roleOptions,
  roleOptionsLoading,
  roleOptionsError,
  onRetryRoleOptions,
  onClose,
  onCreated,
}: {
  roleOptions: RoleOption[];
  roleOptionsLoading: boolean;
  roleOptionsError: string | null;
  onRetryRoleOptions: () => void;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("buyer");
  const [departments, setDepartments] = useState("");
  const [siteScope, setSiteScope] = useState<string[]>([]);
  const [siteOptions, setSiteOptions] = useState<SiteRegistryEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchSiteRegistry(true).then(setSiteOptions).catch(() => {});
  }, []);
  const [tempPw, setTempPw] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      const r = await createAdminUser({
        email: email.trim(),
        display_name: displayName.trim(),
        role,
        departments: departments
          ? departments.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
        site_scope: siteScope.length ? siteScope : undefined,
      });
      setTempPw(r.temp_password);
    } catch (e: any) {
      setError(e?.error || e?.message || "Failed to create user");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Add User" onClose={onClose}>
      {tempPw ? (
        <div className="space-y-3">
          <p className="text-sm text-green-700 dark:text-green-400">
            User created successfully.
          </p>
          <div className="rounded border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 p-3 text-sm">
            <p className="font-medium text-yellow-900 dark:text-yellow-200 mb-1">
              Temporary Password (shown once):
            </p>
            <code className="block text-xs font-mono bg-white dark:bg-gray-900 px-2 py-1 rounded border">
              {tempPw}
            </code>
            <p className="text-xs text-yellow-800 dark:text-yellow-300 mt-2">
              Copy this and share securely with the user. They should log in and
              change it.
            </p>
          </div>
          <div className="text-right">
            <button
              onClick={onCreated}
              className="bg-blue-600 text-white text-sm rounded px-3 py-1.5"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Display Name">
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Role">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={inputClass}
              disabled={roleOptionsLoading || !!roleOptionsError}
            >
              {roleOptionsLoading ? (
                <option>Loading roles…</option>
              ) : roleOptionsError ? (
                <option>Failed to load roles</option>
              ) : (
                roleOptions.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))
              )}
            </select>
            {roleOptionsError && (
              <div className="mt-1 text-xs text-red-600">
                {roleOptionsError}{" "}
                <button
                  type="button"
                  onClick={onRetryRoleOptions}
                  className="underline"
                >
                  Retry
                </button>
              </div>
            )}
          </Field>
          <Field label="Departments (comma separated)">
            <input
              value={departments}
              onChange={(e) => setDepartments(e.target.value)}
              placeholder="footwear, accessories"
              className={inputClass}
            />
          </Field>
          <Field label="Site Scope">
            <div className="flex gap-3 text-sm">
              {siteOptions.map((s) => (
                <label key={s.site_key} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={siteScope.includes(s.site_key)}
                    onChange={(e) =>
                      setSiteScope((prev) =>
                        e.target.checked
                          ? [...prev, s.site_key]
                          : prev.filter((x) => x !== s.site_key)
                      )
                    }
                  />
                  {s.display_name}
                </label>
              ))}
            </div>
          </Field>
          <div className="flex justify-end gap-2 pt-3">
            <button
              onClick={onClose}
              className="text-sm border border-gray-200 dark:border-gray-700 rounded px-3 py-1.5"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={
                submitting ||
                !email ||
                !displayName ||
                roleOptionsLoading ||
                !!roleOptionsError
              }
              className="bg-blue-600 text-white text-sm rounded px-3 py-1.5 disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create User"}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function EditUserModal({
  user,
  roleOptions,
  roleOptionsLoading,
  roleOptionsError,
  onRetryRoleOptions,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  roleOptions: RoleOption[];
  roleOptionsLoading: boolean;
  roleOptionsError: string | null;
  onRetryRoleOptions: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  // A.4 Tier 2.1 — per Q6 live shape (PR #43), departments + site_scope
  // can be undefined / null / array. Normalize to array for state init.
  const initialDepartments = Array.isArray(user.departments)
    ? user.departments.join(", ")
    : "";
  const initialSiteScope = Array.isArray(user.site_scope) ? user.site_scope : [];

  const [displayName, setDisplayName] = useState(user.display_name || "");
  const [role, setRole] = useState(user.role || "buyer");
  const [departments, setDepartments] = useState(initialDepartments);
  const [siteScope, setSiteScope] = useState<string[]>(initialSiteScope);
  const [siteOptions, setSiteOptions] = useState<SiteRegistryEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchSiteRegistry(true).then(setSiteOptions).catch(() => {});
  }, []);

  // A.4 Tier 2.1 — split-trim-filter on submit; matches AddUserModal exactly.
  function parseDepartments(raw: string): string[] {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Helper: detect array-vs-array equality regardless of order? Spec says
  // send if changed. We use JSON-stringify of sorted copy for stable diff.
  function arrayEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sa = [...a].sort();
    const sb = [...b].sort();
    return sa.every((v, i) => v === sb[i]);
  }

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const body: Partial<{
        display_name: string;
        role: string;
        departments: string[] | null;
        site_scope: string[] | null;
      }> = {};

      const trimmedName = displayName.trim();
      if (trimmedName !== (user.display_name || "")) {
        body.display_name = trimmedName;
      }
      if (role !== (user.role || "")) {
        body.role = role;
      }

      // A.4 Tier 2.1 — departments diff. Send array if non-empty; send null
      // to explicitly clear; omit if unchanged.
      const newDepartments = parseDepartments(departments);
      const oldDepartments = Array.isArray(user.departments) ? user.departments : [];
      if (!arrayEqual(newDepartments, oldDepartments)) {
        body.departments = newDepartments.length > 0 ? newDepartments : null;
      }

      // A.4 Tier 2.1 — site_scope diff. Same rules.
      const oldSiteScope = Array.isArray(user.site_scope) ? user.site_scope : [];
      if (!arrayEqual(siteScope, oldSiteScope)) {
        body.site_scope = siteScope.length > 0 ? siteScope : null;
      }

      await updateAdminUser(user.uid, body);
      onSaved();
    } catch (e: any) {
      setError(e?.error || e?.message || "Update failed");
      setSaving(false);
    }
  }

  return (
    <ModalShell title={`Edit ${user.email}`} onClose={onClose}>
      <div className="space-y-3">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Field label="Display Name">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Role">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className={inputClass}
            disabled={roleOptionsLoading || !!roleOptionsError}
          >
            {roleOptionsLoading ? (
              <option>Loading roles…</option>
            ) : roleOptionsError ? (
              <option>Failed to load roles</option>
            ) : (
              roleOptions.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))
            )}
          </select>
          {roleOptionsError && (
            <div className="mt-1 text-xs text-red-600">
              {roleOptionsError}{" "}
              <button
                type="button"
                onClick={onRetryRoleOptions}
                className="underline"
              >
                Retry
              </button>
            </div>
          )}
        </Field>
        <Field label="Departments (comma separated)">
          <input
            value={departments}
            onChange={(e) => setDepartments(e.target.value)}
            placeholder="footwear, accessories"
            className={inputClass}
          />
        </Field>
        <Field label="Site Scope">
          <div className="flex gap-3 text-sm">
            {siteOptions.map((s) => (
              <label key={s.site_key} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={siteScope.includes(s.site_key)}
                  onChange={(e) =>
                    setSiteScope((prev) =>
                      e.target.checked
                        ? [...prev, s.site_key]
                        : prev.filter((x) => x !== s.site_key)
                    )
                  }
                />
                {s.display_name}
              </label>
            ))}
          </div>
        </Field>
        <div className="flex justify-end gap-2 pt-3">
          <button
            onClick={onClose}
            className="text-sm border border-gray-200 dark:border-gray-700 rounded px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || roleOptionsLoading || !!roleOptionsError}
            className="bg-blue-600 text-white text-sm rounded px-3 py-1.5 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─────────────────────────────────────
//  SYSTEM VARIABLES TAB
// ─────────────────────────────────────
function VariablesTab() {
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
      setSettings(s);
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
      setSavedMsg(`Saved ${Object.keys(edits).length} change${Object.keys(edits).length === 1 ? "" : "s"}.`);
      setTimeout(() => setSavedMsg(""), 3000);
      load();
    } catch (e: any) {
      setError(e?.error || e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {savedMsg && (
        <p className="text-sm text-green-600 mb-3">{savedMsg}</p>
      )}

      {settings.length === 0 && (
        <p className="text-sm text-gray-500">
          No admin_settings documents found. Run the seed script first.
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
          {saving ? "Saving…" : `Save All Changes${dirty ? ` (${Object.keys(edits).length})` : ""}`}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────
//  SMTP TAB
// ─────────────────────────────────────
function SmtpTab() {
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

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
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
  );
}

// ─────────────────────────────────────
//  AI PROVIDER TAB
// ─────────────────────────────────────
function AIProviderTab() {
  const [settings, setSettings] = useState<AdminSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [aiProvider, setAiProvider] = useState("anthropic");
  const [aiModel, setAiModel] = useState("");
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await fetchAdminSettings();
        setSettings(s);
      } catch {}
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const modelSetting = settings.find((s) => s.key === "active_ai_model");
    const providerSetting = settings.find(
      (s) => s.key === "active_ai_provider"
    );
    if (modelSetting && modelSetting.value != null)
      setAiModel(String(modelSetting.value));
    if (providerSetting && providerSetting.value != null)
      setAiProvider(String(providerSetting.value));
  }, [settings]);

  async function saveSettings() {
    setSaving(true);
    setTestResult(null);
    try {
      await updateAdminSetting("active_ai_provider", aiProvider, {
        type: "string",
        category: "ai",
        label: "Active AI Provider",
      });
      await updateAdminSetting("active_ai_model", aiModel, {
        type: "string",
        category: "ai",
        label: "Active AI Model String",
      });
      setTestResult({ ok: true, message: "✅ Saved" });
    } catch (e: any) {
      setTestResult({ ok: false, message: e?.error || "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testAI();
      setTestResult({
        ok: r.ok,
        message: r.ok
          ? `✅ Connected — ${r.model}`
          : `❌ ${r.error || "Test failed"}`,
      });
    } catch (e: any) {
      setTestResult({ ok: false, message: e?.error || "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <label className="text-xs text-gray-600 dark:text-gray-400">
          Active Provider
        </label>
        <select
          value={aiProvider}
          onChange={(e) => setAiProvider(e.target.value)}
          className="mt-1 w-full border border-gray-200 dark:border-gray-700 rounded-lg p-2 text-sm bg-white dark:bg-gray-900"
        >
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI (stub)</option>
          <option value="gemini">Gemini (stub)</option>
        </select>
      </div>

      <div>
        <label className="text-xs text-gray-600 dark:text-gray-400">
          Model String
          <span className="ml-1 text-gray-400">
            — update when Anthropic releases new models
          </span>
        </label>
        <input
          type="text"
          value={aiModel}
          onChange={(e) => setAiModel(e.target.value)}
          placeholder="e.g. claude-sonnet-4-5"
          className="mt-1 w-full border border-gray-200 dark:border-gray-700 rounded-lg p-2 text-sm font-mono bg-white dark:bg-gray-900"
        />
        <p className="text-xs text-gray-400 mt-1">
          Current Anthropic models: claude-sonnet-4-5, claude-opus-4-5,
          claude-haiku-4-5
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={saveSettings}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save AI Settings"}
        </button>

        <button
          onClick={runTest}
          disabled={testing}
          className="px-4 py-2 border border-gray-200 dark:border-gray-700 text-sm rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          {testing ? "Testing…" : "Test Connection"}
        </button>

        {testResult && (
          <span
            className={`text-sm ${
              testResult.ok ? "text-green-600" : "text-red-600"
            }`}
          >
            {testResult.message}
          </span>
        )}
      </div>

      <p className="text-xs text-gray-500 pt-2 border-t border-gray-100 dark:border-gray-800">
        The API key is stored as a Cloud Run environment variable
        (<code className="font-mono">ANTHROPIC_API_KEY</code>). Update it via the
        GCP Console.
      </p>
    </div>
  );
}

// ─────────────────────────────────────
//  Shared bits
// ─────────────────────────────────────
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

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-white"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
