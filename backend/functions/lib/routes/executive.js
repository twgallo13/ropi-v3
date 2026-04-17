"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Executive endpoints — Step 3.2
 *   GET /api/v1/executive/health              — Executive Dashboard composite
 *   GET /api/v1/executive/neglected           — Neglected Inventory projection
 *   GET /api/v1/executive/throughput          — Operator Throughput by week
 *   GET /api/v1/executive/channel-disparity   — three pre-flagged slices
 *   POST /api/v1/executive/jobs/weekly-snapshots    — manual trigger (admin)
 *   POST /api/v1/executive/jobs/neglected-inventory — manual trigger (admin)
 *
 * Correction 1 — channel-disparity reads use native flag queries + .select().
 * Correction 2 — counts use .count() aggregation.
 * Correction 3 — long-running work is streamed (see executiveProjections.ts).
 *
 * Access: admin + head_buyer for dashboard + neglected + throughput.
 *         channel-disparity permits buyers (own-scope filter applied).
 */
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const roles_1 = require("../middleware/roles");
const executiveProjections_1 = require("../services/executiveProjections");
const router = (0, express_1.Router)();
const db = () => firebase_admin_1.default.firestore();
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
// ─────────────────────────────────────────────────────────────
// GET /api/v1/executive/health
// ─────────────────────────────────────────────────────────────
router.get("/health", auth_1.requireAuth, (0, roles_1.requireRole)(["head_buyer"]), async (_req, res) => {
    try {
        const health = await (0, executiveProjections_1.buildExecutiveHealth)();
        res.status(200).json(health);
    }
    catch (err) {
        console.error("executive/health error:", err);
        res
            .status(500)
            .json({ error: "Unable to build executive health. Please try again." });
    }
});
// ─────────────────────────────────────────────────────────────
// GET /api/v1/executive/neglected
// ─────────────────────────────────────────────────────────────
router.get("/neglected", auth_1.requireAuth, (0, roles_1.requireRole)(["head_buyer", "buyer"]), async (req, res) => {
    try {
        const role = await resolveRole(req);
        const uid = req.user?.uid || null;
        const scope = req.query.scope || null;
        const snap = await db()
            .collection("executive_projections")
            .doc("neglected_inventory")
            .get();
        if (!snap.exists) {
            res.status(200).json({
                computed_at: null,
                items: [],
                total_count: 0,
                scoped: false,
            });
            return;
        }
        const data = snap.data() || {};
        let items = Array.isArray(data.items) ? data.items : [];
        let scoped = false;
        // Buyers see own-scope only; admin/head_buyer may narrow via ?scope=<uid>
        if (role === "buyer") {
            items = items.filter((it) => it.buyer_id && it.buyer_id === uid);
            scoped = true;
        }
        else if (scope) {
            items = items.filter((it) => it.buyer_id === scope);
            scoped = true;
        }
        res.status(200).json({
            computed_at: data.computed_at || null,
            thresholds: data.thresholds || null,
            items,
            total_count: items.length,
            scoped,
        });
    }
    catch (err) {
        console.error("executive/neglected error:", err);
        res.status(500).json({
            error: "Unable to load neglected inventory. Please try again.",
        });
    }
});
// ─────────────────────────────────────────────────────────────
// GET /api/v1/executive/throughput
// ─────────────────────────────────────────────────────────────
router.get("/throughput", auth_1.requireAuth, (0, roles_1.requireRole)(["head_buyer"]), async (req, res) => {
    try {
        const weekKey = req.query.week_key || (0, executiveProjections_1.getWeekKey)(new Date());
        const snap = await db()
            .collection("operator_throughput")
            .where("week_key", "==", weekKey)
            .get();
        const byOperator = {};
        snap.forEach((doc) => {
            const d = doc.data();
            const uid = d.operator_uid || "unknown";
            if (!byOperator[uid]) {
                byOperator[uid] = {
                    uid,
                    name: d.operator_name || uid,
                    count: 0,
                    departments: {},
                };
            }
            byOperator[uid].count++;
            const dept = d.department || "Unknown";
            byOperator[uid].departments[dept] =
                (byOperator[uid].departments[dept] || 0) + 1;
        });
        const operators = Object.values(byOperator).sort((a, b) => b.count - a.count);
        const total = operators.reduce((s, o) => s + o.count, 0);
        res.status(200).json({
            week_key: weekKey,
            total_completions: total,
            operators,
        });
    }
    catch (err) {
        console.error("executive/throughput error:", err);
        res
            .status(500)
            .json({ error: "Unable to load operator throughput. Please try again." });
    }
});
// ─────────────────────────────────────────────────────────────
// GET /api/v1/executive/channel-disparity
// Correction 1 — flag-based queries with .select() projection.
// ─────────────────────────────────────────────────────────────
router.get("/channel-disparity", auth_1.requireAuth, (0, roles_1.requireRole)(["buyer", "head_buyer"]), async (req, res) => {
    try {
        const role = await resolveRole(req);
        const uid = req.user?.uid || null;
        let storeSaleQ = db()
            .collection("products")
            .where("is_store_sale_web_full", "==", true)
            .where("completion_state", "==", "complete")
            .select("mpn", "name", "brand", "department", "buyer_id", "rics_retail", "rics_offer", "scom", "scom_sale", "web_gm_pct");
        let webSaleQ = db()
            .collection("products")
            .where("is_web_sale_store_full", "==", true)
            .where("completion_state", "==", "complete")
            .select("mpn", "name", "brand", "department", "buyer_id", "rics_retail", "rics_offer", "scom", "scom_sale", "web_gm_pct");
        const mapPromoQ = db()
            .collection("products")
            .where("is_map_protected", "==", true)
            .select("mpn", "name", "brand", "department", "buyer_id", "map_price", "scom", "web_discount_cap", "web_gm_pct");
        const [a, b, c] = await Promise.all([
            storeSaleQ.get(),
            webSaleQ.get(),
            mapPromoQ.get(),
        ]);
        const toItems = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        let storeSaleWebFull = toItems(a);
        let webSaleStoreFull = toItems(b);
        // Filter map_promo_eligible in-memory — web_discount_cap is a sparse field;
        // a Firestore != null inequality query requires its own composite index
        // and behaves unexpectedly when the field is missing on most documents.
        let mapPromoEligible = toItems(c).filter((x) => x.web_discount_cap !== null && x.web_discount_cap !== undefined);
        // Buyer own-scope filter
        if (role === "buyer" && uid) {
            storeSaleWebFull = storeSaleWebFull.filter((x) => x.buyer_id === uid);
            webSaleStoreFull = webSaleStoreFull.filter((x) => x.buyer_id === uid);
            mapPromoEligible = mapPromoEligible.filter((x) => x.buyer_id === uid);
        }
        res.status(200).json({
            store_sale_web_full: storeSaleWebFull,
            web_sale_store_full: webSaleStoreFull,
            map_promo_eligible: mapPromoEligible,
            counts: {
                store_sale_web_full: storeSaleWebFull.length,
                web_sale_store_full: webSaleStoreFull.length,
                map_promo_eligible: mapPromoEligible.length,
            },
            scoped: role === "buyer",
        });
    }
    catch (err) {
        console.error("executive/channel-disparity error:", err);
        res.status(500).json({
            error: "Unable to load channel disparity report. Please try again.",
        });
    }
});
// ─────────────────────────────────────────────────────────────
// Job triggers — admin only
// ─────────────────────────────────────────────────────────────
router.post("/jobs/weekly-snapshots", auth_1.requireAuth, (0, roles_1.requireRole)(["admin"]), async (_req, res) => {
    try {
        const result = await (0, executiveProjections_1.writeWeeklySnapshots)();
        res.status(200).json({ ok: true, ...result });
    }
    catch (err) {
        console.error("jobs/weekly-snapshots error:", err);
        res.status(500).json({ error: "Job failed." });
    }
});
router.post("/jobs/neglected-inventory", auth_1.requireAuth, (0, roles_1.requireRole)(["admin"]), async (_req, res) => {
    try {
        const result = await (0, executiveProjections_1.computeNeglectedInventory)();
        res.status(200).json({ ok: true, ...result });
    }
    catch (err) {
        console.error("jobs/neglected-inventory error:", err);
        res.status(500).json({ error: "Job failed." });
    }
});
exports.default = router;
//# sourceMappingURL=executive.js.map