#!/usr/bin/env node
/**
 * Seed: attribute_registry — 72 docs
 * SPEC-compliant schema: field_key, display_label, field_type, destination_tab,
 * required_for_completion, include_in_ai_prompt, include_in_cadence_targeting,
 * active, export_enabled, dropdown_options, created_at.
 * Idempotent (set-with-merge). Existing created_at is preserved.
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "attribute_registry";

/**
 * Build an attribute_registry document.
 *
 * field_type: "text" | "dropdown" | "toggle" | "number" | "date"
 * destination_tab: "core_information" | "product_attributes" | "descriptions_seo" | "launch_media" | "system"
 */
function attr(field_key, display_label, field_type, destination_tab, opts = {}) {
  const out = {
    field_key,
    display_label,
    field_type,
    destination_tab,
    display_group: opts.display_group || "",
    display_order: opts.display_order ?? 99,
    required_for_completion: opts.required || false,
    include_in_ai_prompt: opts.ai_prompt || false,
    include_in_cadence_targeting: opts.cadence || false,
    active: true,
    export_enabled: opts.export_disabled ? false : true,
    dropdown_options: opts.options || [],
  };
  // TALLY-PRODUCT-LIST-UX Phase 4B — governance fields. Only emit when
  // explicitly opted in so existing entries don't get a null enum_source
  // they don't need (the handler treats undefined/null/non-string as "no
  // enum_source enforcement" — see products.ts POST /:mpn/attributes/:fk).
  if (typeof opts.enum_source === "string" && opts.enum_source) {
    out.enum_source = opts.enum_source;
  }
  if (typeof opts.dropdown_source === "string" && opts.dropdown_source) {
    out.dropdown_source = opts.dropdown_source;
  }
  return out;
}

// ────────────────────────────────────────────────
//  Core Information tab (18 docs) — TALLY-083
//  Visible on every product; operators see these first.
// ────────────────────────────────────────────────
const CORE_INFORMATION = [
  attr("product_name",     "Name",                 "text",     "core_information", { required: true,  ai_prompt: true, cadence: false, display_group: "Identity", display_order: 1 }),
  attr("sku",              "SKU",                  "text",     "core_information", { required: true, display_group: "Identity", display_order: 2 }),
  attr("upc",              "UPC / Barcode",        "text",     "core_information", { display_group: "Identity", display_order: 3 }),
  attr("brand",            "Brand",                "text",     "core_information", { required: true,  ai_prompt: true, cadence: true, display_group: "Identity", display_order: 4, enum_source: "brand_registry" }),
  attr("category",         "Category",             "dropdown", "core_information", {
    required: true,  ai_prompt: true, cadence: true, display_group: "Classification", display_order: 5,
    options: ["Basketball", "Bootcut", "Fitted Hat", "Flat", "Jersey",
      "Lifestyle", "Low Heel", "Mini Dress", "Pullover Hoodie",
      "Pumps", "Short Sleeve", "Short Sleeve Graphic Tees",
      "Slides", "Socks", "Varsity", "Winter Vests"],
  }),
  attr("class",             "Class",                "dropdown", "core_information", {
    required: true,  ai_prompt: true, display_group: "Classification", display_order: 6,
    options: ["Boots", "Dresses", "Hats", "High Heels", "Jackets",
      "Jerseys", "Pants", "Sandals", "Sneakers",
      "Socks & Underwear", "Sweatshirts", "T-shirts", "Vests"],
  }),
  attr("department",        "Department",           "dropdown", "core_information", {
    required: true, ai_prompt: true, display_group: "Classification", display_order: 7,
    options: ["Footwear", "Clothing", "Accessories", "Home & Tech"],
    enum_source: "department_registry",
  }),
  // TALLY-PRODUCT-LIST-UX Phase 4B — site_owner is a dropdown sourced from
  // site_registry. dropdown_source preserves the legacy TALLY-125 hint
  // (UI lookup); enum_source is the new POST-time validator gate.
  attr("site_owner",        "Site Owner",           "dropdown", "core_information", {
    display_group: "Identity", display_order: 99,
    enum_source: "site_registry",
    dropdown_source: "site_registry",
  }),
  attr("gender",           "Gender",               "dropdown", "core_information", {
    required: true, ai_prompt: true, cadence: true, display_group: "Classification", display_order: 8,
    options: ["Mens", "Womens", "Unisex", "Boys", "Girls", "Toddler"],
  }),
  attr("age_group",        "Age Group",            "dropdown", "core_information", {
    required: true, ai_prompt: true, cadence: true, display_group: "Classification", display_order: 9,
    options: ["Adult", "Grade-School", "Pre-School", "Toddler"],
  }),
  attr("primary_color",    "Primary Color",        "dropdown", "core_information", {
    ai_prompt: true, display_group: "Classification", display_order: 10,
    options: ["Black", "White", "Grey", "Brown", "Tan", "Beige", "Navy", "Blue",
      "Royal Blue", "Sky Blue", "Teal", "Green", "Olive", "Lime", "Yellow", "Gold",
      "Orange", "Red", "Pink", "Purple", "Burgundy", "Cream", "Multi", "Clear",
      "Metallic", "Silver", "Rose Gold", "Camo", "Tie Dye", "Natural", "Iridescent", "Other"],
  }),
  attr("color_family",     "Color Family",         "dropdown", "core_information", {
    display_group: "Classification", display_order: 11,
    options: ["black", "white", "red", "blue", "green", "brown", "grey", "pink", "yellow", "orange", "purple", "multi"],
  }),
  attr("size",             "Size / Size Type",     "text",     "core_information", { display_group: "Classification", display_order: 12 }),
  attr("style_code",       "Style Code",           "text",     "core_information", { required: false, display_group: "Identity", display_order: 13 }),
  attr("website",          "Website",              "multi_select", "core_information", {
    required: true, display_group: "Visibility", display_order: 14,
    options: ["fbrkclothing.com", "karmaloop.com", "mltd.com", "plndr.com", "shiekh.com", "shiekhshoes.com", "trendswap.com"],
  }),
  attr("site_ids",         "Site Owner",           "text",     "core_information", { display_group: "Visibility", display_order: 15 }),
  attr("is_in_stock",      "Product Is Active",    "toggle",   "core_information", { required: true, display_group: "Visibility", display_order: 16 }),
  attr("image_status",     "Image Status",         "text",     "core_information", { display_group: "Visibility", display_order: 17 }),
];

