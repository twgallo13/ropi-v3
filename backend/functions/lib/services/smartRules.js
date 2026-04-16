"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeSmartRules = executeSmartRules;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const db = firebase_admin_1.default.firestore;
// TALLY-082 — UUID / GUID detection patterns
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUID_LIKE_PATTERN = /^[0-9a-f-]{20,}$/i;
/**
 * Evaluate a single condition against a product's field values.
 * is_empty contract (Section 19.10): null or whitespace-only = empty.
 * "0" and false are NOT empty.
 */
function evaluateCondition(fieldValue, operator, targetValue) {
    switch (operator) {
        case "matches": {
            if (targetValue === "UUID_PATTERN") {
                const strVal = String(fieldValue ?? "");
                return UUID_PATTERN.test(strVal) || GUID_LIKE_PATTERN.test(strVal);
            }
            return String(fieldValue ?? "") === targetValue;
        }
        case "is empty": {
            if (fieldValue === null || fieldValue === undefined)
                return true;
            if (typeof fieldValue === "string" && fieldValue.trim() === "")
                return true;
            return false;
        }
        case "is not empty": {
            if (fieldValue === null || fieldValue === undefined)
                return false;
            if (typeof fieldValue === "string" && fieldValue.trim() === "")
                return false;
            return true;
        }
        default:
            return false;
    }
}
/**
 * Execute all active Smart Rules against a single product.
 * Called synchronously after every product write during import commit.
 *
 * Section 19.10 requirements:
 * - Fetch active rules ordered by priority ASC, id ASC
 * - Check Human-Verified ceiling FIRST before any write
 * - Write provenance stamp on every value written (TALLY-044)
 * - UUID Name Cleanup: preserve raw GUID in source_inputs.raw_name_original
 * - If target_attribute not in attribute_registry → log error, skip, continue
 */
async function executeSmartRules(mpn, batchId) {
    const firestore = firebase_admin_1.default.firestore();
    const result = {
        rules_fired: 0,
        uuid_names_cleaned: false,
        image_status_set: null,
    };
    // Fetch all active rules, ordered by priority ASC, id ASC
    const rulesSnap = await firestore
        .collection("smart_rules")
        .where("is_active", "==", true)
        .get();
    if (rulesSnap.empty)
        return result;
    // Sort in memory: priority ASC, then document ID ASC
    const sortedDocs = rulesSnap.docs.sort((a, b) => {
        const pA = a.data().priority ?? 999;
        const pB = b.data().priority ?? 999;
        if (pA !== pB)
            return pA - pB;
        return a.id.localeCompare(b.id);
    });
    // Fetch the product document
    const productRef = firestore.collection("products").doc(mpn);
    const productSnap = await productRef.get();
    if (!productSnap.exists)
        return result;
    const productData = productSnap.data();
    // AC9 — Load attribute_registry keys for target_attribute validation
    const registrySnap = await firestore.collection("attribute_registry").get();
    const registryKeys = new Set(registrySnap.docs.map((d) => d.id));
    for (const ruleDoc of sortedDocs) {
        const rule = { id: ruleDoc.id, ...ruleDoc.data() };
        // AC9 — If target_attribute not in attribute_registry, skip with named error log
        if (!registryKeys.has(rule.action.target_attribute)) {
            console.error(`Smart Rule "${rule.id}": target_attribute "${rule.action.target_attribute}" not found in attribute_registry — skipping.`);
            continue;
        }
        // Evaluate all conditions
        const conditionResults = rule.conditions.map((c) => {
            const fieldValue = productData[c.source_field] ?? null;
            return evaluateCondition(fieldValue, c.operator, c.target_value);
        });
        // Apply condition_logic
        let conditionsMet = false;
        if (rule.condition_logic === "AND") {
            conditionsMet = conditionResults.every((r) => r);
        }
        else if (rule.condition_logic === "OR") {
            conditionsMet = conditionResults.some((r) => r);
        }
        if (!conditionsMet)
            continue;
        // Check Human-Verified ceiling FIRST — before any write path (TALLY-044)
        const attrRef = productRef
            .collection("attribute_values")
            .doc(rule.action.target_attribute);
        const attrSnap = await attrRef.get();
        if (attrSnap.exists &&
            attrSnap.data()?.verification_state === "Human-Verified") {
            // Human-Verified is the absolute ceiling — no automated rule exceeds it
            continue;
        }
        // For fill-if-empty: skip if value already exists and always_overwrite is false
        if (!rule.always_overwrite && attrSnap.exists) {
            const existingVal = attrSnap.data()?.value;
            if (existingVal !== null && existingVal !== undefined && existingVal !== "") {
                continue;
            }
        }
        // UUID Name Cleanup special handling: preserve raw GUID before blanking
        if (rule.id === "rule_uuid_name_cleanup") {
            const rawName = productData.name ?? productData.product_name ?? "";
            if (rawName) {
                await productRef
                    .collection("attribute_values")
                    .doc("source_inputs")
                    .set({ raw_name_original: rawName }, { merge: true });
            }
            // Blank the name on the product document
            await productRef.set({ name: "", product_name: "" }, { merge: true });
            result.uuid_names_cleaned = true;
        }
        // Write the attribute value with full provenance stamp (TALLY-044)
        await attrRef.set({
            value: rule.action.output_value,
            origin_type: "Smart Rule",
            origin_detail: `Rule #${rule.id}`,
            verification_state: "System-Applied",
            written_at: db.FieldValue.serverTimestamp(),
        }, { merge: true });
        // Track image status results
        if (rule.action.target_attribute === "image_status") {
            result.image_status_set = rule.action.output_value;
        }
        result.rules_fired++;
    }
    return result;
}
//# sourceMappingURL=smartRules.js.map