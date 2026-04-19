#!/usr/bin/env node
/**
 * TALLY-125 Phase B, Task B1a — Registry Doc Rekey (Canonical Desuffix)
 *
 * For each of 8 site_registry docs:
 *   1. Read doc at current _com ID (e.g. shiekh_com)
 *   2. Write new doc at bare ID (e.g. shiekh) preserving ALL fields,
 *      updating site_key field to bare form
 *   3. Verify new doc exists with all expected fields
 *   4. Delete old _com doc
 *
 * Special case: fbrkclothing_com → fbrk (per PO ruling R5.2)
 *
 * Audit log: { event_type: "site_registry.canonical_desuffix", old_id, new_id, round: 5 }
 *
 * Usage:
 *   node scripts/tally-125-b1a-registry-desuffix.js --dry-run   # preview
 *   node scripts/tally-125-b1a-registry-desuffix.js              # live
 */
"use strict";

const admin = require("firebase-admin");

const KEY_ENV = process.env.GCP_SA_KEY_DEV || process.env.SERVICE_ACCOUNT_JSON;
if (!KEY_ENV) {
  console.error("❌  GCP_SA_KEY_DEV not set");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(KEY_ENV)),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

/**
 * Canonical mapping — old _com doc ID → new bare doc ID
 * All entries strip _com EXCEPT fbrkclothing_com → fbrk (R5.2)
 */
const MAPPING = [
  { old_id: "shiekh_com",        new_id: "shiekh" },
  { old_id: "karmaloop_com",     new_id: "karmaloop" },
  { old_id: "mltd_com",          new_id: "mltd" },
  { old_id: "sangremia_com",     new_id: "sangremia" },
  { old_id: "shiekhshoes_com",   new_id: "shiekhshoes" },
  { old_id: "fbrkclothing_com",  new_id: "fbrk" },        // R5.2 special case
  { old_id: "plndr_com",         new_id: "plndr" },
  { old_id: "trendswap_com",     new_id: "trendswap" },
];

async function main() {
  console.log(`\n=== TALLY-125 B1a: Registry Doc Rekey (Canonical Desuffix) ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Entries: ${MAPPING.length}\n`);

  const coll = db.collection("site_registry");
  let success = 0;
  let skipped = 0;
  let errors = 0;

  for (const { old_id, new_id } of MAPPING) {
    console.log(`--- ${old_id} → ${new_id} ---`);

    // 1. Read old doc
    const oldRef = coll.doc(old_id);
    const oldSnap = await oldRef.get();
    if (!oldSnap.exists) {
      // Check if already migrated (new doc exists)
      const newSnap = await coll.doc(new_id).get();
      if (newSnap.exists) {
        console.log(`  ⏭  Old doc missing, new doc already exists — already migrated. Skipping.`);
        skipped++;
        continue;
      }
      console.error(`  ❌ Old doc ${old_id} NOT FOUND and new doc ${new_id} also missing — ERROR`);
      errors++;
      continue;
    }

    const data = oldSnap.data();
    const fieldCount = Object.keys(data).length;

    // Display current state
    console.log(`  Old doc fields (${fieldCount}): ${Object.keys(data).join(", ")}`);
    console.log(`  Current site_key: ${data.site_key}`);
    console.log(`  Current display_name: ${data.display_name}`);
    console.log(`  Current is_active: ${data.is_active}`);
    console.log(`  Current domain: ${data.domain}`);

    // 2. Check new doc doesn't already exist (collision / partial-failure guard)
    const newRef = coll.doc(new_id);
    const newExisting = await newRef.get();
    if (newExisting.exists) {
      // Partial-failure recovery: new doc exists AND old doc still exists
      // → complete the migration by deleting the old doc + audit-logging
      console.log(`  ⚠️  New doc ${new_id} already exists (partial-failure state). Completing migration...`);
      if (!DRY_RUN) {
        await oldRef.delete();
        console.log(`  🗑️  Deleted old doc: ${old_id}`);
        await db.collection("audit_log").add({
          event_type: "site_registry.canonical_desuffix",
          old_id,
          new_id,
          round: 5,
          field_count: fieldCount,
          note: "partial-failure recovery — completed delete + audit",
          timestamp: ts(),
        });
        console.log(`  📝 Audit logged (recovery)`);
      } else {
        console.log(`  [DRY RUN] Would delete old doc ${old_id} and audit-log (recovery)`);
      }
      success++;
      continue;
    }

    // Build new doc — preserve ALL fields, update site_key to bare form
    const newData = { ...data, site_key: new_id };
    console.log(`  → New site_key: ${newData.site_key}`);

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would write new doc ${new_id}, delete old doc ${old_id}`);
      success++;
      continue;
    }

    // 3. Write new doc (merge: false — full doc creation)
    await newRef.set(newData);

    // 4. Verify new doc
    const verifySnap = await newRef.get();
    if (!verifySnap.exists) {
      console.error(`  ❌ Verification FAILED — new doc ${new_id} not found after write!`);
      errors++;
      continue;
    }
    const verifyData = verifySnap.data();
    const verifyFields = Object.keys(verifyData).length;
    if (verifyFields < fieldCount) {
      console.error(`  ❌ Field count mismatch: old=${fieldCount}, new=${verifyFields}`);
      errors++;
      continue;
    }
    console.log(`  ✅ Verified: ${new_id} has ${verifyFields} fields`);

    // 5. Delete old doc
    await oldRef.delete();
    console.log(`  🗑️  Deleted old doc: ${old_id}`);

    // 6. Audit log
    await db.collection("audit_log").add({
      event_type: "site_registry.canonical_desuffix",
      old_id,
      new_id,
      round: 5,
      field_count: fieldCount,
      timestamp: ts(),
    });
    console.log(`  📝 Audit logged`);
    success++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Success: ${success}`);
  console.log(`  Skipped (already migrated): ${skipped}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Total: ${MAPPING.length}`);

  if (errors > 0) {
    console.error(`\n❌ ${errors} error(s) — review above.`);
    process.exit(1);
  }
  console.log(`\n✅ B1a ${DRY_RUN ? "dry-run" : "live-run"} complete.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
