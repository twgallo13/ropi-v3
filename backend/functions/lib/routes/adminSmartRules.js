"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Step 3.1 — Smart Rules Admin CRUD + Dry-Run.
 *   GET    /api/v1/admin/smart-rules
 *   POST   /api/v1/admin/smart-rules
 *   GET    /api/v1/admin/smart-rules/:rule_id
 *   PUT    /api/v1/admin/smart-rules/:rule_id       (increments version)
 *   DELETE /api/v1/admin/smart-rules/:rule_id       (soft — is_active:false)
 *   POST   /api/v1/admin/smart-rules/:rule_id/test  (dry-run against real MPN)
 *
 * Admin-only.
 */
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const roles_1 = require("../middleware/roles");
const smartRules_1 = require("../services/smartRules");
const router = (0, express_1.Router)();
const db = () => firebase_admin_1.default.firestore();
const ts = () => firebase_admin_1.default.firestore.FieldValue.serverTimestamp();
const rolesAllowed = ["admin"];
const VALID_OPERATORS = [
    "equals",
    "not_equals",
    "contains",
    "starts_with",
    "is_empty",
    "is_not_empty",
    "matches",
];
function slugify(s) {
    return s
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
}
function validateRuleBody(body) {
    if (!body.rule_name || typeof body.rule_name !== "string") {
        return "rule_name is required";
    }
    if (typeof body.priority !== "number") {
        return "priority must be a number";
    }
    if (!Array.isArray(body.conditions) || body.conditions.length === 0) {
        return "conditions[] must be a non-empty array";
    }
    if (!Array.isArray(body.actions) || body.actions.length === 0) {
        return "actions[] must be a non-empty array";
    }
    for (const c of body.conditions) {
        if (!c.field)
            return "condition.field required";
        if (!c.operator || !VALID_OPERATORS.includes(c.operator)) {
            return `condition.operator must be one of ${VALID_OPERATORS.join(", ")}`;
        }
        if (c.logic && c.logic !== "AND" && c.logic !== "OR") {
            return "condition.logic must be AND or OR";
        }
    }
    for (const a of body.actions) {
        if (!a.target_field)
            return "action.target_field required";
        if (a.value === undefined)
            return "action.value required";
    }
    return null;
}
function normalizeRule(body, uid) {
    return {
        rule_name: body.rule_name,
        rule_type: body.rule_type || "type_1",
        is_active: body.is_active !== false,
        priority: body.priority,
        always_overwrite: !!body.always_overwrite,
        conditions: body.conditions.map((c) => ({
            field: c.field,
            operator: c.operator,
            value: c.value,
            logic: c.logic || "AND",
            case_sensitive: c.case_sensitive !== false, // default true
        })),
        actions: body.actions.map((a) => ({
            target_field: a.target_field,
            value: a.value,
        })),
        updated_by: uid,
        updated_at: ts(),
    };
}
function serializeRule(id, data) {
    return {
        rule_id: id,
        ...data,
        created_at: data.created_at?.toDate?.()?.toISOString() || null,
        updated_at: data.updated_at?.toDate?.()?.toISOString() || null,
    };
}
// ── GET list ───────────────────────────────────────────────────────────────
router.get("/", auth_1.requireAuth, (0, roles_1.requireRole)(rolesAllowed), async (_req, res) => {
    try {
        const snap = await db().collection("smart_rules").get();
        const rules = snap.docs
            .map((d) => serializeRule(d.id, d.data()))
            .sort((a, b) => {
            const pA = a.priority ?? 999;
            const pB = b.priority ?? 999;
            if (pA !== pB)
                return pA - pB;
            return a.rule_id.localeCompare(b.rule_id);
        });
        res.json({ rules, total: rules.length });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ── POST create ────────────────────────────────────────────────────────────
router.post("/", auth_1.requireAuth, (0, roles_1.requireRole)(rolesAllowed), async (req, res) => {
    try {
        const err = validateRuleBody(req.body);
        if (err) {
            res.status(400).json({ error: err });
            return;
        }
        const uid = req.user.uid;
        const base = normalizeRule(req.body, uid);
        const rule_id = req.body.rule_id && typeof req.body.rule_id === "string"
            ? req.body.rule_id
            : `rule_${slugify(req.body.rule_name)}_${Date.now().toString(36)}`;
        const ref = db().collection("smart_rules").doc(rule_id);
        const exists = await ref.get();
        if (exists.exists) {
            res.status(409).json({ error: `rule_id "${rule_id}" already exists` });
            return;
        }
        await ref.set({
            ...base,
            created_by: uid,
            created_at: ts(),
            version: 1,
        });
        await db().collection("audit_log").add({
            event_type: "smart_rule_created",
            rule_id,
            rule_name: req.body.rule_name,
            uid,
            timestamp: ts(),
        });
        const after = await ref.get();
        res.status(201).json(serializeRule(rule_id, after.data()));
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ── GET one ────────────────────────────────────────────────────────────────
router.get("/:rule_id", auth_1.requireAuth, (0, roles_1.requireRole)(rolesAllowed), async (req, res) => {
    try {
        const snap = await db().collection("smart_rules").doc(req.params.rule_id).get();
        if (!snap.exists) {
            res.status(404).json({ error: "rule not found" });
            return;
        }
        res.json(serializeRule(snap.id, snap.data()));
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ── PUT update (increments version) ────────────────────────────────────────
router.put("/:rule_id", auth_1.requireAuth, (0, roles_1.requireRole)(rolesAllowed), async (req, res) => {
    try {
        const err = validateRuleBody(req.body);
        if (err) {
            res.status(400).json({ error: err });
            return;
        }
        const uid = req.user.uid;
        const ref = db().collection("smart_rules").doc(req.params.rule_id);
        const before = await ref.get();
        if (!before.exists) {
            res.status(404).json({ error: "rule not found" });
            return;
        }
        const currentVersion = before.data()?.version || 1;
        await ref.set({
            ...normalizeRule(req.body, uid),
            version: currentVersion + 1,
        }, { merge: true });
        await db().collection("audit_log").add({
            event_type: "smart_rule_updated",
            rule_id: req.params.rule_id,
            rule_name: req.body.rule_name,
            uid,
            new_version: currentVersion + 1,
            timestamp: ts(),
        });
        const after = await ref.get();
        res.json(serializeRule(after.id, after.data()));
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ── DELETE (soft) ──────────────────────────────────────────────────────────
router.delete("/:rule_id", auth_1.requireAuth, (0, roles_1.requireRole)(rolesAllowed), async (req, res) => {
    try {
        const uid = req.user.uid;
        const ref = db().collection("smart_rules").doc(req.params.rule_id);
        const snap = await ref.get();
        if (!snap.exists) {
            res.status(404).json({ error: "rule not found" });
            return;
        }
        await ref.set({ is_active: false, updated_at: ts(), updated_by: uid }, { merge: true });
        await db().collection("audit_log").add({
            event_type: "smart_rule_deactivated",
            rule_id: req.params.rule_id,
            uid,
            timestamp: ts(),
        });
        res.json({ ok: true, rule_id: req.params.rule_id, is_active: false });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ── POST :rule_id/test — dry-run ───────────────────────────────────────────
router.post("/:rule_id/test", auth_1.requireAuth, (0, roles_1.requireRole)(rolesAllowed), async (req, res) => {
    try {
        const { mpn } = req.body || {};
        if (!mpn || typeof mpn !== "string") {
            res.status(400).json({ error: "body.mpn (string) required" });
            return;
        }
        const ruleSnap = await db().collection("smart_rules").doc(req.params.rule_id).get();
        if (!ruleSnap.exists) {
            res.status(404).json({ error: "rule not found" });
            return;
        }
        const result = await (0, smartRules_1.dryRunSmartRule)(ruleSnap.data(), mpn);
        res.json({ rule_id: req.params.rule_id, mpn, ...result });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=adminSmartRules.js.map