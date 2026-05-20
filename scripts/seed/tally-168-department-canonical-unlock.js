/**
 * TALLY-168 — Department canonical unlock (follow-up to first patch)
 *
 * Diagnosis 2026-05-19:
 *   There are two attribute_registry docs both labeled "Department":
 *     - attribute_registry/department      → legacy, field_key=undefined, phantom (cannot save)
 *     - attribute_registry/department_key  → canonical (matches product.attribute_values + api.ts), still locked
 *
 *   The first TALLY-168 patch unlocked the wrong doc. PO confirms Department
 *   still appears locked in live UI — that is the `department_key` row.
 *
 * Narrowest safe fix:
 *   1. attribute_registry/department_key  → set is_editable=true (data-only unlock).
 *   2. attribute_registry/department      → set active=false (hide the phantom duplicate so
 *      PDP filter `if (entry.active !== true) continue` excludes it, leaving exactly ONE
 *      visible Department control that is functional + editable).
 *
 * No code change. No other docs touched. No deploy required (live Firestore read).
 *
 * Usage:
 *   node scripts/seed/tally-168-department-canonical-unlock.js           # dry-run (default)
 *   node scripts/seed/tally-168-department-canonical-unlock.js --apply   # commit
 */

"use strict";

const path = require("path");
const admin = require("firebase-admin");
const { initApp, PROJECT_ID } = require(path.join(__dirname, "utils"));

const TALLY = "TALLY-168";
const ACTOR = "system:tally-168-department-canonical-unlock";
const APPLY = process.argv.includes("--apply");

const OPS = [
  {
    docPath: "attribute_registry/department_key",
    purpose: "Unlock the canonical Department dropdown (the one the UI actually binds to)",
    set: { is_editable: true },
    delete: [],
  },
  {
    docPath: "attribute_registry/department",
    purpose: "Deactivate the legacy phantom Department entry (field_key=undefined, cannot save) so PDP no longer renders a duplicate Department control",
    set: { active: false },
    delete: [],
  },
];

const WATCHED = ["field_key", "active", "is_editable", "status", "superseded_by", "hidden_reason", "display_label", "display_group", "tab_group_order", "display_order", "updated_by"];

(async () => {
  initApp();
  const db = admin.firestore();

  const app = admin.app();
  const projectId = app.options.projectId || PROJECT_ID;
  if (projectId !== "ropi-aoss-dev") {
    console.error(`❌ Refusing to run against project '${projectId}'. Expected 'ropi-aoss-dev'.`);
    process.exit(1);
  }

  console.log(`\n=== ${TALLY} — ${APPLY ? "APPLY" : "DRY-RUN"} ===`);
  console.log(`Project: ${projectId}\n`);

  const FV = admin.firestore.FieldValue;

  for (const op of OPS) {
    const ref = db.doc(op.docPath);
    const snap = await ref.get();
    if (!snap.exists) {
      console.error(`❌ ${op.docPath} does not exist. Aborting.`);
      process.exit(1);
    }
    const before = snap.data();

    console.log(`--- ${op.docPath}`);
    console.log(`    purpose: ${op.purpose}`);
    console.log(`    BEFORE:`);
    for (const k of WATCHED) {
      const present = Object.prototype.hasOwnProperty.call(before, k);
      console.log(`      ${k}: ${present ? JSON.stringify(before[k]) : "<absent>"}`);
    }
    console.log(`    PLAN:`);
    for (const [k, v] of Object.entries(op.set)) {
      console.log(`      SET ${k} = ${JSON.stringify(v)}  (was ${JSON.stringify(before[k])})`);
    }
    for (const k of op.delete) {
      const present = Object.prototype.hasOwnProperty.call(before, k);
      console.log(`      DELETE ${k}  (currently ${present ? JSON.stringify(before[k]) : "<absent>"})`);
    }
    console.log(`      SET updated_by = ${JSON.stringify(ACTOR)}  (was ${JSON.stringify(before.updated_by)})`);
    console.log(`      SET updated_at = serverTimestamp()`);

    if (APPLY) {
      const payload = { ...op.set, updated_by: ACTOR, updated_at: FV.serverTimestamp() };
      for (const k of op.delete) payload[k] = FV.delete();
      await ref.update(payload);
      const after = (await ref.get()).data();
      console.log(`    AFTER:`);
      for (const k of WATCHED) {
        const present = Object.prototype.hasOwnProperty.call(after, k);
        console.log(`      ${k}: ${present ? JSON.stringify(after[k]) : "<absent>"}`);
      }
    }
    console.log("");
  }

  if (!APPLY) {
    console.log("(dry-run) No writes performed. Re-run with --apply to commit.");
  } else {
    console.log("✅ Apply complete.");
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
