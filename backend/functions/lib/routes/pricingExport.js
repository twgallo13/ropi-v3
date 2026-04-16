"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Pricing Export (RICS) — Step 2.1 Part 6 (TALLY-112).
 *   GET  /queue              — list queued items for UI
 *   POST /trigger            — build 7-column CSV, upload to Storage, mark queue items exported
 */
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const json2csv_1 = require("json2csv");
const auth_1 = require("../middleware/auth");
const roles_1 = require("../middleware/roles");
const router = (0, express_1.Router)();
const db = () => firebase_admin_1.default.firestore();
const ts = () => firebase_admin_1.default.firestore.FieldValue.serverTimestamp();
// ── GET /queue — queued + not-yet-exported ──
router.get("/queue", auth_1.requireAuth, async (_req, res) => {
    try {
        const snap = await db()
            .collection("pricing_export_queue")
            .where("exported_at", "==", null)
            .get();
        const items = snap.docs.map((d) => {
            const q = d.data();
            return {
                id: d.id,
                mpn: q.mpn,
                sku: q.sku || null,
                rics_retail: q.rics_retail || 0,
                rics_offer: q.rics_offer || 0,
                scom: q.scom || 0,
                scom_sale: q.scom_sale ?? null,
                effective_date: q.effective_date ?? null,
                queued_reason: q.queued_reason || null,
                queued_at: q.queued_at?.toDate?.()?.toISOString() || null,
            };
        });
        res.json({ items, total: items.length });
    }
    catch (err) {
        console.error("GET /exports/pricing/queue error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ── POST /trigger — produce 7-column CSV ──
router.post("/trigger", auth_1.requireAuth, (0, roles_1.requireRole)(["operations_operator"]), async (req, res) => {
    const userId = req.user?.uid;
    if (!userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
    }
    let jobRef;
    try {
        jobRef = await db().collection("pricing_export_jobs").add({
            status: "processing",
            triggered_by: userId,
            triggered_at: ts(),
            item_count: 0,
        });
    }
    catch (err) {
        console.error("create pricing_export_jobs failed:", err);
        res.status(500).json({ error: err.message });
        return;
    }
    try {
        const snap = await db()
            .collection("pricing_export_queue")
            .where("exported_at", "==", null)
            .get();
        const rows = snap.docs.map((d) => {
            const q = d.data();
            return {
                mpn: q.mpn || "",
                sku: q.sku ?? "",
                rics_retail: q.rics_retail ?? 0,
                rics_offer: q.rics_offer ?? 0,
                scom: q.scom ?? 0,
                scom_sale: q.scom_sale ?? "",
                effective_date: q.effective_date ?? "",
            };
        });
        const fields = [
            "mpn",
            "sku",
            "rics_retail",
            "rics_offer",
            "scom",
            "scom_sale",
            "effective_date",
        ];
        const csv = (0, json2csv_1.parse)(rows, { fields });
        const filename = `exports/pricing/${Date.now()}_pricing_export.csv`;
        const bucket = firebase_admin_1.default.storage().bucket();
        const file = bucket.file(filename);
        await file.save(csv, { contentType: "text/csv" });
        await file.makePublic();
        const downloadUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(filename)}`;
        // Mark all queued items as exported
        for (const doc of snap.docs) {
            await doc.ref.set({
                exported_at: ts(),
                export_job_id: jobRef.id,
            }, { merge: true });
        }
        await jobRef.update({
            status: "complete",
            completed_at: ts(),
            item_count: rows.length,
            output_file: filename,
            download_url: downloadUrl,
        });
        await db().collection("audit_log").add({
            event_type: "pricing_export_triggered",
            triggered_by: userId,
            job_id: jobRef.id,
            item_count: rows.length,
            created_at: ts(),
        });
        res.json({
            job_id: jobRef.id,
            status: "complete",
            item_count: rows.length,
            output_file: filename,
            download_url: downloadUrl,
        });
    }
    catch (err) {
        console.error("POST /exports/pricing/trigger error:", err);
        try {
            await jobRef.update({
                status: "failed",
                completed_at: ts(),
                error_message: err.message,
            });
        }
        catch (_) {
            // best effort
        }
        res.status(500).json({ error: err.message, job_id: jobRef.id });
    }
});
// ── GET /jobs — past pricing export jobs ──
router.get("/jobs", auth_1.requireAuth, async (_req, res) => {
    try {
        const snap = await db()
            .collection("pricing_export_jobs")
            .orderBy("triggered_at", "desc")
            .limit(50)
            .get();
        const jobs = snap.docs.map((d) => {
            const j = d.data();
            return {
                id: d.id,
                status: j.status,
                triggered_by: j.triggered_by,
                triggered_at: j.triggered_at?.toDate?.()?.toISOString() || null,
                completed_at: j.completed_at?.toDate?.()?.toISOString() || null,
                item_count: j.item_count || 0,
                output_file: j.output_file || null,
                download_url: j.download_url || null,
            };
        });
        res.json({ jobs });
    }
    catch (err) {
        console.error("GET /exports/pricing/jobs error:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=pricingExport.js.map