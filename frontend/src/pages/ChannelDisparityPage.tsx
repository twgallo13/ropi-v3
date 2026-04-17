import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchChannelDisparity,
  type ChannelDisparityResponse,
  type DisparityItem,
} from "../lib/api";

type SliceKey = "store_sale_web_full" | "web_sale_store_full" | "map_promo_eligible";

const SLICE_META: Record<SliceKey, { label: string; title: string; blurb: string }> = {
  store_sale_web_full: {
    label: "Store Sale / Web Full",
    title: "STORE ON SALE — WEB AT FULL PRICE",
    blurb:
      "Products currently on sale in store but not marked down on web. Buyers may want to align or justify the gap.",
  },
  web_sale_store_full: {
    label: "Web Sale / Store Full",
    title: "WEB ON SALE — STORE AT FULL PRICE",
    blurb:
      "Products discounted online but still at full price in store. Consider matching or documenting the split.",
  },
  map_promo_eligible: {
    label: "MAP + Promo",
    title: "MAP-PROTECTED WITH IN-CART PROMO ELIGIBLE",
    blurb:
      "MAP-protected products where a web_discount_cap is configured. Confirm promo thresholds remain compliant.",
  },
};

function money(n: number | null | undefined) {
  if (n === null || n === undefined || isNaN(Number(n))) return "—";
  return `$${Number(n).toFixed(2)}`;
}
function pct(n: number | null | undefined) {
  if (n === null || n === undefined || isNaN(Number(n))) return "—";
  return `${Number(n).toFixed(1)}%`;
}

function StoreSaleWebFullTable({ items }: { items: DisparityItem[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 text-xs uppercase text-gray-600 border-b">
        <tr>
          <th className="px-3 py-2 text-left">MPN</th>
          <th className="px-3 py-2 text-left">Brand</th>
          <th className="px-3 py-2 text-right">RICS Retail</th>
          <th className="px-3 py-2 text-right">RICS Offer</th>
          <th className="px-3 py-2 text-right">Web Sale</th>
          <th className="px-3 py-2 text-right">Gap</th>
          <th className="px-3 py-2 text-right">Web GM%</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => {
          const gap =
            it.rics_retail && it.rics_offer
              ? it.rics_retail - it.rics_offer
              : null;
          return (
            <tr key={it.id} className="border-b last:border-b-0">
              <td className="px-3 py-2 font-mono text-xs">
                <Link
                  to={`/products/${encodeURIComponent(it.mpn)}`}
                  className="text-blue-700 hover:underline"
                >
                  {it.mpn}
                </Link>
              </td>
              <td className="px-3 py-2">{it.brand || "—"}</td>
              <td className="px-3 py-2 text-right font-mono">
                {money(it.rics_retail)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {money(it.rics_offer)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {money(it.scom_sale)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-amber-700">
                {gap !== null ? money(gap) : "—"}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {pct(it.web_gm_pct)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function WebSaleStoreFullTable({ items }: { items: DisparityItem[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 text-xs uppercase text-gray-600 border-b">
        <tr>
          <th className="px-3 py-2 text-left">MPN</th>
          <th className="px-3 py-2 text-left">Brand</th>
          <th className="px-3 py-2 text-right">Store Reg</th>
          <th className="px-3 py-2 text-right">Web Reg</th>
          <th className="px-3 py-2 text-right">Web Sale</th>
          <th className="px-3 py-2 text-right">Gap</th>
          <th className="px-3 py-2 text-right">Web GM%</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => {
          const gap =
            it.scom && it.scom_sale ? it.scom - it.scom_sale : null;
          return (
            <tr key={it.id} className="border-b last:border-b-0">
              <td className="px-3 py-2 font-mono text-xs">
                <Link
                  to={`/products/${encodeURIComponent(it.mpn)}`}
                  className="text-blue-700 hover:underline"
                >
                  {it.mpn}
                </Link>
              </td>
              <td className="px-3 py-2">{it.brand || "—"}</td>
              <td className="px-3 py-2 text-right font-mono">
                {money(it.rics_retail)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {money(it.scom)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {money(it.scom_sale)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-amber-700">
                {gap !== null ? money(gap) : "—"}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {pct(it.web_gm_pct)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MapPromoTable({ items }: { items: DisparityItem[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 text-xs uppercase text-gray-600 border-b">
        <tr>
          <th className="px-3 py-2 text-left">MPN</th>
          <th className="px-3 py-2 text-left">Brand</th>
          <th className="px-3 py-2 text-right">MAP</th>
          <th className="px-3 py-2 text-right">Web Reg</th>
          <th className="px-3 py-2 text-right">Discount Cap</th>
          <th className="px-3 py-2 text-right">Web GM%</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <tr key={it.id} className="border-b last:border-b-0">
            <td className="px-3 py-2 font-mono text-xs">
              <Link
                to={`/products/${encodeURIComponent(it.mpn)}`}
                className="text-blue-700 hover:underline"
              >
                {it.mpn}
              </Link>
            </td>
            <td className="px-3 py-2">{it.brand || "—"}</td>
            <td className="px-3 py-2 text-right font-mono">
              {money(it.map_price)}
            </td>
            <td className="px-3 py-2 text-right font-mono">
              {money(it.scom)}
            </td>
            <td className="px-3 py-2 text-right font-mono">
              {it.web_discount_cap !== undefined && it.web_discount_cap !== null
                ? `${it.web_discount_cap}%`
                : "—"}
            </td>
            <td className="px-3 py-2 text-right font-mono">
              {pct(it.web_gm_pct)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ChannelDisparityPage() {
  const [data, setData] = useState<ChannelDisparityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [slice, setSlice] = useState<SliceKey>("store_sale_web_full");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchChannelDisparity();
        setData(res);
      } catch (e: any) {
        setError(e?.message || "Failed to load channel disparity");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;
  if (!data) return null;

  const items = data[slice];
  const meta = SLICE_META[slice];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Channel Disparity Report
        </h1>
        <p className="text-sm text-gray-600">
          Identify pricing imbalances across store and web channels.
          {data.scoped && (
            <span className="ml-2 text-xs text-gray-500">
              (scoped to your products)
            </span>
          )}
        </p>
      </div>

      {/* Slice tabs */}
      <div className="flex gap-2">
        {(Object.keys(SLICE_META) as SliceKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setSlice(k)}
            className={`px-3 py-2 text-sm rounded border ${
              slice === k
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {SLICE_META[k].label}{" "}
            <span
              className={`ml-1 text-xs ${
                slice === k ? "text-blue-100" : "text-gray-500"
              }`}
            >
              ({data.counts[k]})
            </span>
          </button>
        ))}
      </div>

      <div className="bg-white border rounded">
        <div className="p-4 border-b">
          <h2 className="text-sm font-semibold text-gray-900">
            {meta.title}{" "}
            <span className="text-gray-500 font-normal">
              ({items.length} product{items.length === 1 ? "" : "s"})
            </span>
          </h2>
          <p className="text-xs text-gray-600 mt-1">{meta.blurb}</p>
        </div>
        {items.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">
            No products in this slice.
          </div>
        ) : (
          <>
            {slice === "store_sale_web_full" && (
              <StoreSaleWebFullTable items={items} />
            )}
            {slice === "web_sale_store_full" && (
              <WebSaleStoreFullTable items={items} />
            )}
            {slice === "map_promo_eligible" && (
              <MapPromoTable items={items} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
