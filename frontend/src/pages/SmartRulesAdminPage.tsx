import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  fetchSmartRules,
  deactivateSmartRule,
  SmartRule,
} from "../lib/api";
import { ConfirmModal } from "../components/admin";

export default function SmartRulesAdminPage() {
  const { role, loading: authLoading } = useAuth();
  const [rules, setRules] = useState<SmartRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();
  // TALLY-SETTINGS-UX Phase 3 / B.0 — ConfirmModal migration (was confirm() + alert())
  const [deactivateTargetId, setDeactivateTargetId] = useState<string | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setRules(await fetchSmartRules());
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading) return;
    if (role !== "admin" && role !== "owner") return;
    load();
  }, [authLoading, role]);

  async function handleDeactivate(rule_id: string) {
    setDeactivateTargetId(rule_id);
  }

  async function runDeactivate(rule_id: string) {
    await deactivateSmartRule(rule_id);
    await load();
  }

  function ruleTypeLabel(r: SmartRule): string {
    if (r.source_field || r.action) return "Legacy";
    return r.rule_type || "Type 1";
  }

  if (authLoading) return <div className="p-6 text-gray-500">Loading…</div>;
  if (role !== "admin" && role !== "owner") return <Navigate to="/dashboard" replace />;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Smart Rules</h1>
        <Link
          to="/admin/smart-rules/new"
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm"
        >
          + New Rule
        </Link>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-3 text-sm">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : (
        <table className="w-full text-sm bg-white border rounded">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-2 w-14">Pri</th>
              <th className="p-2">Rule Name</th>
              <th className="p-2 w-24">Type</th>
              <th className="p-2 w-24">Status</th>
              <th className="p-2 w-20">Overwrite</th>
              <th className="p-2 w-44">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr
                key={r.rule_id}
                className="border-t hover:bg-gray-50"
              >
                <td className="p-2 font-mono">{r.priority}</td>
                <td className="p-2">
                  <div className="font-medium">{r.rule_name}</div>
                  <div className="text-xs text-gray-500 font-mono">
                    {r.rule_id}
                  </div>
                </td>
                <td className="p-2">
                  <span
                    className={
                      ruleTypeLabel(r) === "Legacy"
                        ? "text-amber-700 bg-amber-50 border border-amber-200 text-xs px-2 py-0.5 rounded"
                        : "text-blue-700 bg-blue-50 border border-blue-200 text-xs px-2 py-0.5 rounded"
                    }
                  >
                    {ruleTypeLabel(r)}
                  </span>
                </td>
                <td className="p-2">
                  {r.is_active ? (
                    <span className="text-green-700 bg-green-50 border border-green-200 text-xs px-2 py-0.5 rounded">
                      Active
                    </span>
                  ) : (
                    <span className="text-gray-500 bg-gray-100 border text-xs px-2 py-0.5 rounded">
                      Inactive
                    </span>
                  )}
                </td>
                <td className="p-2">
                  {r.always_overwrite ? (
                    <span className="text-xs">⚠ Yes</span>
                  ) : (
                    <span className="text-xs text-gray-500">No</span>
                  )}
                </td>
                <td className="p-2 space-x-2">
                  <button
                    onClick={() => nav(`/admin/smart-rules/${r.rule_id}`)}
                    className="text-blue-600 hover:underline text-xs"
                  >
                    Edit
                  </button>
                  {r.is_active && (
                    <button
                      onClick={() => handleDeactivate(r.rule_id)}
                      className="text-red-600 hover:underline text-xs"
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-gray-400">
                  No rules.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <ConfirmModal
        open={deactivateTargetId !== null}
        title={`Deactivate "${deactivateTargetId ?? ""}"?`}
        body="This will deactivate the smart rule. It can be reactivated later."
        confirmLabel="Deactivate"
        confirmVariant="primary"
        onConfirm={async () => {
          try {
            await runDeactivate(deactivateTargetId!);
            setDeactivateTargetId(null);
            setDeactivateError(null);
          } catch (e: any) {
            setDeactivateError("Failed: " + (e?.error || e?.message || String(e)));
          }
        }}
        onCancel={() => {
          setDeactivateTargetId(null);
          setDeactivateError(null);
        }}
        errorSlot={deactivateError}
      />
    </div>
  );
}
