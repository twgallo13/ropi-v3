/**
 * product-editor-overhaul.js
 *
 * Combined seed script for Items 3, 5, and 6 of the Product Editor Overhaul:
 *   Item 3 — Move Descriptive Color to Core Information
 *   Item 5 — Image Status (media_status) read-only
 *   Item 6 — Product Attributes tab full restructure
 */
"use strict";

const admin = require("firebase-admin");
const { initApp } = require("./utils");

initApp();
const db = admin.firestore();

// ── Item 3: Move Descriptive Color to Core Information ──────────
async function moveDescriptiveColor() {
  console.log("📦  Item 3 — Moving descriptive_color to Core Information...");
  await db.collection("attribute_registry").doc("descriptive_color").set(
    {
      destination_tab: "core_information",
      display_group: "Classification",
      display_order: 6,
    },
    { merge: true }
  );
  console.log("  Done");
}

// ── Item 5: Image Status read-only ──────────────────────────────
async function imageStatusReadOnly() {
  console.log("🔒  Item 5 — Setting media_status as read-only...");
  await db.collection("attribute_registry").doc("media_status").set(
    {
      is_editable: false,
      is_required: false,
      destination_tab: null,
    },
    { merge: true }
  );
  console.log("  Done");
}

// ── Item 6: Product Attributes tab restructure ──────────────────
async function restructureProductAttributes() {
  console.log("🔧  Item 6 — Restructuring Product Attributes tab...");

  const PRODUCT_ATTRIBUTES_LAYOUT = [
    // PHYSICAL TRAITS — tab_group_order: 1
    { key: "descriptive_color",  group: "Physical Traits",      order: 1, tab_group_order: 1 },
    { key: "material_fabric",    group: "Physical Traits",      order: 2, tab_group_order: 1 },
    { key: "fit",                group: "Physical Traits",      order: 3, tab_group_order: 1 },
    { key: "cut_type",           group: "Physical Traits",      order: 4, tab_group_order: 1 },
    { key: "closure_type",       group: "Physical Traits",      order: 5, tab_group_order: 1 },
    { key: "silhouette",         group: "Physical Traits",      order: 6, tab_group_order: 1 },
    { key: "technology",         group: "Physical Traits",      order: 7, tab_group_order: 1 },
    { key: "collaboration",      group: "Physical Traits",      order: 8, tab_group_order: 1 },

    // SPORT & COLLECTION — tab_group_order: 2
    { key: "league",             group: "Sport & Collection",   order: 1, tab_group_order: 2 },
    { key: "sports_team",        group: "Sport & Collection",   order: 2, tab_group_order: 2 },
    { key: "collection_name",    group: "Sport & Collection",   order: 3, tab_group_order: 2 },

    // FAST FASHION — tab_group_order: 3
    { key: "is_fast_fashion",    group: "Fast Fashion",         order: 1, tab_group_order: 3 },

    // FAST FASHION DETAILS — tab_group_order: 4
    { key: "heel_height",        group: "Fast Fashion Details", order: 1, tab_group_order: 4,
      depends_on: { field: "is_fast_fashion", value: "true" } },
    { key: "platform_height",    group: "Fast Fashion Details", order: 2, tab_group_order: 4,
      depends_on: { field: "is_fast_fashion", value: "true" } },
    { key: "heel_type",          group: "Fast Fashion Details", order: 3, tab_group_order: 4,
      depends_on: { field: "is_fast_fashion", value: "true" } },
    { key: "toe_shape",          group: "Fast Fashion Details", order: 4, tab_group_order: 4,
      depends_on: { field: "is_fast_fashion", value: "true" } },
    { key: "shoe_height_map",    group: "Fast Fashion Details", order: 5, tab_group_order: 4,
      depends_on: { field: "is_fast_fashion", value: "true" } },
  ];

  // Fields to remove from product_attributes tab
  const REMOVE_FROM_PRODUCT_ATTRIBUTES = [
    "retail_price", "sale_price", "cost_price", "msrp",
    "web_regular_price", "web_sale_price", "map", "currency", "price_tier",
    "country_of_origin", "hs_tariff_code", "hazardous_material",
    "warranty", "on_sale", "new_arrival",
    "color_family", "size", "size_type", "upc", "barcode",
  ];

  // Apply layout updates
  for (const entry of PRODUCT_ATTRIBUTES_LAYOUT) {
    await db.collection("attribute_registry").doc(entry.key).set(
      {
        destination_tab: "product_attributes",
        display_group: entry.group,
        display_order: entry.order,
        tab_group_order: entry.tab_group_order || null,
        depends_on: entry.depends_on || null,
      },
      { merge: true }
    );
    console.log(`  Layout: ${entry.key} → ${entry.group} #${entry.order}`);
  }

  // Hide removed fields
  let removedCount = 0;
  for (const key of REMOVE_FROM_PRODUCT_ATTRIBUTES) {
    const ref = db.collection("attribute_registry").doc(key);
    if ((await ref.get()).exists) {
      await ref.set({ destination_tab: null, display_group: null }, { merge: true });
      removedCount++;
      console.log(`  Removed from tab: ${key}`);
    }
  }

  console.log(`  Done — ${PRODUCT_ATTRIBUTES_LAYOUT.length} laid out, ${removedCount} hidden`);
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  await moveDescriptiveColor();
  await imageStatusReadOnly();
  await restructureProductAttributes();
  console.log("\n✅  Product Editor Overhaul seed complete");
}

main().catch((err) => {
  console.error("❌  Error:", err);
  process.exit(1);
});
