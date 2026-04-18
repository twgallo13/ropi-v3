/**
 * backfill-rule-verified.js
 *
 * Migrates all attribute_values documents that have
 * verification_state: 'System-Applied' AND an origin_type in the
 * rule-origin set to the new 'Rule-Verified' state.
 */
"use strict";

const admin = require("firebase-admin");
const { initApp } = require("./utils");

initApp();
const db = admin.firestore();

const RULE_ORIGINS = ["Smart Rule", "Import", "Backfill", "RICS Category Parser"];

async function main() {
  console.log("🔄  Backfilling Rule-Verified state...");
  console.log(`    Origins: ${RULE_ORIGINS.join(", ")}`);

  const productsSnap = await db.collection("products").get();
  console.log(`    Found ${productsSnap.size} products`);

  let totalChanged = 0;
  let productsChanged = 0;

  for (const productDoc of productsSnap.docs) {
    const avSnap = await productDoc.ref.collection("attribute_values").get();
    const batch = db.batch();
    let changed = 0;

    for (const avDoc of avSnap.docs) {
      if (avDoc.id === "source_inputs") continue;
      const d = avDoc.data();
      if (
        d.verification_state === "System-Applied" &&
        RULE_ORIGINS.includes(d.origin_type)
      ) {
        batch.update(avDoc.ref, { verification_state: "Rule-Verified" });
        changed++;
      }
    }

    if (changed > 0) {
      await batch.commit();
      totalChanged += changed;
      productsChanged++;
    }
  }

  console.log(`✅  Done — ${totalChanged} attribute_values updated across ${productsChanged} products`);
}

main().catch((err) => {
  console.error("❌  Error:", err);
  process.exit(1);
});
