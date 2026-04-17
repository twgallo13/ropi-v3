"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Step 2.2 — Cadence Rules CRUD routes.
 *  GET    /api/v1/cadence-rules              — list rules visible to user
 *  POST   /api/v1/cadence-rules              — create rule (version 1)
 *  GET    /api/v1/cadence-rules/:rule_id     — get rule by id
 *  PUT    /api/v1/cadence-rules/:rule_id     — update rule (increments version)
 *  DELETE /api/v1/cadence-rules/:rule_id     — soft-delete (is_active: false)
 */
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const roles_1 = require("../middleware/roles");
const router = (0, express_1.Router)();
const db = () => firebase_admin_1.default.firestore();
const ts = () => firebase_admin_1.default.firestore.FieldValue.serverTimestamp();
const rolesAllowed = ["buyer", "head_buyer", "admin"];
function validateRule(body) {
    if (!body.rule_name || typeof body.rule_name !== "string") {
        return "rule_name is required";
    }
    if (!Array.isArray(body.target_filters))
        return "target_filters must be an array";
    if (!Array.isArray(body.trigger_conditions))
        return "trigger_conditions must be an array";
    if (!Array.isArray(body.markdown_steps) || body.markdown_steps.length === 0) {
        return "markdown_steps must contain at least one step";
    }
    return null;
}
// GET /api/v1/cadence-rules
router.get("/", auth_1.requireAuth, (0, roles_1.requireRole)(rolesAllowed), async (req, res) => {
    try {
        const uid = req.user.uid;
        const role = req.user?.role;
        let query = db().collection("cadence_rules");
        // Mike (head_buyer) + admin see all; buyers see their own
        if (role !== "head_buyer" && role !== "admin") {
            // fall back to Firestore users/{uid}.role
            const userDoc = await db().collection("users").doc(uid).get();
            const uRole = userDoc.data()?.role;
            if (uRole !== "head_buyer" && uRole !== "admin") {
                query = query.where("owner_buyer_id", "==", uid);
            }
        }
        const snap = await query.get();
        const rules = snap.docs.map((d) => ({
            rule_id: d.id,
            ...d.data(),
            created_at: d.data().created_at?.toDate?.()?.toISOString() || null,
            updated_at: d.data().updated_at?.toDate?.()?.toISOString() || null,
        }));
        res.json({ rules, total: rules.length });
    }
    catch (err) {
        console.error("GET /cadence-rules error:", err);
        res.status(500).json({ error: err.message });
    }
});
// POST /api/v1/cadence-rules
router.post("/", auth_1.requireAuth, (0, roles_1.requireRole)(rolesAllowed), async (req, res) => {
    try {
        const err = validateRule(req.body);
        if (err) {
            res.status(400).json({ error: err });
            return;
        }
        const uid = req.user.uid;
        const data = {
            rule_name: req.body.rule_name,
            version: 1,
            is_active: req.body.is_active !== false,
            owner_buyer_id: req.body.owner_buyer_id || uid,
            owner_site_owner: req.body.owner_site_owner || "",
            target_filters: req.body.target_filters || [],
            trigger_conditions: req.body.trigger_conditions || [],
            markdown_steps: req.body.markdown_steps || [],
            created_by: uid,
            created_at: ts(),
            updated_at: ts(),
        };
        const ref = await db().collection("cadence_rules").add(data);
        await db().collection("audit_log").add({
            event_type: "cadence_rule_created",
            rule_id: ref.id,
            rule_name: data.rule_name,
            acting_user_id: uid,
            created_at: ts(),
        });
        res.status(201).json({ rule_id: ref.id, ...data });
    }
    catch (err) {
        console.error("POST /cadence-rules error:", err);
        res.status(500).json({ error: err.message });
    }
});
// GET /api/v1/cadence-rules/:rule_id
router.get("/:rule_id", auth_1.requireAuth, (0, roles_1.requireRole)(rolesAllowed), async (req, res) => {
    try {
        const { rule_id } = req.params;
        const snap = await db().collection("cadence_rules").doc(rule_id).get();
        if (!snap.exists) {
            res.status(404).json({ error: "Rule not found" });
            return;
        }
        res.json({
            rule_id: snap.id,
            ...snap.data(),
            created_at: snap.data().created_at?.toDate?.()?.toISOString() || null,
            updated_at: snap.data().updated_at?.toDate?.()?.toISOString() || null,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// PUT /api/v1/cadence-rules/:rule_id
router.put("/:rule_id", auth_1.requireAuth, (0, roles_1.requireRole)(rolesAllowed), async (req, res) => {
    try {
        const { rule_id } = req.params;
        const err = validateRule(req.body);
        if (err) {
            res.status(400).json({ error: err });
            return;
        }
        const uid = req.user.uid;
        const ref = db().collection("cadence_rules").doc(rule_id);
        const snap = await ref.get();
        if (!snap.exists) {
            res.status(404).json({ error: "Rule not found" });
            return;
        }
        const curVersion = Number(snap.data().version) || 1;
        const updates = {
            rule_name: req.body.rule_name,
            is_active: req.body.is_active !== false,
            owner_buyer_id: req.body.owner_buyer_id || snap.data().owner_buyer_id,
            owner_site_owner: req.body.owner_site_owner || snap.data().owner_site_owner || "",
            target_filters: req.body.target_filters || [],
            trigger_conditions: req.body.trigger_conditions || [],
            markdown_steps: req.body.markdown_steps || [],
            version: curVersion + 1,
            updated_at: ts(),
        };
        await ref.set(updates, { merge: true });
        await db().collection("audit_log").add({
            event_type: "cadence_rule_updated",
            rule_id,
            rule_name: updates.rule_name,
            new_version: updates.version,
            acting_user_id: uid,
            created_at: ts(),
        });
        res.json({ rule_id, ...updates });
    }
    catch (err) {
        console.error("PUT /cadence-rules error:", err);
        res.status(500).json({ error: err.message });
    }
});
// DELETE /api/v1/cadence-rules/:rule_id — soft-delete
router.delete("/:rule_id", auth_1.requireAuth, (0, roles_1.requireRole)(rolesAllowed), async (req, res) => {
    try {
        const { rule_id } = req.params;
        const uid = req.user.uid;
        const ref = db().collection("cadence_rules").doc(rule_id);
        const snap = await ref.get();
        if (!snap.exists) {
            res.status(404).json({ error: "Rule not found" });
            return;
        }
        await ref.set({ is_active: false, updated_at: ts() }, { merge: true });
        await db().collection("audit_log").add({
            event_type: "cadence_rule_deactivated",
            rule_id,
            acting_user_id: uid,
            created_at: ts(),
        });
        res.json({ status: "deactivated", rule_id });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=cadenceRules.js.map