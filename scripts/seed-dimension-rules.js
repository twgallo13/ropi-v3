#!/usr/bin/env node
/**
 * Seed 8 dimension/shipping rules to smart_rules (Phase 3 pre-seed).
 * Verbatim schema from Lisa's Action 1 brief — Phase 3 Smart Rules UI
 * will expose these. Engine in services/smartRules.ts is not touched.
 * Idempotent: doc_id derived from rule_name slug.
 */
"use strict";
const admin = require("./seed/node_modules/firebase-admin");
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

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

const DIMENSION_RULES = [
  {
    rule_name: "Footwear Men's Dimensions",
    rule_type: "type_1",
    is_active: true,
    priority: 10,
    always_overwrite: false,
    conditions: [
      { field: "department", operator: "equals", value: "Footwear", logic: "AND" },
      { field: "gender",     operator: "equals", value: "Mens",     logic: "AND" },
    ],
    actions: [
      { target_field: "dimension_height", value: 4 },
      { target_field: "dimension_length", value: 14 },
      { target_field: "dimension_width",  value: 5 },
      { target_field: "weight",           value: 5 },
    ],
  },
  {
    rule_name: "Footwear Women's Dimensions",
    rule_type: "type_1",
    is_active: true,
    priority: 10,
    always_overwrite: false,
    conditions: [
      { field: "department", operator: "equals", value: "Footwear", logic: "AND" },
      { field: "gender",     operator: "equals", value: "Womens",   logic: "AND" },
    ],
    actions: [
      { target_field: "dimension_height", value: 4 },
      { target_field: "dimension_length", value: 14 },
      { target_field: "dimension_width",  value: 5 },
      { target_field: "weight",           value: 4 },
    ],
  },
  {
    rule_name: "Footwear Kids Dimensions",
    rule_type: "type_1",
    is_active: true,
    priority: 10,
    always_overwrite: false,
    conditions: [
      { field: "department", operator: "equals", value: "Footwear", logic: "AND" },
      { field: "age_group",  operator: "equals", value: "Kids",     logic: "AND" },
    ],
    actions: [
      { target_field: "dimension_height", value: 4 },
      { target_field: "dimension_length", value: 9 },
      { target_field: "dimension_width",  value: 5 },
      { target_field: "weight",           value: 3 },
    ],
  },
  {
    rule_name: "Footwear Unisex Dimensions",
    rule_type: "type_1",
    is_active: true,
    priority: 10,
    always_overwrite: false,
    conditions: [
      { field: "department", operator: "equals", value: "Footwear", logic: "AND" },
      { field: "gender",     operator: "equals", value: "Unisex",   logic: "AND" },
    ],
    actions: [
      { target_field: "dimension_height", value: 4 },
      { target_field: "dimension_length", value: 12 },
      { target_field: "dimension_width",  value: 5 },
      { target_field: "weight",           value: 5 },
    ],
  },
  {
    rule_name: "Launch Product Shipping",
    rule_type: "type_1",
    is_active: true,
    priority: 20,
    always_overwrite: true,
    conditions: [
      { field: "launch", operator: "equals", value: "true", logic: "AND" },
    ],
    actions: [
      { target_field: "standard_shipping_override",  value: 14.95 },
      { target_field: "expedited_shipping_override", value: 29.95 },
      { target_field: "hype",                         value: true  },
      { target_field: "maximum_quantity",             value: 1     },
    ],
  },
  {
    rule_name: "Clothing Weight",
    rule_type: "type_1",
    is_active: true,
    priority: 10,
    always_overwrite: false,
    conditions: [
      { field: "department", operator: "equals", value: "Clothing", logic: "AND" },
    ],
    actions: [{ target_field: "weight", value: 2 }],
  },
  {
    rule_name: "Accessories Weight",
    rule_type: "type_1",
    is_active: true,
    priority: 10,
    always_overwrite: false,
    conditions: [
      { field: "department", operator: "equals", value: "Accessories", logic: "AND" },
    ],
    actions: [{ target_field: "weight", value: 1 }],
  },
  {
    rule_name: "Nike Launch Shipping Override",
    rule_type: "type_1",
    is_active: true,
    priority: 30,
    always_overwrite: true,
    conditions: [
      { field: "launch", operator: "equals", value: "true", logic: "AND" },
      { field: "brand",  operator: "equals", value: "Nike", logic: "AND" },
    ],
    actions: [
      { target_field: "standard_shipping_override", value: 19.95 },
    ],
  },
];

async function main() {
  console.log(`\n🌱  Seeding ${DIMENSION_RULES.length} dimension rules → smart_rules …\n`);
  const written = [];
  for (const rule of DIMENSION_RULES) {
    const doc_id = "dim_" + slug(rule.rule_name);
    const ref = db.collection("smart_rules").doc(doc_id);
    const snap = await ref.get();
    const data = {
      ...rule,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (!snap.exists) {
      data.created_at = admin.firestore.FieldValue.serverTimestamp();
      await ref.set(data);
      written.push({ doc_id, rule_name: rule.rule_name, op: "CREATED" });
    } else {
      await ref.set(data, { merge: true });
      written.push({ doc_id, rule_name: rule.rule_name, op: "UPDATED" });
    }
  }

  console.log("doc_id                                       op        rule_name");
  console.log("────────────────────────────────────────────────────────────────");
  for (const w of written) {
    console.log(w.doc_id.padEnd(44), w.op.padEnd(9), w.rule_name);
  }

  // ────────── Action 2 — update dropdown_options for 4 attribute_registry docs
  console.log("\n🌱  Updating attribute_registry dropdown_options …\n");
  const REG_UPDATES = [
    {
      field_key: "gender",
      dropdown_options: ["Mens", "Womens", "Unisex", "Boys", "Girls", "Toddler"],
    },
    {
      field_key: "age_group",
      dropdown_options: ["Adult", "Grade-School", "Pre-School", "Toddler"],
    },
    {
      field_key: "fit",
      dropdown_options: [
        "Runs one Size Small",
        "Runs a Half Size Small",
        "True to Size",
        "Runs A Half Size Big",
        "Runs One Size Big",
      ],
    },
    {
      field_key: "department",
      dropdown_options: ["Footwear", "Clothing", "Accessories", "Home & Tech"],
    },
  ];

  for (const u of REG_UPDATES) {
    const ref = db.collection("attribute_registry").doc(u.field_key);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log("❌ missing attribute_registry/" + u.field_key);
      continue;
    }
    await ref.set(
      {
        dropdown_options: u.dropdown_options,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    const after = await ref.get();
    console.log(
      u.field_key,
      "→",
      JSON.stringify(after.data().dropdown_options)
    );
  }

  await admin.app().delete();
  console.log("\n✅ Done.\n");
}

main().catch((e) => {
  console.error("❌ FAILED:", e);
  process.exit(1);
});
