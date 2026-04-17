"use strict";
/**
 * realign-attribute-layout.js
 *
 * 1. Assigns display_label, destination_tab, display_group, display_order
 *    to the 9 attribute_registry docs that are currently sitting in "Other".
 * 2. Clears required_for_completion on SEO meta fields so they no longer
 *    block product completion.
 *
 * Idempotent — uses set with merge.
 */
const admin = require("firebase-admin");
const { initApp } = require("./utils");

initApp();
const db = admin.firestore();

// ─── Layout assignments for currently-unassigned fields ─────────────────
const LAYOUT = [
  // Package dimensions → Product Attributes / Physical
  { key: "dimension_height", tab: "product_attributes", group: "Package Dimensions", order: 1, label: "Height (in)", field_type: "number" },
  { key: "dimension_length", tab: "product_attributes", group: "Package Dimensions", order: 2, label: "Length (in)", field_type: "number" },
  { key: "dimension_width",  tab: "product_attributes", group: "Package Dimensions", order: 3, label: "Width (in)",  field_type: "number" },
  { key: "weight",           tab: "product_attributes", group: "Package Dimensions", order: 4, label: "Weight (oz)", field_type: "number" },

  // Inventory / fulfillment limits → Product Attributes / Inventory
  { key: "maximum_quantity", tab: "product_attributes", group: "Inventory", order: 29, label: "Max Order Quantity", field_type: "number" },

  // Launch flags → Launch & Media / Launch Configuration
  { key: "hype",   tab: "launch_media", group: "Launch Configuration", order: 8, label: "HYPE",        field_type: "toggle" },
  { key: "launch", tab: "launch_media", group: "Launch Configuration", order: 9, label: "Launch Flag", field_type: "toggle" },

  // Shipping overrides → Launch & Media / Pricing & Options
  { key: "standard_shipping_override",  tab: "launch_media", group: "Pricing & Options", order: 6, label: "Standard Shipping Override",  field_type: "number" },
  { key: "expedited_shipping_override", tab: "launch_media", group: "Pricing & Options", order: 7, label: "Expedited Shipping Override", field_type: "number" },
];

// ─── SEO fields that should NOT block completion ────────────────────────
const SEO_FIELDS_NON_BLOCKING = ["ai_seo_meta", "ai_seo_title", "meta_description", "meta_name", "meta_title"];

(async () => {
  console.log("\n── Step 1: Assign layout to unassigned fields ──");
  let updated = 0;
  for (const entry of LAYOUT) {
    const ref = db.collection("attribute_registry").doc(entry.key);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`  ⚠  ${entry.key} not found — skipping`);
      continue;
    }
    await ref.set(
      {
        display_label: entry.label,
        destination_tab: entry.tab,
        display_group: entry.group,
        display_order: entry.order,
        field_type: entry.field_type,
        active: true,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log(`  ✓  ${entry.key} → ${entry.tab} / ${entry.group} / order ${entry.order}`);
    updated++;
  }

  console.log(`\n── Step 2: Clear required_for_completion on SEO fields ──`);
  for (const key of SEO_FIELDS_NON_BLOCKING) {
    const ref = db.collection("attribute_registry").doc(key);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`  ℹ  ${key} not found — skipping`);
      continue;
    }
    await ref.set(
      {
        required_for_completion: false,
        is_required: false,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log(`  ✓  ${key} required_for_completion=false`);
  }

  console.log(`\n── Step 3: Verify zero unassigned remaining ──`);
  const allSnap = await db.collection("attribute_registry").get();
  const stillUnassigned = [];
  allSnap.forEach((doc) => {
    const d = doc.data();
    if (!d.display_group || d.display_group === "Other" || d.display_group === "" || !d.destination_tab) {
      stillUnassigned.push(doc.id);
    }
  });
  console.log(`  Unassigned remaining: ${stillUnassigned.length}`);
  stillUnassigned.forEach((k) => console.log(`   - ${k}`));

  console.log(`\n── Summary ──`);
  console.log(`  Layout updated:           ${updated}`);
  console.log(`  SEO fields cleared:       ${SEO_FIELDS_NON_BLOCKING.length}`);
  console.log(`  Unassigned remaining:     ${stillUnassigned.length}`);
  console.log(`✅  Realign complete.\n`);
  process.exit(0);
})().catch((e) => {
  console.error("❌  Realign failed:", e);
  process.exit(1);
});
