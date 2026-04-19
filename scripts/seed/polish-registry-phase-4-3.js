/**
 * polish-registry-phase-4-3.js
 * One-shot Firestore polish for Phase 4.3 post-Pass-B.
 *
 * 8 writes total:
 *  1. launch_date       → display_label: "Launch Date"
 *  2. image_status      → active: false
 *  3. cut_type          → field_type: "dropdown"
 *  4. league            → field_type: "dropdown"
 *  5. silhouette        → field_type: "dropdown"
 *  6. sports_team       → field_type: "dropdown"
 *  7. media_count       → is_editable: false
 *  8. is_fast_fashion   → display_group: "Category Flags"
 *
 * No deletes. No activations/deactivations beyond image_status.
 */

"use strict";

const admin = require("firebase-admin");
const { initApp } = require("./utils");
initApp();

const db = admin.firestore();
const COLLECTION = "attribute_registry";

const WRITES = [
  { docId: "launch_date",    field: "display_label", value: "Launch Date" },
  { docId: "image_status",   field: "active",        value: false },
  { docId: "cut_type",       field: "field_type",    value: "dropdown" },
  { docId: "league",         field: "field_type",    value: "dropdown" },
  { docId: "silhouette",     field: "field_type",    value: "dropdown" },
  { docId: "sports_team",    field: "field_type",    value: "dropdown" },
  { docId: "media_count",    field: "is_editable",   value: false },
  { docId: "is_fast_fashion", field: "display_group", value: "Category Flags" },
];

async function run() {
  let writeCount = 0;
  const modified = [];

  console.log("=== WRITES ===\n");
  for (const { docId, field, value } of WRITES) {
    const ref = db.collection(COLLECTION).doc(docId);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`⚠  ${docId}: DOC NOT FOUND — skipping`);
      continue;
    }
    const data = snap.data();
    const before = data[field];
    // Distinguish undefined (field missing) from other falsy values
    const beforeStr =
      before === undefined
        ? (data.hasOwnProperty(field) ? "undefined (explicit)" : "undefined (field missing)")
        : JSON.stringify(before);
    console.log(`${docId} | ${field} | before: ${beforeStr} | after: ${JSON.stringify(value)}`);
    await ref.update({ [field]: value });
    writeCount++;
    modified.push(docId);
  }

  // --- Read-back confirmation ---
  console.log("\n=== READ-BACK CONFIRMATION ===\n");
  for (const { docId, field, value } of WRITES) {
    const snap = await db.collection(COLLECTION).doc(docId).get();
    if (!snap.exists) continue;
    const data = snap.data();
    const actual = data[field];
    const match = JSON.stringify(actual) === JSON.stringify(value);
    console.log(
      `${match ? "✅" : "❌"} ${docId} | ${field}=${JSON.stringify(actual)} | ` +
      `display_label=${JSON.stringify(data.display_label)} | active=${data.active} | ` +
      `field_type=${data.field_type} | is_editable=${data.is_editable} | ` +
      `display_group=${JSON.stringify(data.display_group)}`
    );
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total Firestore writes: ${writeCount}`);

  process.exit(0);
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
