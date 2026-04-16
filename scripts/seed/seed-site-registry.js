#!/usr/bin/env node
/**
 * Seed: site_registry — 7 docs
 * All ROPI AOSS V3 storefronts.
 * Idempotent (set-with-merge).
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "site_registry";

const SITES = [
  {
    id: "shiekh",
    name: "Shiekh",
    domain: "shiekh.com",
    platform: "shopify",
    status: "active",
    ai_content_strategy: "use_shiekh_default",
    locale: "en-US",
    currency: "USD",
    timezone: "America/Los_Angeles",
    vertical: "sneakers_streetwear",
    features: {
      ai_descriptions: true,
      ai_reviews_summary: true,
      dynamic_pricing: false,
      smart_rules_enabled: true,
    },
    feed_config: { format: "xml", schedule_cron: "0 */4 * * *" },
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  },
  {
    id: "karmaloop",
    name: "Karmaloop",
    domain: "karmaloop.com",
    platform: "shopify",
    status: "active",
    ai_content_strategy: "use_karmaloop_default",
    locale: "en-US",
    currency: "USD",
    timezone: "America/New_York",
    vertical: "streetwear",
    features: {
      ai_descriptions: true,
      ai_reviews_summary: true,
      dynamic_pricing: true,
      smart_rules_enabled: true,
    },
    feed_config: { format: "xml", schedule_cron: "0 */4 * * *" },
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  },
  {
    id: "mltd",
    name: "MLTD",
    domain: "mltd.com",
    platform: "shopify",
    status: "active",
    ai_content_strategy: "use_mltd_default",
    locale: "en-US",
    currency: "USD",
    timezone: "America/Los_Angeles",
    vertical: "streetwear_lifestyle",
    features: {
      ai_descriptions: true,
      ai_reviews_summary: false,
      dynamic_pricing: false,
      smart_rules_enabled: true,
    },
    feed_config: { format: "xml", schedule_cron: "0 */6 * * *" },
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  },
  {
    id: "plndr",
    name: "PLNDR",
    domain: "plndr.com",
    platform: "shopify",
    status: "active",
    ai_content_strategy: "use_plndr_default",
    locale: "en-US",
    currency: "USD",
    timezone: "America/Los_Angeles",
    vertical: "flash_sale_streetwear",
    features: {
      ai_descriptions: true,
      ai_reviews_summary: false,
      dynamic_pricing: true,
      smart_rules_enabled: true,
    },
    feed_config: { format: "xml", schedule_cron: "0 */6 * * *" },
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  },
  {
    id: "shiekhshoes",
    name: "Shiekh Shoes",
    domain: "shiekhshoes.com",
    platform: "shopify",
    status: "active",
    ai_content_strategy: "use_shiekh_default",
    locale: "en-US",
    currency: "USD",
    timezone: "America/Los_Angeles",
    vertical: "footwear",
    features: {
      ai_descriptions: true,
      ai_reviews_summary: true,
      dynamic_pricing: false,
      smart_rules_enabled: true,
    },
    feed_config: { format: "xml", schedule_cron: "0 */4 * * *" },
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  },
  {
    id: "trendswap",
    name: "TrendSwap",
    domain: "trendswap.com",
    platform: "shopify",
    status: "active",
    ai_content_strategy: "use_trendswap_default",
    locale: "en-US",
    currency: "USD",
    timezone: "America/New_York",
    vertical: "resale_marketplace",
    features: {
      ai_descriptions: true,
      ai_reviews_summary: false,
      dynamic_pricing: true,
      smart_rules_enabled: false,
    },
    feed_config: { format: "json", schedule_cron: "0 */8 * * *" },
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  },
  {
    id: "fbrk",
    name: "FBRK",
    domain: "fbrk.com",
    platform: "shopify",
    status: "active",
    ai_content_strategy: "use_fbrk_default",
    locale: "en-US",
    currency: "USD",
    timezone: "America/Los_Angeles",
    vertical: "sneakers_exclusive",
    features: {
      ai_descriptions: true,
      ai_reviews_summary: true,
      dynamic_pricing: false,
      smart_rules_enabled: true,
    },
    feed_config: { format: "xml", schedule_cron: "0 */4 * * *" },
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  },
];

async function main() {
  const app = initApp();
  const db = admin.firestore(app);
  console.log(`\n🌱  Seeding "${COLLECTION}" (${SITES.length} docs) …`);

  let created = 0, updated = 0;
  for (const site of SITES) {
    const { id, ...data } = site;
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
  console.log(`   Summary → created: ${created}, updated: ${updated}, total: ${SITES.length}`);
  console.log(`   ✔  "${COLLECTION}" seed complete.\n`);
}

main().catch(e => { console.error("❌  Seed failed:", e); process.exit(1); });
