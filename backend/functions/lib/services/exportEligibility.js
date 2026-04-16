"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getExportEligibleProducts = getExportEligibleProducts;
/**
 * Export Eligibility Gate — Step 1.7 Part 1
 * 6 conditions evaluated in order. Every condition must pass before a product
 * can be serialized for daily export.
 */
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const db = () => firebase_admin_1.default.firestore();
/**
 * Runs the eligibility gate against all products in 'export_ready' state.
 * Returns eligible docs and a list of blocked products with reasons.
 */
async function getExportEligibleProducts() {
    // Condition 1 — Base: pricing_domain_state = 'export_ready'
    const snap = await db()
        .collection("products")
        .where("pricing_domain_state", "==", "export_ready")
        .get();
    const eligible = [];
    const blocked = [];
    for (const doc of snap.docs) {
        const p = doc.data();
        const mpn = p.mpn || doc.id;
        const reasons = [];
        // Condition 2 — product_is_active must be TRUE
        if (!p.product_is_active) {
            reasons.push("Product is inactive");
        }
        // Condition 2b — SKU is required for export
        if (!p.sku || String(p.sku).trim() === "") {
            reasons.push("SKU is required for export");
        }
        // Condition 3 — name must not be blank
        if (!p.name || p.name.trim() === "") {
            reasons.push("Product name is blank — operator must enter name before export");
        }
        // Condition 4 — defense-in-depth: must not be in discrepancy
        if (p.pricing_domain_state === "discrepancy") {
            reasons.push("Pricing Discrepancy — must be resolved before export");
        }
        // Condition 5 — must not be in scheduled hold
        if (p.pricing_domain_state === "scheduled") {
            reasons.push("Scheduled — awaiting effective date");
        }
        // Condition 6 — Loss-Leader veto window check
        if (p.pricing_domain_state === "loss_leader_review") {
            if (!p.loss_leader_reason) {
                reasons.push("Loss-Leader: buyer reason not submitted");
            }
            if (p.master_veto_pending === true) {
                reasons.push("Loss-Leader: Head Buyer veto window still open");
            }
        }
        if (reasons.length === 0) {
            eligible.push(doc);
        }
        else {
            blocked.push({ mpn, reasons });
        }
    }
    return { eligible, blocked };
}
//# sourceMappingURL=exportEligibility.js.map