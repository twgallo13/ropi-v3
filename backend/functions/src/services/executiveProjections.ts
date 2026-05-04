/**
 * Executive Projections — Step 3.2
 *
 * Pre-computes read-optimised projections so executive UI surfaces never run
 * raw EAV joins at query time (Section 11.8).
 *
 *   - writeWeeklySnapshots()      → metric_snapshots (catalog + per-dept GM%, STR%, products_added)
 *   - computeNeglectedInventory() → executive_projections/neglected_inventory
 *   - buildExecutiveHealth()      → composed response for GET /api/v1/executive/health
 *
 * Corrections:
 *   C2 — Count-only queries use .count() aggregation (no in-memory .size).
 *   C3 — Large collection scans use .stream(), accumulating into locals.
 */
import admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const db = () => admin.firestore();

/** ISO week key for operator throughput bucketing, e.g. "2026-W16". */
export function getWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

async function getAdminNumber(key: string, fallback: number): Promise<number> {
  try {
    const snap = await db().collection("admin_settings").doc(key).get();
    if (snap.exists) {
      const v = snap.data()?.value;
      if (typeof v === "number") return v;
    }
  } catch (_e) {
    /* fall through */
  }
  return fallback;
}

/**
 * Weekly snapshot job — fires after Weekly Operations Import commit.
 * Writes catalog + per-dept GM%, per-dept STR%, and products_added for today.
 */
export async function writeWeeklySnapshots(): Promise<{ written: number }> {
  const today = new Date().toISOString().split("T")[0];

  // Stream complete products and accumulate aggregates (C3)
  let totalGmWeighted = 0;
  let totalUnits = 0;
  let productsScanned = 0;
  const deptGm: Record<string, { weighted: number; units: number }> = {};
  const deptStr: Record<string, { total: number; count: number }> = {};

  await new Promise<void>((resolve, reject) => {
    const stream = db()
      .collection("products")
      .where("completion_state", "==", "complete")
      .stream();

    stream.on("data", (doc: any) => {
      productsScanned++;
      const p = doc.data();
      const units = (Number(p.inventory_store) || 0) + (Number(p.inventory_warehouse) || 0);
      const gm =
        typeof p.web_gm_pct === "number"
          ? p.web_gm_pct
          : typeof p.store_gm_pct === "number"
          ? p.store_gm_pct
          : null;
      const dept: string = p.department || "Unknown";

      if (units > 0 && gm !== null) {
        totalGmWeighted += gm * units;
        totalUnits += units;
        if (!deptGm[dept]) deptGm[dept] = { weighted: 0, units: 0 };
        deptGm[dept].weighted += gm * units;
        deptGm[dept].units += units;
      }

      if (typeof p.str_pct === "number") {
        if (!deptStr[dept]) deptStr[dept] = { total: 0, count: 0 };
        deptStr[dept].total += p.str_pct;
        deptStr[dept].count += 1;
      }
    });
    stream.on("end", () => resolve());
    stream.on("error", (err: Error) => reject(err));
  });

  const batch = db().batch();
  let written = 0;

  // Catalog weighted GM%
  const catalogGm = totalUnits > 0 ? totalGmWeighted / totalUnits : 0;
  const catalogRef = db().collection("metric_snapshots").doc();
  batch.set(catalogRef, {
    snapshot_id: catalogRef.id,
    snapshot_date: today,
    metric_key: "weighted_gm_pct",
    dimension: "catalog",
    dimension_type: "catalog",
    value: Math.round(catalogGm * 100) / 100,
    products_in_scope: productsScanned,
    snapshot_type: "weekly",
    created_at: FieldValue.serverTimestamp(),
  });
  written++;

  // Per-department GM%
  for (const [dept, data] of Object.entries(deptGm)) {
    const val = data.units > 0 ? data.weighted / data.units : 0;
    const ref = db().collection("metric_snapshots").doc();
    batch.set(ref, {
      snapshot_id: ref.id,
      snapshot_date: today,
      metric_key: "weighted_gm_pct",
      dimension: dept,
      dimension_type: "department",
      value: Math.round(val * 100) / 100,
      products_in_scope: data.units,
      snapshot_type: "weekly",
      created_at: FieldValue.serverTimestamp(),
    });
    written++;
  }

  // Per-department STR%
  for (const [dept, data] of Object.entries(deptStr)) {
    const val = data.count > 0 ? data.total / data.count : 0;
    const ref = db().collection("metric_snapshots").doc();
    batch.set(ref, {
      snapshot_id: ref.id,
      snapshot_date: today,
      metric_key: "avg_str_pct",
      dimension: dept,
      dimension_type: "department",
      value: Math.round(val * 100) / 100,
      products_in_scope: data.count,
      snapshot_type: "weekly",
      created_at: FieldValue.serverTimestamp(),
    });
    written++;
  }

  // Products added this month (C2 — count aggregation)
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  let added = 0;
  try {
    const agg = await db()
      .collection("products")
      .where("first_received_at", ">=", monthStart)
      .count()
      .get();
    added = agg.data().count;
  } catch (_e) {
    added = 0;
  }

  const addedRef = db().collection("metric_snapshots").doc();
  batch.set(addedRef, {
    snapshot_id: addedRef.id,
    snapshot_date: today,
    metric_key: "products_added",
    dimension: "catalog",
    dimension_type: "catalog",
    value: added,
    products_in_scope: added,
    snapshot_type: "weekly",
    created_at: FieldValue.serverTimestamp(),
  });
  written++;

  await batch.commit();
  return { written };
}

