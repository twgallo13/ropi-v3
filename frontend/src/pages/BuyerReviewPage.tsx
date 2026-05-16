/**
 * Track 3 Cockpit V1 — BuyerReviewPage shell.
 * TALLY-146 PR 2 — adds CockpitSelectionProvider, sticky BulkActionBar, and
 * universal CockpitDrawer wiring (j/k queue navigation on the cadence tab).
 *
 * TALLY-155 — Optimistic UI + per-row error state.
 *   - Maintains per-tab `hiddenMpns` set and `rowErrors` map (MPN → message).
 *   - Filters server data through that state before passing to sections and
 *     the drawer queue, so successful action targets disappear immediately
 *     without waiting for the background refetch to land.
 *   - On every fresh fetchCockpit() success, intersects hide/error state
 *     against fresh queue membership so stale entries don't accrete.
 *   - Children call back through hide / setError / clearError; this page
 *     owns the optimistic state machine, the sections own the toast UI.
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
import { fetchCockpit } from "../lib/api";
import type {
  CockpitResponse,
  CadenceReviewItem,
  BulkItemResult,
} from "../lib/api";
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
  useCockpitSelection,
  type CockpitTabId,
} from "../components/cockpit/cockpitSelection";

type HiddenState = Record<CockpitTabId, Set<string>>;
type ErrorState = Record<CockpitTabId, Record<string, string>>;

const EMPTY_HIDDEN: HiddenState = {
  cadence: new Set(),
  map: new Set(),
  pricing: new Set(),
};
const EMPTY_ERRORS: ErrorState = { cadence: {}, map: {}, pricing: {} };

export default function BuyerReviewPage() {
  return (
    <CockpitSelectionProvider>
      <BuyerReviewPageInner />
    </CockpitSelectionProvider>
  );
}

function BuyerReviewPageInner() {
  const [data, setData] = useState<CockpitResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CockpitTabId>("cadence");
  const [drawerMpn, setDrawerMpn] = useState<string | null>(null);
  const [hiddenMpns, setHiddenMpns] = useState<HiddenState>(EMPTY_HIDDEN);
  const [rowErrors, setRowErrors] = useState<ErrorState>(EMPTY_ERRORS);
  const sel = useCockpitSelection();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchCockpit();
      setData(d);
      // Intersect hide + error state against fresh queue membership so stale
      // local-only entries don't linger after the server-side truth changes.
      setHiddenMpns((prev) => intersectHidden(prev, d));
      setRowErrors((prev) => intersectErrors(prev, d));
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

  // ── per-row state callbacks (shared shape across all three sections) ──
  const hideRow = useCallback((tab: CockpitTabId, mpn: string) => {
    setHiddenMpns((prev) => {
      if (prev[tab].has(mpn)) return prev;
      const next = new Set(prev[tab]);
      next.add(mpn);
      return { ...prev, [tab]: next };
    });
    // Successful row → drop any prior error and clear selection so the
    // bulk bar count stays accurate.
    setRowErrors((prev) => {
      if (!(mpn in prev[tab])) return prev;
      const tabErrors = { ...prev[tab] };
      delete tabErrors[mpn];
      return { ...prev, [tab]: tabErrors };
    });
    sel.setMany(tab, [mpn], false);
  }, [sel]);

  const setRowError = useCallback(
    (tab: CockpitTabId, mpn: string, message: string) => {
      setRowErrors((prev) => ({
        ...prev,
        [tab]: { ...prev[tab], [mpn]: message },
      }));
    },
    [],
  );

  const clearRowError = useCallback((tab: CockpitTabId, mpn: string) => {
    setRowErrors((prev) => {
      if (!(mpn in prev[tab])) return prev;
      const tabErrors = { ...prev[tab] };
      delete tabErrors[mpn];
      return { ...prev, [tab]: tabErrors };
    });
  }, []);

  /**
   * Apply a bulk endpoint's per-MPN result set:
   *   - hide every "ok" row locally + clear its selection + clear any prior
   *     error;
   *   - keep every "error" row visible with its per-MPN error message and
   *     selection intact so the operator can retry.
   */
  const applyBulkResults = useCallback(
    (tab: CockpitTabId, results: BulkItemResult[]) => {
      setHiddenMpns((prev) => {
        const next = new Set(prev[tab]);
        for (const r of results) if (r.status === "ok") next.add(r.mpn);
        return { ...prev, [tab]: next };
      });
      setRowErrors((prev) => {
        const tabErrors = { ...prev[tab] };
        for (const r of results) {
          if (r.status === "ok") {
            delete tabErrors[r.mpn];
          } else {
            const code = r.error_code;
            const detail = r.error_message ?? "Action failed.";
            tabErrors[r.mpn] = code ? `${code} — ${detail}` : detail;
          }
        }
        return { ...prev, [tab]: tabErrors };
      });
      const successful = results.filter((r) => r.status === "ok").map((r) => r.mpn);
      if (successful.length > 0) sel.setMany(tab, successful, false);
    },
    [sel],
  );

  // Drawer queue = current cadence items (already in their displayed order).
  // PR 2 surfaces the drawer on the cadence tab (the only tab with the full
  // CadenceReviewItem shape and Approve/Deny/Hold per-item flow).
  const cadenceQueue: CadenceReviewItem[] = useMemo(
    () => (data ? (data.cadence as CadenceReviewItem[]) : []),
    [data],
  );
  const visibleCadence = useMemo(
    () => cadenceQueue.filter((i) => !hiddenMpns.cadence.has(i.mpn)),
    [cadenceQueue, hiddenMpns.cadence],
  );
  const visibleMap = useMemo(
    () => (data ? data.map.filter((i) => !hiddenMpns.map.has(i.mpn)) : []),
    [data, hiddenMpns.map],
  );
  const visiblePricing = useMemo(
    () => (data ? data.pricing.filter((i) => !hiddenMpns.pricing.has(i.mpn)) : []),
    [data, hiddenMpns.pricing],
  );

  const drawerItem = useMemo(
    () => visibleCadence.find((i) => i.mpn === drawerMpn) ?? null,
    [visibleCadence, drawerMpn],
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
    <div className="p-4 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-3">Buyer Cockpit</h1>
      <ViewAsBar meta={data.meta} onChange={load} />
      <KpiHeader kpis={data.kpis} />

      {/* Sticky tab strip (PR 2: sticky top:0 so tabs stay visible during scroll). */}
      <div className="sticky top-0 z-20 bg-white">
        <CockpitTabs<CockpitTabId>
          tabs={[
            { id: "cadence", label: "Cadence Review", count: visibleCadence.length },
            { id: "map", label: "MAP Conflicts", count: visibleMap.length },
            { id: "pricing", label: "Pricing Discrepancies", count: visiblePricing.length },
          ]}
          active={activeTab}
          onChange={setActiveTab}
        />
      </div>

      {/* Sticky bulk action bar — directly under tabs (Marge binding). */}
      <BulkActionBar
        activeTab={activeTab}
        readOnly={readOnly}
        onCommitted={load}
        onResults={applyBulkResults}
      />

      {activeTab === "cadence" && (
        <CockpitCadenceSection
          items={visibleCadence}
          readOnly={readOnly}
          onAction={load}
          onOpenDrawer={setDrawerMpn}
          onRowSuccess={(mpn) => hideRow("cadence", mpn)}
          onRowFailure={(mpn, msg) => setRowError("cadence", mpn, msg)}
          getRowError={(mpn) => rowErrors.cadence[mpn]}
          clearRowError={(mpn) => clearRowError("cadence", mpn)}
        />
      )}
      {activeTab === "map" && (
        <CockpitMapSection
          items={visibleMap}
          readOnly={readOnly}
          onAction={load}
          onRowSuccess={(mpn) => hideRow("map", mpn)}
          onRowFailure={(mpn, msg) => setRowError("map", mpn, msg)}
          getRowError={(mpn) => rowErrors.map[mpn]}
          clearRowError={(mpn) => clearRowError("map", mpn)}
        />
      )}
      {activeTab === "pricing" && (
        <CockpitPricingSection
          items={visiblePricing}
          readOnly={readOnly}
          onAction={load}
          onRowSuccess={(mpn) => hideRow("pricing", mpn)}
          onRowFailure={(mpn, msg) => setRowError("pricing", mpn, msg)}
          getRowError={(mpn) => rowErrors.pricing[mpn]}
          clearRowError={(mpn) => clearRowError("pricing", mpn)}
        />
      )}

      <CockpitDrawer
        open={drawerMpn !== null && drawerItem !== null}
        item={drawerItem}
        queue={visibleCadence}
        readOnly={readOnly}
        onClose={() => setDrawerMpn(null)}
        onNavigate={(next) => setDrawerMpn(next)}
        onActionComplete={load}
        onRowSuccess={(mpn) => hideRow("cadence", mpn)}
        onRowFailure={(mpn, msg) => setRowError("cadence", mpn, msg)}
        getRowError={(mpn) => rowErrors.cadence[mpn]}
        clearRowError={(mpn) => clearRowError("cadence", mpn)}
      />
    </div>
  );
}

