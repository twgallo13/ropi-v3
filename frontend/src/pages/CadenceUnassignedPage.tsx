import { useEffect, useState } from "react";
import {
  fetchCadenceUnassigned,
  fetchCadenceRules,
  assignCadenceRule,
  excludeFromCadence,
  type CadenceUnassignedItem,
  type CadenceRule,
} from "../lib/api";

function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  const v = n <= 1 ? n * 100 : n;
  return `${v.toFixed(1)}%`;
}

export default function CadenceUnassignedPage() {
  const [items, setItems] = useState<CadenceUnassignedItem[]>([]);
  const [rules, setRules] = useState<CadenceRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [assignRule, setAssignRule] = useState("");
  const [excludeFor, setExcludeFor] = useState<string | null>(null);
  const [excludeReason, setExcludeReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [u, r] = await Promise.all([fetchCadenceUnassigned(), fetchCadenceRules()]);
      setItems(u.items);
      setRules(r.rules.filter((x) => x.is_active));
    } catch (e: any) {
      setError(e?.error || e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function doAssign(mpn: string) {
    if (!assignRule) return;
    setBusy(true);
    try {
      await assignCadenceRule(mpn, assignRule);
      setAssignFor(null);
      setAssignRule("");
      await load();
    } catch (e: any) {
      setError(e?.error || e?.message || "Assign failed");
    } finally {
      setBusy(false);
    }
  }

  async function doExclude(mpn: string) {
    setBusy(true);
    try {
      await excludeFromCadence(mpn, excludeReason);
      setExcludeFor(null);
      setExcludeReason("");
      await load();
    } catch (e: any) {
      setError(e?.error || e?.message || "Exclude failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Unassigned Cadence</h1>
          <p className="text-sm text-gray-500">
            {items.length} product{items.length !== 1 ? "s" : ""} match no active cadence rule
          </p>
        </div>
        <button onClick={load} className="text-sm border rounded px-3 py-1.5 hover:bg-gray-50">
          Refresh
        </button>
      </div>

      {loading && <div className="text-center text-gray-400 py-12">Loading…</div>}
      {error && <div className="text-center text-red-600 py-8">{error}</div>}
      {!loading && items.length === 0 && (
        <div className="text-center text-gray-400 py-12">No unassigned products.</div>
      )}

      {items.length > 0 && (
        <table className="w-full bg-white border rounded">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="text-left px-3 py-2">MPN</th>
              <th className="text-left px-3 py-2">Brand</th>
              <th className="text-left px-3 py-2">Department</th>
              <th className="text-right px-3 py-2">WOS</th>
              <th className="text-right px-3 py-2">STR%</th>
              <th className="text-right px-3 py-2">Inv</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {items.map((p) => (
              <tr key={p.mpn} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{p.mpn}</td>
                <td className="px-3 py-2">{p.brand}</td>
                <td className="px-3 py-2">{p.department}</td>
                <td className="px-3 py-2 text-right">
                  {p.wos != null ? `${p.wos.toFixed(1)} wks` : "—"}
                </td>
                <td className="px-3 py-2 text-right">{pct(p.str_pct)}</td>
                <td className="px-3 py-2 text-right">{p.inventory_total}</td>
                <td className="px-3 py-2 text-right">
                  {assignFor === p.mpn ? (
                    <div className="flex justify-end gap-2 items-center">
                      <select
                        value={assignRule}
                        onChange={(e) => setAssignRule(e.target.value)}
                        className="border rounded px-2 py-1 text-xs"
                      >
                        <option value="">Select rule…</option>
                        {rules.map((r) => (
                          <option key={r.rule_id} value={r.rule_id}>
                            {r.rule_name}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={busy || !assignRule}
                        onClick={() => doAssign(p.mpn)}
                        className="text-xs bg-blue-600 text-white rounded px-2 py-1 hover:bg-blue-700 disabled:opacity-50"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => {
                          setAssignFor(null);
                          setAssignRule("");
                        }}
                        className="text-xs border rounded px-2 py-1"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : excludeFor === p.mpn ? (
                    <div className="flex justify-end gap-2 items-center">
                      <input
                        value={excludeReason}
                        onChange={(e) => setExcludeReason(e.target.value)}
                        placeholder="reason"
                        className="border rounded px-2 py-1 text-xs"
                      />
                      <button
                        disabled={busy}
                        onClick={() => doExclude(p.mpn)}
                        className="text-xs bg-red-600 text-white rounded px-2 py-1 hover:bg-red-700 disabled:opacity-50"
                      >
                        Exclude
                      </button>
                      <button
                        onClick={() => {
                          setExcludeFor(null);
                          setExcludeReason("");
                        }}
                        className="text-xs border rounded px-2 py-1"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => {
                          setAssignFor(p.mpn);
                          setAssignRule("");
                        }}
                        className="text-xs bg-blue-600 text-white rounded px-2 py-1 hover:bg-blue-700"
                      >
                        Assign
                      </button>
                      <button
                        onClick={() => {
                          setExcludeFor(p.mpn);
                          setExcludeReason("");
                        }}
                        className="text-xs border rounded px-2 py-1 hover:bg-gray-50"
                      >
                        Exclude
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
