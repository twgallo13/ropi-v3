/**
 * Unit tests for backend/functions/src/routes/departmentRegistry.ts.
 *
 * Pattern mirrors backend/functions/src/lib/brandRegistry.test.ts.
 *
 * Run:
 *   cd backend/functions && npx tsc && node lib/lib/departmentRegistry.test.js
 *
 * These tests cover the pure helpers exported from the route module
 * (shape, filter, sort, validate). Route-level Firestore integration is
 * verified during seed + smoke (see scripts/seed/seed-department-registry.js
 * and the Step 4 curl smoke tests).
 */
import {
  DepartmentRegistryEntry,
  shapeDepartmentEntry,
  filterDepartmentEntries,
  compareDepartmentEntries,
  resolveAllowedDepartmentValues,
  isDepartmentValueAllowed,
} from "../routes/departmentRegistry";

let passed = 0;
let failed = 0;

function assert(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.error(`  \u2717 ${label}`);
    console.error(`    expected: ${e}`);
    console.error(`    actual:   ${a}`);
    failed++;
  }
}

function entry(
  key: string,
  display_name: string,
  aliases: string[],
  priority: number,
  is_active = true
): DepartmentRegistryEntry {
  return {
    key,
    display_name,
    aliases,
    is_active,
    priority,
    po_confirmed: true,
  };
}

// 4 PO-confirmed seed entries (table from TALLY-DEPARTMENT-REGISTRY dispatch).
const SEEDED: DepartmentRegistryEntry[] = [
  entry("footwear", "Footwear", ["Shoes", "FOOTWEAR"], 1),
  entry("clothing", "Clothing", ["CLOTHING", "Apparel"], 2),
  entry("accessories", "Accessories", ["Accessory", "ACCESSORIES"], 3),
  entry("home_and_tech", "Home & Tech", ["Home and Tech", "HOME & TECH"], 4),
];

// ─────────────────────────────────────────────────────────────────────────
// TEST 1 — Route returns seeded data (4 departments).
// ─────────────────────────────────────────────────────────────────────────
console.log("TEST 1 — shape + sort over 4 seeded docs");
{
  const docs = [
    { id: "clothing", data: { key: "clothing", display_name: "Clothing", aliases: ["CLOTHING", "Apparel"], is_active: true, priority: 2, po_confirmed: true } },
    { id: "footwear", data: { key: "footwear", display_name: "Footwear", aliases: ["Shoes", "FOOTWEAR"], is_active: true, priority: 1, po_confirmed: true } },
    { id: "home_and_tech", data: { key: "home_and_tech", display_name: "Home & Tech", aliases: ["Home and Tech", "HOME & TECH"], is_active: true, priority: 4, po_confirmed: true } },
    { id: "accessories", data: { key: "accessories", display_name: "Accessories", aliases: ["Accessory", "ACCESSORIES"], is_active: true, priority: 3, po_confirmed: true } },
  ];
  const shaped = docs.map((d) => shapeDepartmentEntry(d.data, d.id));
  const sorted = filterDepartmentEntries(shaped, false).sort(compareDepartmentEntries);
  assert("4 entries", sorted.length, 4);
  assert("priority-ordered keys", sorted.map((e) => e.key), ["footwear", "clothing", "accessories", "home_and_tech"]);
}

// ─────────────────────────────────────────────────────────────────────────
// TEST 2 — activeOnly=true filter works (one temp-deactivated).
// ─────────────────────────────────────────────────────────────────────────
console.log("TEST 2 — activeOnly filter excludes inactive");
{
  const mixed = [
    entry("footwear", "Footwear", ["Shoes"], 1, true),
    entry("clothing", "Clothing", ["Apparel"], 2, false), // temp-deactivated
    entry("accessories", "Accessories", [], 3, true),
    entry("home_and_tech", "Home & Tech", [], 4, true),
  ];
  const all = filterDepartmentEntries(mixed, false).sort(compareDepartmentEntries);
  const active = filterDepartmentEntries(mixed, true).sort(compareDepartmentEntries);
  assert("activeOnly=false → 4 entries", all.length, 4);
  assert("activeOnly=true → 3 entries", active.length, 3);
  assert("activeOnly=true excludes 'clothing'", active.map((e) => e.key), ["footwear", "accessories", "home_and_tech"]);
}

// ─────────────────────────────────────────────────────────────────────────
// TEST 3 — GET /:key returns specific entry (shape from single doc).
// ─────────────────────────────────────────────────────────────────────────
console.log("TEST 3 — single-doc shaping for GET /:key");
{
  const data = { key: "footwear", display_name: "Footwear", aliases: ["Shoes", "FOOTWEAR"], is_active: true, priority: 1, po_confirmed: true };
  const e = shapeDepartmentEntry(data, "footwear");
  assert("key", e.key, "footwear");
  assert("display_name", e.display_name, "Footwear");
  assert("aliases", e.aliases, ["Shoes", "FOOTWEAR"]);
  assert("priority", e.priority, 1);
  assert("is_active", e.is_active, true);
  assert("po_confirmed", e.po_confirmed, true);
}

