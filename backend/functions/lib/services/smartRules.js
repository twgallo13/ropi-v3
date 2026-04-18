"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeSmartRules = executeSmartRules;
exports.dryRunSmartRule = dryRunSmartRule;
/**
 * Smart Rules Engine — Step 3.1 upgrade.
 *
 * Supports TWO schemas:
 *   LEGACY (Phase 1):
 *     { conditions:[{source_field, operator, target_value}],
 *       condition_logic: "AND" | "OR",
 *       action: { target_attribute, output_value } }
 *     operators: matches | is empty | is not empty
 *
 *   CANONICAL (Step 3.1 forward):
 *     { conditions:[{field, operator, value, logic, case_sensitive}],
 *       actions:[{target_field, value}] }
 *     operators: equals | not_equals | contains | starts_with
 *                | is_empty | is_not_empty | matches
 *
 * Invariants (Section 19.10):
 *   - Rules evaluated priority ASC, id ASC
 *   - Human-Verified is the absolute ceiling — NEVER overwritten
 *   - always_overwrite overrides System-Applied but not Human-Verified
 *   - Fill-if-empty is default
 *   - Every write carries provenance stamp (TALLY-044)
 *   - target_field must exist in attribute_registry (AC9) — else skip + log
 *   - Condition field lookup order: product doc → attribute_values → source_inputs
 */
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const db = firebase_admin_1.default.firestore;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUID_LIKE_PATTERN = /^[0-9a-f-]{20,}$/i;
// ── Primitive helpers ──────────────────────────────────────────────────────
function normalize(v, caseSensitive) {
    const s = v === null || v === undefined ? "" : String(v);
    return caseSensitive ? s : s.toLowerCase();
}
function isEmptyValue(v) {
    if (v === null || v === undefined)
        return true;
    if (typeof v === "string" && v.trim() === "")
        return true;
    return false;
}
// ── Canonical condition evaluator ──────────────────────────────────────────
function evalCanonicalCondition(fieldValue, c) {
    const caseSensitive = c.case_sensitive !== false; // default TRUE (TALLY-104)
    const op = (c.operator || "").toLowerCase();
    if (op === "is_empty" || op === "is empty")
        return isEmptyValue(fieldValue);
    if (op === "is_not_empty" || op === "is not empty")
        return !isEmptyValue(fieldValue);
    if (op === "equals") {
        if (typeof c.value === "boolean" || typeof fieldValue === "boolean") {
            return String(fieldValue) === String(c.value);
        }
        return normalize(fieldValue, caseSensitive) === normalize(c.value, caseSensitive);
    }
    if (op === "not_equals") {
        return normalize(fieldValue, caseSensitive) !== normalize(c.value, caseSensitive);
    }
    if (op === "contains") {
        return normalize(fieldValue, caseSensitive).includes(normalize(c.value, caseSensitive));
    }
    if (op === "starts_with") {
        return normalize(fieldValue, caseSensitive).startsWith(normalize(c.value, caseSensitive));
    }
    if (op === "matches") {
        const target = String(c.value ?? "");
        const raw = String(fieldValue ?? "");
        if (target === "UUID_PATTERN") {
            return UUID_PATTERN.test(raw) || GUID_LIKE_PATTERN.test(raw);
        }
        try {
            const re = caseSensitive ? new RegExp(target) : new RegExp(target, "i");
            return re.test(raw);
        }
        catch {
            return raw === target;
        }
    }
    return false;
}
function evaluateConditions(conditions, resolve) {
    if (!conditions || conditions.length === 0)
        return false;
    const andGroup = conditions.filter((c) => !c.logic || c.logic === "AND");
    const orGroup = conditions.filter((c) => c.logic === "OR");
    const andPass = andGroup.every((c) => evalCanonicalCondition(resolve(c.field), c));
    const orPass = orGroup.length === 0 ||
        orGroup.some((c) => evalCanonicalCondition(resolve(c.field), c));
    return andPass && orPass;
}
// ── Legacy evaluator (Phase 1 schema) ──────────────────────────────────────
function evalLegacyOperator(fieldValue, operator, targetValue) {
    switch (operator) {
        case "matches":
            if (targetValue === "UUID_PATTERN") {
                const strVal = String(fieldValue ?? "");
                return UUID_PATTERN.test(strVal) || GUID_LIKE_PATTERN.test(strVal);
            }
            return String(fieldValue ?? "") === targetValue;
        case "is empty":
            return isEmptyValue(fieldValue);
        case "is not empty":
            return !isEmptyValue(fieldValue);
        default:
            return false;
    }
}
function evaluateLegacy(rule, resolve) {
    if (!Array.isArray(rule.conditions) || rule.conditions.length === 0)
        return false;
    const results = rule.conditions.map((c) => evalLegacyOperator(resolve(c.source_field), c.operator, c.target_value));
    if (rule.condition_logic === "OR")
        return results.some((r) => r);
    return results.every((r) => r);
}
function resolveField(ctx, field) {
    if (!field)
        return undefined;
    if (field in ctx.productData && ctx.productData[field] !== undefined) {
        return ctx.productData[field];
    }
    if (field in ctx.attributeValues) {
        return ctx.attributeValues[field]?.value;
    }
    if (field in ctx.sourceInputs) {
        return ctx.sourceInputs[field];
    }
    return undefined;
}
async function loadProductContext(firestore, mpn) {
    const productRef = firestore.collection("products").doc(mpn);
    const productSnap = await productRef.get();
    if (!productSnap.exists)
        return null;
    const attrSnap = await productRef.collection("attribute_values").get();
    const attributeValues = {};
    let sourceInputs = {};
    for (const d of attrSnap.docs) {
        const data = d.data();
        if (d.id === "source_inputs") {
            sourceInputs = data;
        }
        else {
            attributeValues[d.id] = {
                value: data.value,
                verification_state: data.verification_state,
            };
        }
    }
    return {
        productData: productSnap.data(),
        attributeValues,
        sourceInputs,
    };
}
// ── Schema detection ───────────────────────────────────────────────────────
function isLegacyRule(rule) {
    if (Array.isArray(rule.actions) && rule.actions.length > 0)
        return false;
    if (rule.action && typeof rule.action === "object")
        return true;
    if (Array.isArray(rule.conditions) && rule.conditions[0]) {
        if ("source_field" in rule.conditions[0])
            return true;
        if ("field" in rule.conditions[0])
            return false;
    }
    return false;
}
// ── Write path (enforces ceilings + provenance + audit) ────────────────────
async function writeRuleAction(firestore, mpn, batchId, ruleId, ruleName, targetField, value, alwaysOverwrite, registryKeys) {
    if (!targetField)
        return { wrote: false, skippedReason: "missing target_field" };
    if (!registryKeys.has(targetField)) {
        console.error(`Smart Rule "${ruleId}": target_field "${targetField}" not found in attribute_registry — skipping.`);
        return { wrote: false, skippedReason: "target_field not in registry" };
    }
    const productRef = firestore.collection("products").doc(mpn);
    const attrRef = productRef.collection("attribute_values").doc(targetField);
    const attrSnap = await attrRef.get();
    if (attrSnap.exists && attrSnap.data()?.verification_state === "Human-Verified") {
        return { wrote: false, skippedReason: "Human-Verified ceiling" };
    }
    if (!alwaysOverwrite && attrSnap.exists) {
        const existingVal = attrSnap.data()?.value;
        if (existingVal !== null && existingVal !== undefined && existingVal !== "") {
            return { wrote: false, skippedReason: "fill-if-empty: already has value" };
        }
    }
    // Correction 1 (Step 2.5) — capture old value before write so history shows it.
    const oldValue = attrSnap.exists ? attrSnap.data()?.value ?? null : null;
    const oldVerificationState = attrSnap.exists
        ? attrSnap.data()?.verification_state ?? null
        : null;
    await attrRef.set({
        value,
        origin_type: "Smart Rule",
        origin_detail: `Rule #${ruleId} — ${ruleName}`,
        verification_state: "Rule-Verified",
        written_at: db.FieldValue.serverTimestamp(),
    }, { merge: true });
    await firestore.collection("audit_log").add({
        event_type: "smart_rule_execution",
        product_mpn: mpn,
        rule_id: ruleId,
        rule_name: ruleName,
        mpn,
        field_key: targetField,
        target_field: targetField,
        old_value: oldValue,
        old_verification_state: oldVerificationState,
        new_value: value,
        new_verification_state: "Rule-Verified",
        value,
        overwrite: !!alwaysOverwrite,
        batch_id: batchId || null,
        acting_user_id: `smart_rule:${ruleId}`,
        source_type: "smart_rule",
        timestamp: db.FieldValue.serverTimestamp(),
        created_at: db.FieldValue.serverTimestamp(),
    });
    return { wrote: true };
}
// ── Public: executeSmartRules ──────────────────────────────────────────────
async function executeSmartRules(mpn, batchId) {
    const firestore = firebase_admin_1.default.firestore();
    const result = {
        rules_fired: 0,
        uuid_names_cleaned: false,
        image_status_set: null,
        actions_written: [],
    };
    const rulesSnap = await firestore
        .collection("smart_rules")
        .where("is_active", "==", true)
        .get();
    if (rulesSnap.empty)
        return result;
    const sortedDocs = rulesSnap.docs.sort((a, b) => {
        const pA = a.data().priority ?? 999;
        const pB = b.data().priority ?? 999;
        if (pA !== pB)
            return pA - pB;
        return a.id.localeCompare(b.id);
    });
    const ctx = await loadProductContext(firestore, mpn);
    if (!ctx)
        return result;
    const registrySnap = await firestore.collection("attribute_registry").get();
    const registryKeys = new Set(registrySnap.docs.map((d) => d.id));
    for (const ruleDoc of sortedDocs) {
        const raw = ruleDoc.data();
        const ruleId = ruleDoc.id;
        const ruleName = raw.rule_name || ruleId;
        const alwaysOverwrite = !!raw.always_overwrite;
        const legacy = isLegacyRule(raw);
        const matched = legacy
            ? evaluateLegacy(raw, (f) => resolveField(ctx, f))
            : evaluateConditions(raw.conditions || [], (f) => resolveField(ctx, f));
        if (!matched)
            continue;
        // Legacy UUID Name Cleanup preserves raw before blanking
        if (legacy && ruleId === "rule_uuid_name_cleanup") {
            const rawName = ctx.productData.name ?? "";
            if (rawName) {
                await firestore
                    .collection("products")
                    .doc(mpn)
                    .collection("attribute_values")
                    .doc("source_inputs")
                    .set({ raw_name_original: rawName }, { merge: true });
            }
            await firestore
                .collection("products")
                .doc(mpn)
                .set({ name: "" }, { merge: true });
            result.uuid_names_cleaned = true;
        }
        const actions = legacy
            ? [
                {
                    target_field: raw.action?.target_attribute,
                    value: raw.action?.output_value,
                },
            ]
            : Array.isArray(raw.actions)
                ? raw.actions
                : [];
        let firedAny = false;
        for (const a of actions) {
            const r = await writeRuleAction(firestore, mpn, batchId, ruleId, ruleName, a.target_field, a.value, alwaysOverwrite, registryKeys);
            if (r.wrote) {
                firedAny = true;
                result.actions_written.push({
                    rule_id: ruleId,
                    rule_name: ruleName,
                    target_field: a.target_field,
                    value: a.value,
                    overwrite: alwaysOverwrite,
                });
                // Refresh cache so subsequent higher-priority rules see fresh values
                ctx.attributeValues[a.target_field] = {
                    value: a.value,
                    verification_state: "Rule-Verified",
                };
                if (a.target_field === "image_status") {
                    result.image_status_set = String(a.value);
                }
            }
        }
        if (firedAny)
            result.rules_fired++;
    }
    return result;
}
async function dryRunSmartRule(rule, mpn) {
    const firestore = firebase_admin_1.default.firestore();
    const ctx = await loadProductContext(firestore, mpn);
    if (!ctx)
        return { would_match: false, would_write: [] };
    const legacy = isLegacyRule(rule);
    const matched = legacy
        ? evaluateLegacy(rule, (f) => resolveField(ctx, f))
        : evaluateConditions(rule.conditions || [], (f) => resolveField(ctx, f));
    if (!matched)
        return { would_match: false, would_write: [] };
    const registrySnap = await firestore.collection("attribute_registry").get();
    const registryKeys = new Set(registrySnap.docs.map((d) => d.id));
    const actions = legacy
        ? [
            {
                target_field: rule.action?.target_attribute,
                value: rule.action?.output_value,
            },
        ]
        : Array.isArray(rule.actions)
            ? rule.actions
            : [];
    const productRef = firestore.collection("products").doc(mpn);
    const alwaysOverwrite = !!rule.always_overwrite;
    const would_write = [];
    for (const a of actions) {
        if (!a.target_field) {
            would_write.push({ target_field: "", value: a.value, blocked_reason: "missing target_field" });
            continue;
        }
        if (!registryKeys.has(a.target_field)) {
            would_write.push({
                target_field: a.target_field,
                value: a.value,
                blocked_reason: "target_field not in attribute_registry",
            });
            continue;
        }
        const attrSnap = await productRef.collection("attribute_values").doc(a.target_field).get();
        if (attrSnap.exists && attrSnap.data()?.verification_state === "Human-Verified") {
            would_write.push({
                target_field: a.target_field,
                value: a.value,
                blocked_reason: "Human-Verified ceiling",
            });
            continue;
        }
        if (!alwaysOverwrite && attrSnap.exists) {
            const existing = attrSnap.data()?.value;
            if (existing !== null && existing !== undefined && existing !== "") {
                would_write.push({
                    target_field: a.target_field,
                    value: a.value,
                    blocked_reason: "fill-if-empty: field already has value",
                });
                continue;
            }
        }
        would_write.push({ target_field: a.target_field, value: a.value, blocked_reason: null });
    }
    return { would_match: true, would_write };
}
//# sourceMappingURL=smartRules.js.map