import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  fetchProduct,
  fetchAttributeRegistry,
  completeProduct,
  saveField,
  type ProductDetail,
  type AttributeRegistryEntry,
} from "../lib/api";

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
  onSaved: (fieldKey: string, value: unknown, completion_progress: { total_required: number; completed: number; pct: number; blockers: string[] }) => void;
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
      onSaved(fieldKey, resp.value, resp.completion_progress);
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
      onSaved(fieldKey, resp.value, resp.completion_progress);
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

// ── Main page ──────────────────────────────────────────────────
export default function ProductDetailPage() {
  const { mpn } = useParams<{ mpn: string }>();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [registry, setRegistry] = useState<AttributeRegistryEntry[]>([]);
  const [activeTab, setActiveTab] = useState("core_information");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [completing, setCompleting] = useState(false);
  const [completeMsg, setCompleteMsg] = useState("");

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
    (fieldKey: string, value: unknown, completionProgress: { total_required: number; completed: number; pct: number; blockers: string[] }) => {
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
        updated.completion_progress = completionProgress;
        // If name field, update the product name
        if (fieldKey === "name" || fieldKey === "product_name") {
          updated.name = typeof value === "string" ? value : updated.name;
        }
        return updated;
      });
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
          <span
            className={`inline-block px-3 py-1 rounded text-sm font-medium ${
              p.completion_state === "complete"
                ? "bg-green-100 text-green-700"
                : "bg-yellow-100 text-yellow-700"
            }`}
          >
            {p.completion_state}
          </span>
          {p.is_high_priority && (
            <span className="ml-2 bg-red-100 text-red-800 text-xs font-medium px-2 py-1 rounded">
              High Priority — {p.launch_days_remaining}d
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4 bg-white rounded-lg border p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Completion Progress</span>
          <span className="text-sm text-gray-500">
            {cp.completed}/{cp.total_required} ({cp.pct}%)
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all ${
              cp.pct === 100 ? "bg-green-500" : cp.pct >= 50 ? "bg-yellow-500" : "bg-red-500"
            }`}
            style={{ width: `${cp.pct}%` }}
          />
        </div>
        {cp.blockers.length > 0 ? (
          <div className="mt-2">
            <p className="text-xs text-gray-500">Blockers:</p>
            <ul className="text-xs text-red-600 list-disc ml-4">
              {cp.blockers.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        ) : cp.pct === 100 ? (
          <p className="mt-2 text-sm text-green-600 font-medium">Ready to Complete ✓</p>
        ) : null}
      </div>

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
    </div>
    </MpnContext.Provider>
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
