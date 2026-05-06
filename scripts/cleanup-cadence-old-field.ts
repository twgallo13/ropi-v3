#!/usr/bin/env -S npx tsx
/**
 * Phase 3.11 Track 1 — Cadence old field cleanup.
 *
 * Deletes the stale `in_buyer_queue` field from every doc in the
 * `cadence_assignments` collection.
 *
 * Context: Phase 3.10 Track 3 (PR #87) renamed `in_buyer_queue` →
 * `in_cadence_review_queue` and ran a backfill (163 docs). Both fields
 * coexisted defensively. All code paths now read/write only the new field.
 * This script removes the old field.
 *
 * Defensive checks per doc:
 *   - If `in_cadence_review_queue` is missing entirely → WARN + SKIP
 *     (Track 3 backfill may have missed this doc; needs Lisa investigation).
 *   - If `in_buyer_queue` value !== `in_cadence_review_queue` value → WARN + SKIP
 *     (data divergence; do NOT delete until reconciled).
 *   - Otherwise → delete `in_buyer_queue`.
 *
 * Idempotent: if `in_buyer_queue` is already absent, the doc is skipped
 * (already_clean).
 *
 * Emits audit_log entry (event_type="track-3-cleanup-old-field") for each
 * deleted field.
 *
 * Usage:
 *   npx tsx scripts/cleanup-cadence-old-field.ts --dry-run
 *   npx tsx scripts/cleanup-cadence-old-field.ts
 *
 * Auth: falls back to GCP_SA_KEY_DEV env var, then /tmp/sa-dev.json.
 */
import * as admin from "firebase-admin";
import * as fs from "fs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const MODE = DRY_RUN ? "DRY-RUN" : "LIVE";

// ── Auth ──────────────────────────────────────────────────────────────────────
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

