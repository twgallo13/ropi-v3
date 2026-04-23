"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeBrand = normalizeBrand;
exports.loadBrandRegistry = loadBrandRegistry;
exports.matchBrand = matchBrand;
exports.buildActiveRegistryView = buildActiveRegistryView;
exports.deriveSiteTargetKeys = deriveSiteTargetKeys;
/**
 * Brand Registry — TALLY-128 §3 governance layer.
 *
 * Brand→Site Owner canonical mapping stored in Firestore (collection:
 * `brand_registry`). Replaces hardcoded brand string lists in backfill
 * scripts. Also exposes a tolerant `deriveSiteTargetKeys()` helper for the
 * Layer 3 (site_targets) derivation per PO ruling R2-Q1 amended.
 */
const firebase_admin_1 = __importDefault(require("firebase-admin"));
/**
 * Normalize a brand string for lookup: trim whitespace + lowercase.
 * Per §3 Matcher Contract.
 */
function normalizeBrand(input) {
    if (!input || typeof input !== "string")
        return "";
    return input.trim().toLowerCase();
}
/**
 * Load active Brand Registry into a normalized lookup Map keyed by
 * `brand_key` (already lowercase by convention). Aliases are NOT pre-expanded
 * here; matchBrand() walks them per lookup so registry edits don't require
 * cache invalidation.
 *
 * Only `is_active == true` entries are returned.
 */
async function loadBrandRegistry() {
    const snap = await firebase_admin_1.default
        .firestore()
        .collection("brand_registry")
        .where("is_active", "==", true)
        .get();
    const out = new Map();
    for (const doc of snap.docs) {
        const d = doc.data() || {};
        const key = normalizeBrand(d.brand_key);
        if (!key)
            continue;
        out.set(key, {
            brand_key: key,
            display_name: d.display_name || key,
            aliases: Array.isArray(d.aliases) ? d.aliases : [],
            default_site_owner: d.default_site_owner ?? null,
            is_active: d.is_active !== false,
            po_confirmed: !!d.po_confirmed,
            notes: d.notes ?? null,
        });
    }
    return out;
}
/**
 * Match a brand string against the registry per §3 Matcher Contract:
 *   1. normalize input (trim + lowercase)
 *   2. exact key match
 *   3. alias match (each alias normalized at compare time)
 *   4. else null
 *
 * Case-insensitive + whitespace-trimmed on both sides. No destructive
 * normalization of the product catalog.
 */
function matchBrand(inputBrand, registry) {
    const normalized = normalizeBrand(inputBrand);
    if (!normalized)
        return null;
    const direct = registry.get(normalized);
    if (direct)
        return direct;
    for (const entry of registry.values()) {
        if (!entry.aliases || entry.aliases.length === 0)
            continue;
        for (const alias of entry.aliases) {
            if (normalizeBrand(alias) === normalized)
                return entry;
        }
    }
    return null;
}
/**
 * Build a lookup view over the active site_registry for derivation use.
 * Both site_key and domain lookups are case-insensitive (R2-Q4 confirmed
 * lowercase empirically; defensive normalization retained).
 */
function buildActiveRegistryView(sites) {
    const byKey = new Map();
    const byDomain = new Map();
    for (const s of sites) {
        if (!s.is_active)
            continue;
        const k = (s.site_key || "").trim().toLowerCase();
        if (k)
            byKey.set(k, s);
        const d = (s.domain || "").trim().toLowerCase();
        if (d)
            byDomain.set(d, s);
    }
    return {
        hasSiteKey(normalizedKey) {
            return byKey.has(normalizedKey);
        },
        findByDomain(normalizedDomain) {
            return byDomain.get(normalizedDomain) || null;
        },
        allSiteKeys() {
            return Array.from(byKey.keys());
        },
    };
}
/**
 * Tolerant Active Websites → site_targets derivation per R2-Q1 amended.
 *
 *   For each value in product.attribute_values.website (mixed format —
 *   bare site_keys AND full domains observed empirically):
 *     1. normalize (trim + lowercase)
 *     2. if registry.hasSiteKey(normalized) → add normalized
 *     3. else if registry.findByDomain(normalized) → add match.site_key
 *     4. else → record as non-registry value (gap tracking)
 *
 * NOT domain parsing; uses direct equality against stored domain field.
 * Returns Set + non-registry list for caller-side gap reporting.
 */
function deriveSiteTargetKeys(activeWebsiteValues, registry) {
    const targetKeys = new Set();
    const nonRegistryValues = [];
    if (!Array.isArray(activeWebsiteValues)) {
        return { targetKeys, nonRegistryValues };
    }
    for (const raw of activeWebsiteValues) {
        if (raw === null || raw === undefined)
            continue;
        const normalized = String(raw).trim().toLowerCase();
        if (!normalized)
            continue;
        if (registry.hasSiteKey(normalized)) {
            targetKeys.add(normalized);
            continue;
        }
        const byDomain = registry.findByDomain(normalized);
        if (byDomain) {
            const k = (byDomain.site_key || "").trim().toLowerCase();
            if (k)
                targetKeys.add(k);
            continue;
        }
        nonRegistryValues.push(normalized);
    }
    return { targetKeys, nonRegistryValues };
}
//# sourceMappingURL=brandRegistry.js.map