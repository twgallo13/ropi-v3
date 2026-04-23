"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveStaleness = void 0;
/**
 * Site Verification Review — Phase 4.4 §6.1 / §6.2.
 *
 *   GET  /review                    — products with any site_verification entry
 *                                     in state "mismatch" or "stale", PLUS
 *                                     coverage-gap rows derived from site_targets.
 *   POST /:mpn/mark-live            — body: { site_key }
 *   POST /:mpn/flag                 — body: { site_key, reason }
 *   POST /:mpn/reverify             — body: { site_key }   (Confirm Still Live)
 *
 * Reviewer mutations (mark-live, flag, reverify) write reviewer_uid +
 * reviewer_action_at on every successful action. Unauthenticated requests
 * are rejected by `requireAuth` with 401; we never write a synthetic
 * reviewer attribution.
 *
 * Staleness derivation is delegated to lib/staleness (single source of truth).
 */
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const roles_1 = require("../middleware/roles");
const mpnUtils_1 = require("../services/mpnUtils");
const staleness_1 = require("../lib/staleness");
Object.defineProperty(exports, "deriveStaleness", { enumerable: true, get: function () { return staleness_1.deriveStaleness; } });
const completionCompute_1 = require("../services/completionCompute");
const router = (0, express_1.Router)();
const db = () => firebase_admin_1.default.firestore();
const ts = () => firebase_admin_1.default.firestore.FieldValue.serverTimestamp();
const viewRoles = ["operations_operator", "product_ops", "buyer", "head_buyer"];
async function loadRegistry() {
    const snap = await db().collection("site_registry").get();
    const map = new Map();
    for (const d of snap.docs) {
        const data = d.data() || {};
        const key = data.site_key || d.id;
        map.set(key, {
            site_key: key,
            display_name: data.display_name || data.name || key,
            domain: data.domain || null,
            is_active: data.is_active === true,
        });
    }
    return map;
}
function isoOrNull(t) {
    return t?.toDate?.()?.toISOString?.() || null;
}
// ── GET /review ──
router.get("/review", auth_1.requireAuth, (0, roles_1.requireRole)(viewRoles), async (_req, res) => {
    const startMs = Date.now();
    try {
        const cache = {};
        const [thresholdDays, registry, productsSnap] = await Promise.all([
            (0, staleness_1.getStalenessThresholdDays)(cache),
            loadRegistry(),
            db().collection("products").get(),
        ]);
        const items = [];
        for (const doc of productsSnap.docs) {
            const p = doc.data();
            const mpn = p.mpn || doc.id;
            const sv = p.site_verification || {};
            // ── Mismatch / stale rows ─────────────────────────────────────────
            for (const [siteKey, entryRaw] of Object.entries(sv)) {
                const entry = entryRaw || {};
                const storedState = entry?.verification_state;
                const lastVerifiedAt = entry?.last_verified_at;
                const renderedState = (0, staleness_1.deriveVerificationState)(storedState, lastVerifiedAt, thresholdDays);
                const flagged = renderedState === "mismatch" || renderedState === "stale";
                if (!flagged)
                    continue;
                const reg = registry.get(siteKey);
                if (!reg) {
                    console.warn(`[review] orphaned site_verification key on mpn=${mpn}: ${siteKey}`);
                }
                items.push({
                    mpn,
                    product_name: p.name || "",
                    brand: p.brand || "",
                    site_key: siteKey,
                    site_display_name: reg?.display_name ?? siteKey,
                    site_domain: reg?.domain ?? null,
                    verification_state: renderedState,
                    product_url: entry?.product_url || null,
                    image_url: entry?.image_url || null,
                    mismatch_reason: entry?.mismatch_reason || null,
                    last_verified_at: isoOrNull(entry?.last_verified_at),
                    verification_date: entry?.verification_date || null,
                    reviewer_uid: entry?.reviewer_uid || null,
                    reviewer_action_at: isoOrNull(entry?.reviewer_action_at),
                });
            }
            // ── Coverage-gap rows ─────────────────────────────────────────────
            // Scope rules (per spec §6.1.1 + PO Round 4 audit):
            // - Inactive registry sites: skip silently; no coverage-gap row emitted.
            // - Unrecognized site_targets keys: skip silently; cleanup is owned
            //   by TALLY-128 Task 5 (commit 38ed25e). The orphaned_reference
            //   audit branch was removed by TALLY-128 Task 6 (6a INV-A:
            //   historical artifact, not a runtime defect).
            const stSnap = await doc.ref.collection("site_targets").get();
            for (const stDoc of stSnap.docs) {
                const t = stDoc.data() || {};
                if (t.active === false)
                    continue;
                const targetKey = t.site_id || stDoc.id;
                const reg = registry.get(targetKey);
                if (!reg)
                    continue; // unrecognized site_target key → silent skip
                if (!reg.is_active)
                    continue; // inactive registry site → silent skip
                const svEntry = sv[targetKey];
                const hasUrl = !!svEntry?.product_url;
                if (svEntry && hasUrl)
                    continue; // already verified, nothing to do
                items.push({
                    mpn,
                    product_name: p.name || "",
                    brand: p.brand || "",
                    site_key: targetKey,
                    site_display_name: reg.display_name,
                    site_domain: reg.domain,
                    verification_state: "unverified",
                    product_url: null,
                    image_url: null,
                    mismatch_reason: "coverage_gap",
                    last_verified_at: null,
                    verification_date: null,
                    reviewer_uid: null,
                    reviewer_action_at: null,
                });
            }
        }
        const durationMs = Date.now() - startMs;
        console.log(`[review] returned ${items.length} rows (products scanned=${productsSnap.size}, threshold_days=${thresholdDays}) in ${durationMs}ms`);
        res.json({ items, total: items.length });
    }
    catch (err) {
        console.error("GET /site-verification/review error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ── Shared reviewer helper ─────────────────────────────────────────────────
function reviewerUidOrReject(req, res) {
    const uid = req.user?.uid;
    if (!uid) {
        res.status(401).json({
            error: "Authenticated user required to record reviewer attribution.",
        });
        return null;
    }
    return uid;
}
// ── POST /:mpn/mark-live ──
router.post("/:mpn/mark-live", auth_1.requireAuth, (0, roles_1.requireRole)(viewRoles), async (req, res) => {
    try {
        const reviewerUid = reviewerUidOrReject(req, res);
        if (!reviewerUid)
            return;
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
                    reviewer_uid: reviewerUid,
                    reviewer_action_at: ts(),
                },
            },
        }, { merge: true });
        await db().collection("audit_log").add({
            product_mpn: mpn,
            event_type: "site_verification_mark_live",
            site_key,
            acting_user_id: reviewerUid,
            reviewer_uid: reviewerUid,
            source_type: "human_edit",
            created_at: ts(),
        });
        // TALLY-P1 — stamp 5-field completion projection (best-effort).
        try {
            const result = await (0, completionCompute_1.computeCompletion)(mpn);
            await (0, completionCompute_1.stampCompletionOnProduct)(ref, result);
        }
        catch (stampErr) {
            console.warn("completion_stamp_failed", { mpn, err: stampErr?.message });
        }
        res.json({
            mpn,
            site_key,
            verification_state: "verified_live",
            reviewer_uid: reviewerUid,
        });
    }
    catch (err) {
        console.error("POST /site-verification/:mpn/mark-live error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ── POST /:mpn/flag ──
router.post("/:mpn/flag", auth_1.requireAuth, (0, roles_1.requireRole)(viewRoles), async (req, res) => {
    try {
        const reviewerUid = reviewerUidOrReject(req, res);
        if (!reviewerUid)
            return;
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
                    reviewer_uid: reviewerUid,
                    reviewer_action_at: ts(),
                },
            },
        }, { merge: true });
        let authorName = req.user?.name || req.user?.email || "User";
        try {
            const uDoc = await db().collection("users").doc(reviewerUid).get();
            if (uDoc.exists)
                authorName = uDoc.data()?.display_name || authorName;
        }
        catch (_e) {
            /* ignore */
        }
        await ref.collection("comments").add({
            text: `Site Verification flagged on ${site_key}: ${reason}`,
            author_uid: reviewerUid,
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
            acting_user_id: reviewerUid,
            reviewer_uid: reviewerUid,
            source_type: "human_edit",
            created_at: ts(),
        });
        // TALLY-P1 — stamp 5-field completion projection (best-effort).
        try {
            const result = await (0, completionCompute_1.computeCompletion)(mpn);
            await (0, completionCompute_1.stampCompletionOnProduct)(ref, result);
        }
        catch (stampErr) {
            console.warn("completion_stamp_failed", { mpn, err: stampErr?.message });
        }
        res.json({
            mpn,
            site_key,
            verification_state: "mismatch",
            mismatch_reason: reason,
            reviewer_uid: reviewerUid,
        });
    }
    catch (err) {
        console.error("POST /site-verification/:mpn/flag error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ── POST /:mpn/reverify — Phase 4.4 §6.2.1 / §6.2.2 "Confirm Still Live" ──
router.post("/:mpn/reverify", auth_1.requireAuth, (0, roles_1.requireRole)(viewRoles), async (req, res) => {
    try {
        const reviewerUid = reviewerUidOrReject(req, res);
        if (!reviewerUid)
            return;
        const { mpn } = req.params;
        const { site_key } = req.body || {};
        if (!site_key) {
            res.status(400).json({ error: "site_key is required" });
            return;
        }
        // 1. site_key must be present in site_registry AND active.
        const regSnap = await db().collection("site_registry").doc(site_key).get();
        if (!regSnap.exists || regSnap.get("is_active") !== true) {
            res.status(400).json({
                error: `site_key "${site_key}" is not an active site in site_registry`,
            });
            return;
        }
        // 2. Product must exist.
        const ref = db().collection("products").doc((0, mpnUtils_1.mpnToDocId)(mpn));
        const snap = await ref.get();
        if (!snap.exists) {
            res.status(404).json({ error: "Product not found" });
            return;
        }
        // 3. site_verification[site_key] must already exist.
        const sv = snap.data()?.site_verification || {};
        const entry = sv[site_key];
        if (!entry) {
            res.status(404).json({
                error: `No prior site_verification entry for site_key "${site_key}" — cannot reverify.`,
            });
            return;
        }
        // 4. Merge: refresh staleness clock + reviewer fields. Preserve
        //    verification_state, mismatch_reason, product_url, image_url, etc.
        await ref.set({
            site_verification: {
                [site_key]: {
                    last_verified_at: ts(),
                    reviewer_uid: reviewerUid,
                    reviewer_action_at: ts(),
                },
            },
        }, { merge: true });
        await db().collection("audit_log").add({
            product_mpn: mpn,
            event_type: "site_verification.reverified",
            site_key,
            reviewer_uid: reviewerUid,
            acting_user_id: reviewerUid,
            source_type: "human_edit",
            created_at: ts(),
        });
        // TALLY-P1 — stamp 5-field completion projection (best-effort).
        try {
            const result = await (0, completionCompute_1.computeCompletion)(mpn);
            await (0, completionCompute_1.stampCompletionOnProduct)(ref, result);
        }
        catch (stampErr) {
            console.warn("completion_stamp_failed", { mpn, err: stampErr?.message });
        }
        res.json({
            mpn,
            site_key,
            verification_state: entry.verification_state || "unverified",
            reviewer_uid: reviewerUid,
        });
    }
    catch (err) {
        console.error("POST /site-verification/:mpn/reverify error:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=siteVerificationReview.js.map