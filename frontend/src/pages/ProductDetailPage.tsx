import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  fetchProduct,
  fetchAttributeRegistry,
  completeProduct,
  saveField,
  aiAssistant,
  type ProductDetail,
  type AttributeRegistryEntry,
  type SaveFieldResponse,
} from "../lib/api";
import ProductHistoryTab from "../components/ProductHistoryTab";
import ProductCommentThread from "../components/ProductCommentThread";

// ── Provenance helpers — used only for info cards ──────────────
// (EditableAttrRow handles its own provenance display)

// ── Tab config — four operator tabs, system hidden ─────────────
const TABS: { key: string; label: string }[] = [
  { key: "core_information",  label: "Core Information" },
  { key: "product_attributes", label: "Product Attributes" },
  { key: "descriptions_seo",  label: "Descriptions & SEO" },
  { key: "launch_media",      label: "Launch & Media" },
];

// ── Editable Attribute Row ─────────────────────────────────────
function EditableAttrRow({
  fieldKey,
  displayLabel,
  fieldType,
  dropdownOptions,
  attr,
  onSaved,
}: {
  fieldKey: string;
  displayLabel: string;
  fieldType: string;
  dropdownOptions: string[];
  attr: { value: unknown; origin_type: string | null; verification_state: string | null } | undefined;
  onSaved: (fieldKey: string, resp: SaveFieldResponse) => void;
}) {
  const originType = attr?.origin_type ?? null;
  const verificationState = attr?.verification_state ?? null;
  const currentValue = attr?.value;
  const displayValue = currentValue !== null && currentValue !== undefined ? String(currentValue) : "";

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayValue);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [verifying, setVerifying] = useState(false);

  // Sync draft when attr changes externally
  useEffect(() => {
    if (!editing) setDraft(displayValue);
  }, [displayValue, editing]);

  const hasChanged = draft !== displayValue;

  // Does this field need verification? Has a value but not Human-Verified
  const needsVerify = displayValue !== "" && verificationState !== "Human-Verified";

  function startEdit() {
    setDraft(displayValue);
    setEditing(true);
    setSaveError("");
  }

  function cancelEdit() {
    setDraft(displayValue);
    setEditing(false);
    setSaveError("");
  }

  async function handleSave(mpn: string) {
    setSaving(true);
    setSaveError("");
    try {
      let finalValue: unknown = draft;
      if (fieldType === "number") finalValue = draft === "" ? "" : Number(draft);
      else if (fieldType === "toggle") finalValue = draft === "true" || draft === "YES";
      const resp = await saveField(mpn, fieldKey, finalValue);
      onSaved(fieldKey, resp);
      setEditing(false);
    } catch (err: any) {
      setSaveError(err?.error || "Save failed");
      setDraft(displayValue);
    } finally {
      setSaving(false);
    }
  }

  async function handleVerify(mpn: string) {
    setVerifying(true);
    setSaveError("");
    try {
      const resp = await saveField(mpn, fieldKey, currentValue, "verify");
      onSaved(fieldKey, resp);
    } catch (err: any) {
      setSaveError(err?.error || "Verify failed");
    } finally {
      setVerifying(false);
    }
  }

  // Border style based on provenance
  let borderClass = "";
  if (verificationState === "Human-Verified") borderClass = "border-l-4 border-gray-400";
  else if (originType === "Smart Rule") borderClass = "border-l-4 border-blue-400";
  else if (originType === "RO-Import") borderClass = "border-l-4 border-blue-400";

  // Badge
  let badge = null;
  if (verificationState === "Human-Verified" && !editing)
    badge = <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600 shrink-0">🔒</span>;
  else if ((originType === "Smart Rule" || originType === "RO-Import") && !editing)
    badge = <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 shrink-0">{originType}</span>;

  // Read-only display
  if (!editing) {
    return (
      <MpnContext.Consumer>
        {(mpn) => (
      <div
        className={`flex items-center gap-3 px-3 py-2 bg-white rounded cursor-pointer hover:bg-gray-50 ${borderClass}`}
        onClick={startEdit}
      >
        <span className="w-52 text-sm font-medium text-gray-600 shrink-0">{displayLabel}</span>
        <span className={`flex-1 text-sm font-mono truncate ${originType === "RO-Import" ? "text-gray-400" : "text-gray-800"}`}>
          {displayValue !== ""
            ? (fieldType === "toggle" ? (displayValue === "true" || displayValue === "YES" ? "Yes" : "No") : displayValue)
            : <span className="text-gray-300 italic">—</span>}
        </span>
        {needsVerify && (
          <button
            onClick={(e) => { e.stopPropagation(); handleVerify(mpn); }}
            disabled={verifying}
            className="px-2 py-0.5 text-xs font-medium rounded bg-green-50 text-green-700 border border-green-300 hover:bg-green-100 disabled:opacity-50 shrink-0"
          >
            {verifying ? "…" : "✓ Verify"}
          </button>
        )}
        {badge}
        {saveError && <span className="text-xs text-red-600 shrink-0">{saveError}</span>}
      </div>
        )}
      </MpnContext.Consumer>
    );
  }

  // Editing mode — render input based on field_type
  return (
    <MpnContext.Consumer>
      {(mpn) => (
        <div className={`flex items-center gap-3 px-3 py-2 bg-white rounded ring-2 ring-blue-400 ${borderClass}`}>
          <span className="w-52 text-sm font-medium text-gray-600 shrink-0">{displayLabel}</span>
          <div className="flex-1 flex items-center gap-2">
            {fieldType === "dropdown" ? (
              <select
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="flex-1 border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                autoFocus
              >
                <option value="">— Select —</option>
                {dropdownOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : fieldType === "multi_select" ? (
              <div className="flex-1 flex flex-wrap gap-2">
                {dropdownOptions.map((opt) => {
                  const selected = draft.split(",").map(s => s.trim()).filter(Boolean);
                  const isChecked = selected.includes(opt);
                  return (
                    <label key={opt} className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          const next = isChecked
                            ? selected.filter(s => s !== opt)
                            : [...selected, opt];
                          setDraft(next.join(", "));
                        }}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      {opt}
                    </label>
                  );
                })}
              </div>
            ) : fieldType === "toggle" ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft === "true" || draft === "YES"}
                  onChange={(e) => setDraft(e.target.checked ? "true" : "false")}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                {draft === "true" || draft === "YES" ? "Yes" : "No"}
              </label>
            ) : fieldType === "number" ? (
              <input
                type="number"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="flex-1 border rounded px-2 py-1 text-sm font-mono focus:ring-2 focus:ring-blue-400 focus:outline-none"
                autoFocus
              />
            ) : fieldType === "date" ? (
              <input
                type="date"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="flex-1 border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                autoFocus
              />
            ) : (
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="flex-1 border rounded px-2 py-1 text-sm font-mono focus:ring-2 focus:ring-blue-400 focus:outline-none"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && hasChanged) handleSave(mpn); if (e.key === "Escape") cancelEdit(); }}
              />
            )}
            {hasChanged && (
              <button
                onClick={() => handleSave(mpn)}
                disabled={saving}
                className="px-3 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "…" : "Save"}
              </button>
            )}
            <button
              onClick={cancelEdit}
              className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
          {saveError && <span className="text-xs text-red-600 shrink-0">{saveError}</span>}
        </div>
      )}
    </MpnContext.Consumer>
  );
}

