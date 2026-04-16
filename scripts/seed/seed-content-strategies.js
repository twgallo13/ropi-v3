#!/usr/bin/env node
/**
 * Seed script: contentStrategies collection
 * Idempotent — safe to run multiple times (uses set-with-merge).
 *
 * Usage:  node scripts/seed/seed-content-strategies.js
 */

"use strict";

const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "contentStrategies";

const STRATEGIES = [
  {
    id: "use_ropi_default",
    name: "ROPI Default Strategy",
    description: "Standard AI content generation for ROPI-branded sites",
    toneOfVoice: "professional",
    targetAudience: "general",
    maxDescriptionLength: 500,
    enableSEOOptimization: true,
    enableAutoTranslation: false,
    promptTemplate: "Generate a product description in a professional, informative tone for a general audience.",
    brandGuidelines: {
      voiceStyle: "professional",
      avoidTerms: [],
      preferredTerms: ["premium", "quality", "reliable"],
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  },
  {
    id: "use_shiekh_default",
    name: "Shiekh Default Strategy",
    description: "AI content generation tailored for Shiekh brand voice and audience",
    toneOfVoice: "energetic",
    targetAudience: "streetwear-sneaker-enthusiasts",
    maxDescriptionLength: 400,
    enableSEOOptimization: true,
    enableAutoTranslation: false,
    promptTemplate: "Generate a product description in an energetic, trend-forward tone targeting sneaker and streetwear enthusiasts.",
    brandGuidelines: {
      voiceStyle: "energetic",
      avoidTerms: ["cheap", "budget"],
      preferredTerms: ["fresh", "exclusive", "drip", "fire"],
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

  for (const strategy of STRATEGIES) {
    const { id, ...data } = strategy;
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

  console.log(`\n   Summary → created: ${created}, updated: ${updated}, total: ${STRATEGIES.length}`);
  console.log(`   ✔  "${COLLECTION}" seed complete.\n`);
}

main().catch((err) => {
  console.error("❌  Seed failed:", err);
  process.exit(1);
});
