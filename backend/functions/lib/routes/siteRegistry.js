"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Site Registry — Phase 4.4 §3.1 / §8 canonical endpoint.
 *
 *   GET /api/v1/site-registry            → all entries
 *   GET /api/v1/site-registry?active=true → is_active === true only
 *
 * Response shape (per Phase 4.4 §3.1):
 *   { sites: [{ site_key, display_name, domain, is_active, priority,
 *               badge_color, notes }] }
 *
 * Sorted by priority ascending, then site_key.
 *
 * Canonical replacement for the legacy GET /api/v1/imports/site-verification/sites
 * endpoint, which was removed in Phase 5 Pass 2 (TALLY-123 Task 8).
 */
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.get("/", auth_1.requireAuth, async (req, res) => {
    try {
        const activeOnly = String(req.query.active || "").toLowerCase() === "true";
        const snap = await firebase_admin_1.default.firestore().collection("site_registry").get();
        const sites = snap.docs
            .map((d) => {
            const data = d.data() || {};
            return {
                site_key: data.site_key || d.id,
                display_name: data.display_name || data.name || d.id,
                domain: data.domain || null,
                is_active: data.is_active === true,
                priority: typeof data.priority === "number" ? data.priority : 999,
                badge_color: data.badge_color ?? null,
                notes: data.notes ?? null,
            };
        })
            .filter((s) => (activeOnly ? s.is_active : true))
            .sort((a, b) => {
            if (a.priority !== b.priority)
                return a.priority - b.priority;
            return a.site_key.localeCompare(b.site_key);
        });
        res.json({ sites });
    }
    catch (err) {
        console.error("GET /site-registry error:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=siteRegistry.js.map