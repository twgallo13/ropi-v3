#!/usr/bin/env node
/**
 * Seed script: globalConfig collection
 * Idempotent — safe to run multiple times (uses set-with-merge).
 *
 * Usage:  node scripts/seed/seed-global-config.js
 */

"use strict";

const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "globalConfig";

const CONFIGS = [
  {
    id: "platform",
    appName: "ropi-aoss",
    version: "3.0.0",
    environment: "dev",
    maintenanceMode: false,
    supportEmail: "support@ropi.io",
    maxSitesPerAccount: 10,
    defaultLocale: "en-US",
    defaultCurrency: "USD",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  },
  {
    id: "ai",
    defaultModel: "gpt-4o",
    fallbackModel: "gpt-4o-mini",
    maxTokensPerRequest: 4096,
    contentGenerationEnabled: true,
    moderationEnabled: true,
    strategies: ["use_ropi_default", "use_shiekh_default"],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  },
  {
    id: "featureFlags",
    enableDynamicPricing: false,
    enableAIDescriptions: true,
    enableReviewSummaries: true,
    enableMultiCurrency: false,
    enableAnalyticsDashboard: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  },
];

async function main() {
  const app = initApp();
  const db = admin.firestore(app);
  console.log(`\n🌱  Seeding "${COLLECTION}" collection …`);

  let created = 0;
  let updated = 0;

  for (const config of CONFIGS) {
    const { id, ...data } = config;
    const ref = db.collection(COLLECTION).doc(id);
    const snap = await ref.get();

    if (snap.exists) {
      const { createdAt, ...updateData } = data;
      await ref.set({ ...updateData, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      updated++;
      console.log(`   ✏️  Updated existing doc: ${COLLECTION}/${id}`);
    } else {
      await ref.set(data);
      created++;
      console.log(`   ✅  Created doc: ${COLLECTION}/${id}`);
    }
  }

  console.log(`\n   Summary → created: ${created}, updated: ${updated}, total: ${CONFIGS.length}`);
  console.log(`   ✔  "${COLLECTION}" seed complete.\n`);
}

main().catch((err) => {
  console.error("❌  Seed failed:", err);
  process.exit(1);
});
