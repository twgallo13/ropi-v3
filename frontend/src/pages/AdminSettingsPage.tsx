import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  fetchAdminUsers,
  createAdminUser,
  updateAdminUser,
  disableAdminUser,
  reenableAdminUser,
  resetAdminUserPassword,
  fetchSiteRegistry,
  fetchRoleOptions,
  type AdminUser,
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
  // A.4 PR 5 (Tier 2.2) — re-enable button state
  const [reenablingUid, setReenablingUid] = useState<string | null>(null);
  const [reenableError, setReenableError] = useState<string | null>(null);
  // A.4 PR 6 (Tier 2.3) — password-reset state. revealedPassword is held in
  // memory only for the lifetime of the reveal modal; never persisted.
  const [resetConfirmTarget, setResetConfirmTarget] =
    useState<AdminUser | null>(null);
  const [resettingUid, setResettingUid] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [revealedPassword, setRevealedPassword] = useState<{
    uid: string;
    email: string | null;
    temp_password: string;
  } | null>(null);
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
      {reenableError && (
        <p className="text-red-600 text-sm mb-3">{reenableError}</p>
      )}
      {resetError && (
        <p className="text-red-600 text-sm mb-3">{resetError}</p>
      )}

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
                  <button
                    onClick={() => {
                      setResetError(null);
                      setResetConfirmTarget(u);
                    }}
                    className="text-xs text-amber-700 hover:underline mr-3"
                  >
                    Reset Password
                  </button>
                  {u.disabled ? (
                    <button
                      disabled={reenablingUid === u.uid}
                      onClick={async () => {
                        setReenableError(null);
                        setReenablingUid(u.uid);
                        try {
                          await reenableAdminUser(u.uid);
                          await load();
                        } catch (e: any) {
                          setReenableError(
                            e?.error || e?.message || "Re-enable failed"
                          );
                        } finally {
                          setReenablingUid(null);
                        }
                      }}
                      className="text-xs text-green-700 hover:underline disabled:opacity-50"
                    >
                      {reenablingUid === u.uid ? "Re-enabling…" : "Re-enable"}
                    </button>
                  ) : (
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
      {/* A.4 PR 6 (Tier 2.3) — password-reset confirm + one-shot reveal */}
      <ConfirmModal
        open={resetConfirmTarget !== null}
        title="Reset password?"
        body={`This will invalidate the current password for ${resetConfirmTarget?.email ?? ""} and generate a new temporary password to share with the user. Continue?`}
        confirmLabel={
          resettingUid === resetConfirmTarget?.uid ? "Resetting…" : "Reset Password"
        }
        confirmVariant="primary"
        onConfirm={async () => {
          if (!resetConfirmTarget) return;
          setResetError(null);
          setResettingUid(resetConfirmTarget.uid);
          try {
            const r = await resetAdminUserPassword(resetConfirmTarget.uid);
            setRevealedPassword({
              uid: resetConfirmTarget.uid,
              email: resetConfirmTarget.email,
              temp_password: r.temp_password,
            });
            setResetConfirmTarget(null);
          } catch (e: any) {
            setResetError(
              e?.error ?? e?.message ?? String(e) ?? "Reset failed"
            );
            setResetConfirmTarget(null);
          } finally {
            setResettingUid(null);
          }
        }}
        onCancel={() => {
          setResetConfirmTarget(null);
        }}
      />
      {revealedPassword && (
        <ModalShell
          title={`Temporary Password — ${revealedPassword.email ?? ""}`}
          onClose={() => setRevealedPassword(null)}
        >
          <div className="space-y-3">
            <div className="rounded border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 p-3 text-sm">
              <p className="font-medium text-yellow-900 dark:text-yellow-200 mb-1">
                Temporary Password (shown once):
              </p>
              <code className="block text-xs font-mono bg-white dark:bg-gray-900 px-2 py-1 rounded border break-all">
                {revealedPassword.temp_password}
              </code>
              <p className="text-xs text-yellow-800 dark:text-yellow-300 mt-2">
                Copy this and share securely with the user. It will not be
                shown again. The user should sign in and change it.
              </p>
            </div>
            <div className="text-right">
              <button
                onClick={() => setRevealedPassword(null)}
                className="bg-blue-600 text-white text-sm rounded px-3 py-1.5"
              >
                Done
              </button>
            </div>
          </div>
        </ModalShell>
      )}
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
  // Phase 3.5 PR B — body deprecated. Canonical surface is
  // SystemVariablesPage at /admin/infrastructure/system-variables (Infrastructure pillar).
  // Full handler removal is a follow-up tally.
  return (
    <div className="p-6 max-w-2xl">
      <div className="border border-amber-300 bg-amber-50 rounded-md p-4">
        <h3 className="font-semibold mb-2">System Variables have moved</h3>
        <p className="mb-3">
          Application-wide settings are now at{" "}
          <a
            href="/admin/infrastructure/system-variables"
            className="text-blue-700 underline"
          >
            /admin/infrastructure/system-variables
          </a>{" "}
          under Infrastructure. SMTP, Pricing, and AI settings have their own
          dedicated pages.
        </p>
        <p className="text-sm text-gray-600">
          This tab will be removed in a future cleanup. Update your bookmarks.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────
//  SMTP TAB
// ─────────────────────────────────────
function SmtpTab() {
  // Phase 3.5 PR B — body deprecated. Canonical surface is
  // SmtpSettingsPage at /admin/infrastructure/smtp (Infrastructure pillar).
  // Full handler removal is a follow-up tally.
  return (
    <div className="p-6 max-w-2xl">
      <div className="border border-amber-300 bg-amber-50 rounded-md p-4">
        <h3 className="font-semibold mb-2">SMTP Settings have moved</h3>
        <p className="mb-3">
          SMTP configuration is now at{" "}
          <a
            href="/admin/infrastructure/smtp"
            className="text-blue-700 underline"
          >
            /admin/infrastructure/smtp
          </a>{" "}
          under Infrastructure.
        </p>
        <p className="text-sm text-gray-600">
          This tab will be removed in a future cleanup. Update your bookmarks.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────
//  AI PROVIDER TAB
// ─────────────────────────────────────
function AIProviderTab() {
  // Phase 3.5 PR B — body deprecated. Canonical surface is
  // AIProvidersListPage at /admin/ai-automation/providers (AI & Automation pillar).
  // Full handler removal is a follow-up tally.
  return (
    <div className="p-6 max-w-2xl">
      <div className="border border-amber-300 bg-amber-50 rounded-md p-4">
        <h3 className="font-semibold mb-2">AI Provider has moved</h3>
        <p className="mb-3">
          AI provider configuration is now at{" "}
          <a
            href="/admin/ai-automation/providers"
            className="text-blue-700 underline"
          >
            /admin/ai-automation/providers
          </a>{" "}
          under AI &amp; Automation.
        </p>
        <p className="text-sm text-gray-600">
          This tab will be removed in a future cleanup. Update your bookmarks.
        </p>
      </div>
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
