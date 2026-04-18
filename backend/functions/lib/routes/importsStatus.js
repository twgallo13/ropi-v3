"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// routes/importsStatus.ts
//
// Shared status endpoints for the async import pipeline:
//   GET /api/v1/imports/status/:batch_id   → current progress for one batch
//   GET /api/v1/imports/active             → batches still processing for caller
//
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.get("/status/:batch_id", auth_1.requireAuth, async (req, res) => {
    const { batch_id } = req.params;
    try {
        const doc = await firebase_admin_1.default
            .firestore()
            .collection("import_batches")
            .doc(batch_id)
            .get();
        if (!doc.exists) {
            res.status(404).json({ error: "Batch not found" });
            return;
        }
        const d = doc.data() || {};
        res.status(200).json({
            batch_id,
            status: d.status || "unknown",
            import_type: d.import_type || d.family || null,
            row_count: d.row_count || 0,
            committed_rows: d.committed_rows || 0,
            failed_rows: d.failed_rows || 0,
            skipped_rows: d.skipped_rows || 0,
            progress_pct: d.progress_pct || 0,
            completed_at: d.completed_at || null,
            error_message: d.error_message || null,
        });
    }
    catch (err) {
        console.error("status lookup failed:", err);
        res.status(500).json({ error: "Failed to fetch import status" });
    }
});
router.get("/active", auth_1.requireAuth, async (req, res) => {
    const uid = req.user?.uid;
    try {
        const snap = await firebase_admin_1.default
            .firestore()
            .collection("import_batches")
            .where("status", "==", "processing")
            .limit(50)
            .get();
        const jobs = snap.docs
            .map((d) => {
            const x = d.data();
            return {
                batch_id: d.id,
                status: x.status,
                import_type: x.import_type || x.family || null,
                row_count: x.row_count || 0,
                committed_rows: x.committed_rows || 0,
                failed_rows: x.failed_rows || 0,
                skipped_rows: x.skipped_rows || 0,
                progress_pct: x.progress_pct || 0,
                uploaded_by: x.uploaded_by || null,
                processing_started_at: x.processing_started_at || null,
            };
        })
            // Surface caller's jobs first, but include peers so an analyst can see
            // a teammate's import is still running.
            .sort((a, b) => {
            const aMine = a.uploaded_by === uid ? 0 : 1;
            const bMine = b.uploaded_by === uid ? 0 : 1;
            return aMine - bMine;
        });
        res.status(200).json({ jobs });
    }
    catch (err) {
        console.error("active lookup failed:", err);
        res.status(500).json({ error: "Failed to fetch active import jobs" });
    }
});
router.post("/cancel/:batch_id", auth_1.requireAuth, async (req, res) => {
    const { batch_id } = req.params;
    try {
        const ref = firebase_admin_1.default.firestore().collection("import_batches").doc(batch_id);
        const doc = await ref.get();
        if (!doc.exists) {
            res.status(404).json({ error: "Batch not found" });
            return;
        }
        const current = doc.data()?.status;
        if (current === "complete" || current === "failed" || current === "cancelled") {
            res.status(400).json({ error: `Cannot cancel \u2014 job is already ${current}` });
            return;
        }
        await ref.set({
            status: "cancelled",
            cancelled_at: firebase_admin_1.default.firestore.FieldValue.serverTimestamp(),
            cancelled_by: req.user?.uid || null,
            completed_at: firebase_admin_1.default.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.status(200).json({ ok: true, batch_id, status: "cancelled" });
    }
    catch (err) {
        console.error("cancel failed:", err);
        res.status(500).json({ error: "Failed to cancel import" });
    }
});
exports.default = router;
//# sourceMappingURL=importsStatus.js.map