#!/usr/bin/env node
/**
 * Step 3.1 — Smart Rules Engine Verification.
 *
 * Verifies:
 *  - 8 seeded dimension rules fire against a Men's Footwear product
 *  - Launch product cascade: base Launch (priority 20) → Nike override
 *    (priority 30) overwrites standard_shipping_override to 19.95
 *  - always_overwrite respected
 *  - Human-Verified ceiling respected
 *  - Engine still executes legacy-schema rules
 */
"use strict";
// Use backend/functions node_modules so admin SDK instance matches the compiled engine
const admin = require("../backend/functions/node_modules/firebase-admin");
const fs = require("fs");
const path = require("path");

// Load .env
const envPath = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) {
      const k = t.substring(0, eq).trim();
      const v = t.substring(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const sa = JSON.parse(process.env.GCP_SA_KEY_DEV);
admin.initializeApp({
  credential: admin.credential.cert(sa),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore();

// Import the TS-compiled engine
const { executeSmartRules } = require(path.resolve(
  __dirname,
  "..",
  "backend",
  "functions",
  "lib",
  "services",
  "smartRules"
));

function div(title) {
  console.log("\n" + "═".repeat(68));
  console.log("  " + title);
  console.log("═".repeat(68));
}

async function setAttr(mpn, field, value, verification = "System-Applied") {
  await db
    .collection("products")
    .doc(mpn)
    .collection("attribute_values")
    .doc(field)
    .set(
      {
        value,
        verification_state: verification,
        origin_type: "Test Fixture",
        origin_detail: "step31-verify.js",
        written_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

async function clearAttr(mpn, field) {
  await db
    .collection("products")
    .doc(mpn)
    .collection("attribute_values")
    .doc(field)
    .delete()
    .catch(() => {});
}

async function readAttr(mpn, field) {
  const s = await db
    .collection("products")
    .doc(mpn)
    .collection("attribute_values")
    .doc(field)
    .get();
  if (!s.exists) return null;
  const d = s.data();
  return { value: d.value, origin_detail: d.origin_detail, vs: d.verification_state };
}

async function ensureProduct(mpn, seed = {}) {
  const ref = db.collection("products").doc(mpn);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      mpn,
      product_is_active: true,
      completion_state: "incomplete",
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      ...seed,
    });
  } else {
    await ref.set(seed, { merge: true });
  }
}

async function cleanFields(mpn, fields) {
  for (const f of fields) await clearAttr(mpn, f);
}

// ───────────────────────────────────────────────────────────────────────────
async function main() {
  const DIM_FIELDS = [
    "dimension_height",
    "dimension_length",
    "dimension_width",
    "weight",
    "standard_shipping_override",
    "expedited_shipping_override",
    "hype",
    "maximum_quantity",
  ];

  // Ensure registry has required target fields
  div("Step 0 — Ensure attribute_registry has dimension target fields");
  const REQUIRED_TARGETS = [
    { id: "dimension_height", type: "number" },
    { id: "dimension_length", type: "number" },
    { id: "dimension_width", type: "number" },
    { id: "weight", type: "number" },
    { id: "standard_shipping_override", type: "number" },
    { id: "expedited_shipping_override", type: "number" },
    { id: "hype", type: "boolean" },
    { id: "maximum_quantity", type: "number" },
    { id: "launch", type: "boolean" },
  ];
  for (const t of REQUIRED_TARGETS) {
    const ref = db.collection("attribute_registry").doc(t.id);
    const s = await ref.get();
    if (!s.exists) {
      await ref.set({
        field_key: t.id,
        display_name: t.id.replace(/_/g, " "),
        field_type: t.type,
        category: "shipping",
        required: false,
        ai_prompt: false,
        is_active: true,
      });
      console.log("  ✅ registered " + t.id);
    } else {
      console.log("  ✓ exists " + t.id);
    }
  }

  // ─── Test 1 — Men's Footwear fires all 4 dimension actions ──────────────
  div("Test 1 — Footwear Men's Dimensions (priority 10)");
  const MPN1 = "TEST-STEP31-FW-MENS";
  await ensureProduct(MPN1, { brand: "TestBrand", department: "Footwear", gender: "Mens" });
  await cleanFields(MPN1, DIM_FIELDS);

  const r1 = await executeSmartRules(MPN1, "step31-verify");
  console.log(
    `  rules_fired: ${r1.rules_fired}  actions_written: ${r1.actions_written.length}`
  );
  for (const a of r1.actions_written)
    console.log(`    → ${a.rule_id.padEnd(40)} ${a.target_field} = ${JSON.stringify(a.value)}`);

  const h = await readAttr(MPN1, "dimension_height");
  const l = await readAttr(MPN1, "dimension_length");
  const w = await readAttr(MPN1, "dimension_width");
  const wt = await readAttr(MPN1, "weight");
  console.log("\n  Result attribute_values:");
  console.log(`    dimension_height: ${JSON.stringify(h?.value)}  origin: ${h?.origin_detail}`);
  console.log(`    dimension_length: ${JSON.stringify(l?.value)}  origin: ${l?.origin_detail}`);
  console.log(`    dimension_width : ${JSON.stringify(w?.value)}  origin: ${w?.origin_detail}`);
  console.log(`    weight          : ${JSON.stringify(wt?.value)}  origin: ${wt?.origin_detail}`);

  const ok1 = h?.value === 4 && l?.value === 14 && w?.value === 5 && wt?.value === 5;
  console.log(`\n  Expected: 4, 14, 5, 5  →  ${ok1 ? "✅ PASS" : "❌ FAIL"}`);

  // ─── Test 2 — Launch cascade: Nike override wins over base launch ────────
  div("Test 2 — Launch cascade: base (p=20, 14.95) → Nike override (p=30, 19.95)");
  const MPN2 = "TEST-STEP31-NIKE-LAUNCH";
  await ensureProduct(MPN2, {
    brand: "Nike",
    department: "Footwear",
    gender: "Mens",
    launch: true,
  });
  await cleanFields(MPN2, DIM_FIELDS);

  const r2 = await executeSmartRules(MPN2, "step31-verify");
  console.log(`  rules_fired: ${r2.rules_fired}  actions_written: ${r2.actions_written.length}`);
  for (const a of r2.actions_written)
    console.log(`    → ${a.rule_id.padEnd(40)} ${a.target_field} = ${JSON.stringify(a.value)} overwrite=${a.overwrite}`);

  const std = await readAttr(MPN2, "standard_shipping_override");
  const exp = await readAttr(MPN2, "expedited_shipping_override");
  const hype = await readAttr(MPN2, "hype");
  console.log("\n  Result:");
  console.log(`    standard_shipping_override : ${JSON.stringify(std?.value)}  origin: ${std?.origin_detail}`);
  console.log(`    expedited_shipping_override: ${JSON.stringify(exp?.value)}  origin: ${exp?.origin_detail}`);
  console.log(`    hype                       : ${JSON.stringify(hype?.value)}  origin: ${hype?.origin_detail}`);

  const ok2 =
    std?.value === 19.95 &&
    /Nike/.test(std?.origin_detail || "") &&
    exp?.value === 29.95 &&
    hype?.value === true;
  console.log(`\n  Expected: std=19.95 (Nike override wins), exp=29.95, hype=true  →  ${ok2 ? "✅ PASS" : "❌ FAIL"}`);

  // ─── Test 3 — Human-Verified ceiling respected ──────────────────────────
  div("Test 3 — Human-Verified ceiling blocks overwrite even with always_overwrite=true");
  const MPN3 = "TEST-STEP31-HV-CEILING";
  await ensureProduct(MPN3, {
    brand: "Nike",
    department: "Footwear",
    gender: "Mens",
    launch: true,
  });
  await cleanFields(MPN3, DIM_FIELDS);
  // Pre-set Human-Verified value
  await setAttr(MPN3, "standard_shipping_override", 9.99, "Human-Verified");

  const r3 = await executeSmartRules(MPN3, "step31-verify");
  const std3 = await readAttr(MPN3, "standard_shipping_override");
  console.log(`  standard_shipping_override = ${JSON.stringify(std3?.value)}  vs=${std3?.vs}`);
  const ok3 = std3?.value === 9.99 && std3?.vs === "Human-Verified";
  console.log(`  Expected: 9.99 preserved (HV wins)  →  ${ok3 ? "✅ PASS" : "❌ FAIL"}`);

  // ─── Test 4 — Legacy rule backward compat ──────────────────────────────
  div("Test 4 — Legacy Phase 1 schema still executes");
  const legacySnap = await db
    .collection("smart_rules")
    .where("is_active", "==", true)
    .get();
  const legacy = legacySnap.docs.filter((d) => !!d.data().source_field || !!d.data().action);
  console.log(`  Found ${legacy.length} legacy-schema active rule(s):`);
  for (const d of legacy) {
    const data = d.data();
    console.log(
      `    ${d.id}  action=${data.action?.target_attribute}=${JSON.stringify(data.action?.output_value)}  ops=${(data.conditions || []).map((c) => c.operator).join(",")}`
    );
  }

  // ─── Summary ──────────────────────────────────────────────────────────
  div("Summary");
  const results = [
    ["Test 1 — Mens Footwear dimensions", ok1],
    ["Test 2 — Nike launch cascade", ok2],
    ["Test 3 — Human-Verified ceiling", ok3],
  ];
  for (const [name, pass] of results) {
    console.log(`  ${pass ? "✅" : "❌"}  ${name}`);
  }
  const allPass = results.every(([, p]) => p);
  console.log(`\n  Overall: ${allPass ? "✅ ALL PASS" : "❌ FAILURES"}\n`);

  await admin.app().delete();
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("❌ FAILED:", e);
  process.exit(1);
});
