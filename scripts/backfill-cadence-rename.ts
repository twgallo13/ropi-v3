#!/usr/bin/env -S npx tsx
/**
 * Phase 3.10 Track 3 — Backfill cadence_assignments field rename.
 *
 * Renames `in_buyer_queue` → `in_cadence_review_queue` in every doc in the
 * `cadence_assignments` collection. Defensive coexistence strategy:
 *   - Copies `in_buyer_queue` value to `in_cadence_review_queue` (if not already set).
 *   - Does NOT delete `in_buyer_queue` (defensive — old Cloud Run is still live until deploy).
 *
 * Idempotent: if a doc already has `in_cadence_review_queue` set AND the value matches
 * `in_buyer_queue`, the doc is skipped (no write, logged as "already migrated").
 *
 * Emits audit_log entry for every doc written.
 *
 * Usage:
 *   GCP_SA_KEY_DEV='<sa-json>' npx tsx scripts/backfill-cadence-rename.ts --dry-run
 *   GCP_SA_KEY_DEV='<sa-json>' npx tsx scripts/backfill-cadence-rename.ts
 *
 * If GCP_SA_KEY_DEV is unset, falls back to /tmp/sa-dev.json.
 */
import * as admin from "firebase-admin";
import * as fs from "fs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const MODE = DRY_RUN ? "DRY-RUN" : "LIVE";

let saJson: string;
const envKey = process.env.GCP_SA_KEY_DEV || process.env.SERVICE_ACCOUNT_JSON;
if (envKey) {
  saJson = envKey;
} else if (fs.existsSync("/tmp/sa-dev.json")) {
  saJson = fs.readFileSync("/tmp/sa-dev.json", "utf8");
} else {
  console.error("❌  No SA credentials. Set GCP_SA_KEY_DEV or place /tmp/sa-dev.json.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(saJson)),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore();

const BATCH_LIMIT = 500;

interface MigrationSummary {
  total_scanned: number;
  already_migrated: number;
  written: number;
  skipped_no_old_field: number;
  errors: number;
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`\n🛠   Phase 3.10 Track 3 cadence field rename backfill — mode: ${MODE}`);
  console.log(`    Started: ${startedAt}`);
  console.log(`    Project: ropi-aoss-dev\n`);

  const summary: MigrationSummary = {
    total_scanned: 0,
    already_migrated: 0,
    written: 0,
    skipped_no_old_field: 0,
    errors: 0,
  };

  // --- Scan all cadence_assignments ---
  const snap = await db.collection("cadence_assignments").get();
  console.log(`    Docs fetched: ${snap.size}`);

  const toWrite: Array<{ docId: string; mpn: string; value: boolean }> = [];
  const alreadyMigrated: string[] = [];
  const noOldField: string[] = [];

  for (const doc of snap.docs) {
    summary.total_scanned++;
    const data = doc.data();

    // No old field — skip (brand-new doc written after rename, or anomaly)
    if (!("in_buyer_queue" in data)) {
      noOldField.push(doc.id);
      summary.skipped_no_old_field++;
      continue;
    }

    const oldValue = data["in_buyer_queue"] as boolean;

    // Already migrated and consistent — skip
    if (
      "in_cadence_review_queue" in data &&
      data["in_cadence_review_queue"] === oldValue
    ) {
      alreadyMigrated.push(doc.id);
      summary.already_migrated++;
      continue;
    }

    toWrite.push({ docId: doc.id, mpn: data.mpn ?? doc.id, value: oldValue });
  }

  console.log(`\n    Docs to write:          ${toWrite.length}`);
  console.log(`    Already migrated:       ${summary.already_migrated}`);
  console.log(`    Skipped (no old field): ${summary.skipped_no_old_field}\n`);

  if (toWrite.length === 0) {
    console.log("✅  Nothing to migrate.");
    return;
  }

  if (DRY_RUN) {
    console.log("--- DRY-RUN: would write to ---");
    toWrite.forEach((r) =>
      console.log(`  [${r.docId}] in_cadence_review_queue = ${r.value}  (mpn=${r.mpn})`)
    );
    console.log("\n🔎  Dry-run complete — no writes performed.");
    return;
  }

  // --- LIVE: write in batches ---
  let batchStart = 0;
  while (batchStart < toWrite.length) {
    const chunk = toWrite.slice(batchStart, batchStart + BATCH_LIMIT);
    const batch = db.batch();

    for (const { docId, value } of chunk) {
      const ref = db.collection("cadence_assignments").doc(docId);
      batch.set(ref, { in_cadence_review_queue: value }, { merge: true });
    }

    await batch.commit();
    summary.written += chunk.length;
    console.log(`    Batch committed: docs ${batchStart + 1}–${batchStart + chunk.length}`);
    batchStart += BATCH_LIMIT;
  }

  // --- Emit audit_log ---
  const auditBatch = db.batch();
  for (const { mpn } of toWrite) {
    const auditRef = db.collection("audit_log").doc();
    auditBatch.set(auditRef, {
      event_type: "cadence_field_rename_backfill",
      product_mpn: mpn,
      old_field: "in_buyer_queue",
      new_field: "in_cadence_review_queue",
      acting_user_id: "system",
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await auditBatch.commit();
  console.log(`    Audit log entries emitted: ${toWrite.length}`);

  console.log(`\n✅  Backfill complete.`);
  console.log(`    Total scanned:  ${summary.total_scanned}`);
  console.log(`    Written:        ${summary.written}`);
  console.log(`    Already done:   ${summary.already_migrated}`);
  console.log(`    Skipped:        ${summary.skipped_no_old_field}`);
  console.log(`    Errors:         ${summary.errors}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
