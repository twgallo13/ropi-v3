"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePricing = resolvePricing;
exports.writePricingSnapshot = writePricingSnapshot;
/**
 * Pricing Resolution Engine — Section 19.7
 * Implements the approved pseudo-code exactly.
 * 10 pre-audited bug fixes locked — do not deviate.
 *
 * Critical rules:
 * - has_valid_value() rejects null, empty string, AND zero ($0 = "not set")
 * - Step 3A (Loss-Leader) MUST execute BEFORE Step 3B (Pricing Discrepancy)
 * - MAP floor is map_state.map_price — never effective_store_regular
 * - Both store_gm_pct AND web_gm_pct calculated separately
 * - Below-cost always logged even when below_cost_acknowledgment_required = false
 * - is_loss_leader flag stamped on every pricing snapshot
 * - log_pricing_event() called at every routing outcome — no silent paths
 */
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const pricingUtils_1 = require("./pricingUtils");
const mpnUtils_1 = require("./mpnUtils");
const db = firebase_admin_1.default.firestore;
/**
 * Main pricing resolution function.
 * Follows Section 19.7 pseudo-code step-by-step.
 */
async function resolvePricing(mpn, pricingInputs, mapState, adminSettings) {
    const { rics_retail, rics_offer, scom, scom_sale } = pricingInputs;
    // ── Step 1: Determine effective prices ──
    const effective_store_regular = rics_retail;
    const effective_store_sale = rics_offer;
    const effective_web_regular = scom;
    const effective_web_sale = scom_sale;
    // ── Step 2: Calculate cost ──
    let cost;
    let cost_is_estimated;
    if (pricingInputs.actual_cost && pricingInputs.actual_cost > 0) {
        cost = pricingInputs.actual_cost;
        cost_is_estimated = false;
    }
    else {
        // Estimated cost = rics_retail × estimated_cost_multiplier
        cost = rics_retail * adminSettings.estimated_cost_multiplier;
        cost_is_estimated = true;
    }
    // ── Calculate margins (Bug #7 fix: store and web separately) ──
    const store_gm_pct = (0, pricingUtils_1.hasValidValue)(rics_offer)
        ? ((rics_offer - cost) / rics_offer) * 100
        : null;
    const web_gm_pct = (0, pricingUtils_1.hasValidValue)(scom_sale)
        ? ((scom_sale - cost) / scom_sale) * 100
        : null;
    // ── MAP constraint check ──
    let is_map_constrained = false;
    if (mapState.is_active && mapState.map_price > 0) {
        // MAP floor is map_state.map_price — never effective_store_regular (TALLY-005)
        if ((0, pricingUtils_1.hasValidValue)(rics_offer) && rics_offer < mapState.map_price) {
            is_map_constrained = true;
        }
        if ((0, pricingUtils_1.hasValidValue)(scom_sale) && scom_sale < mapState.map_price) {
            is_map_constrained = true;
        }
    }
    // ── Check for all-zero pricing → Pricing Pending (TALLY-080) ──
    const allPricesZeroOrEmpty = !(0, pricingUtils_1.hasValidValue)(rics_retail) &&
        !(0, pricingUtils_1.hasValidValue)(rics_offer) &&
        !(0, pricingUtils_1.hasValidValue)(scom) &&
        !(0, pricingUtils_1.hasValidValue)(scom_sale);
    if (allPricesZeroOrEmpty) {
        const result = {
            status: "Pricing Pending",
            effective_store_regular,
            effective_store_sale,
            effective_web_regular,
            effective_web_sale,
            store_gm_pct: null,
            web_gm_pct: null,
            is_map_constrained: false,
            is_loss_leader: false,
            cost_is_estimated,
            cost,
            discrepancy_reasons: [],
        };
        // log_pricing_event — no silent paths
        await logPricingEvent(mpn, "Pricing Pending", "All prices are zero or empty");
        return result;
    }
    // ── Step 3A: Loss-Leader Check (MUST execute BEFORE Step 3B) ──
    // Below-cost always logged even when below_cost_acknowledgment_required is false
    let is_loss_leader = false;
    const belowCostReasons = [];
    if ((0, pricingUtils_1.hasValidValue)(rics_offer) && rics_offer < cost) {
        is_loss_leader = true;
        belowCostReasons.push(`Store sale price ($${rics_offer.toFixed(2)}) is below cost ($${cost.toFixed(2)})`);
    }
    if ((0, pricingUtils_1.hasValidValue)(scom_sale) && scom_sale < cost) {
        is_loss_leader = true;
        belowCostReasons.push(`Web sale price ($${scom_sale.toFixed(2)}) is below cost ($${cost.toFixed(2)})`);
    }
    if (is_loss_leader) {
        // Always log below-cost
        await logPricingEvent(mpn, "Loss-Leader Detected", belowCostReasons.join("; "));
        // Route to Loss-Leader Review (NOT Discrepancy — TALLY-090)
        if (adminSettings.below_cost_acknowledgment_required) {
            const payload = {
                cost,
                cost_is_estimated,
                store_margin_pct: store_gm_pct,
                web_margin_pct: web_gm_pct,
                rics_offer,
                scom_sale,
                veto_window_hours: adminSettings.master_veto_window * 24, // master_veto_window is in days
            };
            await routeToLossLeaderReview(mpn, payload);
            const result = {
                status: "Loss-Leader Review Pending",
                effective_store_regular,
                effective_store_sale,
                effective_web_regular,
                effective_web_sale,
                store_gm_pct,
                web_gm_pct,
                is_map_constrained,
                is_loss_leader: true,
                cost_is_estimated,
                cost,
                discrepancy_reasons: [],
            };
            return result;
        }
        // If acknowledgment not required, log but continue to Step 3B
    }
    // ── Step 3B: Pricing Discrepancy Check ──
    const discrepancy_reasons = [];
    // ricsOffer > ricsRetail → absolute blocker (TALLY-017)
    if ((0, pricingUtils_1.hasValidValue)(rics_offer) && (0, pricingUtils_1.hasValidValue)(rics_retail) && rics_offer > rics_retail) {
        discrepancy_reasons.push(`Store sale price ($${rics_offer.toFixed(2)}) exceeds store regular price ($${rics_retail.toFixed(2)})`);
    }
    // scomSale > scom → absolute blocker (TALLY-017)
    if ((0, pricingUtils_1.hasValidValue)(scom_sale) && (0, pricingUtils_1.hasValidValue)(scom) && scom_sale > scom) {
        discrepancy_reasons.push(`Web sale price ($${scom_sale.toFixed(2)}) exceeds web regular price ($${scom.toFixed(2)})`);
    }
    // salePrice > $0 but regularPrice = $0 → Discrepancy (TALLY-080)
    if ((0, pricingUtils_1.hasValidValue)(scom_sale) && !(0, pricingUtils_1.hasValidValue)(scom)) {
        discrepancy_reasons.push(`Web sale price ($${scom_sale.toFixed(2)}) is set but web regular price is $0 or missing`);
    }
    if ((0, pricingUtils_1.hasValidValue)(rics_offer) && !(0, pricingUtils_1.hasValidValue)(rics_retail)) {
        discrepancy_reasons.push(`Store sale price ($${rics_offer.toFixed(2)}) is set but store regular price is $0 or missing`);
    }
    // Margin below safe threshold — warn but don't block
    if (store_gm_pct !== null && store_gm_pct < adminSettings.gross_margin_safe_threshold && store_gm_pct >= 0) {
        discrepancy_reasons.push(`Store gross margin (${store_gm_pct.toFixed(1)}%) is below safe threshold (${adminSettings.gross_margin_safe_threshold}%)`);
    }
    if (web_gm_pct !== null && web_gm_pct < adminSettings.gross_margin_safe_threshold && web_gm_pct >= 0) {
        discrepancy_reasons.push(`Web gross margin (${web_gm_pct.toFixed(1)}%) is below safe threshold (${adminSettings.gross_margin_safe_threshold}%)`);
    }
    if (discrepancy_reasons.length > 0) {
        await routeToPricingDiscrepancy(mpn, discrepancy_reasons);
        await logPricingEvent(mpn, "Pricing Discrepancy", discrepancy_reasons.join("; "));
        const result = {
            status: "Pricing Discrepancy",
            effective_store_regular,
            effective_store_sale,
            effective_web_regular,
            effective_web_sale,
            store_gm_pct,
            web_gm_pct,
            is_map_constrained,
            is_loss_leader,
            cost_is_estimated,
            cost,
            discrepancy_reasons,
        };
        return result;
    }
    // ── Step 4: All checks pass → Pricing Current ──
    await logPricingEvent(mpn, "Pricing Current", "All pricing checks passed");
    return {
        status: "Pricing Current",
        effective_store_regular,
        effective_store_sale,
        effective_web_regular,
        effective_web_sale,
        store_gm_pct,
        web_gm_pct,
        is_map_constrained,
        is_loss_leader,
        cost_is_estimated,
        cost,
        discrepancy_reasons: [],
    };
}
// ── Pricing Discrepancy Routing (TALLY-017) ──
async function routeToPricingDiscrepancy(mpn, reasons) {
    const firestore = firebase_admin_1.default.firestore();
    const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
    await firestore.collection("products").doc(docId).set({
        pricing_domain_state: "discrepancy",
        discrepancy_reasons: reasons,
        discrepancy_flagged_at: db.FieldValue.serverTimestamp(),
    }, { merge: true });
    // Audit log
    await firestore.collection("audit_log").add({
        product_mpn: mpn,
        event_type: "pricing_discrepancy_flagged",
        reasons,
        acting_user_id: "system",
        created_at: db.FieldValue.serverTimestamp(),
    });
}
// ── Loss-Leader Review Routing (TALLY-099) ──
async function routeToLossLeaderReview(mpn, payload) {
    const firestore = firebase_admin_1.default.firestore();
    const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
    // Layer 1: Set domain state
    await firestore.collection("products").doc(docId).set({
        pricing_domain_state: "loss_leader_review",
        loss_leader_flagged_at: db.FieldValue.serverTimestamp(),
        loss_leader_payload: payload,
    }, { merge: true });
    // Layer 3: Alert Head Buyers via in-app notification
    const headBuyers = await firestore
        .collection("users")
        .where("role", "==", "head_buyer")
        .get();
    for (const buyer of headBuyers.docs) {
        await firestore
            .collection("users")
            .doc(buyer.id)
            .collection("notifications")
            .add({
            type: "loss_leader_alert",
            product_mpn: mpn,
            payload,
            veto_window_expires_at: new Date(Date.now() + payload.veto_window_hours * 60 * 60 * 1000),
            is_read: false,
            created_at: db.FieldValue.serverTimestamp(),
        });
    }
    // Audit log
    await firestore.collection("audit_log").add({
        product_mpn: mpn,
        event_type: "loss_leader_review_initiated",
        payload,
        acting_user_id: "system",
        created_at: db.FieldValue.serverTimestamp(),
    });
}
// ── Pricing event logger — called at every routing outcome ──
async function logPricingEvent(mpn, status, detail) {
    const firestore = firebase_admin_1.default.firestore();
    await firestore.collection("audit_log").add({
        product_mpn: mpn,
        event_type: "pricing_resolution",
        pricing_status: status,
        detail,
        acting_user_id: "system",
        created_at: db.FieldValue.serverTimestamp(),
    });
}
// ── Write pricing snapshot (append-only subcollection) ──
async function writePricingSnapshot(mpn, batchId, result) {
    const firestore = firebase_admin_1.default.firestore();
    const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
    const productRef = firestore.collection("products").doc(docId);
    // Append to pricing_snapshots subcollection
    await productRef.collection("pricing_snapshots").add({
        resolved_at: db.FieldValue.serverTimestamp(),
        import_batch_id: batchId,
        effective_store_regular: result.effective_store_regular,
        effective_store_sale: result.effective_store_sale,
        effective_web_regular: result.effective_web_regular,
        effective_web_sale: result.effective_web_sale,
        store_gm_pct: result.store_gm_pct,
        web_gm_pct: result.web_gm_pct,
        is_map_constrained: result.is_map_constrained,
        is_loss_leader: result.is_loss_leader,
        cost_is_estimated: result.cost_is_estimated,
        cost: result.cost,
        pricing_domain_state: result.status,
        discrepancy_reasons: result.discrepancy_reasons || [],
    });
    // Update top-level product document with current state
    const productSnap = await productRef.get();
    const productData = productSnap.data() || {};
    const mapPrice = Number(productData.map_price) || 0;
    const effectiveWebSale = result.effective_web_sale;
    const conflictActive = !!productData.is_map_protected &&
        result.is_map_constrained &&
        mapPrice > 0 &&
        effectiveWebSale > 0 &&
        effectiveWebSale < mapPrice;
    const conflictReason = conflictActive
        ? `Web sale ($${effectiveWebSale.toFixed(2)}) is below MAP floor ($${mapPrice.toFixed(2)})`
        : null;
    // Step 3.2 Correction 1 — Channel disparity flags stamped on product doc.
    // Readers must filter by these booleans, not recompute from raw fields.
    const esr = result.effective_store_regular;
    const ess = result.effective_store_sale;
    const ewr = result.effective_web_regular;
    const ews = result.effective_web_sale;
    const storeOnSale = ess > 0 && esr > 0 && ess < esr;
    const webOnSale = ews > 0 && ewr > 0 && ews < ewr;
    const webAtFull = !ews || ews <= 0 || (ewr > 0 && ews >= ewr);
    const storeAtFull = !ess || ess <= 0 || (esr > 0 && ess >= esr);
    const isStoreSaleWebFull = storeOnSale && webAtFull;
    const isWebSaleStoreFull = webOnSale && storeAtFull;
    await productRef.set({
        pricing_domain_state: result.status,
        is_loss_leader: result.is_loss_leader,
        is_map_constrained: result.is_map_constrained,
        store_gm_pct: result.store_gm_pct,
        web_gm_pct: result.web_gm_pct,
        pricing_resolved_at: db.FieldValue.serverTimestamp(),
        map_conflict_active: conflictActive,
        map_conflict_reason: conflictReason,
        map_conflict_flagged_at: conflictActive
            ? db.FieldValue.serverTimestamp()
            : null,
        is_store_sale_web_full: isStoreSaleWebFull,
        is_web_sale_store_full: isWebSaleStoreFull,
    }, { merge: true });
}
//# sourceMappingURL=pricingResolution.js.map