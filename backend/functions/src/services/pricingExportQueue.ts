/**
 * Step 2.1 / TALLY-112 — Pricing Export Queue utility.
 * Queues a product for the RICS Pricing Export. Upsert — re-queueing
 * the same MPN updates the existing row with the latest pricing values.
 */
import admin from "firebase-admin";
import { mpnToDocId } from "./mpnUtils";

export type PricingExportReason =
  | "buyer_markdown"
  | "scom_edit"
  | "map_change"
  | "cadence"
  | "map_removal";

export async function queueForPricingExport(
  mpn: string,
  reason: PricingExportReason,
  actingUserId: string,
  effectiveDate: string | null
): Promise<void> {
  const db = admin.firestore();
  const docId = mpnToDocId(mpn);
  const productDoc = await db.collection("products").doc(docId).get();
  const p = productDoc.data();
  if (!p) return;

  await db.collection("pricing_export_queue").doc(docId).set(
    {
      mpn: p.mpn || mpn,
      sku: p.sku || null,
      rics_retail: p.rics_retail || 0,
      rics_offer: p.rics_offer || 0,
      scom: p.scom || 0,
      scom_sale: p.scom_sale || null,
      effective_date: effectiveDate,
      queued_at: admin.firestore.FieldValue.serverTimestamp(),
      queued_by: actingUserId,
      queued_reason: reason,
      exported_at: null,
      export_job_id: null,
    },
    { merge: true }
  );
}
