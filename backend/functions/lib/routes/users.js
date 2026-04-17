"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Users — lightweight roster used for @mention autocomplete (Step 2.5 Correction 2)
 * and other places where we need the list of users in the system.
 *   GET /api/v1/users — list active users
 */
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
function initials(name) {
    return (name || "U")
        .split(/\s+/)
        .filter(Boolean)
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
}
router.get("/", auth_1.requireAuth, async (_req, res) => {
    try {
        const snap = await firebase_admin_1.default.firestore().collection("users").get();
        const users = snap.docs.map((d) => {
            const data = d.data() || {};
            const display_name = data.display_name || data.name || data.email || d.id;
            return {
                uid: d.id,
                display_name,
                email: data.email || null,
                role: data.role || null,
                avatar_initials: initials(display_name),
                active: data.active !== false,
            };
        });
        res.json({ users });
    }
    catch (err) {
        console.error("GET /users error:", err);
        res.status(500).json({ error: "Failed to load users." });
    }
});
exports.default = router;
//# sourceMappingURL=users.js.map