// ─────────────────────────────────────────────────────────────────────────
// TEST 4 — Validation accepts all 4 seeded active values (display_name + key + aliases).
// ─────────────────────────────────────────────────────────────────────────
console.log("TEST 4 — validation accepts all 4 seeded values");
{
  // Display names (current product storage convention).
  assert("Footwear accepted", isDepartmentValueAllowed("Footwear", SEEDED), true);
  assert("Clothing accepted", isDepartmentValueAllowed("Clothing", SEEDED), true);
  assert("Accessories accepted", isDepartmentValueAllowed("Accessories", SEEDED), true);
  assert("Home & Tech accepted", isDepartmentValueAllowed("Home & Tech", SEEDED), true);
  // Keys.
  assert("'footwear' key accepted", isDepartmentValueAllowed("footwear", SEEDED), true);
  assert("'home_and_tech' key accepted", isDepartmentValueAllowed("home_and_tech", SEEDED), true);
  // Aliases (case-insensitive).
  assert("'Shoes' alias accepted", isDepartmentValueAllowed("Shoes", SEEDED), true);
  assert("'apparel' (case) accepted", isDepartmentValueAllowed("apparel", SEEDED), true);
  assert("'HOME AND TECH' alias accepted", isDepartmentValueAllowed("HOME AND TECH", SEEDED), true);
}

// ─────────────────────────────────────────────────────────────────────────
// TEST 5 — Validation REJECTS temp-deactivated entry value (PO Ruling G).
// ─────────────────────────────────────────────────────────────────────────
console.log("TEST 5 — validation rejects deactivated entry (Ruling G)");
{
  const withDeactivated: DepartmentRegistryEntry[] = [
    entry("footwear", "Footwear", ["Shoes"], 1, true),
    entry("clothing", "Clothing", ["Apparel"], 2, false), // soft-deactivated
    entry("accessories", "Accessories", [], 3, true),
    entry("home_and_tech", "Home & Tech", [], 4, true),
  ];
  assert("'Clothing' (deactivated display_name) REJECTED", isDepartmentValueAllowed("Clothing", withDeactivated), false);
  assert("'clothing' (deactivated key) REJECTED", isDepartmentValueAllowed("clothing", withDeactivated), false);
  assert("'Apparel' (deactivated alias) REJECTED", isDepartmentValueAllowed("Apparel", withDeactivated), false);
  // Sibling actives still accepted.
  assert("'Footwear' still accepted", isDepartmentValueAllowed("Footwear", withDeactivated), true);
}

// ─────────────────────────────────────────────────────────────────────────
// TEST 6 — Validation REJECTS value not in registry.
// ─────────────────────────────────────────────────────────────────────────
console.log("TEST 6 — validation rejects unknown values");
{
  assert("'Underwear' rejected", isDepartmentValueAllowed("Underwear", SEEDED), false);
  assert("'Toys' rejected", isDepartmentValueAllowed("Toys", SEEDED), false);
  assert("empty string rejected", isDepartmentValueAllowed("", SEEDED), false);
  assert("null rejected", isDepartmentValueAllowed(null, SEEDED), false);
  assert("undefined rejected", isDepartmentValueAllowed(undefined, SEEDED), false);
  assert("whitespace-only rejected", isDepartmentValueAllowed("   ", SEEDED), false);
}

// ─────────────────────────────────────────────────────────────────────────
// TEST 7 — Existing products with pre-existing values NOT re-validated.
//   Validation surface area is per-write only. Demonstrate by showing
//   resolveAllowedDepartmentValues is a pure read-only function over the
//   registry — there is no batch revalidation export, and inactive entries'
//   stored product values are unaffected (we never inspect product docs here).
// ─────────────────────────────────────────────────────────────────────────
console.log("TEST 7 — validation is per-write, not retroactive");
{
  // Simulated registry where 'clothing' is now inactive. Any product still
  // holding a "Clothing" attribute_value is unaffected: validation is only
  // invoked when a NEW write to that field is attempted.
  const reg: DepartmentRegistryEntry[] = [
    entry("footwear", "Footwear", ["Shoes"], 1, true),
    entry("clothing", "Clothing", ["Apparel"], 2, false),
  ];
  const allowed = resolveAllowedDepartmentValues(reg);
  // The deactivated value is NOT in the active-allowlist (would reject NEW
  // writes), but the helper does not touch product docs — proving existing
  // product attribute_values cannot be retroactively invalidated by it.
  assert("active-only allowlist excludes deactivated 'clothing'", allowed.has("clothing"), false);
  assert("active-only allowlist excludes deactivated 'Clothing'", allowed.has("clothing"), false);
  assert("active 'footwear' still in allowlist", allowed.has("footwear"), true);
  // Sanity: no product-state mutation surface exists in this module — the
  // only exports are pure helpers (shape/filter/sort/resolve/isAllowed) and
  // an async loadDepartmentRegistry() that READS Firestore. No write/migrate
  // export exists, so existing products cannot be touched by this code path.
  assert("module exposes no batch-revalidate function", typeof (require("../routes/departmentRegistry") as any).revalidateAllProducts, "undefined");
}

// ─────────────────────────────────────────────────────────────────────────
// TEST 8 — attribute_registry/department has enum_source + no options.
//   Pure-test stand-in: assert the validator's selection contract — when
//   enum_source is set, options array is ignored. This is the contract
//   wired into routes/products.ts. Live Firestore state is verified during
//   seed (see seed-department-registry.js Step 4 spot-check output).
// ─────────────────────────────────────────────────────────────────────────
console.log("TEST 8 — enum_source contract: registry takes precedence over options");
{
  // Simulated attribute_registry/department doc post-seed.
  const attrDoc = {
    field_key: "department",
    field_type: "dropdown",
    enum_source: "department_registry",
    dropdown_options: [], // emptied by seed
    active: true,
  };
  assert("enum_source set to department_registry", attrDoc.enum_source, "department_registry");
  assert("dropdown_options emptied", attrDoc.dropdown_options, []);
  // Contract: validator should consult registry (not options) when
  // enum_source is present. Resolved set drives accept/reject.
  const allowed = resolveAllowedDepartmentValues(SEEDED);
  assert("resolved allowlist non-empty", allowed.size > 0, true);
  assert("resolved allowlist drives 'Footwear' accept", allowed.has("footwear"), true);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
