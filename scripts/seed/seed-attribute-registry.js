#!/usr/bin/env node
/**
 * Seed: attribute_registry — 66 docs
 * Product attribute definitions for the ROPI AOSS V3 platform.
 * Idempotent (set-with-merge).
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "attribute_registry";

// Helper to build attribute doc
function attr(id, label, type, group, opts = {}) {
  return {
    id,
    label,
    data_type: type,
    group,
    is_required: opts.required || false,
    is_searchable: opts.searchable || false,
    is_filterable: opts.filterable || false,
    is_ai_generated: opts.ai || false,
    allowed_values: opts.values || null,
    default_value: opts.default_value ?? null,
    sort_order: opts.sort || 0,
    status: "active",
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  };
}

const ATTRIBUTES = [
  // ── Core Product (1–10) ──
  attr("product_name", "Product Name", "string", "core", { required: true, searchable: true, sort: 1 }),
  attr("product_slug", "Product Slug", "string", "core", { required: true, sort: 2 }),
  attr("sku", "SKU", "string", "core", { required: true, searchable: true, sort: 3 }),
  attr("upc", "UPC / Barcode", "string", "core", { searchable: true, sort: 4 }),
  attr("brand", "Brand", "string", "core", { required: true, searchable: true, filterable: true, sort: 5 }),
  attr("category", "Category", "string", "core", { required: true, filterable: true, sort: 6 }),
  attr("subcategory", "Subcategory", "string", "core", { filterable: true, sort: 7 }),
  attr("product_type", "Product Type", "enum", "core", { filterable: true, values: ["footwear", "apparel", "accessory", "equipment"], sort: 8 }),
  attr("gender", "Gender", "enum", "core", { filterable: true, values: ["men", "women", "unisex", "kids", "toddler", "infant"], sort: 9 }),
  attr("age_group", "Age Group", "enum", "core", { filterable: true, values: ["adult", "youth", "toddler", "infant"], sort: 10 }),

  // ── Pricing (11–16) ──
  attr("retail_price", "Retail Price", "number", "pricing", { required: true, sort: 11 }),
  attr("sale_price", "Sale Price", "number", "pricing", { sort: 12 }),
  attr("cost_price", "Cost Price", "number", "pricing", { sort: 13 }),
  attr("msrp", "MSRP", "number", "pricing", { sort: 14 }),
  attr("currency", "Currency", "enum", "pricing", { values: ["USD", "CAD", "GBP", "EUR"], default_value: "USD", sort: 15 }),
  attr("price_tier", "Price Tier", "enum", "pricing", { values: ["budget", "mid", "premium", "luxury"], filterable: true, sort: 16 }),

  // ── Inventory (17–22) ──
  attr("stock_quantity", "Stock Quantity", "number", "inventory", { sort: 17 }),
  attr("warehouse_location", "Warehouse Location", "string", "inventory", { sort: 18 }),
  attr("reorder_point", "Reorder Point", "number", "inventory", { sort: 19 }),
  attr("weight_oz", "Weight (oz)", "number", "inventory", { sort: 20 }),
  attr("is_in_stock", "In Stock", "boolean", "inventory", { filterable: true, default_value: true, sort: 21 }),
  attr("inventory_status", "Inventory Status", "enum", "inventory", { values: ["available", "low_stock", "out_of_stock", "discontinued"], filterable: true, sort: 22 }),

  // ── Descriptions / Content (23–30) ──
  attr("short_description", "Short Description", "string", "content", { searchable: true, sort: 23 }),
  attr("long_description", "Long Description", "text", "content", { searchable: true, sort: 24 }),
  attr("ai_generated_description", "AI Generated Description", "text", "content", { ai: true, sort: 25 }),
  attr("ai_generated_bullets", "AI Generated Bullets", "array", "content", { ai: true, sort: 26 }),
  attr("ai_seo_title", "AI SEO Title", "string", "content", { ai: true, sort: 27 }),
  attr("ai_seo_meta", "AI SEO Meta Description", "string", "content", { ai: true, sort: 28 }),
  attr("keywords", "Keywords", "array", "content", { searchable: true, sort: 29 }),
  attr("tags", "Tags", "array", "content", { searchable: true, filterable: true, sort: 30 }),

  // ── Media (31–36) ──
  attr("primary_image_url", "Primary Image URL", "string", "media", { required: true, sort: 31 }),
  attr("image_urls", "Image URLs", "array", "media", { sort: 32 }),
  attr("video_url", "Video URL", "string", "media", { sort: 33 }),
  attr("thumbnail_url", "Thumbnail URL", "string", "media", { sort: 34 }),
  attr("alt_text", "Image Alt Text", "string", "media", { ai: true, sort: 35 }),
  attr("media_count", "Media Count", "number", "media", { sort: 36 }),

  // ── Sizing / Variants (37–44) ──
  attr("size", "Size", "string", "variant", { filterable: true, sort: 37 }),
  attr("size_system", "Size System", "enum", "variant", { values: ["us", "uk", "eu", "cm"], default_value: "us", sort: 38 }),
  attr("color", "Color", "string", "variant", { filterable: true, sort: 39 }),
  attr("color_family", "Color Family", "enum", "variant", { filterable: true, values: ["black", "white", "red", "blue", "green", "brown", "grey", "pink", "yellow", "orange", "purple", "multi"], sort: 40 }),
  attr("material", "Material", "string", "variant", { filterable: true, sort: 41 }),
  attr("width", "Width", "enum", "variant", { filterable: true, values: ["narrow", "standard", "wide", "extra_wide"], sort: 42 }),
  attr("style_code", "Style Code", "string", "variant", { searchable: true, sort: 43 }),
  attr("colorway", "Colorway", "string", "variant", { searchable: true, sort: 44 }),

  // ── Sneaker-Specific (45–52) ──
  attr("silhouette", "Silhouette", "string", "sneaker", { filterable: true, searchable: true, sort: 45 }),
  attr("release_date", "Release Date", "timestamp", "sneaker", { filterable: true, sort: 46 }),
  attr("release_type", "Release Type", "enum", "sneaker", { filterable: true, values: ["general", "limited", "exclusive", "quickstrike", "hyperstrike"], sort: 47 }),
  attr("collaboration", "Collaboration", "string", "sneaker", { searchable: true, filterable: true, sort: 48 }),
  attr("technology", "Technology", "array", "sneaker", { filterable: true, sort: 49 }),
  attr("closure_type", "Closure Type", "enum", "sneaker", { filterable: true, values: ["lace_up", "slip_on", "velcro", "zipper", "buckle"], sort: 50 }),
  attr("heel_height", "Heel Height", "enum", "sneaker", { values: ["flat", "low", "mid", "high"], filterable: true, sort: 51 }),
  attr("toe_shape", "Toe Shape", "enum", "sneaker", { values: ["round", "pointed", "square", "open"], sort: 52 }),

  // ── SEO / Visibility (53–58) ──
  attr("is_visible", "Visible on Storefront", "boolean", "visibility", { default_value: true, sort: 53 }),
  attr("is_featured", "Featured", "boolean", "visibility", { filterable: true, sort: 54 }),
  attr("is_on_sale", "On Sale", "boolean", "visibility", { filterable: true, sort: 55 }),
  attr("is_new_arrival", "New Arrival", "boolean", "visibility", { filterable: true, sort: 56 }),
  attr("canonical_url", "Canonical URL", "string", "visibility", { sort: 57 }),
  attr("site_ids", "Assigned Sites", "array", "visibility", { sort: 58 }),

  // ── Compliance / Logistics (59–64) ──
  attr("country_of_origin", "Country of Origin", "string", "compliance", { sort: 59 }),
  attr("hs_code", "HS / Tariff Code", "string", "compliance", { sort: 60 }),
  attr("is_hazmat", "Hazardous Material", "boolean", "compliance", { default_value: false, sort: 61 }),
  attr("shipping_class", "Shipping Class", "enum", "compliance", { values: ["standard", "oversize", "freight", "ltl"], default_value: "standard", sort: 62 }),
  attr("return_policy", "Return Policy", "enum", "compliance", { values: ["standard", "final_sale", "exchange_only"], default_value: "standard", sort: 63 }),
  attr("warranty_months", "Warranty (months)", "number", "compliance", { default_value: 0, sort: 64 }),

  // ── Analytics / AI (65–66) ──
  attr("ai_confidence_score", "AI Confidence Score", "number", "analytics", { ai: true, sort: 65 }),
  attr("last_ai_enrichment", "Last AI Enrichment", "timestamp", "analytics", { ai: true, sort: 66 }),
];

async function main() {
  const app = initApp();
  const db = admin.firestore(app);
  console.log(`\n🌱  Seeding "${COLLECTION}" (${ATTRIBUTES.length} docs) …`);

  let created = 0, updated = 0;
  for (const item of ATTRIBUTES) {
    const { id, ...data } = item;
    const ref = db.collection(COLLECTION).doc(id);
    const snap = await ref.get();
    if (snap.exists) {
      const { created_at, ...upd } = data;
      await ref.set({ ...upd, updated_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      updated++;
    } else {
      await ref.set(data);
      created++;
    }
  }
  console.log(`   Summary → created: ${created}, updated: ${updated}, total: ${ATTRIBUTES.length}`);
  console.log(`   ✔  "${COLLECTION}" seed complete.\n`);
}

main().catch(e => { console.error("❌  Seed failed:", e); process.exit(1); });
