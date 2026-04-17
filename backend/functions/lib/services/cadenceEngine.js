"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchesTargetFilters = matchesTargetFilters;
exports.matchesTriggerConditions = matchesTriggerConditions;
exports.runCadenceEvaluation = runCadenceEvaluation;
/**
 * Step 2.2 — Cadence Evaluation Engine (Section 14.5).
 * Evaluates every committed product against active cadence_rules and writes
 * a cadence_assignment with an approval-ready recommendation.
 *
 * Philosophy: evaluation only — never auto-executes pricing changes.
 * Every recommendation routes to buyer approval.
 *
 * TALLY-104: string operators honor case_sensitive on each filter condition.
 */
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const mpnUtils_1 = require("./mpnUtils");
const pricingUtils_1 = require("./pricingUtils");
const mapState_1 = require("./mapState");
const db = () => firebase_admin_1.default.firestore();
const ts = () => firebase_admin_1.default.firestore.FieldValue.serverTimestamp();
// ── Helpers ──
function getProductField(product, field) {
    // Support dotted paths like attributes.gender
    if (field.includes(".")) {
        const parts = field.split(".");
        let cur = product;
        for (const p of parts) {
            if (cur == null)
                return null;
            cur = cur[p];
        }
        return cur;
    }
    return product[field];
}
function matchesTargetFilters(product, filters) {
    if (!filters || filters.length === 0)
        return true;
    return filters.every((f) => {
        const fv = getProductField(product, f.field);
        if (fv === null || fv === undefined)
            return false;
        const caseSensitive = f.case_sensitive !== false; // default ON (TALLY-104)
        const a = caseSensitive ? String(fv) : String(fv).toLowerCase();
        const b = caseSensitive ? String(f.value) : String(f.value).toLowerCase();
        switch (f.operator) {
            case "equals":
                return a === b;
            case "not_equals":
                return a !== b;
            case "contains":
                return a.includes(b);
            case "starts_with":
                return a.startsWith(b);
            default:
                return false;
        }
    });
}
function evaluateCondition(signals, c) {
    const v = signals[c.field];
    if (v === null || v === undefined)
        return false;
    const target = c.value;
    switch (c.operator) {
        case "less_than":
            return Number(v) < Number(target);
        case "greater_than":
            return Number(v) > Number(target);
        case "less_than_or_equal":
            return Number(v) <= Number(target);
        case "greater_than_or_equal":
            return Number(v) >= Number(target);
        case "equals":
            if (typeof target === "boolean")
                return Boolean(v) === target;
            return Number(v) === Number(target);
        default:
            return false;
    }
}
function matchesTriggerConditions(signals, conditions) {
    if (!conditions || conditions.length === 0)
        return true;
    const andC = conditions.filter((c) => c.logic === "AND" || !c.logic);
    const orC = conditions.filter((c) => c.logic === "OR");
    const andResult = andC.every((c) => evaluateCondition(signals, c));
    const orResult = orC.length === 0 || orC.some((c) => evaluateCondition(signals, c));
    return andResult && orResult;
}
function buildSignals(product) {
    const invStore = Number(product.inventory_store) || 0;
    const invWarehouse = Number(product.inventory_warehouse) || 0;
    const invWhs = Number(product.inventory_whs) || 0;
    // product_age_days — first_received_at until now
    let productAgeDays = null;
    const first = product.first_received_at?.toDate?.();
    if (first) {
        productAgeDays = Math.floor((Date.now() - first.getTime()) / (24 * 60 * 60 * 1000));
    }
    return {
        str_pct: product.str_pct != null
            ? Number(product.str_pct) * (product.str_pct <= 1 ? 100 : 1)
            : null, // normalize to percent if fractional
        wos: product.wos != null ? Number(product.wos) : null,
        product_age_days: productAgeDays,
        inventory_total: invStore + invWarehouse + invWhs,
        inventory_store: invStore,
        is_slow_moving: product.is_slow_moving === true,
        store_gm_pct: product.store_gm_pct != null ? Number(product.store_gm_pct) : null,
        web_gm_pct: product.web_gm_pct != null ? Number(product.web_gm_pct) : null,
        days_in_queue: Number(product.days_in_queue) || 0,
        is_map_protected: product.is_map_protected === true,
    };
}
async function writeConflictAssignment(mpn, rules) {
    const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
    await db().collection("cadence_assignments").doc(docId).set({
        mpn,
        cadence_state: "assigned",
        conflict: true,
        conflict_rule_ids: rules.map((r) => r.id),
        matched_rule_id: null,
        recommendation: null,
        in_buyer_queue: false,
        last_evaluated_at: ts(),
    }, { merge: true });
    await db().collection("audit_log").add({
        product_mpn: mpn,
        event_type: "cadence_conflict",
        conflict_rule_ids: rules.map((r) => r.id),
        acting_user_id: "system",
        created_at: ts(),
    });
}
async function writeUnassigned(mpn) {
    const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
    await db().collection("cadence_assignments").doc(docId).set({
        mpn,
        cadence_state: "unassigned",
        matched_rule_id: null,
        matched_rule_version: null,
        recommendation: null,
        in_buyer_queue: false,
        conflict: false,
        conflict_rule_ids: [],
        last_evaluated_at: ts(),
    }, { merge: true });
}
async function writeAssignment(mpn, rule, signals, product) {
    const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
    const ref = db().collection("cadence_assignments").doc(docId);
    const existingSnap = await ref.get();
    const existing = existingSnap.exists ? existingSnap.data() : null;
    const sameRuleSameVersion = existing &&
        existing.matched_rule_id === rule.id &&
        existing.matched_rule_version === rule.version;
    // Compute days_at_current_step
    let daysAtStep = 0;
    let stepFirstMatchedAt = existing?.step_first_matched_at || null;
    if (sameRuleSameVersion && stepFirstMatchedAt?.toDate) {
        daysAtStep = Math.floor((Date.now() - stepFirstMatchedAt.toDate().getTime()) / (24 * 60 * 60 * 1000));
    }
    // Find the step appropriate for daysAtStep
    const sortedSteps = [...rule.markdown_steps].sort((a, b) => a.day_threshold - b.day_threshold);
    let currentStep = sortedSteps[0];
    for (const s of sortedSteps) {
        if (daysAtStep >= s.day_threshold)
            currentStep = s;
    }
    // Correction 1 + 2 — compute new prices with never-raise-price guard + MAP floor
    const ricsRetail = Number(product.rics_retail) || 0;
    const currentRicsOffer = Number(product.rics_offer) || 0;
    const currentScomSale = Number(product.scom_sale) || 0;
    let newRicsOffer = currentRicsOffer;
    let exportRicsOffer = currentRicsOffer;
    let newScomSale = null;
    let exportScomSale = null;
    const applyRounding = currentStep.apply_99_rounding !== false; // default true
    if (currentStep.action_type === "markdown_pct") {
        // Correction 2 — never raise price; base is rics_retail (not compounding)
        const candidate = ricsRetail * (1 - currentStep.value / 100);
        newRicsOffer = Math.min(candidate, currentRicsOffer || candidate);
        exportRicsOffer = applyRounding ? (0, pricingUtils_1.apply99Rounding)(newRicsOffer) : newRicsOffer;
    }
    else if (currentStep.action_type === "custom_price") {
        newRicsOffer = Math.min(currentStep.value, currentRicsOffer || currentStep.value);
        exportRicsOffer = applyRounding ? (0, pricingUtils_1.apply99Rounding)(newRicsOffer) : newRicsOffer;
    }
    else if (currentStep.action_type === "off_sale") {
        newRicsOffer = ricsRetail;
        exportRicsOffer = ricsRetail;
    }
    else if (currentStep.action_type === "set_in_cart_promo") {
        // Store price unchanged; we mirror offer as-is
        newRicsOffer = currentRicsOffer;
        exportRicsOffer = currentRicsOffer;
    }
    // Correction 1 — scope store_and_web also writes scom_sale with MAP floor enforcement
    if (currentStep.markdown_scope === "store_and_web") {
        const mapState = await (0, mapState_1.getMapState)(mpn);
        let candidateWeb;
        if (currentStep.action_type === "off_sale") {
            candidateWeb = Number(product.scom) || ricsRetail;
        }
        else {
            candidateWeb = newRicsOffer;
        }
        // Never raise price on web either (floor at current scom_sale when lower)
        let webPrice = Math.min(candidateWeb, currentScomSale > 0 ? currentScomSale : candidateWeb);
        // MAP floor enforcement
        let mapFloorApplied = false;
        if (mapState.is_active && mapState.map_price > 0 && webPrice < mapState.map_price) {
            webPrice = mapState.map_price;
            mapFloorApplied = true;
        }
        newScomSale = Math.round(webPrice * 100) / 100;
        // Skip 99-rounding when MAP floor was applied (would violate MAP)
        exportScomSale =
            applyRounding && !mapFloorApplied ? (0, pricingUtils_1.apply99Rounding)(newScomSale) : newScomSale;
    }
    // Build explanation
    const explanation = [];
    for (const t of rule.trigger_conditions) {
        const v = signals[t.field];
        const disp = typeof v === "number" ? v.toFixed(2).replace(/\.00$/, "") : String(v);
        explanation.push(`${t.field} (${disp}) ${t.operator} ${t.value}`);
    }
    const recommendation = {
        action_type: currentStep.action_type,
        markdown_scope: currentStep.markdown_scope,
        value: currentStep.value,
        new_rics_offer: Math.round(newRicsOffer * 100) / 100,
        export_rics_offer: Math.round(exportRicsOffer * 100) / 100,
        rule_name: rule.rule_name,
        rule_id: rule.id,
        step_number: currentStep.step_number,
        explanation,
    };
    if (newScomSale !== null) {
        recommendation.new_scom_sale = newScomSale;
        recommendation.export_scom_sale = exportScomSale;
    }
    const updates = {
        mpn,
        cadence_state: "assigned",
        matched_rule_id: rule.id,
        matched_rule_version: rule.version,
        current_step: currentStep.step_number,
        step_first_matched_at: stepFirstMatchedAt || ts(),
        days_at_current_step: daysAtStep,
        last_evaluated_at: ts(),
        next_step_due_at: null,
        recommendation,
        in_buyer_queue: true,
        buyer_queue_entered_at: existing?.buyer_queue_entered_at || ts(),
        days_in_queue: existing?.days_in_queue || 0,
        conflict: false,
        conflict_rule_ids: [],
    };
    await ref.set(updates, { merge: true });
    await db().collection("audit_log").add({
        product_mpn: mpn,
        event_type: "cadence_evaluated",
        rule_id: rule.id,
        rule_name: rule.rule_name,
        step_number: currentStep.step_number,
        action_type: currentStep.action_type,
        acting_user_id: "system",
        created_at: ts(),
    });
}
// ── Main entry point ──
async function runCadenceEvaluation(importedMpns) {
    const rulesSnap = await db()
        .collection("cadence_rules")
        .where("is_active", "==", true)
        .get();
    const rules = rulesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    let evaluated = 0;
    let assigned = 0;
    let unassigned = 0;
    let conflicts = 0;
    let skippedMid = 0;
    for (const mpn of importedMpns) {
        try {
            const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
            const productSnap = await db().collection("products").doc(docId).get();
            if (!productSnap.exists)
                continue;
            const product = productSnap.data();
            const signals = buildSignals(product);
            const matched = rules.filter((r) => matchesTargetFilters(product, r.target_filters) &&
                matchesTriggerConditions(signals, r.trigger_conditions));
            evaluated++;
            // Correction 3 — if product is mid-cadence on older rule version, skip and
            // only update last_evaluated_at
            const assignRef = db().collection("cadence_assignments").doc(docId);
            const existingSnap = await assignRef.get();
            const existing = existingSnap.exists ? existingSnap.data() : null;
            if (existing &&
                existing.matched_rule_id &&
                existing.in_buyer_queue &&
                matched.some((r) => r.id === existing.matched_rule_id)) {
                const currentRule = matched.find((r) => r.id === existing.matched_rule_id);
                if (existing.matched_rule_version != null &&
                    existing.matched_rule_version < currentRule.version) {
                    await assignRef.set({ last_evaluated_at: ts() }, { merge: true });
                    skippedMid++;
                    continue;
                }
            }
            if (matched.length === 0) {
                await writeUnassigned(mpn);
                unassigned++;
                continue;
            }
            if (matched.length === 1) {
                await writeAssignment(mpn, matched[0], signals, product);
                assigned++;
                continue;
            }
            // Multiple matches — most specific wins; equal specificity → conflict
            matched.sort((a, b) => (b.target_filters?.length || 0) - (a.target_filters?.length || 0));
            const topSpec = matched[0].target_filters?.length || 0;
            const topMatches = matched.filter((r) => (r.target_filters?.length || 0) === topSpec);
            if (topMatches.length > 1) {
                await writeConflictAssignment(mpn, topMatches);
                conflicts++;
                continue;
            }
            await writeAssignment(mpn, matched[0], signals, product);
            assigned++;
        }
        catch (err) {
            console.error(`runCadenceEvaluation error for ${mpn}:`, err.message);
        }
    }
    return { evaluated, assigned, unassigned, conflicts, skipped_mid_cadence: skippedMid };
}
//# sourceMappingURL=cadenceEngine.js.map