function intersectHidden(prev: HiddenState, d: CockpitResponse): HiddenState {
  const inQueue = {
    cadence: new Set(d.cadence.map((i) => i.mpn)),
    map: new Set(d.map.map((i) => i.mpn)),
    pricing: new Set(d.pricing.map((i) => i.mpn)),
  } as const;
  return {
    cadence: new Set([...prev.cadence].filter((m) => inQueue.cadence.has(m))),
    map: new Set([...prev.map].filter((m) => inQueue.map.has(m))),
    pricing: new Set([...prev.pricing].filter((m) => inQueue.pricing.has(m))),
  };
}

function intersectErrors(prev: ErrorState, d: CockpitResponse): ErrorState {
  const inQueue = {
    cadence: new Set(d.cadence.map((i) => i.mpn)),
    map: new Set(d.map.map((i) => i.mpn)),
    pricing: new Set(d.pricing.map((i) => i.mpn)),
  } as const;
  return {
    cadence: filterRecord(prev.cadence, (m) => inQueue.cadence.has(m)),
    map: filterRecord(prev.map, (m) => inQueue.map.has(m)),
    pricing: filterRecord(prev.pricing, (m) => inQueue.pricing.has(m)),
  };
}

function filterRecord<T>(rec: Record<string, T>, keep: (k: string) => boolean): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(rec)) if (keep(k)) out[k] = rec[k];
  return out;
}
