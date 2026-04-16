#!/usr/bin/env node
/**
 * Seed script: siteRegistry collection
 * Idempotent — safe to run multiple times (uses set-with-merge).
 *
 * Auth: set GCP_SA_KEY_DEV env-var to the JSON service-account key content,
 *        or set GOOGLE_APPLICATION_CREDENTIALS to a key-file path.
 *
 * Usage:  node scripts/seed/seed-site-registry.js
 */

"use strict";

const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "siteRegistry";

const SITES = [
  {
    id: "shiekh",
    name: "Shiekh",
    domain: "shiekh.com",
    status: "active",
    ai_content_strategy: "use_shiekh_default",
    locale: "en-US",
    currency: "USD",
    timezone: "America/Los_Angeles",
    features: {
      ai_descriptions: true,
      ai_reviews_summary: true,
      dynamic_pricing: false,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  },
  {
    id: "ropi-main",
    name: "ROPI Main",
    domain: "ropi.io",
    status: "active",
    ai_content_strategy: "use_ropi_default",
    locale: "en-US",
    currency: "USD",
    timezone: "America/New_York",
    features: {
      ai_descriptions: true,
      ai_reviews_summary: true,
      dynamic_pricing: true,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  },
  {
    id: "ropi-outlet",
    name: "ROPI Outlet",
    domain: "outlet.ropi.io",
    status: "active",
    ai_content_strategy: "use_ropi_default",
    locale: "en-US",
    currency: "USD",
    timezone: "America/New_York",
    features: {
      ai_descriptions: true,
      ai_reviews_summary: false,
      dynamic_pricing: false,
    },
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

  for (const site of SITES) {
    const { id, ...data } = site;
    const ref = db.collection(COLLECTION).doc(id);
    const snap = await ref.get();

    if (snap.exists) {
      // Merge to preserve any manual additions
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

  console.log(`\n   Summary → created: ${created}, updated: ${updated}, total: ${SITES.length}`);
  console.log(`   ✔  "${COLLECTION}" seed complete.\n`);
}

main().catch((err) => {
  console.error("❌  Seed failed:", err);
  process.exit(1);
});
