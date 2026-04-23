"use strict";
/**
 * services/completionCompute.ts
 *
 * Pre-computation pattern reference for TALLY-P1 + future
 * domain-compute services (Pillar 2 of TALLY-PRODUCT-LIST-UX).
 *
 * Module structure:
 * - services/<domain>Compute.ts
 * - Exports: compute<Domain>() + stamp<Domain>OnProduct()
 * - Pure helpers (no Firestore) + impure convenience wrappers
 * - Stamp is non-transactional (PO Ruling N 2026-04-23)
 * - Stamp called by HTTP route handlers only, never services
 *   (PO Ruling 2026-04-23 architectural rule)
 * - Field naming per-domain, not forced <domain>_ prefix
 * - warning_count / warning semantics defined per-domain
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRequiredFieldKeysPure = getRequiredFieldKeysPure;
exports.computeCompletionProgressPure = computeCompletionProgressPure;
exports.buildNextActionHintPure = buildNextActionHintPure;
exports.getRequiredFieldKeys = getRequiredFieldKeys;
exports.computeCompletionProgress = computeCompletionProgress;
exports.computeCompletion = computeCompletion;
exports.stampCompletionOnProduct = stampCompletionOnProduct;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const mpnUtils_1 = require("./mpnUtils");
// ────────────────────────────────────────────────
//  Pure helpers (no Firestore)
// ────────────────────────────────────────────────
/**
 * Pure: extract the required-field list from an attribute_registry snapshot.
 *
 * NOTE on signature deviation from dispatch (returns RequiredField[] not
 * string[]): callers need the display_label to build human-readable blocker
 * messages and the next_action_hint. Returning the richer shape keeps the
 * pure boundary while preserving label fidelity.
 */
function getRequiredFieldKeysPure(attributeRegistrySnap) {
    return attributeRegistrySnap.docs.map((d) => ({
        field_key: d.id,
        display_label: d.data().display_label || d.id,
    }));
}
/**
 * Pure: compute completion progress from required fields + attribute_values.
 *
 * Inputs are plain objects (no Firestore): callers convert their snapshots
 * to AttributeValueLike[] before invoking this.
 */
function computeCompletionProgressPure(required, attributeValues) {
    const attrMap = new Map();
    for (const av of attributeValues) {
        if (av.id !== "source_inputs")
            attrMap.set(av.id, av);
    }
    const present = [];
    const missing = [];
    const blockers = [];
    let completed = 0;
    for (const rf of required) {
        const attr = attrMap.get(rf.field_key);
        const hasValue = attr &&
            attr.value !== undefined &&
            attr.value !== null &&
            attr.value !== "";
        if (hasValue) {
            const isVerified = attr.verification_state === "Human-Verified" ||
                attr.verification_state === "Rule-Verified";
            if (isVerified) {
                completed++;
                present.push(rf.field_key);
            }
            else {
                missing.push(rf.field_key);
                blockers.push(`${rf.display_label} must be verified`);
            }
        }
        else {
            missing.push(rf.field_key);
            blockers.push(`${rf.display_label} is required`);
        }
    }
    // ai_blockers per PO Ruling N1 2026-04-23: count of attribute_values where
    // origin_type === "AI" AND verification_state !== "Human-Verified".
    // This is a separate scan from required-field gating — an AI-origin field
    // can be "AI blocker" even if it isn't on the required list.
    const ai_blockers = [];
    for (const av of attributeValues) {
        if (av.id === "source_inputs")
            continue;
        if (av.origin_type === "AI" && av.verification_state !== "Human-Verified") {
            ai_blockers.push(av.id);
        }
    }
    const total = required.length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 100;
    return { percent, present, missing, blockers, ai_blockers };
}
/**
 * Pure: build the next_action_hint string per dispatch prioritization.
 *   1. AI blockers present → "Approve AI content: <field>"
 *   2. Else missing required → "Fill <field>"
 *   3. Else → ""
 */
