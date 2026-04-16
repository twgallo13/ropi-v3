import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  fetchProduct,
  fetchAttributeRegistry,
  completeProduct,
  type ProductDetail,
  type AttributeRegistryEntry,
} from "../lib/api";

// ── Provenance helpers (keyed on origin_type) ──────────────────
function provenanceBorder(originType: string | null): string {
  if (originType === 'Smart Rule') return 'border-l-4 border-blue-400';
  if (originType === 'Human') return 'border-l-4 border-gray-400';
  return ''; // RO-Import and others — no left border
}

function ProvenanceBadge({ originType }: { originType: string | null }) {
  if (originType === 'Smart Rule')
    return <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 shrink-0">Smart Rule</span>;
  if (originType === 'Human')
    return <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600 shrink-0">🔒</span>;
  return null; // RO-Import — no badge
}

// ── Tab config — four operator tabs, system hidden ─────────────
const TABS: { key: string; label: string }[] = [
  { key: "core_information",  label: "Core Information" },
  { key: "product_attributes", label: "Product Attributes" },
  { key: "descriptions_seo",  label: "Descriptions & SEO" },
  { key: "launch_media",      label: "Launch & Media" },
];

// ── Attribute row ──────────────────────────────────────────────
function AttrRow({
  displayLabel,
  attr,
}: {
  displayLabel: string;
  attr: { value: unknown; origin_type: string | null; verification_state: string | null } | undefined;
}) {
  const originType = attr?.origin_type ?? null;
  const value = attr?.value;

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 bg-white rounded ${provenanceBorder(originType)}`}
    >
      <span className="w-52 text-sm font-medium text-gray-600 shrink-0">
        {displayLabel}
      </span>
      <span className={`flex-1 text-sm font-mono truncate ${originType === 'RO-Import' ? 'text-gray-400' : 'text-gray-800'}`}>
        {value !== null && value !== undefined && value !== ""
          ? String(value)
          : <span className="text-gray-300 italic">—</span>}
      </span>
      <ProvenanceBadge originType={originType} />
    </div>
  );
}

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
        {cp.blockers.length > 0 && (
          <div className="mt-2">
            <p className="text-xs text-gray-500">Blockers:</p>
            <ul className="text-xs text-red-600 list-disc ml-4">
              {cp.blockers.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        )}
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
              <AttrRow
                key={entry.field_key}
                displayLabel={entry.display_label}
                attr={p.attribute_values[entry.field_key]}
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
