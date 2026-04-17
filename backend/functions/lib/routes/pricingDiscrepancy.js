"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Pricing Discrepancy — Step 2.5 Part 1.
 *   GET  /                          — list products in pricing_domain_state = "discrepancy"
 *   POST /:mpn/resolve              — correct_pricing | flag_for_review | override_to_export
 *
 * Section 9.10 Step 3B reason codes:
 *   A — ricsOffer > ricsRetail (price inversion)
 *   B — GM% below safe threshold and not below cost
 *   C — Source scom below active MAP price
 */
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const roles_1 = require("../middleware/roles");
const mpnUtils_1 = require("../services/mpnUtils");
const pricingResolution_1 = require("../services/pricingResolution");
const router = (0, express_1.Router)();
const db = () => firebase_admin_1.default.firestore();
const ts = () => firebase_admin_1.default.firestore.FieldValue.serverTimestamp();
const viewRoles = ["buyer", "operations_operator", "head_buyer"];
const resolveRoles = ["buyer", "head_buyer"];
// ── GET /api/v1/pricing/discrepancy ──
router.get("/", auth_1.requireAuth, (0, roles_1.requireRole)(viewRoles), async (_req, res) => {
    try {
        const snap = await db()
            .collection("products")
            .where("pricing_domain_state", "==", "discrepancy")
            .get();
        const items = await Promise.all(snap.docs.map(async (doc) => {
            const p = doc.data();
            // Pull latest pricing snapshot for effective prices
            const snapQuery = await doc.ref
                .collection("pricing_snapshots")
                .orderBy("resolved_at", "desc")
                .limit(1)
                .get();
            const latest = snapQuery.empty ? null : snapQuery.docs[0].data();
            return {
                mpn: p.mpn || doc.id,
                name: p.name || "",
                brand: p.brand || "",
                rics_retail: Number(p.rics_retail) || 0,
                rics_offer: Number(p.rics_offer) || 0,
                scom: Number(p.scom) || 0,
                scom_sale: Number(p.scom_sale) || 0,
                effective_web_regular: latest?.effective_web_regular ?? null,
                effective_web_sale: latest?.effective_web_sale ?? null,
                web_gm_pct: latest?.web_gm_pct ?? null,
                discrepancy_reasons: p.discrepancy_reasons || [],
                flagged_at: p.discrepancy_flagged_at?.toDate?.()?.toISOString() || null,
                flagged_by: p.discrepancy_flagged_by || "system",
                map_price: p.map_price || null,
                is_map_protected: !!p.is_map_protected,
            };
        }));
        items.sort((a, b) => (a.flagged_at || "").localeCompare(b.flagged_at || ""));
        res.json({ items, total: items.length });
    }
    catch (err) {
        console.error("GET /pricing/discrepancy error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ── POST /api/v1/pricing/discrepancy/:mpn/resolve ──
router.post("/:mpn/resolve", auth_1.requireAuth, (0, roles_1.requireRole)(resolveRoles), async (req, res) => {
    try {
        const { mpn } = req.params;
        const { action, note, corrected_rics_offer, corrected_scom, } = req.body || {};
        const userId = req.user?.uid || "system";
        const userRole = req.user?.role || null;
        const valid = ["correct_pricing", "flag_for_review", "override_to_export"];
        if (!valid.includes(action)) {
            res.status(400).json({ error: `action must be one of ${valid.join(", ")}` });
            return;
        }
        if (!note || String(note).trim() === "") {
            res.status(400).json({ error: "note is required" });
            return;
        }
        const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
        const productRef = db().collection("products").doc(docId);
        const snap = await productRef.get();
        if (!snap.exists) {
            res.status(404).json({ error: "Product not found" });
            return;
        }
        const p = snap.data();
        if (p.pricing_domain_state !== "discrepancy") {
            res
                .status(400)
                .json({ error: "Product is not in a pricing discrepancy state" });
            return;
        }
        // ── correct_pricing ──
        if (action === "correct_pricing") {
            const hasOffer = corrected_rics_offer !== undefined && corrected_rics_offer !== null;
            const hasScom = corrected_scom !== undefined && corrected_scom !== null;
            if (!hasOffer && !hasScom) {
                res.status(400).json({
                    error: "At least one of corrected_rics_offer or corrected_scom is required",
                });
                return;
            }
            const updates = { updated_at: ts() };
            const newRicsOffer = hasOffer
                ? Number(corrected_rics_offer)
                : Number(p.rics_offer) || 0;
            const newScom = hasScom ? Number(corrected_scom) : Number(p.scom) || 0;
            if (hasOffer)
                updates.rics_offer = newRicsOffer;
            if (hasScom) {
                updates.scom = newScom;
                // Provenance stamp on attribute
                await productRef
                    .collection("attribute_values")
                    .doc("scom")
                    .set({
                    value: newScom,
                    origin_type: "Human",
                    origin_detail: `Pricing Discrepancy correction — User: ${userId}`,
                    verification_state: "Human-Verified",
                    written_at: ts(),
                }, { merge: true });
            }
            await productRef.set(updates, { merge: true });
            // Re-run pricing resolution
            const fresh = (await productRef.get()).data();
            const mapDoc = await db()
                .collection("products")
                .doc(docId)
                .collection("map_state")
                .doc("current")
                .get();
            const mapState = mapDoc.exists
                ? mapDoc.data()
                : { is_active: false, map_price: 0, map_promo_price: null };
            const adminSettingsDoc = await db()
                .collection("admin_settings")
                .doc("global")
                .get();
            const adminSettings = adminSettingsDoc.exists
                ? adminSettingsDoc.data()
                : {};
            const resolution = await (0, pricingResolution_1.resolvePricing)(mpn, {
                rics_retail: Number(fresh.rics_retail) || 0,
                rics_offer: Number(fresh.rics_offer) || 0,
                scom: Number(fresh.scom) || 0,
                scom_sale: Number(fresh.scom_sale) || 0,
            }, mapState, adminSettings);
            if (resolution.status === "Pricing Current") {
                await productRef.set({
                    pricing_domain_state: "export_ready",
                    discrepancy_reasons: [],
                    discrepancy_cleared_at: ts(),
                }, { merge: true });
            }
            await db().collection("audit_log").add({
                product_mpn: mpn,
                event_type: "pricing_discrepancy_correct_pricing",
                note,
                corrected_rics_offer: hasOffer ? newRicsOffer : null,
                corrected_scom: hasScom ? newScom : null,
                new_pricing_status: resolution.status,
                acting_user_id: userId,
                source_type: "buyer_action",
                created_at: ts(),
            });
            res.json({
                mpn,
                action,
                new_pricing_status: resolution.status,
                discrepancy_cleared: resolution.status === "Pricing Current",
            });
            return;
        }
        // ── flag_for_review ──
        if (action === "flag_for_review") {
            const { reviewer_uid } = req.body || {};
            await productRef
                .collection("comments")
                .add({
                text: `Pricing Discrepancy flagged for review: ${note}`,
                author_uid: userId,
                author_name: req.user?.name || req.user?.email || "User",
                mentions: reviewer_uid ? [reviewer_uid] : [],
                created_at: ts(),
                edited_at: null,
            });
            if (reviewer_uid) {
                await db().collection("notifications").add({
                    uid: reviewer_uid,
                    type: "pricing_discrepancy",
                    product_mpn: mpn,
                    message: `Pricing Discrepancy flagged for your review on ${mpn}: ${note}`,
                    read: false,
                    created_at: ts(),
                });
            }
            await productRef.set({ discrepancy_flagged_for_review: true, discrepancy_reviewer: reviewer_uid || null }, { merge: true });
            await db().collection("audit_log").add({
                product_mpn: mpn,
                event_type: "pricing_discrepancy_flag_for_review",
                reviewer_uid: reviewer_uid || null,
                note,
                acting_user_id: userId,
                source_type: "buyer_action",
                created_at: ts(),
            });
            res.json({ mpn, action, reviewer_uid: reviewer_uid || null });
            return;
        }
        // ── override_to_export — Head Buyer only ──
        if (action === "override_to_export") {
            const isHeadBuyer = userRole === "head_buyer" || userRole === "admin";
            // Fallback to users collection
            let permitted = isHeadBuyer;
            if (!permitted) {
                const uDoc = await db().collection("users").doc(userId).get();
                const r = uDoc.data()?.role;
                permitted = r === "head_buyer" || r === "admin";
            }
            if (!permitted) {
                res
                    .status(403)
                    .json({ error: "override_to_export requires Head Buyer role" });
                return;
            }
            await productRef.set({
                pricing_domain_state: "export_ready",
                discrepancy_reasons: [],
                discrepancy_override: true,
                discrepancy_override_reason: note,
                discrepancy_override_by: userId,
                discrepancy_override_at: ts(),
            }, { merge: true });
            await db().collection("audit_log").add({
                product_mpn: mpn,
                event_type: "discrepancy_override",
                override_reason: note,
                acting_user_id: userId,
                source_type: "buyer_action",
                created_at: ts(),
            });
            res.json({ mpn, action, pricing_domain_state: "export_ready" });
            return;
        }
    }
    catch (err) {
        console.error("POST /pricing/discrepancy/:mpn/resolve error:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=pricingDiscrepancy.js.map