"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Advisory — Step 3.4
 *   GET  /latest                        — latest report for current user (+ global if exec)
 *   GET  /history                       — last N reports for current user
 *   POST /mark-read/:report_id          — mark report read (owner of report only)
 *
 * Manual trigger endpoint lives under /api/v1/executive/jobs/weekly-advisory
 * so it sits alongside the other executive job triggers.
 */
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const db = () => firebase_admin_1.default.firestore();
const ts = () => firebase_admin_1.default.firestore.FieldValue.serverTimestamp();
async function resolveRole(req) {
    const claim = req.user?.role;
    if (claim)
        return claim;
    const uid = req.user?.uid;
    if (!uid)
        return null;
    try {
        const doc = await db().collection("users").doc(uid).get();
        return doc.data()?.role || null;
    }
    catch {
        return null;
    }
}
function serialize(doc) {
    const data = doc.data();
    if (!data)
        return null;
    return {
        ...data,
        report_id: doc.id,
        generated_at: data.generated_at?.toDate?.()?.toISOString?.() || null,
        read_at: data.read_at?.toDate?.()?.toISOString?.() || null,
    };
}
// ─────────────────────────────────────────────────────────────
// GET /latest
// ─────────────────────────────────────────────────────────────
router.get("/latest", auth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        if (!uid) {
            res.status(401).json({ error: "Authentication required" });
            return;
        }
        const role = await resolveRole(req);
        const isExec = role === "admin" || role === "owner" || role === "head_buyer";
        // My own latest
        const mySnap = await db()
            .collection("weekly_advisory_reports")
            .where("buyer_uid", "==", uid)
            .orderBy("generated_at", "desc")
            .limit(1)
            .get();
        const myReport = mySnap.empty ? null : serialize(mySnap.docs[0]);
        let globalReport = null;
        let buyerReports = [];
        if (isExec) {
            const gSnap = await db()
                .collection("weekly_advisory_reports")
                .where("buyer_uid", "==", "global")
                .orderBy("generated_at", "desc")
                .limit(1)
                .get();
            globalReport = gSnap.empty ? null : serialize(gSnap.docs[0]);
            // Pull sibling buyer reports for the same import_batch_id (if any)
            const batchId = globalReport?.import_batch_id;
            if (batchId) {
                const bSnap = await db()
                    .collection("weekly_advisory_reports")
                    .where("import_batch_id", "==", batchId)
                    .get();
                buyerReports = bSnap.docs
                    .map((d) => serialize(d))
                    .filter((r) => r && r.buyer_uid !== "global");
            }
        }
        res.json({
            report: myReport,
            global_report: globalReport,
            buyer_reports: buyerReports,
            is_exec: isExec,
        });
    }
    catch (err) {
        console.error("GET /advisory/latest error:", err);
        res.status(500).json({ error: "Failed to load latest advisory." });
    }
});
// ─────────────────────────────────────────────────────────────
// GET /history
// ─────────────────────────────────────────────────────────────
router.get("/history", auth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        if (!uid) {
            res.status(401).json({ error: "Authentication required" });
            return;
        }
        const limitRaw = Number(req.query.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 50
            ? limitRaw
            : 4;
        const snap = await db()
            .collection("weekly_advisory_reports")
            .where("buyer_uid", "==", uid)
            .orderBy("generated_at", "desc")
            .limit(limit)
            .get();
        res.json({
            reports: snap.docs.map((d) => serialize(d)),
        });
    }
    catch (err) {
        console.error("GET /advisory/history error:", err);
        res.status(500).json({ error: "Failed to load advisory history." });
    }
});
// ─────────────────────────────────────────────────────────────
// POST /mark-read/:report_id
// ─────────────────────────────────────────────────────────────
router.post("/mark-read/:report_id", auth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        if (!uid) {
            res.status(401).json({ error: "Authentication required" });
            return;
        }
        const { report_id } = req.params;
        const ref = db().collection("weekly_advisory_reports").doc(report_id);
        const snap = await ref.get();
        if (!snap.exists) {
            res.status(404).json({ error: "Report not found" });
            return;
        }
        const data = snap.data();
        const role = await resolveRole(req);
        const isExec = role === "admin" || role === "owner" || role === "head_buyer";
        const ownsIt = data.buyer_uid === uid;
        const canReadGlobal = data.buyer_uid === "global" && isExec;
        if (!ownsIt && !canReadGlobal) {
            res.status(403).json({ error: "Cannot modify another user's report" });
            return;
        }
        await ref.set({ read_by_buyer: true, read_at: ts() }, { merge: true });
        res.json({ report_id, read_by_buyer: true });
    }
    catch (err) {
        console.error("POST /advisory/mark-read error:", err);
        res.status(500).json({ error: "Failed to mark read." });
    }
});
exports.default = router;
//# sourceMappingURL=advisory.js.map