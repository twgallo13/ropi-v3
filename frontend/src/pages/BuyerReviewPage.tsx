/**
 * Track 3 Cockpit V1 — BuyerReviewPage shell.
 * TALLY-146 PR 2 — adds CockpitSelectionProvider, sticky BulkActionBar, and
 * universal CockpitDrawer wiring (j/k queue navigation on the cadence tab).
 *
 * Composes:
 *   - ViewAsBar (sets X-View-As-Uid via localStorage; triggers re-fetch)
 *   - KpiHeader (5 tiles)
 *   - CockpitTabs (sticky)
 *   - BulkActionBar (sticky directly under tabs; per-tab actions)
 *   - CockpitCadenceSection / CockpitMapSection / CockpitPricingSection
 *   - CockpitDrawer (right-anchored, opens on row click; cadence tab only)
 *
 * readOnly = !meta.can_write — disables write actions when an unprivileged
 * caller is viewing-as another user.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchCockpit } from "../lib/api";
import type { CockpitResponse, CadenceReviewItem } from "../lib/api";
import KpiHeader from "../components/cockpit/KpiHeader";
import ViewAsBar from "../components/cockpit/ViewAsBar";
import CockpitTabs from "../components/cockpit/CockpitTabs";
import CockpitCadenceSection from "../components/cockpit/CockpitCadenceSection";
import CockpitMapSection from "../components/cockpit/CockpitMapSection";
import CockpitPricingSection from "../components/cockpit/CockpitPricingSection";
import BulkActionBar from "../components/cockpit/BulkActionBar";
import CockpitDrawer from "../components/cockpit/CockpitDrawer";
import {
  CockpitSelectionProvider,
  type CockpitTabId,
} from "../components/cockpit/cockpitSelection";

export default function BuyerReviewPage() {
  const [data, setData] = useState<CockpitResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // TALLY-165 — initial tab honors ?tab=cadence|map|pricing so deep links from
  // the Dashboard KPI tiles and legacy /pricing-discrepancy /cadence-review
  // redirects land on the correct tab inside Buyer Cockpit.
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab: CockpitTabId = (() => {
    const t = searchParams.get("tab");
    return t === "map" || t === "pricing" || t === "cadence" ? t : "cadence";
  })();
  const [activeTab, setActiveTab] = useState<CockpitTabId>(initialTab);
  // Keep the URL ?tab=... in sync with user clicks on the tab strip.
  const handleTabChange = useCallback(
    (next: CockpitTabId) => {
      setActiveTab(next);
      const sp = new URLSearchParams(searchParams);
      sp.set("tab", next);
      setSearchParams(sp, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const [drawerMpn, setDrawerMpn] = useState<string | null>(null);
  // TALLY-158 Phase 1.6 — optimistic per-mpn removal from the cadence queue.
  // On successful Approve/Deny/Hold the row is dropped locally before the
  // refetch lands, preventing the stale row from being clicked again and
  // triggering a follow-on 400 against an already-transitioned item.
  const [removedCadenceMpns, setRemovedCadenceMpns] = useState<Set<string>>(
    () => new Set(),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchCockpit();
      setData(d);
      // Fresh server truth lands — clear local optimistic removals so the
      // queue reflects the canonical cadence response.
      setRemovedCadenceMpns(new Set());
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

  // Drawer queue = current cadence items (already in their displayed order).
  // PR 2 surfaces the drawer on the cadence tab (the only tab with the full
  // CadenceReviewItem shape and Approve/Deny/Hold per-item flow).
  const cadenceQueue: CadenceReviewItem[] = useMemo(
    () =>
      data
        ? (data.cadence as CadenceReviewItem[]).filter(
            (i) => !removedCadenceMpns.has(i.mpn),
          )
        : [],
    [data, removedCadenceMpns],
  );

  // TALLY-158 Phase 1.6 — onAction handler for the cadence queue. Optimistically
  // drops the acted mpn from the local list, then triggers the existing refetch
  // so server truth reconciles shortly after.
  const handleCadenceAction = useCallback(
    (mpn?: string) => {
      if (mpn) {
        setRemovedCadenceMpns((prev) => {
          const next = new Set(prev);
          next.add(mpn);
          return next;
        });
        // If the drawer is open on the acted item, close it so the user is
        // not left looking at a stale detail view.
        setDrawerMpn((cur) => (cur === mpn ? null : cur));
      }
      load();
    },
    [load],
  );
  const drawerItem = useMemo(
    () => cadenceQueue.find((i) => i.mpn === drawerMpn) ?? null,
    [cadenceQueue, drawerMpn],
  );

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
    <CockpitSelectionProvider>
      <div className="p-4 max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold mb-3">Buyer Cockpit</h1>
        <ViewAsBar meta={data.meta} onChange={load} />
        <KpiHeader kpis={data.kpis} />

        {/* Sticky tab strip (PR 2: sticky top:0 so tabs stay visible during scroll). */}
        <div className="sticky top-0 z-20 bg-white">
          <CockpitTabs<CockpitTabId>
            tabs={[
              { id: "cadence", label: "Cadence Review", count: data.cadence.length },
              { id: "map", label: "MAP Conflicts", count: data.map.length },
              { id: "pricing", label: "Pricing Discrepancies", count: data.pricing.length },
            ]}
            active={activeTab}
            onChange={handleTabChange}
          />
        </div>

        {/* Sticky bulk action bar — directly under tabs (Marge binding). */}
        <BulkActionBar activeTab={activeTab} readOnly={readOnly} onCommitted={load} />

        {activeTab === "cadence" && (
          <CockpitCadenceSection
            items={cadenceQueue}
            readOnly={readOnly}
            onAction={handleCadenceAction}
            onOpenDrawer={setDrawerMpn}
          />
        )}
        {activeTab === "map" && (
          <CockpitMapSection items={data.map} readOnly={readOnly} onAction={load} />
        )}
        {activeTab === "pricing" && (
          <CockpitPricingSection items={data.pricing} readOnly={readOnly} onAction={load} />
        )}

        <CockpitDrawer
          open={drawerMpn !== null && drawerItem !== null}
          item={drawerItem}
          queue={cadenceQueue}
          readOnly={readOnly}
          onClose={() => setDrawerMpn(null)}
          onNavigate={(next) => setDrawerMpn(next)}
          onActionComplete={load}
        />
      </div>
    </CockpitSelectionProvider>
  );
}
