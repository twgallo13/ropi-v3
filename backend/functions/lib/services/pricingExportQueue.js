"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueForPricingExport = queueForPricingExport;
/**
 * Step 2.1 / TALLY-112 — Pricing Export Queue utility.
 * Queues a product for the RICS Pricing Export. Upsert — re-queueing
 * the same MPN updates the existing row with the latest pricing values.
 */
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const mpnUtils_1 = require("./mpnUtils");
async function queueForPricingExport(mpn, reason, actingUserId, effectiveDate) {
    const db = firebase_admin_1.default.firestore();
    const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
    const productDoc = await db.collection("products").doc(docId).get();
    const p = productDoc.data();
    if (!p)
        return;
    await db.collection("pricing_export_queue").doc(docId).set({
        mpn: p.mpn || mpn,
        sku: p.sku || null,
        rics_retail: p.rics_retail || 0,
        rics_offer: p.rics_offer || 0,
        scom: p.scom || 0,
        scom_sale: p.scom_sale || null,
        effective_date: effectiveDate,
        queued_at: firebase_admin_1.default.firestore.FieldValue.serverTimestamp(),
        queued_by: actingUserId,
        queued_reason: reason,
        exported_at: null,
        export_job_id: null,
    }, { merge: true });
}
//# sourceMappingURL=pricingExportQueue.js.map