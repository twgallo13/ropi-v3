/**
 * TALLY-SETTINGS-UX Phase 3 / A.3 PR5 — Permissions Matrix (read-only).
 *
 * Mounted at /admin/governance/permissions.
 *
 * Displays the 10 CANONICAL_ROLES surfaced via PR3 endpoint
 * GET /api/v1/admin/role-permissions.
 *
 * READ-ONLY: no create / edit / delete affordances. The matrix is a
 * source-of-truth view of role surfacing in the codebase.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RoleGate, ErrorBanner } from "../components/admin";
import { fetchRolePermissions, CanonicalRoleEntry } from "../lib/api";

function formatError(err: any): string {
  if (!err) return "Unknown error.";
  if (typeof err === "string") return err;
  return err.error || err.message || JSON.stringify(err);
}

function sourceLabel(source: CanonicalRoleEntry["source"]): string {
  return source === "launch_editor" ? "LAUNCH_EDITOR_ROLES" : "Direct requireRole";
}

export default function PermissionsPage() {
  const [roles, setRoles] = useState<CanonicalRoleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const data = await fetchRolePermissions();
        if (!cancelled) setRoles(data.roles ?? []);
      } catch (e: any) {
        if (!cancelled) setError(formatError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <RoleGate>
      <div className="max-w-5xl mx-auto p-6">
        <Link to="/admin/governance" className="text-sm text-blue-600 hover:underline">
          ← Access &amp; Governance
        </Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">Permissions Matrix</h1>
        <p className="text-gray-600 mb-6">
          Canonical role inventory — read-only view of roles surfaced in the codebase
          (direct <code>requireRole(...)</code> calls and <code>LAUNCH_EDITOR_ROLES</code> indirection).
        </p>

        <ErrorBanner message={error} onDismiss={() => setError(null)} />

        {loading ? (
          <p className="text-sm text-gray-500 italic">Loading roles…</p>
        ) : (
          <div className="border rounded overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Role</th>
                  <th className="px-4 py-2 text-left font-semibold">Source</th>
                  <th className="px-4 py-2 text-left font-semibold">Representative Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {roles.length === 0 ? (
                  <tr>
                    <td className="px-4 py-3 text-center text-gray-500 italic" colSpan={3}>
                      No roles returned.
                    </td>
                  </tr>
                ) : (
                  roles.map((r) => (
                    <tr key={r.role}>
                      <td className="px-4 py-2"><code className="text-xs">{r.role}</code></td>
                      <td className="px-4 py-2">
                        {r.source === "launch_editor" ? (
                          <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                            {sourceLabel(r.source)}
                          </span>
                        ) : (
                          <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                            {sourceLabel(r.source)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2"><code className="text-xs">{r.representative_ref}</code></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-6 text-xs text-gray-500 italic max-w-3xl">
          Note: <code>content_manager</code> and <code>launch_lead</code> are surfaced via{" "}
          <code>LAUNCH_EDITOR_ROLES</code> indirection and are not currently assignable from the
          Admin Users UI. This will be addressed in A.4 (per Ruling C.3).
        </p>
      </div>
    </RoleGate>
  );
}