/**
 * Nightly job — rebuild executive_projections/neglected_inventory.
 */
export async function computeNeglectedInventory(): Promise<{ total_count: number }> {
  const ageThresholdDays = await getAdminNumber("neglected_age_threshold_days", 60);
  const attentionThresholdDays = await getAdminNumber(
    "neglected_attention_threshold_days",
    14
  );

  const now = Date.now();
  const ageCutoff = new Date(now - ageThresholdDays * 86400000);
  const attentionCutoff = new Date(now - attentionThresholdDays * 86400000);

  const neglected: any[] = [];

  await new Promise<void>((resolve, reject) => {
    const stream = db()
      .collection("products")
      .where("completion_state", "==", "complete")
      .where("first_received_at", "<=", ageCutoff)
      .stream();

    stream.on("data", (doc: any) => {
      const p = doc.data();
      const firstReceivedMs =
        p.first_received_at?.toMillis?.() ??
        (p.first_received_at instanceof Date ? p.first_received_at.getTime() : null);
      if (!firstReceivedMs) return;

      // last_modified_at → fall back to first_received_at
      let lastTouchMs: number;
      if (p.last_modified_at?.toMillis) {
        lastTouchMs = p.last_modified_at.toMillis();
      } else if (p.last_modified_at instanceof Date) {
        lastTouchMs = p.last_modified_at.getTime();
      } else {
        lastTouchMs = firstReceivedMs;
      }

      if (lastTouchMs > attentionCutoff.getTime()) return;

      const daysOld = Math.floor((now - firstReceivedMs) / 86400000);
      const daysSinceTouch = Math.floor((now - lastTouchMs) / 86400000);

      neglected.push({
        mpn: p.mpn,
        name: p.name || null,
        brand: p.brand || null,
        department: p.department || "Unknown",
        buyer_id: p.buyer_id || null,
        days_old: daysOld,
        days_since_touch: daysSinceTouch,
        inventory_total:
          (Number(p.inventory_store) || 0) + (Number(p.inventory_warehouse) || 0),
        str_pct: typeof p.str_pct === "number" ? p.str_pct : null,
        wos: typeof p.wos === "number" ? p.wos : null,
        store_gm_pct: typeof p.store_gm_pct === "number" ? p.store_gm_pct : null,
        neglect_score: daysOld + daysSinceTouch,
      });
    });
    stream.on("end", () => resolve());
    stream.on("error", (err: Error) => reject(err));
  });

  neglected.sort((a, b) => b.neglect_score - a.neglect_score);

  await db()
    .collection("executive_projections")
    .doc("neglected_inventory")
    .set({
      computed_at: FieldValue.serverTimestamp(),
      items: neglected,
      total_count: neglected.length,
      thresholds: {
        age_days: ageThresholdDays,
        attention_days: attentionThresholdDays,
      },
    });

  return { total_count: neglected.length };
}

export interface LossLeaderWatchlistItem {
  mpn: string;
  name: string | null;
  brand: string | null;
  rics_offer: number;
  estimated_cost: number;
  gap_amount: number;
  days_pending: number;
}

export interface ExecutiveHealth {
  products_added_this_month: number;
  products_added_last_month: number;
  gm_trend: { date: string; value: number }[];
  gm_target_pct: number;
  str_heatmap: { department: string; str_pct: number }[];
  markdown_forecast: any[];
  snapshot_freshness: string | null;
  loss_leader_products: LossLeaderWatchlistItem[];
}