interface CleanupSummary {
  total_scanned: number;
  already_clean: number;         // in_buyer_queue already absent
  to_clean: number;              // queued for deletion
  skipped_missing_new: number;   // in_cadence_review_queue absent — WARN
  skipped_diverged: number;      // old !== new — WARN
  cleaned: number;               // actually deleted (live only)
  errors: number;
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`\n🗑   Phase 3.11 Track 1 — cadence old field cleanup — mode: ${MODE}`);
  console.log(`    Started:  ${startedAt}`);
  console.log(`    Project:  ropi-aoss-dev`);
  console.log(`    Target:   cadence_assignments.in_buyer_queue → delete\n`);

  const summary: CleanupSummary = {
    total_scanned: 0,
    already_clean: 0,
    to_clean: 0,
    skipped_missing_new: 0,
    skipped_diverged: 0,
    cleaned: 0,
    errors: 0,
  };

  const warnings: string[] = [];

  // ── Scan all cadence_assignments ──────────────────────────────────────────
  const snap = await db.collection("cadence_assignments").get();
  console.log(`    Docs fetched: ${snap.size}`);

  interface QueuedDoc {
    docId: string;
    mpn: string;
    oldValue: boolean;
    newValue: boolean;
  }

  const toClean: QueuedDoc[] = [];

  for (const doc of snap.docs) {
    summary.total_scanned++;
    const data = doc.data();
    const mpn: string = data.mpn ?? doc.id;

    // Already clean — in_buyer_queue absent
    if (!("in_buyer_queue" in data)) {
      summary.already_clean++;
      continue;
    }

    const oldValue = data["in_buyer_queue"] as boolean;

    // WARN: new field missing entirely (Track 3 backfill missed this doc)
    if (!("in_cadence_review_queue" in data)) {
      const msg = `⚠️  WARN [${doc.id}] mpn=${mpn}: in_cadence_review_queue MISSING — in_buyer_queue=${oldValue}. SKIPPED.`;
      console.log(`    ${msg}`);
      warnings.push(msg);
      summary.skipped_missing_new++;
      continue;
    }

    const newValue = data["in_cadence_review_queue"] as boolean;

    // WARN: values diverged — do not delete
    if (oldValue !== newValue) {
      const msg = `⚠️  WARN [${doc.id}] mpn=${mpn}: DIVERGED — in_buyer_queue=${oldValue}, in_cadence_review_queue=${newValue}. SKIPPED.`;
      console.log(`    ${msg}`);
      warnings.push(msg);
      summary.skipped_diverged++;
      continue;
    }

    toClean.push({ docId: doc.id, mpn, oldValue, newValue });
    summary.to_clean++;
  }

  console.log(`\n    Docs to clean:            ${summary.to_clean}`);
  console.log(`    Already clean:            ${summary.already_clean}`);
  console.log(`    Skipped (new missing):    ${summary.skipped_missing_new}`);
  console.log(`    Skipped (diverged):       ${summary.skipped_diverged}`);
  console.log(`    Warnings total:           ${warnings.length}`);

  if (summary.skipped_diverged > 0) {
    console.error(`\n❌  DATA INTEGRITY: ${summary.skipped_diverged} diverged doc(s). Do NOT run live until Lisa investigates.`);
    if (!DRY_RUN) {
      console.error("    Aborting live run.");
      process.exit(1);
    }
  }

  if (toClean.length === 0) {
    console.log("\n✅  Nothing to clean.");
    return;
  }

  if (DRY_RUN) {
    console.log("\n--- DRY-RUN: would delete in_buyer_queue from ---");
    toClean.forEach((r) =>
      console.log(
        `  [${r.docId}] mpn=${r.mpn}  in_buyer_queue=${r.oldValue} → DELETE  (in_cadence_review_queue=${r.newValue} retained)`
      )
    );
    console.log("\n🔎  Dry-run complete — no writes performed.");
    return;
  }

  // ── LIVE: delete in batches (Firestore max 500 ops per batch) ────────────
  let batchStart = 0;
  while (batchStart < toClean.length) {
    const chunk = toClean.slice(batchStart, batchStart + BATCH_LIMIT);
    const batch = db.batch();

    for (const { docId } of chunk) {
      const ref = db.collection("cadence_assignments").doc(docId);
      batch.update(ref, {
        in_buyer_queue: admin.firestore.FieldValue.delete(),
      });
    }

    await batch.commit();
    summary.cleaned += chunk.length;
    console.log(`    Batch committed: docs ${batchStart + 1}–${batchStart + chunk.length}`);
    batchStart += BATCH_LIMIT;
  }

  // ── Emit audit_log ────────────────────────────────────────────────────────
  // Write in batches (each audit entry = 1 op)
  let auditStart = 0;
  let auditTotal = 0;
  while (auditStart < toClean.length) {
    const chunk = toClean.slice(auditStart, auditStart + BATCH_LIMIT);
    const auditBatch = db.batch();

    for (const { docId, mpn, oldValue, newValue } of chunk) {
      const auditRef = db.collection("audit_log").doc();
      auditBatch.set(auditRef, {
        event_type: "track-3-cleanup-old-field",
        doc_id: docId,
        mpn,
        before: { in_buyer_queue: oldValue, in_cadence_review_queue: newValue },
        after: { in_cadence_review_queue: newValue },
        actor: "system-cleanup",
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    await auditBatch.commit();
    auditTotal += chunk.length;
    auditStart += BATCH_LIMIT;
  }
  console.log(`    Audit log entries emitted: ${auditTotal}`);

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log(`\n✅  Cleanup complete.`);
  console.log(`    Total scanned:   ${summary.total_scanned}`);
  console.log(`    Cleaned:         ${summary.cleaned}`);
  console.log(`    Already clean:   ${summary.already_clean}`);
  console.log(`    Skipped (warn):  ${summary.skipped_missing_new + summary.skipped_diverged}`);
  console.log(`    Errors:          ${summary.errors}`);
  if (warnings.length > 0) {
    console.log(`\n⚠️  Warnings (${warnings.length}) — surface to Lisa:`);
    warnings.forEach((w) => console.log(`    ${w}`));
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
