/**
 * TALLY-168 — Restore Department editability on Product Edit
 *
 * Lisa ruling 2026-05-19: TALLY-168 supersedes TALLY-144-2F ruling 3.
 * Scope: data-only patch on `attribute_registry/department` ONLY.
 *
 * Actions on that single doc:
 *   - SET   is_editable = true
 *   - DELETE status
 *   - DELETE superseded_by
 *   - DELETE hidden_reason
 *   - SET   updated_by = "system:tally-168-restore-department-editability"
 *   - SET   updated_at = serverTimestamp()
 *
 * No other fields touched. No code change. No other docs touched.
 *
 * Usage:
 *   node scripts/tally-168-restore-department-editability.js           # dry-run (default)
 *   node scripts/tally-168-restore-department-editability.js --apply   # commit
 */

"use strict";

const path = require("path");
const admin = require("firebase-admin");
const { initApp, PROJECT_ID } = require(path.join(__dirname, "utils"));

const TALLY = "TALLY-168";
const ACTOR = "system:tally-168-restore-department-editability";
const DOC_PATH = "attribute_registry/department";
const APPLY = process.argv.includes("--apply");

(async () => {
  initApp();
  const db = admin.firestore();

  // Project guard
  const app = admin.app();
  const projectId = app.options.projectId || PROJECT_ID;
  if (projectId !== "ropi-aoss-dev") {
    console.error(`❌ Refusing to run against project '${projectId}'. Expected 'ropi-aoss-dev'.`);
    process.exit(1);
  }

  const ref = db.doc(DOC_PATH);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`❌ ${DOC_PATH} does not exist. Aborting.`);
    process.exit(1);
  }
  const before = snap.data();

  console.log(`\n=== ${TALLY} — ${APPLY ? "APPLY" : "DRY-RUN"} ===`);
  console.log(`Project: ${projectId}`);
  console.log(`Doc:     ${DOC_PATH}\n`);

  const watched = ["is_editable", "status", "superseded_by", "hidden_reason", "active", "updated_by"];
  console.log("BEFORE (watched fields):");
  for (const k of watched) {
    console.log(`  ${k}: ${JSON.stringify(before[k])}`);
  }

  const plan = {
    "is_editable": { op: "SET",    value: true },
    "status":      { op: "DELETE", value: undefined },
    "superseded_by": { op: "DELETE", value: undefined },
    "hidden_reason": { op: "DELETE", value: undefined },
    "updated_by":  { op: "SET",    value: ACTOR },
    "updated_at":  { op: "SET",    value: "serverTimestamp()" },
  };

  console.log("\nPLANNED CHANGES:");
  for (const [k, v] of Object.entries(plan)) {
    if (v.op === "DELETE") {
      const present = Object.prototype.hasOwnProperty.call(before, k);
      console.log(`  ${k}: DELETE  (currently ${present ? JSON.stringify(before[k]) : "<absent>"})`);
    } else {
      console.log(`  ${k}: SET ${JSON.stringify(v.value)}  (was ${JSON.stringify(before[k])})`);
    }
  }

  if (!APPLY) {
    console.log("\n(dry-run) No write performed. Re-run with --apply to commit.");
    process.exit(0);
  }

  const FV = admin.firestore.FieldValue;
  await ref.update({
    is_editable: true,
    status: FV.delete(),
    superseded_by: FV.delete(),
    hidden_reason: FV.delete(),
    updated_by: ACTOR,
    updated_at: FV.serverTimestamp(),
  });

  const afterSnap = await ref.get();
  const after = afterSnap.data();
  console.log("\nAFTER (watched fields):");
  for (const k of watched) {
    const present = Object.prototype.hasOwnProperty.call(after, k);
    console.log(`  ${k}: ${present ? JSON.stringify(after[k]) : "<absent>"}`);
  }
  console.log("\n✅ Apply complete.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