// ────────────────────────────────────────────────
//  Product Attributes tab (31 docs)
//  Physical, variant, pricing, inventory, compliance.
// ────────────────────────────────────────────────
const PRODUCT_ATTRIBUTES = [
  // Physical / variant
  attr("descriptive_color", "Descriptive Color",   "text",     "product_attributes", { ai_prompt: true, display_group: "Physical", display_order: 1 }),
  attr("fit",               "Fit",                 "dropdown", "product_attributes", {
    ai_prompt: true, display_group: "Physical", display_order: 2,
    options: [
      "Runs one Size Small",
      "Runs a Half Size Small",
      "True to Size",
      "Runs A Half Size Big",
      "Runs One Size Big",
    ],
  }),
  attr("material",          "Material / Fabric",   "text",     "product_attributes", { ai_prompt: true, display_group: "Physical", display_order: 3 }),
  attr("colorway",          "Colorway",            "text",     "product_attributes", { ai_prompt: true, display_group: "Physical", display_order: 4 }),
  attr("size_system",       "Size System",         "dropdown", "product_attributes", {
    display_group: "Physical", display_order: 5,
    options: ["us", "uk", "eu", "cm"],
  }),
  attr("width",             "Width",               "dropdown", "product_attributes", {
    ai_prompt: true, display_group: "Physical", display_order: 6,
    options: ["narrow", "standard", "wide", "extra_wide"],
  }),
  attr("silhouette",        "Silhouette",          "text",     "product_attributes", { ai_prompt: true, display_group: "Physical", display_order: 7 }),
  attr("closure_type",      "Closure Type",        "dropdown", "product_attributes", {
    ai_prompt: true, display_group: "Physical", display_order: 8,
    options: ["lace_up", "slip_on", "velcro", "zipper", "buckle"],
  }),
  attr("heel_height",       "Heel Height",         "dropdown", "product_attributes", {
    ai_prompt: true, display_group: "Physical", display_order: 9,
    options: ["flat", "low", "mid", "high"],
  }),
  attr("toe_shape",         "Toe Shape",           "dropdown", "product_attributes", {
    ai_prompt: true, display_group: "Physical", display_order: 10,
    options: ["round", "pointed", "square", "open"],
  }),
  attr("technology",        "Technology",          "text",     "product_attributes", { ai_prompt: true, display_group: "Physical", display_order: 11 }),
  attr("collaboration",     "Collaboration",       "text",     "product_attributes", { ai_prompt: true, display_group: "Physical", display_order: 12 }),
  // Sneaker / release
  attr("release_date",      "Release Date",        "date",     "product_attributes", { cadence: true, display_group: "Release", display_order: 13 }),
  attr("release_type",      "Release Type",        "dropdown", "product_attributes", {
    cadence: true, display_group: "Release", display_order: 14,
    options: ["general", "limited", "exclusive", "quickstrike", "hyperstrike"],
  }),
  // Pricing
  attr("retail_price",      "Retail Price",        "number",   "product_attributes", { display_group: "Pricing", display_order: 15 }),
  attr("sale_price",        "Sale Price",          "number",   "product_attributes", { cadence: true, display_group: "Pricing", display_order: 16 }),
  attr("cost_price",        "Cost Price",          "number",   "product_attributes", { display_group: "Pricing", display_order: 17 }),
  attr("msrp",              "MSRP",                "number",   "product_attributes", { display_group: "Pricing", display_order: 18 }),
  // Web selling prices — editable for Product Ops (TALLY-107)
  attr("scom",              "Web Regular Price (SCOM)", "number", "product_attributes", { display_group: "Pricing", display_order: 19 }),
  attr("scom_sale",         "Web Sale Price (SCOM Sale)", "number", "product_attributes", { display_group: "Pricing", display_order: 20 }),
  // MAP designation — toggling to a MAP-active value auto-populates SCOM from RICS Retail (TALLY-107)
  attr("map",               "MAP",                 "dropdown", "product_attributes", {
    display_group: "Pricing", display_order: 21,
    options: ["NO", "MAP", "UMAP", "iMAP", "Disallowed"],
  }),
  attr("currency",          "Currency",            "dropdown", "product_attributes", {
    display_group: "Pricing", display_order: 22,
    options: ["USD", "CAD", "GBP", "EUR"],
  }),
  attr("price_tier",        "Price Tier",          "dropdown", "product_attributes", {
    cadence: true, display_group: "Pricing", display_order: 23,
    options: ["budget", "mid", "premium", "luxury"],
  }),
  // Inventory
  attr("stock_quantity",    "Stock Quantity",      "number",   "product_attributes", { display_group: "Inventory", display_order: 24 }),
  attr("warehouse_location","Warehouse Location",  "text",     "product_attributes", { display_group: "Inventory", display_order: 25 }),
  attr("reorder_point",     "Reorder Point",       "number",   "product_attributes", { display_group: "Inventory", display_order: 26 }),
  attr("weight_oz",         "Weight (oz)",         "number",   "product_attributes", { display_group: "Inventory", display_order: 27 }),
  attr("inventory_status",  "Inventory Status",    "dropdown", "product_attributes", {
    cadence: true, display_group: "Inventory", display_order: 28,
    options: ["available", "low_stock", "out_of_stock", "discontinued"],
  }),
  // Compliance / logistics
  attr("country_of_origin", "Country of Origin",  "text",     "product_attributes", { display_group: "Compliance", display_order: 29 }),
  attr("hs_code",           "HS / Tariff Code",   "text",     "product_attributes", { display_group: "Compliance", display_order: 30 }),
  attr("is_hazmat",         "Hazardous Material",  "toggle",   "product_attributes", { display_group: "Compliance", display_order: 31 }),
  attr("shipping_class",    "Shipping Class",      "dropdown", "product_attributes", {
    display_group: "Compliance", display_order: 32,
    options: ["standard", "oversize", "freight", "ltl"],
  }),
  attr("return_policy",     "Return Policy",       "dropdown", "product_attributes", {
    display_group: "Compliance", display_order: 33,
    options: ["standard", "final_sale", "exchange_only"],
  }),
  attr("warranty_months",   "Warranty (months)",   "number",   "product_attributes", { display_group: "Compliance", display_order: 34 }),
  // Visibility flags
  attr("is_on_sale",        "On Sale",             "toggle",   "product_attributes", { cadence: true, display_group: "Flags", display_order: 35 }),
  attr("is_new_arrival",    "New Arrival",         "toggle",   "product_attributes", { cadence: true, display_group: "Flags", display_order: 36 }),
];