function buildNextActionHintPure(inner, required) {
    if (inner.ai_blockers.length > 0) {
        return `Approve AI content: ${inner.ai_blockers[0]}`;
    }
    if (inner.missing.length > 0) {
        const firstKey = inner.missing[0];
        const rf = required.find((r) => r.field_key === firstKey);
        const label = rf ? rf.display_label : firstKey;
        return `Fill ${label}`;
    }
    return "";
}
// ────────────────────────────────────────────────
//  Impure convenience wrappers (read Firestore)
// ────────────────────────────────────────────────
/** Convenience: load required fields from attribute_registry. */
async function getRequiredFieldKeys(firestore) {
    const snap = await firestore
        .collection("attribute_registry")
        .where("required_for_completion", "==", true)
        .get();
    return getRequiredFieldKeysPure(snap);
}
/**
 * Convenience: legacy 3-arg signature preserved for in-file products.ts call
 * sites (list + detail handlers fetch requiredFields once and pass it per row).
 *
 * Returns the back-compat CompletionProgress payload (kept additive per PO
 * Ruling N4 2026-04-23 — frontend completion_progress consumers unchanged).
 */
async function computeCompletionProgress(firestore, docId, requiredFields) {
    const avSnap = await firestore
        .collection("products")
        .doc(docId)
        .collection("attribute_values")
        .get();
    const avList = avSnap.docs.map((d) => {
        const data = d.data();
        return {
            id: d.id,
            value: data.value,
            verification_state: data.verification_state ?? null,
            origin_type: data.origin_type ?? null,
        };
    });
    const inner = computeCompletionProgressPure(requiredFields, avList);
    return {
        total_required: requiredFields.length,
        completed: inner.present.length,
        pct: inner.percent,
        blockers: inner.blockers,
    };
}
/**
 * Compute the 5-field projection for a product. Loads attribute_registry +
 * attribute_values, runs pure compute, returns the stamp payload.
 *
 * Called by HTTP route handlers only (per PO Ruling 2026-04-23 architectural
 * rule). Services do their work; callers at HTTP boundary stamp.
 */
async function computeCompletion(mpn) {
    const firestore = firebase_admin_1.default.firestore();
    const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
    const [registrySnap, avSnap] = await Promise.all([
        firestore
            .collection("attribute_registry")
            .where("required_for_completion", "==", true)
            .get(),
        firestore
            .collection("products")
            .doc(docId)
            .collection("attribute_values")
            .get(),
    ]);
    const required = getRequiredFieldKeysPure(registrySnap);
    const avList = avSnap.docs.map((d) => {
        const data = d.data();
        return {
            id: d.id,
            value: data.value,
            verification_state: data.verification_state ?? null,
            origin_type: data.origin_type ?? null,
        };
    });
    const inner = computeCompletionProgressPure(required, avList);
    const next_action_hint = buildNextActionHintPure(inner, required);
    return {
        completion_percent: inner.percent,
        blocker_count: inner.missing.length,
        ai_blocker_count: inner.ai_blockers.length,
        next_action_hint,
        completion_last_computed_at: firebase_admin_1.default.firestore.FieldValue.serverTimestamp(),
    };
}
/**
 * Stamp the 5 pre-computed completion fields onto products/{mpn}.
 *
 * Best-effort, non-transactional (PO Ruling N 2026-04-23 — NO tx parameter).
 * Uses set with merge:true so the write is purely additive (Step 2.1 schema
 * additivity rule).
 */
async function stampCompletionOnProduct(productRef, computeResult) {
    await productRef.set({
        completion_percent: computeResult.completion_percent,
        blocker_count: computeResult.blocker_count,
        ai_blocker_count: computeResult.ai_blocker_count,
        next_action_hint: computeResult.next_action_hint,
        completion_last_computed_at: computeResult.completion_last_computed_at,
    }, { merge: true });
}
//# sourceMappingURL=completionCompute.js.map