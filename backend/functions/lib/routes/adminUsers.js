"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * adminUsers — Step 4.2 Tab 1
 * Admin CRUD for platform users. Firebase Auth account + Firestore users/{uid}.
 *   GET    /api/v1/admin/users          — list
 *   POST   /api/v1/admin/users          — create (auto temp password)
 *   PUT    /api/v1/admin/users/:uid     — update role/departments/site_scope/display_name
 *   DELETE /api/v1/admin/users/:uid     — disable account
 */
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const roles_1 = require("../middleware/roles");
const router = (0, express_1.Router)();
const ALLOWED_ROLES = [
    "buyer",
    "head_buyer",
    "product_ops",
    "map_analyst",
    "completion_specialist",
    "operations_operator",
    "admin",
    "owner",
];
router.get("/", auth_1.requireAuth, (0, roles_1.requireRole)(["admin", "owner"]), async (_req, res) => {
    try {
        const snap = await firebase_admin_1.default.firestore().collection("users").get();
        const users = snap.docs.map((d) => {
            const data = d.data() || {};
            return {
                uid: d.id,
                email: data.email || null,
                display_name: data.display_name || data.name || null,
                role: data.role || null,
                departments: data.departments || null,
                site_scope: data.site_scope || null,
                disabled: data.disabled === true,
                created_at: data.created_at?.toDate?.().toISOString() || null,
            };
        });
        res.json({ users });
    }
    catch (err) {
        console.error("GET /admin/users error:", err);
        res.status(500).json({ error: err.message || "Failed to load users" });
    }
});
router.post("/", auth_1.requireAuth, (0, roles_1.requireRole)(["admin", "owner"]), async (req, res) => {
    try {
        const { email, display_name, role, departments, site_scope } = req.body || {};
        if (!email || !display_name || !role) {
            res
                .status(400)
                .json({ error: "email, display_name and role are required." });
            return;
        }
        if (!ALLOWED_ROLES.includes(role)) {
            res.status(400).json({
                error: `Invalid role. Allowed: ${ALLOWED_ROLES.join(", ")}`,
            });
            return;
        }
        const rand = Math.floor(1000 + Math.random() * 9000);
        const tempPassword = `${String(display_name).replace(/\s+/g, "")}${rand}@Ropi`;
        const authUser = await firebase_admin_1.default.auth().createUser({
            email,
            displayName: display_name,
            password: tempPassword,
        });
        await firebase_admin_1.default.auth().setCustomUserClaims(authUser.uid, { role });
        await firebase_admin_1.default
            .firestore()
            .collection("users")
            .doc(authUser.uid)
            .set({
            uid: authUser.uid,
            email,
            display_name,
            role,
            departments: departments || null,
            site_scope: site_scope || null,
            requires_review: false,
            created_at: firebase_admin_1.default.firestore.FieldValue.serverTimestamp(),
            created_by: req.user?.uid || null,
        });
        res.json({ uid: authUser.uid, temp_password: tempPassword });
    }
    catch (err) {
        console.error("POST /admin/users error:", err);
        res.status(500).json({ error: err.message || "Failed to create user" });
    }
});
router.put("/:uid", auth_1.requireAuth, (0, roles_1.requireRole)(["admin", "owner"]), async (req, res) => {
    try {
        const { uid } = req.params;
        const { display_name, role, departments, site_scope } = req.body || {};
        const update = {
            updated_at: firebase_admin_1.default.firestore.FieldValue.serverTimestamp(),
            updated_by: req.user?.uid || null,
        };
        if (display_name !== undefined)
            update.display_name = display_name;
        if (role !== undefined) {
            if (!ALLOWED_ROLES.includes(role)) {
                res.status(400).json({ error: "Invalid role" });
                return;
            }
            update.role = role;
            await firebase_admin_1.default.auth().setCustomUserClaims(uid, { role });
        }
        if (departments !== undefined)
            update.departments = departments;
        if (site_scope !== undefined)
            update.site_scope = site_scope;
        if (display_name !== undefined) {
            await firebase_admin_1.default.auth().updateUser(uid, { displayName: display_name });
        }
        await firebase_admin_1.default.firestore().collection("users").doc(uid).set(update, {
            merge: true,
        });
        res.json({ ok: true, uid });
    }
    catch (err) {
        console.error("PUT /admin/users/:uid error:", err);
        res.status(500).json({ error: err.message || "Failed to update user" });
    }
});
router.delete("/:uid", auth_1.requireAuth, (0, roles_1.requireRole)(["admin", "owner"]), async (req, res) => {
    try {
        const { uid } = req.params;
        await firebase_admin_1.default.auth().updateUser(uid, { disabled: true });
        await firebase_admin_1.default
            .firestore()
            .collection("users")
            .doc(uid)
            .set({
            disabled: true,
            disabled_at: firebase_admin_1.default.firestore.FieldValue.serverTimestamp(),
            disabled_by: req.user?.uid || null,
        }, { merge: true });
        res.json({ ok: true, uid });
    }
    catch (err) {
        console.error("DELETE /admin/users/:uid error:", err);
        res.status(500).json({ error: err.message || "Failed to disable user" });
    }
});
exports.default = router;
//# sourceMappingURL=adminUsers.js.map