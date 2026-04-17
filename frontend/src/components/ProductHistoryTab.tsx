import { useEffect, useState } from "react";
import {
  fetchProductHistory,
  type HistoryEntry,
} from "../lib/api";

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function eventTitle(e: HistoryEntry): string {
  if (e.event_type === "product_created") return "Product created";
  if (e.event_type === "smart_rule_execution")
    return `Smart Rule ${e.rule_name ? `“${e.rule_name}”` : `#${e.rule_id}`} fired`;
  if (e.event_type === "field_edited" && e.field_key) return `${e.field_key} edited`;
  if (e.event_type === "field_verified" && e.field_key) return `${e.field_key} verified`;
  if (e.event_type === "field_created" && e.field_key) return `${e.field_key} set`;
  if (e.event_type === "pricing_resolution") return `Pricing resolution — ${e.pricing_status || ""}`;
  if (e.event_type === "pricing_discrepancy_flagged") return "Pricing discrepancy flagged";
  if (e.event_type === "pricing_discrepancy_correct_pricing") return "Pricing discrepancy — corrected";
  if (e.event_type === "pricing_discrepancy_flag_for_review") return "Pricing discrepancy — flagged for review";
  if (e.event_type === "discrepancy_override") return "⚠ Discrepancy override to export";
  if (e.event_type === "site_verification_mark_live") return "Site verification — marked live";
  if (e.event_type === "site_verification_flag") return "Site verification — flagged";
  return e.event_type;
}

function actorLabel(e: HistoryEntry): string {
  if (!e.acting_user_id) return "System";
  if (e.acting_user_id.startsWith("import:")) return `Import batch ${e.acting_user_id.slice(7, 13)}…`;
  if (e.acting_user_id.startsWith("smart_rule:")) return `Smart Rule ${e.acting_user_id.slice(11)}`;
  if (e.acting_user_id === "system") return "System";
  return e.acting_user_id.slice(0, 12);
}

export default function ProductHistoryTab({ mpn }: { mpn: string }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [fieldFilter, setFieldFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string> = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      if (fieldFilter.trim()) params.field = fieldFilter.trim();
      if (sourceFilter) params.source_type = sourceFilter;
      const res = await fetchProductHistory(mpn, params);
      setEntries(res.entries);
    } catch (e: any) {
      setError(e?.error || e?.message || "Failed to load history");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mpn]);

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-end mb-4">
        <div>
          <label className="text-xs text-gray-600 block">Start</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-600 block">End</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-600 block">Field</label>
          <input
            type="text"
            placeholder="e.g. primary_color"
            value={fieldFilter}
            onChange={(e) => setFieldFilter(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-600 block">Source</label>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="">All</option>
            <option value="import">Import</option>
            <option value="buyer_action">Buyer action</option>
            <option value="smart_rule">Smart Rule</option>
            <option value="human_edit">Human edit</option>
          </select>
        </div>
        <button
          onClick={load}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm"
        >
          Apply
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-gray-500 italic py-4">No history entries.</p>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => {
            const when = e.created_at ? new Date(e.created_at).toLocaleString() : "—";
            return (
              <div key={e.id} className="border rounded p-3 bg-white text-sm">
                <div className="flex justify-between items-start">
                  <span className="font-medium text-gray-900">{eventTitle(e)}</span>
                  <span className="text-xs text-gray-500">{when}</span>
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  by {actorLabel(e)}
                  {e.source_type && ` · ${e.source_type}`}
                </div>
                {e.field_key && (e.old_value !== null || e.new_value !== null) && (
                  <div className="mt-2 text-xs text-gray-700">
                    <span className="font-mono bg-gray-100 px-1 rounded">{fmt(e.old_value)}</span>{" "}
                    → <span className="font-mono bg-blue-50 px-1 rounded">{fmt(e.new_value)}</span>
                    {e.new_verification_state && (
                      <span className="ml-2 text-gray-500">({e.new_verification_state})</span>
                    )}
                  </div>
                )}
                {e.note && <div className="mt-1 text-xs italic text-gray-600">“{e.note}”</div>}
                {e.reasons && e.reasons.length > 0 && (
                  <div className="mt-1 text-xs text-gray-600">
                    Reasons: {e.reasons.join("; ")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
