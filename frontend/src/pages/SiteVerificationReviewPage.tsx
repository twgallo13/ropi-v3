import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchSiteVerificationReview,
  siteVerificationMarkLive,
  siteVerificationFlag,
  type SiteVerificationItem,
} from "../lib/api";

function stateBadge(state: string) {
  if (state === "mismatch")
    return <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded text-xs">🔴 Mismatch</span>;
  if (state === "stale")
    return <span className="bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded text-xs">🟡 Stale</span>;
  return <span className="bg-gray-100 text-gray-800 px-2 py-0.5 rounded text-xs">{state}</span>;
}

export default function SiteVerificationReviewPage() {
  const [items, setItems] = useState<SiteVerificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flagOpenKey, setFlagOpenKey] = useState<string | null>(null);
  const [flagReason, setFlagReason] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetchSiteVerificationReview();
      setItems(res.items);
    } catch (e: any) {
      setError(e?.error || e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function handleMarkLive(mpn: string, site_key: string) {
    try {
      await siteVerificationMarkLive(mpn, site_key);
      await load();
    } catch (e: any) {
      setError(e?.error || e?.message || "Failed to mark live");
    }
  }
  async function handleFlagSubmit(mpn: string, site_key: string) {
    if (!flagReason.trim()) return;
    try {
      await siteVerificationFlag(mpn, site_key, flagReason);
      setFlagOpenKey(null);
      setFlagReason("");
      await load();
    } catch (e: any) {
      setError(e?.error || e?.message || "Failed to flag");
    }
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Site Verification Review</h1>
          <p className="text-sm text-gray-600 mt-1">
            Products flagged for site verification issues.
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
          No items to review.
        </p>
      ) : (
        <div className="bg-white border rounded divide-y">
          <div className="grid grid-cols-12 text-xs font-medium text-gray-600 bg-gray-50 px-3 py-2">
            <div className="col-span-2">MPN</div>
            <div className="col-span-2">Brand</div>
            <div className="col-span-2">Site</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">URL / Image</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
          {items.map((item) => {
            const rowKey = `${item.mpn}__${item.site_key}`;
            return (
              <div key={rowKey} className="px-3 py-3 text-sm">
                <div className="grid grid-cols-12 items-center">
                  <div className="col-span-2 font-mono">
                    <Link to={`/products/${encodeURIComponent(item.mpn)}`} className="text-blue-600 hover:underline">
                      {item.mpn}
                    </Link>
                  </div>
                  <div className="col-span-2">{item.brand || "—"}</div>
                  <div className="col-span-2">{item.site_key}</div>
                  <div className="col-span-2">{stateBadge(item.verification_state)}</div>
                  <div className="col-span-2 text-xs">
                    {item.product_url ? (
                      <a href={item.product_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                        ↗ Link
                      </a>
                    ) : (
                      <span className="text-gray-400">No Link</span>
                    )}
                    <span className="ml-2">
                      {item.image_url ? "✓ Image" : "No Image"}
                    </span>
                  </div>
                  <div className="col-span-2 flex gap-2 justify-end">
                    <button
                      onClick={() => handleMarkLive(item.mpn, item.site_key)}
                      className="px-2 py-1 text-xs bg-green-600 text-white rounded"
                    >
                      Verify Live
                    </button>
                    <button
                      onClick={() => {
                        setFlagOpenKey(flagOpenKey === rowKey ? null : rowKey);
                        setFlagReason("");
                      }}
                      className="px-2 py-1 text-xs bg-yellow-500 text-white rounded"
                    >
                      Flag
                    </button>
                  </div>
                </div>
                {flagOpenKey === rowKey && (
                  <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded">
                    <input
                      type="text"
                      value={flagReason}
                      onChange={(e) => setFlagReason(e.target.value)}
                      placeholder="Reason (e.g., image_missing, wrong_product)…"
                      className="w-full border rounded p-1 text-sm"
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => handleFlagSubmit(item.mpn, item.site_key)}
                        disabled={!flagReason.trim()}
                        className="px-3 py-1 text-xs bg-yellow-600 text-white rounded disabled:opacity-50"
                      >
                        Submit Flag
                      </button>
                      <button
                        onClick={() => setFlagOpenKey(null)}
                        className="px-3 py-1 text-xs bg-gray-200 rounded"
                      >
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