// ────────────────────────────────────────────────
//  Descriptions & SEO tab (11 docs)
// ────────────────────────────────────────────────
const DESCRIPTIONS_SEO = [
  attr("product_slug",          "Product Slug",             "text", "descriptions_seo", { display_group: "SEO", display_order: 1 }),
  attr("short_description",     "Short Description",        "text", "descriptions_seo", { ai_prompt: true, display_group: "Descriptions", display_order: 2 }),
  attr("long_description",      "Long Description",         "text", "descriptions_seo", { ai_prompt: true, display_group: "Descriptions", display_order: 3 }),
  attr("ai_generated_description","AI Generated Description","text","descriptions_seo", { ai_prompt: false, display_group: "Descriptions", display_order: 4 }),
  attr("ai_generated_bullets",  "AI Generated Bullets",     "text", "descriptions_seo", { ai_prompt: false, display_group: "Descriptions", display_order: 5 }),
  attr("ai_seo_title",          "Meta Name",                "text", "descriptions_seo", { required: true, ai_prompt: false, display_group: "SEO", display_order: 6 }),
  attr("ai_seo_meta",           "Meta Description",         "text", "descriptions_seo", { required: true, ai_prompt: false, display_group: "SEO", display_order: 7 }),
  attr("keywords",              "Keywords",                 "text", "descriptions_seo", { ai_prompt: true, display_group: "SEO", display_order: 8 }),
  attr("tags",                  "Tags",                     "text", "descriptions_seo", { ai_prompt: true, display_group: "SEO", display_order: 9 }),
  attr("alt_text",              "Image Alt Text",           "text", "descriptions_seo", { ai_prompt: true, display_group: "SEO", display_order: 10 }),
  attr("canonical_url",         "Canonical URL",            "text", "descriptions_seo", { display_group: "SEO", display_order: 11 }),
];

