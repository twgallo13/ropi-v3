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
// ── GET /me/advisory-preferences ──
router.get("/me/advisory-preferences", auth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        if (!uid) {
            res.status(401).json({ error: "Authentication required" });
            return;
        }
        const doc = await firebase_admin_1.default.firestore().collection("users").doc(uid).get();
        const prefs = doc.data()?.advisory_preferences || {
            focus_area: "balanced",
            format_preference: "prose",
        };
        res.json({ advisory_preferences: prefs });
    }
    catch (err) {
        console.error("GET /users/me/advisory-preferences error:", err);
        res.status(500).json({ error: "Failed to load preferences." });
    }
});
// ── PUT /me/advisory-preferences ──
const ALLOWED_FOCUS = new Set([
    "balanced",
    "margin_health",
    "inventory_clearance",
]);
const ALLOWED_FORMAT = new Set(["prose", "bullet_points"]);
router.put("/me/advisory-preferences", auth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        if (!uid) {
            res.status(401).json({ error: "Authentication required" });
            return;
        }
        const body = req.body || {};
        const update = {};
        if (body.focus_area !== undefined) {
            if (!ALLOWED_FOCUS.has(body.focus_area)) {
                res.status(400).json({ error: "Invalid focus_area" });
                return;
            }
            update.focus_area = body.focus_area;
        }
        if (body.format_preference !== undefined) {
            if (!ALLOWED_FORMAT.has(body.format_preference)) {
                res.status(400).json({ error: "Invalid format_preference" });
                return;
            }
            update.format_preference = body.format_preference;
        }
        if (Object.keys(update).length === 0) {
            res.status(400).json({ error: "No valid fields provided" });
            return;
        }
        const ref = firebase_admin_1.default.firestore().collection("users").doc(uid);
        const doc = await ref.get();
        const existing = doc.data()?.advisory_preferences || {
            focus_area: "balanced",
            format_preference: "prose",
        };
        const merged = { ...existing, ...update };
        await ref.set({ advisory_preferences: merged }, { merge: true });
        res.json({ advisory_preferences: merged });
    }
    catch (err) {
        console.error("PUT /users/me/advisory-preferences error:", err);
        res.status(500).json({ error: "Failed to update preferences." });
    }
});
exports.default = router;
//# sourceMappingURL=users.js.map