"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Step 2.2 — Cadence Review + Assignments routes.
 *  GET  /api/v1/cadence-review                  — in-queue review cards
 *  GET  /api/v1/cadence-assignments/unassigned  — unassigned products
 *  POST /api/v1/cadence-assignments/:mpn/assign — manual rule assignment
 *  POST /api/v1/cadence-assignments/:mpn/exclude — exclude product from cadence
 */
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const roles_1 = require("../middleware/roles");
const mpnUtils_1 = require("../services/mpnUtils");
const router = (0, express_1.Router)();
const db = () => firebase_admin_1.default.firestore();
const ts = () => firebase_admin_1.default.firestore.FieldValue.serverTimestamp();
const buyerRoles = ["buyer", "head_buyer", "admin"];
async function getUserRole(req) {
    const claim = req.user?.role;
    if (claim)
        return claim;
    const uid = req.user?.uid;
    if (!uid)
        return null;
    const doc = await db().collection("users").doc(uid).get();
    return doc.data()?.role || null;
}
// GET /api/v1/cadence-review
router.get("/cadence-review", auth_1.requireAuth, (0, roles_1.requireRole)(buyerRoles), async (req, res) => {
    try {
        const uid = req.user.uid;
        const role = await getUserRole(req);
        // Gather owned rule ids for non-admin / non-head_buyer
        let ownedRuleIds = null;
        if (role !== "head_buyer" && role !== "admin") {
            const rulesSnap = await db()
                .collection("cadence_rules")
                .where("owner_buyer_id", "==", uid)
                .get();
            ownedRuleIds = rulesSnap.docs.map((d) => d.id);
            if (ownedRuleIds.length === 0) {
                res.json({ items: [], total: 0 });
                return;
            }
        }
        const assignSnap = await db()
            .collection("cadence_assignments")
            .where("in_buyer_queue", "==", true)
            .get();
        const items = [];
        for (const d of assignSnap.docs) {
            const a = d.data();
            if (a.cadence_state !== "assigned" || !a.recommendation)
                continue;
            if (ownedRuleIds && !ownedRuleIds.includes(a.matched_rule_id))
                continue;
            const pSnap = await db()
                .collection("products")
                .doc((0, mpnUtils_1.mpnToDocId)(a.mpn))
                .get();
            if (!pSnap.exists)
                continue;
            const p = pSnap.data();
            const entered = a.buyer_queue_entered_at?.toDate?.();
            const daysInQueue = entered
                ? Math.floor((Date.now() - entered.getTime()) / (24 * 60 * 60 * 1000))
                : 0;
            const invTotal = (Number(p.inventory_store) || 0) +
                (Number(p.inventory_warehouse) || 0) +
                (Number(p.inventory_whs) || 0);
            items.push({
                mpn: a.mpn,
                name: p.name || "",
                brand: p.brand || "",
                department: p.department || "",
                class: p.class || "",
                site_owner: p.site_owner || "",
                rics_retail: Number(p.rics_retail) || 0,
                rics_offer: Number(p.rics_offer) || 0,
                scom: Number(p.scom) || 0,
                scom_sale: Number(p.scom_sale) || 0,
                is_map_protected: p.is_map_protected === true,
                map_price: Number(p.map_price) || null,
                map_conflict_active: p.map_conflict_active === true,
                str_pct: p.str_pct != null ? Number(p.str_pct) : null,
                wos: p.wos != null ? Number(p.wos) : null,
                store_gm_pct: p.store_gm_pct != null ? Number(p.store_gm_pct) : null,
                web_gm_pct: p.web_gm_pct != null ? Number(p.web_gm_pct) : null,
                inventory_total: invTotal,
                is_slow_moving: p.is_slow_moving === true,
                recommendation: a.recommendation,
                current_step: a.current_step,
                days_in_queue: daysInQueue,
            });
        }
        res.json({ items, total: items.length });
    }
    catch (err) {
        console.error("GET /cadence-review error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/v1/cadence-assignments/unassigned
router.get("/cadence-assignments/unassigned", auth_1.requireAuth, (0, roles_1.requireRole)(buyerRoles), async (_req, res) => {
    try {
        const snap = await db()
            .collection("cadence_assignments")
            .where("cadence_state", "==", "unassigned")
            .get();
        const items = [];
        for (const d of snap.docs) {
            const a = d.data();
            const pSnap = await db()
                .collection("products")
                .doc((0, mpnUtils_1.mpnToDocId)(a.mpn))
                .get();
            if (!pSnap.exists)
                continue;
            const p = pSnap.data();
            items.push({
                mpn: a.mpn,
                name: p.name || "",
                brand: p.brand || "",
                department: p.department || "",
                class: p.class || "",
                wos: p.wos != null ? Number(p.wos) : null,
                str_pct: p.str_pct != null ? Number(p.str_pct) : null,
                inventory_total: (Number(p.inventory_store) || 0) +
                    (Number(p.inventory_warehouse) || 0) +
                    (Number(p.inventory_whs) || 0),
                last_evaluated_at: a.last_evaluated_at?.toDate?.()?.toISOString() || null,
            });
        }
        res.json({ items, total: items.length });
    }
    catch (err) {
        console.error("GET /cadence-assignments/unassigned error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/v1/cadence-assignments/:mpn/assign
router.post("/cadence-assignments/:mpn/assign", auth_1.requireAuth, (0, roles_1.requireRole)(buyerRoles), async (req, res) => {
    try {
        const { mpn } = req.params;
        const { rule_id } = req.body || {};
        if (!rule_id) {
            res.status(400).json({ error: "rule_id is required" });
            return;
        }
        const uid = req.user.uid;
        const ruleSnap = await db().collection("cadence_rules").doc(rule_id).get();
        if (!ruleSnap.exists) {
            res.status(404).json({ error: "Rule not found" });
            return;
        }
        const ref = db().collection("cadence_assignments").doc((0, mpnUtils_1.mpnToDocId)(mpn));
        await ref.set({
            mpn,
            cadence_state: "assigned",
            matched_rule_id: rule_id,
            matched_rule_version: Number(ruleSnap.data().version) || 1,
            manual_assignment: true,
            manual_assigned_by: uid,
            manual_assigned_at: ts(),
            last_evaluated_at: ts(),
        }, { merge: true });
        await db().collection("audit_log").add({
            event_type: "cadence_manual_assign",
            product_mpn: mpn,
            rule_id,
            acting_user_id: uid,
            created_at: ts(),
        });
        res.json({ status: "assigned", mpn, rule_id });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/v1/cadence-assignments/:mpn/exclude
router.post("/cadence-assignments/:mpn/exclude", auth_1.requireAuth, (0, roles_1.requireRole)(buyerRoles), async (req, res) => {
    try {
        const { mpn } = req.params;
        const { reason } = req.body || {};
        const uid = req.user.uid;
        await db()
            .collection("cadence_assignments")
            .doc((0, mpnUtils_1.mpnToDocId)(mpn))
            .set({
            mpn,
            cadence_state: "excluded",
            excluded_reason: reason || null,
            excluded_by: uid,
            excluded_at: ts(),
            in_buyer_queue: false,
            recommendation: null,
            last_evaluated_at: ts(),
        }, { merge: true });
        await db().collection("audit_log").add({
            event_type: "cadence_excluded",
            product_mpn: mpn,
            reason: reason || null,
            acting_user_id: uid,
            created_at: ts(),
        });
        res.json({ status: "excluded", mpn });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=cadenceReview.js.map