#!/usr/bin/env node
/**
 * Seed: smart_rules — 3 docs
 * AI content-generation rule sets for the ROPI AOSS V3 platform.
 * Idempotent (set-with-merge).
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "smart_rules";

const RULES = [
  {
    id: "ai_description_generation",
    name: "AI Description Generation",
    description: "Rules governing automated product description generation across all sites",
    rule_type: "content_generation",
    status: "active",
    priority: 1,
    conditions: {
      trigger: "on_product_create_or_update",
      required_fields: ["product_name", "brand", "category", "sku"],
      skip_if: ["ai_generated_description_exists_and_fresh"],
      freshness_threshold_hours: 168,
    },
    actions: {
      generate_fields: [
        "ai_generated_description",
        "ai_generated_bullets",
        "ai_seo_title",
        "ai_seo_meta",
        "alt_text",
      ],
      model: "gpt-4o",
      fallback_model: "gpt-4o-mini",
      max_tokens: 4096,
      temperature: 0.7,
      enforce_brand_voice: true,
      apply_site_strategy: true,
    },
    site_scope: ["shiekh", "karmaloop", "mltd", "plndr", "shiekhshoes", "trendswap", "fbrk"],
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  },
  {
    id: "price_markdown_automation",
    name: "Price Markdown Automation",
    description: "Smart pricing rules for automated markdowns based on inventory age and stock levels",
    rule_type: "pricing",
    status: "active",
    priority: 2,
    conditions: {
      trigger: "on_schedule",
      schedule_cron: "0 2 * * *",
      min_days_in_stock: 30,
      inventory_status: ["available", "low_stock"],
    },
    actions: {
      markdown_tiers: [
        { days_in_stock: 30, discount_pct: 10 },
        { days_in_stock: 60, discount_pct: 20 },
        { days_in_stock: 90, discount_pct: 30 },
        { days_in_stock: 120, discount_pct: 40 },
      ],
      max_discount_pct: 50,
      exclude_brands: [],
      notify_on_markdown: true,
      requires_approval_above_pct: 35,
    },
    site_scope: ["karmaloop", "plndr", "trendswap"],
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  },
  {
    id: "inventory_visibility_sync",
    name: "Inventory Visibility Sync",
    description: "Rules for automatically hiding/showing products based on stock status across storefronts",
    rule_type: "visibility",
    status: "active",
    priority: 3,
    conditions: {
      trigger: "on_inventory_change",
      evaluate_fields: ["stock_quantity", "inventory_status"],
    },
    actions: {
      hide_when_out_of_stock: true,
      show_when_restocked: true,
      out_of_stock_threshold: 0,
      low_stock_threshold: 5,
      set_is_visible: true,
      set_is_on_sale: false,
      notify_on_restock: true,
      cross_site_sync: true,
    },
    site_scope: ["shiekh", "karmaloop", "mltd", "plndr", "shiekhshoes", "trendswap", "fbrk"],
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  },
];

async function main() {
  const app = initApp();
  const db = admin.firestore(app);
  console.log(`\n🌱  Seeding "${COLLECTION}" (${RULES.length} docs) …`);

  let created = 0, updated = 0;
  for (const rule of RULES) {
    const { id, ...data } = rule;
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
  console.log(`   Summary → created: ${created}, updated: ${updated}, total: ${RULES.length}`);
  console.log(`   ✔  "${COLLECTION}" seed complete.\n`);
}

main().catch(e => { console.error("❌  Seed failed:", e); process.exit(1); });