// ────────────────────────────────────────────────
//  Launch & Media tab (7 docs)
// ────────────────────────────────────────────────
const LAUNCH_MEDIA = [
  attr("primary_image_url", "Primary Image URL",  "text",   "launch_media", { display_group: "Media", display_order: 1 }),
  attr("image_urls",        "Image URLs",          "text",   "launch_media", { display_group: "Media", display_order: 2 }),
  attr("media_count",       "Media Count",         "number", "launch_media", { display_group: "Media", display_order: 3 }),
  attr("is_visible",        "Visible on Storefront","toggle","launch_media", { display_group: "Visibility", display_order: 4 }),
  attr("is_featured",       "Featured",            "toggle", "launch_media", { display_group: "Visibility", display_order: 5 }),
];

// ────────────────────────────────────────────────
//  System tab (2 docs)
//  AI-derived signals — hidden from operators,
//  never in AI prompt, never exported.
// ────────────────────────────────────────────────
const SYSTEM = [
  attr("ai_confidence_score", "AI Confidence Score", "number", "system", { export_disabled: true, display_group: "System", display_order: 1 }),
  attr("last_ai_enrichment",  "Last AI Enrichment",  "date",   "system", { export_disabled: true, display_group: "System", display_order: 2 }),
];

const ATTRIBUTES = [
  ...CORE_INFORMATION,      // 18
  ...PRODUCT_ATTRIBUTES,    // 36
  ...DESCRIPTIONS_SEO,      // 11
  ...LAUNCH_MEDIA,          //  7
  ...SYSTEM,                //  2
  // Total: 73
];

async function main() {
  const app = initApp();
  const db = admin.firestore(app);

  console.log(`\n🌱  Seeding "${COLLECTION}" (${ATTRIBUTES.length} docs) …`);

  // Verify count matches spec before writing anything
  if (ATTRIBUTES.length !== 73) {
    console.error(`❌  Expected 73 attributes, got ${ATTRIBUTES.length}. Aborting.`);
    process.exit(1);
  }

  let created = 0, updated = 0;

  for (const item of ATTRIBUTES) {
    const { field_key, ...data } = item;
    const ref = db.collection(COLLECTION).doc(field_key);
    const snap = await ref.get();

    if (snap.exists) {
      // Preserve created_at; update everything else (including new SPEC fields)
      await ref.set(
        { ...data, updated_at: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      updated++;
    } else {
      await ref.set({
        ...data,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      created++;
    }

    console.log(`   ✓  [${item.destination_tab}] ${field_key}`);
  }

  // Validate destination_tab distribution
  const tabCounts = {};
  for (const a of ATTRIBUTES) {
    tabCounts[a.destination_tab] = (tabCounts[a.destination_tab] || 0) + 1;
  }

  console.log(`\n   Tab distribution:`);
  for (const [tab, count] of Object.entries(tabCounts)) {
    console.log(`      ${tab}: ${count}`);
  }

  console.log(`\n   Summary → created: ${created}, updated: ${updated}, total: ${ATTRIBUTES.length}`);
  console.log(`   ✔  "${COLLECTION}" seed complete.\n`);
}

main().catch(e => { console.error("❌  Seed failed:", e); process.exit(1); });
