/**
 * remove-dead-fields.js
 *
 * Removes dead fields from attribute_registry and all product
 * attribute_values subcollections.
 */
"use strict";

const admin = require("firebase-admin");
const { initApp } = require("./utils");

initApp();
const db = admin.firestore();

const DEAD = ["color_family", "size", "size_type", "style_code", "upc", "barcode"];

async function main() {
  console.log("🗑️  Removing dead fields:", DEAD.join(", "));

  // Remove from attribute_registry
  for (const field of DEAD) {
    const ref = db.collection("attribute_registry").doc(field);
    if ((await ref.get()).exists) {
      await ref.delete();
      console.log("  Deleted registry:", field);
    }
  }

  // Remove from all product attribute_values
  const snap = await db.collection("products").get();
  console.log(`  Scanning ${snap.size} products...`);
  let totalDeleted = 0;

  for (const doc of snap.docs) {
    for (const field of DEAD) {
      const avRef = doc.ref.collection("attribute_values").doc(field);
      if ((await avRef.get()).exists) {
        await avRef.delete();
        totalDeleted++;
      }
    }
  }

  console.log(`✅  Done — ${totalDeleted} attribute_values documents deleted`);
}

main().catch((err) => {
  console.error("❌  Error:", err);
  process.exit(1);
});
