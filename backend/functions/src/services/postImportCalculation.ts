/**
 * Post-Import Calculation Job — TALLY-019
 * Fires after every successful Weekly Operations Import commit.
 * Calculates STR%, WOS, GM% for every product in the import batch.
 */
import admin from "firebase-admin";
import { mpnToDocId } from "./mpnUtils";
import { AdminSettings } from "./adminSettings";

const db = admin.firestore;

export async function runPostImportCalculations(
  batchId: string,
  mpns: string[],
  settings: AdminSettings
): Promise<{ calculated: number; skipped: number }> {
  const firestore = admin.firestore();
  let calculated = 0;
  let skipped = 0;

  for (const mpn of mpns) {
    const docId = mpnToDocId(mpn);
    const doc = await firestore.collection("products").doc(docId).get();
    if (!doc.exists) {
      skipped++;
      continue;
    }
    const product = doc.data()!;

    // STR% = Units Sold ÷ (Units Sold + Units On Hand) × 100
    // Sales window from admin_settings.str_calculation_window_days (default 30)
    const unitsSold = (product.sales_store || 0) + (product.sales_web || 0);
    const unitsOnHand =
      (product.inventory_store || 0) +
      (product.inventory_warehouse || 0) +
      (product.inventory_whs || 0);
    const strPct =
      unitsSold + unitsOnHand > 0
        ? (unitsSold / (unitsSold + unitsOnHand)) * 100
        : 0;

    // WOS = Total Inventory ÷ Average Weekly Sales
    // Trailing window from admin_settings.wos_trailing_average_days (default 30)
    const avgWeeklySales = unitsSold / (settings.str_calculation_window_days / 7);
    const wos = avgWeeklySales > 0 ? unitsOnHand / avgWeeklySales : null;

    // GM% — store and web separately (Section 19.7 Bug #7 fix)
    const cost =
      product.actual_cost ||
      product.rics_retail * settings.estimated_cost_multiplier;
    const storeGmPct =
      product.rics_offer > 0
        ? ((product.rics_offer - cost) / product.rics_offer) * 100
        : null;
    const webGmPct =
      product.scom_sale > 0
        ? ((product.scom_sale - cost) / product.scom_sale) * 100
        : null;

    // Slow Moving flag (TALLY-087)
    const isSlowMoving =
      strPct < settings.slow_moving_str_threshold ||
      (wos !== null && wos > settings.slow_moving_wos_threshold);

    await firestore
      .collection("products")
      .doc(docId)
      .set(
        {
          str_pct: strPct,
          wos,
          store_gm_pct: storeGmPct,
          web_gm_pct: webGmPct,
          is_slow_moving: isSlowMoving,
          metrics_calculated_at: db.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    calculated++;
  }

  return { calculated, skipped };
}

/**
 * Sales-import-driven metric recompute.
 *
 * Triggered after a Sales Import (web or store) commits.
 * Combines web + store sales fields stamped on the product document with
 * current inventory to recompute STR%, WOS, and weekly_sales_rate.
 *
 * Brief formulas:
 *   STR% = totalSales30d / (totalInventory + totalSales30d) * 100
 *   weeklySalesRate = totalSales7d > 0 ? totalSales7d : (totalSales30d / 4)
 *   WOS  = totalInventory / weeklySalesRate  (null if rate is 0)
 *
 * Values are rounded to 1 decimal place.
 */
export async function recomputeSalesMetrics(
  mpns: string[]
): Promise<{ calculated: number; skipped: number }> {
  const firestore = admin.firestore();
  let calculated = 0;
  let skipped = 0;

  for (const mpn of mpns) {
    const docId = mpnToDocId(mpn);
    const ref = firestore.collection("products").doc(docId);
    const snap = await ref.get();
    if (!snap.exists) {
      skipped++;
      continue;
    }
    const p = snap.data()!;

    const totalInventory =
      (p.inventory_store || 0) +
      (p.inventory_warehouse || 0) +
      (p.inventory_whs || 0);
    const totalSales30d = (p.web_sales_30d || 0) + (p.store_sales_30d || 0);
    const totalSales7d = (p.web_sales_7d || 0) + (p.store_sales_7d || 0);

    const strPct =
      totalSales30d > 0
        ? (totalSales30d / (totalInventory + totalSales30d)) * 100
        : 0;

    const weeklySalesRate =
      totalSales7d > 0 ? totalSales7d : totalSales30d / 4;
    const wos =
      weeklySalesRate > 0 ? totalInventory / weeklySalesRate : null;

    await ref.set(
      {
        str_pct: Math.round(strPct * 10) / 10,
        wos: wos !== null ? Math.round(wos * 10) / 10 : null,
        weekly_sales_rate: Math.round(weeklySalesRate * 10) / 10,
        metrics_calculated_at: db.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    calculated++;
  }

  return { calculated, skipped };
}