// Context to pass mpn down to EditableAttrRow without prop drilling through map
import { createContext } from "react";
const MpnContext = createContext<string>("");

// ── Status Bar ──────────────────────────────────────────────────
type CompletionProgress = { total_required: number; completed: number; pct: number; blockers: string[] };

function StatusBar({
  completionState,
  completionProgress,
  pricingDomainState,
  isMapProtected,
  mapConflictActive,
  mapConflictReason,
  mapPrice,
  needsAiReview,
  aiReviewReason,
}: {
  completionState: string;
  completionProgress: CompletionProgress;
  pricingDomainState: string;
  isMapProtected?: boolean;
  mapConflictActive?: boolean;
  mapConflictReason?: string | null;
  mapPrice?: number | null;
  needsAiReview?: boolean;
  aiReviewReason?: string | null;
}) {
  const isComplete = completionState === "complete";
  const cp = completionProgress;

  // Derive export signal based on completion_state + pricing_domain_state.
  // TALLY-107 — Valid states: Awaiting Completion, Export Ready ✅, Exported ✓,
  // Scheduled 📅, Blocked ⛔ [reason].
  let exportLabel: string;
  let exportClass: string;
  if (!isComplete) {
    exportLabel = "Awaiting Completion";
    exportClass = "bg-gray-100 text-gray-600";
  } else if (pricingDomainState === "export_ready") {
    exportLabel = "Export Ready ✅";
    exportClass = "bg-green-100 text-green-700";
  } else if (pricingDomainState === "exported") {
    exportLabel = "Exported ✓";
    exportClass = "bg-green-100 text-green-700";
  } else if (pricingDomainState === "scheduled") {
    exportLabel = "Scheduled 📅";
    exportClass = "bg-purple-50 text-purple-700";
  } else if (
    pricingDomainState === "discrepancy" ||
    pricingDomainState === "Pricing Discrepancy"
  ) {
    exportLabel = "Blocked ⛔ Discrepancy";
    exportClass = "bg-red-50 text-red-700";
  } else if (
    pricingDomainState === "loss_leader_review" ||
    pricingDomainState === "Loss-Leader Review Pending"
  ) {
    exportLabel = "Blocked ⛔ Loss-Leader Review";
    exportClass = "bg-red-50 text-red-700";
  } else if (
    pricingDomainState === "buyer_denied" ||
    pricingDomainState === "loss_leader_vetoed"
  ) {
    exportLabel = `Blocked ⛔ ${pricingDomainState}`;
    exportClass = "bg-red-50 text-red-700";
  } else {
    exportLabel = "Awaiting Completion";
    exportClass = "bg-gray-100 text-gray-600";
  }

  // Pricing signal label/color
  const pricingLabel = pricingDomainState || "pending";
  let pricingClass = "bg-gray-100 text-gray-600";
  if (pricingDomainState === "export_ready" || pricingDomainState === "exported") {
    pricingClass = "bg-green-50 text-green-700";
  } else if (
    pricingDomainState === "discrepancy" ||
    pricingDomainState === "Pricing Discrepancy" ||
    pricingDomainState === "loss_leader_review" ||
    pricingDomainState === "Loss-Leader Review Pending" ||
    pricingDomainState === "buyer_denied" ||
    pricingDomainState === "loss_leader_vetoed"
  ) {
    pricingClass = "bg-red-50 text-red-700";
  } else if (pricingDomainState === "scheduled") {
    pricingClass = "bg-purple-50 text-purple-700";
  } else if (pricingDomainState === "Pricing Pending" || pricingDomainState === "pending") {
    pricingClass = "bg-yellow-50 text-yellow-700";
  }

  return (
    <div className="mt-4 bg-white rounded-lg border p-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Completion signal */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Completion</p>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                isComplete ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
              }`}
            >
              {completionState}
            </span>
            <span className="text-xs text-gray-500">
              {cp.completed}/{cp.total_required} ({cp.pct}%)
            </span>
          </div>
          <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                cp.pct === 100 ? "bg-green-500" : cp.pct >= 50 ? "bg-yellow-500" : "bg-red-500"
              }`}
              style={{ width: `${cp.pct}%` }}
            />
          </div>
        </div>

        {/* Pricing signal */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Pricing</p>
          <div className="mt-1">
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${pricingClass}`}>
              {pricingLabel}
            </span>
          </div>
        </div>

        {/* Export signal */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Export Status</p>
          <div className="mt-1">
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${exportClass}`}>
              {exportLabel}
            </span>
          </div>
        </div>

        {/* MAP signal */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">MAP Status</p>
          <div className="mt-1">
            {mapConflictActive ? (
              <span
                className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-red-600 text-white"
                title={mapConflictReason || ""}
              >
                ⚠️ MAP Conflict
              </span>
            ) : isMapProtected ? (
              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                MAP Protected {mapPrice != null ? `($${mapPrice.toFixed(2)})` : ""}
              </span>
            ) : (
              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                Not Protected
              </span>
            )}
          </div>
          {mapConflictActive && mapConflictReason && (
            <p className="mt-1 text-xs text-red-600">{mapConflictReason}</p>
          )}
        </div>

        {/* AI Review signal */}
        {needsAiReview && (
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">AI Content</p>
            <div className="mt-1">
              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
                ⚠️ AI Content Needs Review
              </span>
            </div>
            {aiReviewReason && (
              <p className="mt-1 text-xs text-orange-600">{aiReviewReason}</p>
            )}
          </div>
        )}
      </div>

      {/* Completion blockers (kept under the bar) */}
      {cp.blockers.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs text-gray-500">Completion blockers:</p>
          <ul className="text-xs text-red-600 list-disc ml-4">
            {cp.blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      ) : cp.pct === 100 && !isComplete ? (
        <p className="mt-3 text-sm text-green-600 font-medium">Ready to Complete ✓</p>
      ) : null}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────
export default function ProductDetailPage() {
  const { mpn } = useParams<{ mpn: string }>();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [registry, setRegistry] = useState<AttributeRegistryEntry[]>([]);
  const [activeTab, setActiveTab] = useState("core_information");
  const [topView, setTopView] = useState<"details" | "history">("details");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [completing, setCompleting] = useState(false);
  const [completeMsg, setCompleteMsg] = useState("");
  const [mapAutoMsg, setMapAutoMsg] = useState("");

  useEffect(() => {
    if (!mpn) return;
    setLoading(true);
    Promise.all([fetchProduct(mpn), fetchAttributeRegistry()])
      .then(([prod, reg]) => {
        setProduct(prod);
        setRegistry(reg);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [mpn]);

  // Callback after a field is saved — update product state in place
  const handleFieldSaved = useCallback(
    (fieldKey: string, resp: SaveFieldResponse) => {
      const value = resp.value;
      setProduct((prev) => {
        if (!prev) return prev;
        const updated = { ...prev };
        // Update attribute_values
        updated.attribute_values = {
          ...updated.attribute_values,
          [fieldKey]: {
            value,
            origin_type: "Human",
            origin_detail: null,
            verification_state: "Human-Verified",
            written_at: new Date().toISOString(),
          },
        };
        // Update completion_progress
        updated.completion_progress = resp.completion_progress;
        // If name field, update the product name
        if (fieldKey === "name" || fieldKey === "product_name") {
          updated.name = typeof value === "string" ? value : updated.name;
        }
        // TALLY-107 — MAP auto-populate: mirror new scom/scom_sale into local state
        if (resp.map_auto_populate && resp.map_auto_populate.triggered) {
          const retail = resp.map_auto_populate.rics_retail;
          updated.scom = retail;
          updated.scom_sale = retail;
          const humanStamp = {
            origin_type: "Human",
            origin_detail: "MAP auto-populate",
            verification_state: "Human-Verified",
            written_at: new Date().toISOString(),
          };
          updated.attribute_values = {
            ...updated.attribute_values,
            scom: { value: retail, ...humanStamp },
            scom_sale: { value: retail, ...humanStamp },
          };
        }
        // Mirror scom / scom_sale top-level values when edited directly
        if (fieldKey === "scom" && typeof value === "number") updated.scom = value;
        if (fieldKey === "scom_sale" && typeof value === "number") updated.scom_sale = value;
        return updated;
      });

      // Toast for MAP auto-populate
      if (resp.map_auto_populate && resp.map_auto_populate.triggered) {
        setMapAutoMsg(
          `MAP detected — Web prices set to $${resp.map_auto_populate.rics_retail.toFixed(2)}`
        );
        setTimeout(() => setMapAutoMsg(""), 6000);
      }
    },
    []
  );

  async function handleComplete() {
    if (!mpn) return;
    setCompleting(true);
    setCompleteMsg("");
    try {
      await completeProduct(mpn);
      setCompleteMsg("Product marked complete!");
      const updated = await fetchProduct(mpn);
      setProduct(updated);
    } catch (err: unknown) {
      const e = err as { error?: string; blockers?: string[] };
      if (e.blockers) {
        setCompleteMsg(`Cannot complete: ${e.blockers.join("; ")}`);
      } else {
        setCompleteMsg(e.error || "Failed");
      }
    } finally {
      setCompleting(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-400">Loading…</div>;
  if (error || !product) {
    return (
      <div className="p-8 text-center text-red-600">
        {error || "Product not found"}
      </div>
    );
  }

  const p = product;
  const cp = p.completion_progress;

  // Group registry entries by destination_tab (exclude system tab from UI)
  const byTab: Record<string, AttributeRegistryEntry[]> = {};
  for (const tab of TABS) byTab[tab.key] = [];
  for (const entry of registry) {
    if (entry.destination_tab !== "system" && byTab[entry.destination_tab]) {
      byTab[entry.destination_tab].push(entry);
    }
  }

  // Sort each tab's entries alphabetically by display_label
  for (const tab of TABS) {
    byTab[tab.key].sort((a, b) => a.display_label.localeCompare(b.display_label));
  }

  const tabEntries = byTab[activeTab] || [];

  return (
    <MpnContext.Provider value={mpn || ""}>
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Back link */}
      <Link to="/queue/completion" className="text-sm text-blue-600 hover:underline">
        ← Back to Queue
      </Link>

      {/* Header */}
      <div className="mt-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{p.name || p.mpn}</h1>
          <p className="text-sm text-gray-500 mt-1">
            MPN: <span className="font-mono">{p.mpn}</span> · SKU: {p.sku} · Brand: {p.brand}
          </p>
        </div>
        <div className="text-right">
          {p.is_high_priority && (
            <span className="bg-red-100 text-red-800 text-xs font-medium px-2 py-1 rounded">
              High Priority — {p.launch_days_remaining}d
            </span>
          )}
        </div>
      </div>

      {/* Status Bar (Completion / Pricing / Export) */}
      <StatusBar
        completionState={p.completion_state}
        completionProgress={cp}
        pricingDomainState={p.pricing_domain_state || "pending"}
        isMapProtected={p.is_map_protected}
        mapConflictActive={p.map_conflict_active}
        mapConflictReason={p.map_conflict_reason}
        mapPrice={p.map_price}
        needsAiReview={p.needs_ai_review}
        aiReviewReason={p.ai_review_reason}
      />

      {/* MAP auto-populate toast */}
      {mapAutoMsg && (
        <div className="mt-3 px-3 py-2 rounded bg-blue-50 text-blue-800 text-sm border border-blue-200">
          {mapAutoMsg}
        </div>
      )}

      {/* Complete button */}
      <div className="mt-4 flex items-center gap-3">
        {(() => {
          const hasBlockers = cp.blockers.length > 0;
          const isDisabled = completing || p.completion_state === "complete" || hasBlockers;
          return (
            <button
              onClick={handleComplete}
              disabled={isDisabled}
              className={`px-4 py-2 rounded font-medium ${
                isDisabled
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {completing ? "Completing…" : "Mark Complete"}
            </button>
          );
        })()}
        {completeMsg && (
          <span
            className={`text-sm ${
              completeMsg.startsWith("Cannot") || completeMsg === "Failed"
                ? "text-red-600"
                : "text-green-600"
            }`}
          >
            {completeMsg}
          </span>
        )}
      </div>

      {/* Key info cards */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        <InfoCard label="Status" value={p.status} />
        <InfoCard label="Image Status" value={p.image_status || "—"} />
        <InfoCard label="Store Inv" value={String(p.inventory_store)} />
        <InfoCard label="WH Inv" value={String(p.inventory_warehouse)} />
        <InfoCard label="SCOM" value={`$${p.scom.toFixed(2)}`} />
        <InfoCard label="SCOM Sale" value={`$${p.scom_sale.toFixed(2)}`} />
        <InfoCard label="RICS Retail" value={`$${p.rics_retail.toFixed(2)}`} />
        <InfoCard label="RICS Offer" value={`$${p.rics_offer.toFixed(2)}`} />
      </div>

      {/* Site Targets */}
      {p.site_targets.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-2">Site Targets</h2>
          <div className="flex gap-2">
            {p.site_targets.map((st) => (
              <span key={st.site_id} className="bg-blue-50 text-blue-700 px-3 py-1 rounded text-sm">
                {st.site_id} ({st.domain})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Top-level tab bar — Details | History ──────────────── */}
      <div className="mt-8 border-b flex gap-2">
        <button
          onClick={() => setTopView("details")}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${
            topView === "details"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Details
        </button>
        <button
          onClick={() => setTopView("history")}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${
            topView === "history"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          History
        </button>
      </div>

      {topView === "history" ? (
        <div className="mt-4">
          <ProductHistoryTab mpn={p.mpn} />
        </div>
      ) : (
      <>
      {/* ── Attribute tabs ─────────────────────────────────────── */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-3">Attributes</h2>

        {/* Tab bar */}
        <div className="flex border-b mb-4">
          {TABS.map((tab) => {
            const filled = byTab[tab.key].filter(
              (e) => p.attribute_values[e.field_key]?.value !== undefined &&
                     p.attribute_values[e.field_key]?.value !== null &&
                     p.attribute_values[e.field_key]?.value !== ""
            ).length;
            const total = byTab[tab.key].length;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {tab.label}
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                  isActive ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"
                }`}>
                  {filled}/{total}
                </span>
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="space-y-1">
          {tabEntries.length === 0 ? (
            <p className="text-sm text-gray-400 italic py-4">No attributes in this tab.</p>
          ) : (
            tabEntries.map((entry) => (
              <EditableAttrRow
                key={entry.field_key}
                fieldKey={entry.field_key}
                displayLabel={entry.display_label}
                fieldType={entry.field_type}
                dropdownOptions={entry.dropdown_options || []}
                attr={p.attribute_values[entry.field_key]}
                onSaved={handleFieldSaved}
              />
            ))
          )}
        </div>
      </div>

      {/* Source Inputs (raw) */}
      {Object.keys(p.source_inputs).length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-3">Source Inputs (Raw)</h2>
          <div className="bg-gray-50 rounded border p-4 text-sm font-mono space-y-1">
            {Object.entries(p.source_inputs)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, val]) => (
                <div key={key} className="flex gap-2">
                  <span className="text-gray-500 shrink-0">{key}:</span>
                  <span className="truncate">{String(val)}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* AI Content Review Link */}
      <div className="mt-6">
        <Link
          to={`/products/${encodeURIComponent(mpn || "")}/review`}
          className="inline-flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded text-sm hover:bg-purple-700"
        >
          🤖 AI Content Review
        </Link>
      </div>

      {/* AI Assistant Panel */}
      <AIAssistantPanel mpn={mpn || ""} productName={p.name} />
      </>
      )}

      {/* Comment thread — always visible */}
      <ProductCommentThread mpn={p.mpn} />
    </div>
    </MpnContext.Provider>
  );
}

// ── AI Assistant Panel ─────────────────────────────────────────
function AIAssistantPanel({ mpn, productName }: { mpn: string; productName: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<{ role: string; text: string }[]>([]);
  const [loading, setLoading] = useState(false);

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data:image/...;base64, prefix
      const base64 = result.split(",")[1] || result;
      setImageData(base64);
    };
    reader.readAsDataURL(file);
  }

  async function handleSend() {
    if (!message.trim() && !imageData) return;
    const userMsg = message.trim();
    setChatHistory((prev) => [
      ...prev,
      { role: "user", text: userMsg + (imageData ? " [📷 image attached]" : "") },
    ]);
    setMessage("");
    setLoading(true);
    try {
      const result = await aiAssistant(mpn, userMsg, imageData || undefined);
      setChatHistory((prev) => [...prev, { role: "assistant", text: result.response }]);
      setImageData(null);
    } catch (err: any) {
      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", text: `Error: ${err.error || "AI Assistant unavailable"}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-6 border rounded bg-white">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <span>🤖 AI Assistant</span>
        <span className="text-gray-400">{open ? "▲ Close" : "▼ Open"}</span>
      </button>

      {open && (
        <div className="border-t px-4 py-4 space-y-3">
          {/* Image upload */}
          <div className="flex gap-2">
            <label className="cursor-pointer bg-gray-100 text-gray-600 px-3 py-1.5 rounded text-xs hover:bg-gray-200">
              📎 Upload Image
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </label>
            {imageData && (
              <span className="text-xs text-green-600 flex items-center gap-1">
                ✓ Image attached
                <button onClick={() => setImageData(null)} className="text-red-500 hover:underline">
                  ×
                </button>
              </span>
            )}
          </div>

          {/* Chat history */}
          {chatHistory.length > 0 && (
            <div className="max-h-64 overflow-y-auto space-y-2 border rounded p-3 bg-gray-50">
              {chatHistory.map((msg, i) => (
                <div
                  key={i}
                  className={`text-sm ${msg.role === "user" ? "text-blue-700" : "text-gray-700"}`}
                >
                  <span className="font-medium">
                    {msg.role === "user" ? "You: " : "AI: "}
                  </span>
                  {msg.text}
                </div>
              ))}
              {loading && (
                <div className="text-sm text-gray-400 italic">AI is thinking…</div>
              )}
            </div>
          )}

          {/* Input */}
          <div className="flex gap-2">
            <input
              className="flex-1 border rounded px-3 py-2 text-sm"
              placeholder={`Ask me about ${productName || "this product"}…`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button
              onClick={handleSend}
              disabled={loading || (!message.trim() && !imageData)}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              Send
            </button>
          </div>

          <p className="text-xs text-gray-400">
            ⚠️ Suggestions only — apply manually to fields
          </p>
        </div>
      )}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded border p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}
