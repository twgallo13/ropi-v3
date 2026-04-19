/**
 * normalize-registry-phase-4-3.js
 * One-shot Firestore normalization for Phase 4.3 Pass B.
 *
 * Deactivates:  hs_code, is_hazmat, is_on_sale, is_new_arrival,
 *               maximum_quantity, warranty_months, site_ids,
 *               is_in_stock, country_of_origin
 *
 * Activates:    launch_date, hide_image_until_date, drawing_fcfs,
 *               collection_name, cut_type, league, material_fabric,
 *               sports_team
 *
 * No docs are deleted — history is preserved.
 */

"use strict";

const admin = require("firebase-admin");
const { initApp } = require("./utils");
initApp();

const db = admin.firestore();
const COLLECTION = "attribute_registry";

const DEACTIVATE = [
  "hs_code",
  "is_hazmat",
  "is_on_sale",
  "is_new_arrival",
  "maximum_quantity",
  "warranty_months",
  "site_ids",
  "is_in_stock",
  "country_of_origin",
];

const ACTIVATE = [
  "launch_date",
  "hide_image_until_date",
  "drawing_fcfs",
  "collection_name",
  "cut_type",
  "league",
  "material_fabric",
  "sports_team",
];

async function run() {
  let writeCount = 0;
  const modified = [];

  // --- Deactivations ---
  console.log("=== DEACTIVATIONS ===\n");
  for (const docId of DEACTIVATE) {
    const ref = db.collection(COLLECTION).doc(docId);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`⚠  ${docId}: DOC NOT FOUND — skipping`);
      continue;
    }
    const before = snap.data().active;
    console.log(`${docId} | active | before: ${before} | after: false`);
    await ref.update({ active: false });
    writeCount++;
    modified.push(docId);
  }

  // --- Activations ---
  console.log("\n=== ACTIVATIONS ===\n");
  for (const docId of ACTIVATE) {
    const ref = db.collection(COLLECTION).doc(docId);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`⚠  ${docId}: DOC NOT FOUND — skipping`);
      continue;
    }
    const before = snap.data().active;
    console.log(`${docId} | active | before: ${before} | after: true`);
    await ref.update({ active: true });
    writeCount++;
    modified.push(docId);
  }

  // --- Read-back confirmation ---
  console.log("\n=== READ-BACK CONFIRMATION ===\n");
  for (const docId of modified) {
    const snap = await db.collection(COLLECTION).doc(docId).get();
    const data = snap.data();
    console.log(
      `✅ ${docId} | active=${data.active} | destination_tab=${data.destination_tab} | display_label=${data.display_label}`
    );
  }

  // --- Mislabel scan ---
  console.log("\n=== MISLABEL SCAN (info only — no changes) ===\n");
  const all = await db.collection(COLLECTION).get();
  let flagCount = 0;
  all.forEach((d) => {
    const data = d.data();
    if (data.active !== true) return; // only scan active docs
    // Flag docs with empty destination_tab
    if (!data.destination_tab) {
      console.log(`🚩 ${d.id} | active=true but destination_tab=${data.destination_tab}`);
      flagCount++;
    }
    // Flag docs with is_editable=false that aren't in system tab
    if (data.is_editable === false && data.destination_tab !== "system") {
      console.log(`🚩 ${d.id} | active=true, is_editable=false, tab=${data.destination_tab}`);
      flagCount++;
    }
  });
  if (flagCount === 0) console.log("No mislabel flags found.");

  // --- Summary ---
  console.log("\n=== SUMMARY ===");
  console.log(`Total Firestore writes: ${writeCount}`);
  console.log(`Deactivated: ${DEACTIVATE.length} docs`);
  console.log(`Activated: ${ACTIVATE.length} docs`);

  // Final count check
  const finalSnap = await db.collection(COLLECTION).get();
  let activeCount = 0;
  finalSnap.forEach((d) => { if (d.data().active === true) activeCount++; });
  console.log(`\nFinal active doc count: ${activeCount} / ${finalSnap.size} total`);

  process.exit(0);
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
