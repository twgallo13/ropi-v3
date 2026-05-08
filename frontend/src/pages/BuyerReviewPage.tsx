/**
 * Track 3 Cockpit V1 — BuyerReviewPage shell.
 *
 * Composes:
 *   - ViewAsBar (sets X-View-As-Uid via localStorage; triggers re-fetch)
 *   - KpiHeader (5 tiles)
 *   - CockpitCadenceSection
 *   - CockpitMapSection
 *   - CockpitPricingSection
 *
 * readOnly = !meta.can_write — disables write actions when an unprivileged
 * caller is viewing-as another user.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchCockpit } from "../lib/api";
import type { CockpitResponse } from "../lib/api";
import KpiHeader from "../components/cockpit/KpiHeader";
import ViewAsBar from "../components/cockpit/ViewAsBar";
import CockpitCadenceSection from "../components/cockpit/CockpitCadenceSection";
import CockpitMapSection from "../components/cockpit/CockpitMapSection";
import CockpitPricingSection from "../components/cockpit/CockpitPricingSection";

export default function BuyerReviewPage() {
  const [data, setData] = useState<CockpitResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchCockpit();
      setData(d);
    } catch (e: any) {
      console.error("[cockpit] fetch failed:", e);
      setError(e?.error || e?.message || "Failed to load cockpit.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return <div className="p-4 text-sm text-slate-500">Loading cockpit…</div>;
  }
  if (error) {
    return (
      <div className="p-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded">
        {error}
      </div>
    );
  }
  if (!data) return null;

  const readOnly = !data.meta.can_write;

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-3">Buyer Cockpit</h1>
      <ViewAsBar meta={data.meta} onChange={load} />
      <KpiHeader kpis={data.kpis} />
      <CockpitCadenceSection items={data.cadence} readOnly={readOnly} onAction={load} />
      <CockpitMapSection items={data.map} readOnly={readOnly} onAction={load} />
      <CockpitPricingSection items={data.pricing} readOnly={readOnly} onAction={load} />
    </div>
  );
}
