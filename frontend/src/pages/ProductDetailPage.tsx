import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchProduct, completeProduct, type ProductDetail } from "../lib/api";

const PROVENANCE_STYLES: Record<
  string,
  { border: string; badge: string; badgeLabel: string }
> = {
  "System-Applied": {
    border: "border-l-4 border-blue-400",
    badge: "bg-blue-100 text-blue-700",
    badgeLabel: "Smart Rule",
  },
  "Needs-Review": {
    border: "border-l-4 border-amber-400",
    badge: "bg-amber-100 text-amber-700",
    badgeLabel: "⚠️ Needs Review",
  },
  "Human-Verified": {
    border: "border-l-4 border-gray-300",
    badge: "bg-gray-100 text-gray-600",
    badgeLabel: "🔒 Verified",
  },
};

const DEFAULT_STYLE = {
  border: "",
  badge: "bg-gray-50 text-gray-400",
  badgeLabel: "Empty",
};

export default function ProductDetailPage() {
  const { mpn } = useParams<{ mpn: string }>();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [completing, setCompleting] = useState(false);
  const [completeMsg, setCompleteMsg] = useState("");

  useEffect(() => {
    if (!mpn) return;
    setLoading(true);
    fetchProduct(mpn)
      .then(setProduct)
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
      // Reload
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

  if (loading) {
    return <div className="p-8 text-center text-gray-400">Loading…</div>;
  }
  if (error || !product) {
    return (
      <div className="p-8 text-center text-red-600">
        {error || "Product not found"}
      </div>
    );
  }

  const p = product;
  const cp = p.completion_progress;
  const attrs = Object.entries(p.attribute_values).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Back link */}
      <Link
        to="/queue/completion"
        className="text-sm text-blue-600 hover:underline"
      >
        ← Back to Queue
      </Link>

      {/* Header */}
      <div className="mt-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{p.name || p.mpn}</h1>
          <p className="text-sm text-gray-500 mt-1">
            MPN: <span className="font-mono">{p.mpn}</span> · SKU: {p.sku} ·
            Brand: {p.brand}
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
              cp.pct === 100
                ? "bg-green-500"
                : cp.pct >= 50
                ? "bg-yellow-500"
                : "bg-red-500"
            }`}
            style={{ width: `${cp.pct}%` }}
          />
        </div>
        {cp.blockers.length > 0 && (
          <div className="mt-2">
            <p className="text-xs text-gray-500">Blockers:</p>
            <ul className="text-xs text-red-600 list-disc ml-4">
              {cp.blockers.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Complete button */}
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={handleComplete}
          disabled={completing || p.completion_state === "complete"}
          className="bg-green-600 text-white px-4 py-2 rounded font-medium hover:bg-green-700 disabled:opacity-50"
        >
          {completing ? "Completing…" : "Mark Complete"}
        </button>
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
        <InfoCard
          label="Store Inv"
          value={String(p.inventory_store)}
        />
        <InfoCard
          label="WH Inv"
          value={String(p.inventory_warehouse)}
        />
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
              <span
                key={st.site_id}
                className="bg-blue-50 text-blue-700 px-3 py-1 rounded text-sm"
              >
                {st.site_id} ({st.domain})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Attribute Values */}
      <div className="mt-6">
        <h2 className="text-lg font-semibold mb-3">Attributes</h2>
        <div className="space-y-1">
          {attrs.map(([key, attr]) => {
            const vs = attr.verification_state || "";
            const style = PROVENANCE_STYLES[vs] || DEFAULT_STYLE;
            return (
              <div
                key={key}
                className={`flex items-center gap-3 px-3 py-2 bg-white rounded ${style.border}`}
              >
                <span className="w-48 text-sm font-medium text-gray-600 shrink-0">
                  {key}
                </span>
                <span className="flex-1 text-sm font-mono truncate">
                  {attr.value !== null && attr.value !== undefined
                    ? String(attr.value)
                    : "—"}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${style.badge} shrink-0`}
                >
                  {style.badgeLabel}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Source Inputs */}
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
