import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchPricingDiscrepancy,
  resolvePricingDiscrepancy,
  type PricingDiscrepancyItem,
} from "../lib/api";
import { useAuth } from "../contexts/AuthContext";

const REASON_CODE_MAP: Record<string, { code: string; label: string }> = {
  "A": { code: "A", label: "Price inversion — RICS Offer > RICS Retail" },
  "B": { code: "B", label: "GM% below threshold (not below cost)" },
  "C": { code: "C", label: "Source SCOM below active MAP" },
};

// Reasons are stored as strings — extract letter code if present
function reasonBadge(reason: string): { code: string; label: string } {
  if (/rics ?offer\s*>\s*rics ?retail/i.test(reason) || /inver(t|sion)/i.test(reason)) return REASON_CODE_MAP.A;
  if (/gm/i.test(reason) && /below/i.test(reason)) return REASON_CODE_MAP.B;
  if (/map/i.test(reason) && /below/i.test(reason)) return REASON_CODE_MAP.C;
  return { code: "?", label: reason };
}

export default function PricingDiscrepancyPage() {
  const { role } = useAuth();
  const [items, setItems] = useState<PricingDiscrepancyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedMpn, setExpandedMpn] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<
    "correct_pricing" | "flag_for_review" | "override_to_export" | null
  >(null);
  const [correctedRicsOffer, setCorrectedRicsOffer] = useState<string>("");
  const [correctedScom, setCorrectedScom] = useState<string>("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState("");

  const canOverride = role === "head_buyer" || role === "admin";

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetchPricingDiscrepancy();
      setItems(res.items);
    } catch (e: any) {
      setError(e?.error || e?.message || "Failed to load discrepancy queue");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startAction(mpn: string, mode: typeof actionMode) {
    setExpandedMpn(mpn);
    setActionMode(mode);
    setCorrectedRicsOffer("");
    setCorrectedScom("");
    setResolutionNote("");
    setRowError("");
  }

  function cancelAction() {
    setExpandedMpn(null);
    setActionMode(null);
    setCorrectedRicsOffer("");
    setCorrectedScom("");
    setResolutionNote("");
    setRowError("");
  }

  async function handleSubmit(mpn: string) {
    if (!actionMode) return;
    setSaving(true);
    setRowError("");
    try {
      const body: any = { action: actionMode, note: resolutionNote };
      if (actionMode === "correct_pricing") {
        if (correctedRicsOffer) body.corrected_rics_offer = parseFloat(correctedRicsOffer);
        if (correctedScom) body.corrected_scom = parseFloat(correctedScom);
      }
      await resolvePricingDiscrepancy(mpn, body);
      cancelAction();
      await load();
    } catch (e: any) {
      setRowError(e?.error || e?.message || "Failed to resolve discrepancy");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Pricing Discrepancy</h1>
          <p className="text-sm text-gray-600 mt-1">
            Products blocked from export due to pricing anomalies. Each must be manually
            resolved before it can export.
          </p>
        </div>
        <span className="bg-red-100 text-red-800 px-3 py-1 rounded text-sm">
          {items.length} items
        </span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500 italic py-8 text-center">
          No pricing discrepancies. All clear.
        </p>
      ) : (
        <div className="bg-white border rounded divide-y">
          <div className="grid grid-cols-12 text-xs font-medium text-gray-600 bg-gray-50 px-3 py-2">
            <div className="col-span-2">MPN</div>
            <div className="col-span-2">Brand</div>
            <div className="col-span-2 text-right">RICS Retail</div>
            <div className="col-span-2 text-right">RICS Offer</div>
            <div className="col-span-1 text-right">Web Sale</div>
            <div className="col-span-3">Why</div>
          </div>
          {items.map((item) => {
            const expanded = expandedMpn === item.mpn;
            const badges = (item.discrepancy_reasons || []).map(reasonBadge);
            return (
              <div key={item.mpn}>
                <div className="grid grid-cols-12 px-3 py-3 items-center text-sm">
                  <div className="col-span-2 font-mono">
                    <Link to={`/products/${encodeURIComponent(item.mpn)}`} className="text-blue-600 hover:underline">
                      {item.mpn}
                    </Link>
                  </div>
                  <div className="col-span-2">{item.brand || "—"}</div>
                  <div className="col-span-2 text-right">${item.rics_retail.toFixed(2)}</div>
                  <div className="col-span-2 text-right">${item.rics_offer.toFixed(2)}</div>
                  <div className="col-span-1 text-right">
                    {item.effective_web_sale !== null ? `$${Number(item.effective_web_sale).toFixed(2)}` : "—"}
                  </div>
                  <div className="col-span-3 flex flex-wrap gap-1">
                    {badges.map((b, i) => (
                      <span
                        key={i}
                        title={b.label}
                        className="bg-red-50 text-red-700 border border-red-200 text-xs px-2 py-0.5 rounded"
                      >
                        🔴 {b.code}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Action buttons row */}
                <div className="px-3 pb-3 flex gap-2">
                  <button
                    onClick={() => startAction(item.mpn, "correct_pricing")}
                    className="px-3 py-1 text-xs bg-blue-600 text-white rounded"
                  >
                    Correct Pricing
                  </button>
                  <button
                    onClick={() => startAction(item.mpn, "flag_for_review")}
                    className="px-3 py-1 text-xs bg-yellow-500 text-white rounded"
                  >
                    Flag for Review
                  </button>
                  {canOverride && (
                    <button
                      onClick={() => startAction(item.mpn, "override_to_export")}
                      className="px-3 py-1 text-xs bg-red-600 text-white rounded"
                    >
                      Override to Export
                    </button>
                  )}
                  <Link
                    to={`/products/${encodeURIComponent(item.mpn)}`}
                    className="ml-auto px-3 py-1 text-xs bg-gray-200 rounded"
                  >
                    Open Product
                  </Link>
                </div>

                {/* Correction 3 — expandable inline panel */}
                {expanded && actionMode === "correct_pricing" && (
                  <div className="mx-3 mb-3 p-3 bg-blue-50 border border-blue-200 rounded">
                    <p className="text-sm font-medium text-blue-800 mb-2">
                      Enter corrected prices
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-600">RICS Offer (Store Sale)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={correctedRicsOffer}
                          onChange={(e) => setCorrectedRicsOffer(e.target.value)}
                          placeholder={String(item.rics_offer)}
                          className="w-full border rounded p-1 text-sm mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">SCOM (Web Regular)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={correctedScom}
                          onChange={(e) => setCorrectedScom(e.target.value)}
                          placeholder={String(item.scom)}
                          className="w-full border rounded p-1 text-sm mt-1"
                        />
                      </div>
                    </div>
                    <div className="mt-2">
                      <label className="text-xs text-gray-600">Resolution note (required)</label>
                      <input
                        type="text"
                        value={resolutionNote}
                        onChange={(e) => setResolutionNote(e.target.value)}
                        placeholder="Explain why these prices are correct..."
                        className="w-full border rounded p-1 text-sm mt-1"
                      />
                    </div>
                    {rowError && <p className="mt-2 text-sm text-red-600">{rowError}</p>}
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => handleSubmit(item.mpn)}
                        disabled={
                          saving ||
                          (!correctedRicsOffer && !correctedScom) ||
                          !resolutionNote.trim()
                        }
                        className="px-3 py-1 bg-blue-600 text-white text-sm rounded disabled:opacity-50"
                      >
                        {saving ? "Applying…" : "Apply Corrections"}
                      </button>
                      <button onClick={cancelAction} className="px-3 py-1 bg-gray-200 text-sm rounded">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {expanded && actionMode === "flag_for_review" && (
                  <div className="mx-3 mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
                    <p className="text-sm font-medium text-yellow-800 mb-2">
                      Flag for review
                    </p>
                    <input
                      type="text"
                      value={resolutionNote}
                      onChange={(e) => setResolutionNote(e.target.value)}
                      placeholder="Reason for flagging…"
                      className="w-full border rounded p-1 text-sm"
                    />
                    {rowError && <p className="mt-2 text-sm text-red-600">{rowError}</p>}
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => handleSubmit(item.mpn)}
                        disabled={saving || !resolutionNote.trim()}
                        className="px-3 py-1 bg-yellow-600 text-white text-sm rounded disabled:opacity-50"
                      >
                        {saving ? "Flagging…" : "Flag"}
                      </button>
                      <button onClick={cancelAction} className="px-3 py-1 bg-gray-200 text-sm rounded">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {expanded && actionMode === "override_to_export" && (
                  <div className="mx-3 mb-3 p-3 bg-red-50 border border-red-300 rounded">
                    <p className="text-sm font-medium text-red-800 mb-2">
                      ⚠ Head Buyer override — permanent audit entry
                    </p>
                    <input
                      type="text"
                      value={resolutionNote}
                      onChange={(e) => setResolutionNote(e.target.value)}
                      placeholder="Mandatory override reason…"
                      className="w-full border rounded p-1 text-sm"
                    />
                    {rowError && <p className="mt-2 text-sm text-red-600">{rowError}</p>}
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => handleSubmit(item.mpn)}
                        disabled={saving || !resolutionNote.trim()}
                        className="px-3 py-1 bg-red-600 text-white text-sm rounded disabled:opacity-50"
                      >
                        {saving ? "Overriding…" : "Confirm Override"}
                      </button>
                      <button onClick={cancelAction} className="px-3 py-1 bg-gray-200 text-sm rounded">
                        Cancel
                      </button>
                    </div>
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
