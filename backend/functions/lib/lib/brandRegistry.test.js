"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for backend/functions/src/lib/brandRegistry.ts.
 *
 * Run: cd backend/functions && npx tsc && node lib/lib/brandRegistry.test.js
 *
 * matchBrand() tests use an in-memory Map (no Firestore). loadBrandRegistry()
 * is exercised by the seed script's spot-check, not here.
 */
const brandRegistry_1 = require("./brandRegistry");
let passed = 0;
let failed = 0;
function assert(label, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        console.log(`  \u2713 ${label}`);
        passed++;
    }
    else {
        console.error(`  \u2717 ${label}`);
        console.error(`    expected: ${e}`);
        console.error(`    actual:   ${a}`);
        failed++;
    }
}
function entry(key, owner, aliases = []) {
    return {
        brand_key: key,
        display_name: key,
        aliases,
        default_site_owner: owner,
        is_active: true,
        po_confirmed: true,
        notes: null,
    };
}
const REGISTRY = new Map([
    ["nike", entry("nike", "shiekh", ["NIKE INC."])],
    ["jordan", entry("jordan", "shiekh", ["BRAND JORDAN"])],
    ["adidas", entry("adidas", "shiekh")],
    ["puma", entry("puma", "shiekh")],
    ["crocs", entry("crocs", "shiekh")],
    ["smoke rise", entry("smoke rise", "shiekh")],
    ["pro standard", entry("pro standard", "shiekh")],
    ["new era", entry("new era", "shiekh", ["NEW ERA CAPS"])],
    ["billionaire boys club", entry("billionaire boys club", "karmaloop")],
    ["icecream", entry("icecream", "karmaloop")],
]);
console.log("normalizeBrand()");
assert("trim + lowercase", (0, brandRegistry_1.normalizeBrand)("  NIKE  "), "nike");
assert("null \u2192 empty", (0, brandRegistry_1.normalizeBrand)(null), "");
assert("undefined \u2192 empty", (0, brandRegistry_1.normalizeBrand)(undefined), "");
assert("empty \u2192 empty", (0, brandRegistry_1.normalizeBrand)(""), "");
console.log("matchBrand() \u2014 direct key");
assert("nike", (0, brandRegistry_1.matchBrand)("nike", REGISTRY)?.brand_key, "nike");
assert("NIKE (case)", (0, brandRegistry_1.matchBrand)("NIKE", REGISTRY)?.brand_key, "nike");
assert("Nike  (whitespace)", (0, brandRegistry_1.matchBrand)("  Nike  ", REGISTRY)?.brand_key, "nike");
assert("ADIDAS", (0, brandRegistry_1.matchBrand)("ADIDAS", REGISTRY)?.brand_key, "adidas");
assert("Smoke Rise", (0, brandRegistry_1.matchBrand)("Smoke Rise", REGISTRY)?.brand_key, "smoke rise");
assert("Billionaire Boys Club", (0, brandRegistry_1.matchBrand)("Billionaire Boys Club", REGISTRY)?.brand_key, "billionaire boys club");
assert("PRO STANDARD", (0, brandRegistry_1.matchBrand)("PRO STANDARD", REGISTRY)?.brand_key, "pro standard");
console.log("matchBrand() \u2014 aliases");
assert("NIKE INC. \u2192 nike", (0, brandRegistry_1.matchBrand)("NIKE INC.", REGISTRY)?.brand_key, "nike");
assert("nike inc. (case)", (0, brandRegistry_1.matchBrand)("nike inc.", REGISTRY)?.brand_key, "nike");
assert("BRAND JORDAN \u2192 jordan", (0, brandRegistry_1.matchBrand)("BRAND JORDAN", REGISTRY)?.brand_key, "jordan");
assert("brand jordan (case)", (0, brandRegistry_1.matchBrand)("brand jordan", REGISTRY)?.brand_key, "jordan");
assert("NEW ERA CAPS \u2192 new era", (0, brandRegistry_1.matchBrand)("NEW ERA CAPS", REGISTRY)?.brand_key, "new era");
assert("New Era Caps (case)", (0, brandRegistry_1.matchBrand)("New Era Caps", REGISTRY)?.brand_key, "new era");
console.log("matchBrand() \u2014 unmapped");
assert("Reebok \u2192 null", (0, brandRegistry_1.matchBrand)("Reebok", REGISTRY), null);
assert("'' \u2192 null", (0, brandRegistry_1.matchBrand)("", REGISTRY), null);
assert("null \u2192 null", (0, brandRegistry_1.matchBrand)(null, REGISTRY), null);
assert("undefined \u2192 null", (0, brandRegistry_1.matchBrand)(undefined, REGISTRY), null);
console.log("matchBrand() \u2014 alias does not collide with another brand_key");
assert("NIKE alias does not match adidas", (0, brandRegistry_1.matchBrand)("NIKE INC.", REGISTRY)?.brand_key !== "adidas", true);
// ─────────────────────────────────────────────────────────────────────────
// deriveSiteTargetKeys() — R2-Q1 tolerant matcher
// ─────────────────────────────────────────────────────────────────────────
console.log("deriveSiteTargetKeys() \u2014 R2-Q1 tolerant");
const REG_VIEW = (0, brandRegistry_1.buildActiveRegistryView)([
    { site_key: "shiekh", domain: "shiekh.com", is_active: true },
    { site_key: "karmaloop", domain: "karmaloop.com", is_active: true },
    { site_key: "mltd", domain: "mltd.com", is_active: true },
    { site_key: "inactive_test", domain: "inactive.com", is_active: false },
]);
function asArr(s) {
    return Array.from(s).sort();
}
const r1 = (0, brandRegistry_1.deriveSiteTargetKeys)(["karmaloop", "shiekh.com", "mltd"], REG_VIEW);
assert("mixed bare+domain \u2192 normalized site_keys", asArr(r1.targetKeys), ["karmaloop", "mltd", "shiekh"]);
assert("mixed bare+domain \u2192 no non-registry", r1.nonRegistryValues, []);
const r2 = (0, brandRegistry_1.deriveSiteTargetKeys)(["KARMALOOP", "Shiekh.COM"], REG_VIEW);
assert("uppercase normalizes", asArr(r2.targetKeys), ["karmaloop", "shiekh"]);
const r3 = (0, brandRegistry_1.deriveSiteTargetKeys)(["plndr", "vnds.com", "shiekh"], REG_VIEW);
assert("non-registry skipped from targets", asArr(r3.targetKeys), ["shiekh"]);
assert("non-registry recorded for gap", r3.nonRegistryValues.sort(), ["plndr", "vnds.com"]);
const r4 = (0, brandRegistry_1.deriveSiteTargetKeys)([], REG_VIEW);
assert("empty AW \u2192 empty result", asArr(r4.targetKeys), []);
const r5 = (0, brandRegistry_1.deriveSiteTargetKeys)(null, REG_VIEW);
assert("null AW \u2192 empty result", asArr(r5.targetKeys), []);
const r6 = (0, brandRegistry_1.deriveSiteTargetKeys)(["inactive_test", "inactive.com"], REG_VIEW);
assert("inactive site_key skipped", asArr(r6.targetKeys), []);
assert("inactive domain skipped", r6.nonRegistryValues.sort(), ["inactive.com", "inactive_test"]);
const r7 = (0, brandRegistry_1.deriveSiteTargetKeys)(["shiekh", "shiekh.com"], REG_VIEW);
assert("duplicate same-site dedupes via Set", asArr(r7.targetKeys), ["shiekh"]);
const r8 = (0, brandRegistry_1.deriveSiteTargetKeys)([null, undefined, "", "  ", "shiekh"], REG_VIEW);
assert("null/undefined/empty/whitespace skipped", asArr(r8.targetKeys), ["shiekh"]);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0)
    process.exit(1);
//# sourceMappingURL=brandRegistry.test.js.map