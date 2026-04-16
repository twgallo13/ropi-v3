"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const pricingUtils_1 = require("../services/pricingUtils");
const adminSettings_1 = require("../services/adminSettings");
const mpnUtils_1 = require("../services/mpnUtils");
const router = (0, express_1.Router)();
const db = () => firebase_admin_1.default.firestore();
const ts = () => firebase_admin_1.default.firestore.FieldValue.serverTimestamp();
// ── POST /api/v1/buyer-actions/markdown ──
router.post("/markdown", async (req, res) => {
    try {
        const { mpn, action_type, adjustment } = req.body;
        if (!mpn || !action_type) {
            res.status(400).json({ error: "mpn and action_type are required" });
            return;
        }
        if (!["approve", "deny", "adjust"].includes(action_type)) {
            res.status(400).json({ error: "action_type must be approve, deny, or adjust" });
            return;
        }
        const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
        const productRef = db().collection("products").doc(docId);
        const doc = await productRef.get();
        if (!doc.exists) {
            res.status(404).json({ error: "Product not found" });
            return;
        }
        const product = doc.data();
        // Validate product is in buyer-review-eligible state
        const eligibleStates = ["Pricing Current", "Loss-Leader Review Pending"];
        if (!eligibleStates.includes(product.pricing_domain_state)) {
            res.status(400).json({
                error: `Product pricing_domain_state is "${product.pricing_domain_state}" — must be in ${eligibleStates.join(" or ")} for buyer action`,
            });
            return;
        }
        const ricsRetail = product.rics_retail || 0;
        const currentOffer = product.rics_offer || 0;
        const buyerUserId = req.user?.uid || "anonymous";
        if (action_type === "deny") {
            // Deny — no price calculation needed
            const actionRef = await db().collection("buyer_actions").add({
                mpn,
                buyer_user_id: buyerUserId,
                action_type: "deny",
                original_rics_offer: currentOffer,
                new_rics_offer: null,
                export_rics_offer: null,
                effective_date: null,
                pricing_domain_state_after: "buyer_denied",
                created_at: ts(),
            });
            await productRef.set({
                pricing_domain_state: "buyer_denied",
                buyer_action_taken_at: ts(),
                last_buyer_action_id: actionRef.id,
            }, { merge: true });
            await db().collection("audit_log").add({
                product_mpn: mpn,
                event_type: "buyer_action",
                action_type: "deny",
                acting_user_id: buyerUserId,
                created_at: ts(),
            });
            res.json({
                status: "success",
                mpn,
                action_type: "deny",
                pricing_domain_state: "buyer_denied",
            });
            return;
        }
        // Approve or Adjust — calculate prices
        let newRicsOffer;
        if (action_type === "approve") {
            // 15% default markdown
            newRicsOffer = Math.round(ricsRetail * 0.85 * 100) / 100;
        }
        else {
            // adjust
            if (!adjustment) {
                res.status(400).json({ error: "adjustment object required for adjust action" });
                return;
            }
            if (adjustment.type === "pct") {
                newRicsOffer = Math.round(ricsRetail * (1 - adjustment.value / 100) * 100) / 100;
            }
            else if (adjustment.type === "dollar") {
                newRicsOffer = Math.round((ricsRetail - adjustment.value) * 100) / 100;
            }
            else if (adjustment.type === "price") {
                newRicsOffer = Math.round(adjustment.value * 100) / 100;
            }
            else {
                res.status(400).json({ error: "adjustment.type must be pct, dollar, or price" });
                return;
            }
        }
        const exportPrice = (0, pricingUtils_1.apply99Rounding)(newRicsOffer);
        const effectiveDate = adjustment?.effective_date || null;
        const stateAfter = effectiveDate ? "scheduled" : "export_ready";
        const actionRef = await db().collection("buyer_actions").add({
            mpn,
            buyer_user_id: buyerUserId,
            action_type,
            original_rics_offer: currentOffer,
            new_rics_offer: newRicsOffer,
            export_rics_offer: exportPrice,
            effective_date: effectiveDate,
            pricing_domain_state_after: stateAfter,
            created_at: ts(),
        });
        await productRef.set({
            pricing_domain_state: stateAfter,
            buyer_action_taken_at: ts(),
            last_buyer_action_id: actionRef.id,
        }, { merge: true });
        await db().collection("audit_log").add({
            product_mpn: mpn,
            event_type: "buyer_action",
            action_type,
            new_rics_offer: newRicsOffer,
            export_rics_offer: exportPrice,
            effective_date: effectiveDate,
            acting_user_id: buyerUserId,
            created_at: ts(),
        });
        res.json({
            status: "success",
            mpn,
            action_type,
            new_rics_offer: newRicsOffer,
            export_rics_offer: exportPrice,
            pricing_domain_state: stateAfter,
            buyer_action_id: actionRef.id,
        });
    }
    catch (err) {
        console.error("POST /buyer-actions/markdown error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ── POST /api/v1/buyer-actions/loss-leader-acknowledge ──
router.post("/loss-leader-acknowledge", async (req, res) => {
    try {
        const { mpn, reason } = req.body;
        if (!mpn || !reason) {
            res.status(400).json({ error: "mpn and reason are required" });
            return;
        }
        const settings = await (0, adminSettings_1.getAdminSettings)();
        if (reason.length < settings.below_cost_reason_min_chars) {
            res.status(400).json({
                error: `Reason must be at least ${settings.below_cost_reason_min_chars} characters — explain why this below-cost price is necessary`,
            });
            return;
        }
        const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
        const productRef = db().collection("products").doc(docId);
        const doc = await productRef.get();
        if (!doc.exists) {
            res.status(404).json({ error: "Product not found" });
            return;
        }
        const product = doc.data();
        if (product.pricing_domain_state !== "Loss-Leader Review Pending") {
            res.status(400).json({
                error: `Product must be in "Loss-Leader Review Pending" state, currently "${product.pricing_domain_state}"`,
            });
            return;
        }
        const buyerUserId = req.user?.uid || "anonymous";
        const vetoWindowHours = settings.master_veto_window * 24;
        const vetoExpiresAt = new Date(Date.now() + vetoWindowHours * 60 * 60 * 1000);
        await productRef.set({
            loss_leader_acknowledged: true,
            loss_leader_reason: reason,
            loss_leader_acknowledged_at: ts(),
            loss_leader_acknowledged_by: buyerUserId,
            pricing_domain_state: "Loss-Leader Acknowledged",
            veto_window_expires_at: vetoExpiresAt,
        }, { merge: true });
        await db().collection("audit_log").add({
            product_mpn: mpn,
            event_type: "loss_leader_acknowledged",
            reason,
            acting_user_id: buyerUserId,
            veto_expires_at: vetoExpiresAt,
            created_at: ts(),
        });
        res.json({
            status: "success",
            mpn,
            veto_window_hours: vetoWindowHours,
            veto_expires_at: vetoExpiresAt.toISOString(),
        });
    }
    catch (err) {
        console.error("POST /buyer-actions/loss-leader-acknowledge error:", err);
        res.status(500).json({ error: err.message });
    }
});
// ── POST /api/v1/buyer-actions/loss-leader-veto ──
router.post("/loss-leader-veto", async (req, res) => {
    try {
        const { mpn, veto_reason } = req.body;
        if (!mpn || !veto_reason) {
            res.status(400).json({ error: "mpn and veto_reason are required" });
            return;
        }
        const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
        const productRef = db().collection("products").doc(docId);
        const doc = await productRef.get();
        if (!doc.exists) {
            res.status(404).json({ error: "Product not found" });
            return;
        }
        const buyerUserId = req.user?.uid || "anonymous";
        await productRef.set({
            pricing_domain_state: "loss_leader_vetoed",
            veto_reason,
            vetoed_by: buyerUserId,
            vetoed_at: ts(),
        }, { merge: true });
        await db().collection("audit_log").add({
            product_mpn: mpn,
            event_type: "loss_leader_vetoed",
            veto_reason,
            acting_user_id: buyerUserId,
            created_at: ts(),
        });
        res.json({
            status: "success",
            mpn,
            pricing_domain_state: "loss_leader_vetoed",
        });
    }
    catch (err) {
        console.error("POST /buyer-actions/loss-leader-veto error:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=buyerActions.js.map