import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

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
// PHASE-3.7 sub-PR 1.9 — UsersTab deprecated. Canonical surface is
// UserManagementPage at /admin/governance/users (Access & Governance pillar).
// Full handler removal is a follow-up tally.
function UsersTab() {
  return (
    <div className="p-6 max-w-2xl">
      <div className="border border-amber-300 bg-amber-50 rounded-md p-4">
        <h3 className="font-semibold mb-2">User Management has moved</h3>
        <p className="mb-3">
          User management is now at{" "}
          <Link
            to="/admin/governance/users"
            className="text-blue-700 underline"
          >
            /admin/governance/users
          </Link>{" "}
          under Access &amp; Governance.
        </p>
        <p className="text-sm text-gray-600">
          This tab will be removed in a future cleanup. Update your bookmarks.
        </p>
      </div>
    </div>
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