export async function buildExecutiveHealth(): Promise<ExecutiveHealth> {
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  // Count-only aggregations (C2)
  const [thisMonthAgg, lastMonthAgg] = await Promise.all([
    db()
      .collection("products")
      .where("first_received_at", ">=", thisMonthStart)
      .count()
      .get(),
    db()
      .collection("products")
      .where("first_received_at", ">=", lastMonthStart)
      .where("first_received_at", "<=", lastMonthEnd)
      .count()
      .get(),
  ]);

  // 12 weeks of catalog GM% snapshots
  const twelveWeeksAgo = new Date();
  twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84);
  const twelveWeeksAgoStr = twelveWeeksAgo.toISOString().split("T")[0];

  const gmTrendSnap = await db()
    .collection("metric_snapshots")
    .where("metric_key", "==", "weighted_gm_pct")
    .where("dimension", "==", "catalog")
    .where("snapshot_date", ">=", twelveWeeksAgoStr)
    .orderBy("snapshot_date", "asc")
    .get();

  const gmTrend = gmTrendSnap.docs.map((d) => ({
    date: d.data().snapshot_date as string,
    value: d.data().value as number,
  }));

  // Latest STR% per department — dedup to most-recent
  const strSnap = await db()
    .collection("metric_snapshots")
    .where("metric_key", "==", "avg_str_pct")
    .where("dimension_type", "==", "department")
    .orderBy("snapshot_date", "desc")
    .limit(500)
    .get();

  const latestStrByDept: Record<string, number> = {};
  strSnap.forEach((doc) => {
    const d = doc.data();
    if (latestStrByDept[d.dimension] === undefined) {
      latestStrByDept[d.dimension] = d.value;
    }
  });

  // 7-day markdown forecast
  const today = now.toISOString().split("T")[0];
  const sevenDaysOut = new Date();
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
  const sevenDaysStr = sevenDaysOut.toISOString().split("T")[0];

  let markdownForecast: any[] = [];
  try {
    const scheduledSnap = await db()
      .collection("products")
      .where("pricing_domain_state", "==", "scheduled")
      .where("scheduled_effective_date", ">=", today)
      .where("scheduled_effective_date", "<=", sevenDaysStr)
      .get();

    markdownForecast = scheduledSnap.docs.map((doc) => {
      const p = doc.data();
      return {
        mpn: p.mpn,
        name: p.name || null,
        brand: p.brand || null,
        effective_date: p.scheduled_effective_date,
        current_rics_offer: p.rics_offer ?? null,
        scheduled_rics_offer: p.scheduled_rics_offer ?? null,
        gm_pct_current: p.store_gm_pct ?? null,
        gm_pct_projected: p.scheduled_gm_pct ?? null,
      };
    });
  } catch (_e) {
    // Missing composite index or field is acceptable — report empty forecast.
    markdownForecast = [];
  }

  const gmTargetPct = await getAdminNumber("gm_target_pct", 40);

  // Below-Cost Watchlist: products in loss_leader_review state, sorted by gap descending.
  let lossLeaderProducts: LossLeaderWatchlistItem[] = [];
  try {
    const llSnap = await db()
      .collection("products")
      .where("pricing_domain_state", "in", ["loss_leader_review", "Loss-Leader Review Pending"])
      .get();

    const now2 = new Date();
    lossLeaderProducts = llSnap.docs.map((doc) => {
      const p = doc.data();
      const payload = p.loss_leader_payload ?? {};
      const rics_offer: number = Number(payload.rics_offer ?? p.rics_offer ?? 0);
      const estimated_cost: number = Number(payload.cost ?? 0);
      const gap_amount: number = rics_offer - estimated_cost;
      let days_pending = 0;
      if (p.loss_leader_flagged_at) {
        const flaggedMs =
          typeof p.loss_leader_flagged_at.toDate === "function"
            ? p.loss_leader_flagged_at.toDate().getTime()
            : new Date(p.loss_leader_flagged_at).getTime();
        days_pending = Math.floor((now2.getTime() - flaggedMs) / 86_400_000);
      }
      return {
        mpn: p.mpn ?? doc.id,
        name: p.name ?? null,
        brand: p.brand ?? null,
        rics_offer,
        estimated_cost,
        gap_amount,
        days_pending,
      };
    });
    // Sort by gap_amount ascending (most below-cost first — largest negative gap first)
    lossLeaderProducts.sort((a, b) => a.gap_amount - b.gap_amount);
  } catch (_e) {
    lossLeaderProducts = [];
  }

  return {
    products_added_this_month: thisMonthAgg.data().count,
    products_added_last_month: lastMonthAgg.data().count,
    gm_trend: gmTrend,
    gm_target_pct: gmTargetPct,
    str_heatmap: Object.entries(latestStrByDept)
      .map(([department, str_pct]) => ({ department, str_pct }))
      .sort((a, b) => b.str_pct - a.str_pct),
    markdown_forecast: markdownForecast,
    snapshot_freshness: gmTrend.length > 0 ? gmTrend[gmTrend.length - 1].date : null,
    loss_leader_products: lossLeaderProducts,
  };
}
