#!/usr/bin/env node
/**
 * Seed: display_group, display_order, full_width on attribute_registry docs.
 * Groups attributes into logical sub-sections within each destination_tab.
 * Idempotent — safe to re-run.
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "attribute_registry";

// ── Group definitions keyed by display_group name ──────────────
// Each entry: [field_key, display_order, full_width?]
const DISPLAY_GROUPS = {
  // ── Tab: core_information ────────────────────────────────────
  "Taxonomy": [
    ["department",      1],
    ["gender",          2],
    ["age_group",       3],
    ["class",           4],
    ["category",        5],
    ["style_code",      6],
  ],
  "Naming & Identity": [
    ["product_name",    1, true],
    ["sku",             2],
    ["upc",             3],
    ["brand",           4],
    ["size",            5],
  ],
  "Color & Materials": [
    ["primary_color",   1],
    ["color_family",    2],
  ],
  "Commerce & Status": [
    ["website",         1],
    ["site_ids",        2],
    ["is_in_stock",     3],
    ["image_status",    4],
  ],

  // ── Tab: product_attributes ──────────────────────────────────
  "Physical & Variant": [
    ["descriptive_color", 1],
    ["colorway",          2],
    ["material",          3],
    ["fit",               4],
    ["width",             5],
    ["silhouette",        6],
    ["size_system",       7],
  ],
  "Footwear Details": [
    ["closure_type",    1],
    ["heel_height",     2],
    ["toe_shape",       3],
    ["technology",      4],
  ],
  "Collaboration & Release": [
    ["collaboration",   1],
    ["release_date",    2],
    ["release_type",    3],
  ],
  "Pricing": [
    ["retail_price",    1],
    ["sale_price",      2],
    ["cost_price",      3],
    ["msrp",            4],
    ["scom",            5],
    ["scom_sale",       6],
    ["map",             7],
    ["currency",        8],
    ["price_tier",      9],
  ],
  "Inventory & Logistics": [
    ["stock_quantity",      1],
    ["warehouse_location",  2],
    ["reorder_point",       3],
    ["weight_oz",           4],
    ["inventory_status",    5],
  ],
  "Compliance": [
    ["country_of_origin",  1],
    ["hs_code",            2],
    ["is_hazmat",          3],
    ["shipping_class",     4],
    ["return_policy",      5],
    ["warranty_months",    6],
  ],
  "Flags": [
    ["is_on_sale",       1],
    ["is_new_arrival",   2],
  ],

  // ── Tab: descriptions_seo ───────────────────────────────────
  "Descriptions": [
    ["short_description",        1, true],
    ["long_description",         2, true],
    ["ai_generated_description", 3, true],
    ["ai_generated_bullets",     4, true],
  ],
  "SEO": [
    ["product_slug",    1],
    ["ai_seo_title",    2],
    ["ai_seo_meta",     3, true],
    ["keywords",        4, true],
    ["tags",            5, true],
    ["alt_text",        6, true],
    ["canonical_url",   7],
  ],

  // ── Tab: launch_media ───────────────────────────────────────
  "Media": [
    ["primary_image_url", 1],
    ["image_urls",        2, true],
    ["media_count",       3],
  ],
  "Visibility": [
    ["is_visible",   1],
    ["is_featured",  2],
  ],
};

// Build a lookup: field_key → { display_group, display_order, full_width }
const FIELD_MAP = {};
for (const [groupName, fields] of Object.entries(DISPLAY_GROUPS)) {
  for (const entry of fields) {
    const [fieldKey, order, fullWidth] = entry;
    FIELD_MAP[fieldKey] = {
      display_group: groupName,
      display_order: order,
      full_width: fullWidth || false,
    };
  }
}

async function main() {
  const app = initApp();
  const db = admin.firestore(app);

  console.log(`\n🌱  Seeding display_group/display_order on "${COLLECTION}" …`);

  const snap = await db.collection(COLLECTION).get();
  let updated = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const fieldKey = doc.id;
    const mapping = FIELD_MAP[fieldKey];

    if (mapping) {
      await doc.ref.update({
        display_group: mapping.display_group,
        display_order: mapping.display_order,
        full_width: mapping.full_width,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`   ✓  ${fieldKey} → "${mapping.display_group}" (order: ${mapping.display_order}${mapping.full_width ? ', full_width' : ''})`);
      updated++;
    } else {
      console.log(`   ⚠  ${fieldKey} — no group mapping defined, setting to "Other"`);
      await doc.ref.update({
        display_group: "Other",
        display_order: 99,
        full_width: false,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      skipped++;
    }
  }

  console.log(`\n   Summary → updated: ${updated}, defaulted to "Other": ${skipped}`);
  console.log(`   ✔  display_group seed complete.\n`);
}

main().catch((e) => {
  console.error("❌  Seed failed:", e);
  process.exit(1);
});
