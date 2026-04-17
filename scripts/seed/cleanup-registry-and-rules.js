#!/usr/bin/env node
/**
 * Data Hygiene: cleanup-registry-and-rules.js
 *
 * 1. Delete family_color from attribute_registry
 * 2. Remove family_color from all product attribute_values subcollections
 * 3. Seed "Default Tax Class" Smart Rule (if tax_class is empty → "Taxable Goods")
 *
 * Idempotent — safe to re-run. Firestore-only, no deploy needed.
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");
const { v4: uuidv4 } = require("uuid");

async function main() {
  const app = initApp();
  const db = admin.firestore(app);

  // ── 1. Delete family_color from attribute_registry ──────────
  console.log("\n── Step 1: Delete family_color from attribute_registry ──");
  const familyColorRef = db.collection("attribute_registry").doc("family_color");
  const familyColorDoc = await familyColorRef.get();
  if (familyColorDoc.exists) {
    await familyColorRef.delete();
    console.log("✅ Deleted attribute_registry/family_color");
  } else {
    console.log("ℹ️  family_color not found in attribute_registry — skipping");
  }

  // ── 2. Remove family_color from product attribute_values ────
  console.log("\n── Step 2: Remove family_color from product attribute_values ──");
  const productsSnap = await db.collection("products").get();
  let cleaned = 0;
  for (const productDoc of productsSnap.docs) {
    const avRef = productDoc.ref.collection("attribute_values").doc("family_color");
    const avDoc = await avRef.get();
    if (avDoc.exists) {
      await avRef.delete();
      cleaned++;
    }
  }
  console.log(`✅ Removed family_color from ${cleaned} product attribute_values`);

  // ── 3. Seed tax_class default Smart Rule ────────────────────
  console.log("\n── Step 3: Seed Default Tax Class smart rule ──");
  const existingRule = await db
    .collection("smart_rules")
    .where("rule_name", "==", "Default Tax Class")
    .limit(1)
    .get();

  if (!existingRule.empty) {
    console.log("ℹ️  Default Tax Class rule already exists — skipping");
  } else {
    const ruleId = uuidv4();
    await db.collection("smart_rules").doc(ruleId).set({
      rule_id: ruleId,
      rule_name: "Default Tax Class",
      rule_type: "Type 1",
      description: "If tax_class is empty, set to Taxable Goods",
      is_active: true,
      priority: 5,
      version: 1,
      conditions: [
        {
          field: "tax_class",
          operator: "is_empty",
          value: null,
          logic: "AND",
          case_sensitive: false,
        },
      ],
      actions: [
        {
          field: "tax_class",
          value: "Taxable Goods",
          verification_state: "System-Applied",
          always_overwrite: false,
        },
      ],
      created_by: "admin",
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`✅ Created Smart Rule: Default Tax Class (id: ${ruleId})`);
  }

  console.log("\n✅ Data hygiene complete.");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌  Script failed:", e);
  process.exit(1);
});
