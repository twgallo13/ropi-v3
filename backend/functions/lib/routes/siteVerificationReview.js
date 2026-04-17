"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Site Verification Review — Step 2.5 Part 3.
 *   GET  /review                    — products with any site_verification entry
 *                                     in state "mismatch" or "stale" (>14 days)
 *   POST /:mpn/mark-live            — body: { site_key }
 *   POST /:mpn/flag                 — body: { site_key, reason }
 */
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const roles_1 = require("../middleware/roles");
const mpnUtils_1 = require("../services/mpnUtils");
const router = (0, express_1.Router)();
const db = () => firebase_admin_1.default.firestore();
const ts = () => firebase_admin_1.default.firestore.FieldValue.serverTimestamp();
const STALE_DAYS = 14;
const viewRoles = ["operations_operator", "product_ops", "buyer", "head_buyer"];
// ── GET /review ──
router.get("/review", auth_1.requireAuth, (0, roles_1.requireRole)(viewRoles), async (_req, res) => {
    try {
        const snap = await db().collection("products").get();
        const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
        const items = [];
        for (const doc of snap.docs) {
            const p = doc.data();
            const sv = p.site_verification || {};
            for (const [siteKey, entryRaw] of Object.entries(sv)) {
                const entry = entryRaw;
                const state = entry?.verification_state || "unverified";
                const lastMs = entry?.last_verified_at?.toDate?.()?.getTime?.() || 0;
                const isStale = state === "verified_live" && lastMs > 0 && lastMs < cutoff;
                const flagged = state === "mismatch" || isStale;
                if (!flagged)
                    continue;
                items.push({
                    mpn: p.mpn || doc.id,
                    name: p.name || "",
                    brand: p.brand || "",
                    site_key: siteKey,
                    verification_state: isStale ? "stale" : state,
                    product_url: entry?.product_url || null,
                    image_url: entry?.image_url || null,
                    mismatch_reason: entry?.mismatch_reason || null,
                    last_verified_at: entry?.last_verified_at?.toDate?.()?.toISOString?.() || null,
                });
            }
        }
        res.json({ items, total: items.length });
    }
    catch (err) {
        console.error("GET /site-verification/review error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ── POST /:mpn/mark-live ──
router.post("/:mpn/mark-live", auth_1.requireAuth, (0, roles_1.requireRole)(viewRoles), async (req, res) => {
    try {
        const { mpn } = req.params;
        const { site_key } = req.body || {};
        if (!site_key) {
            res.status(400).json({ error: "site_key is required" });
            return;
        }
        const ref = db().collection("products").doc((0, mpnUtils_1.mpnToDocId)(mpn));
        const snap = await ref.get();
        if (!snap.exists) {
            res.status(404).json({ error: "Product not found" });
            return;
        }
        await ref.set({
            site_verification: {
                [site_key]: {
                    verification_state: "verified_live",
                    mismatch_reason: null,
                    last_verified_at: ts(),
                },
            },
        }, { merge: true });
        await db().collection("audit_log").add({
            product_mpn: mpn,
            event_type: "site_verification_mark_live",
            site_key,
            acting_user_id: req.user?.uid || "system",
            source_type: "human_edit",
            created_at: ts(),
        });
        res.json({ mpn, site_key, verification_state: "verified_live" });
    }
    catch (err) {
        console.error("POST /site-verification/:mpn/mark-live error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ── POST /:mpn/flag ──
router.post("/:mpn/flag", auth_1.requireAuth, (0, roles_1.requireRole)(viewRoles), async (req, res) => {
    try {
        const { mpn } = req.params;
        const { site_key, reason } = req.body || {};
        if (!site_key || !reason) {
            res.status(400).json({ error: "site_key and reason are required" });
            return;
        }
        const ref = db().collection("products").doc((0, mpnUtils_1.mpnToDocId)(mpn));
        const snap = await ref.get();
        if (!snap.exists) {
            res.status(404).json({ error: "Product not found" });
            return;
        }
        await ref.set({
            site_verification: {
                [site_key]: {
                    verification_state: "mismatch",
                    mismatch_reason: reason,
                    last_verified_at: ts(),
                },
            },
        }, { merge: true });
        const userId = req.user?.uid || "system";
        let authorName = req.user?.name || req.user?.email || "User";
        try {
            const uDoc = await db().collection("users").doc(userId).get();
            if (uDoc.exists)
                authorName = uDoc.data()?.display_name || authorName;
        }
        catch (_e) {
            /* ignore */
        }
        await ref.collection("comments").add({
            text: `Site Verification flagged on ${site_key}: ${reason}`,
            author_uid: userId,
            author_name: authorName,
            mentions: [],
            created_at: ts(),
            edited_at: null,
        });
        await db().collection("audit_log").add({
            product_mpn: mpn,
            event_type: "site_verification_flag",
            site_key,
            reason,
            acting_user_id: userId,
            source_type: "human_edit",
            created_at: ts(),
        });
        res.json({ mpn, site_key, verification_state: "mismatch", mismatch_reason: reason });
    }
    catch (err) {
        console.error("POST /site-verification/:mpn/flag error:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=siteVerificationReview.js.map