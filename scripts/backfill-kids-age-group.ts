#!/usr/bin/env -S npx tsx
/**
 * Phase 3.12 Track 1C — Kids products age_group backfill.
 *
 * Per dispatch TALLY-PHASE-3.12-TRACK-1C, Decision X:
 *   PO has manually added "Kids" to attribute_registry/age_group.dropdown_options.
 *
 * Pre-flight diagnostic confirmed (2026-05-07):
 *   attribute_registry/age_group.dropdown_options =
 *     ["Adult","Grade-School","Pre-School","Toddler","Kids"]
 *   55 product docs have gender === "Kids" and age_group is unset.
 *
 * Dispatch text says "Set age_group to 'kids'" (lowercase). The active
 * registry value is "Kids" (capital K — Decision X). Lowercase would fail
 * downstream validation. Using canonical "Kids".
 *
 * For each product where gender === "Kids":
 *   - Set age_group = "Kids"
 *   - Set gender   = "Unisex"  (dispatch primary recommendation; "Kids"
 *                               is not a valid gender registry value)
 *   - Skip docs that already have age_group set or gender !== "Kids".
 *
 * Audit log emitted per migrated product:
 *   event_type: "phase-3.12-track-1c-kids-backfill"
 *   target_product_id: <doc.id>
 *   target_product_mpn: <mpn>
 *   actor: "system-migration"
 *   before: { gender, age_group }
 *   after:  { gender, age_group }
 *
 * Idempotent: re-running on a fully-backfilled doc is a no-op.
 *
 * Usage:
 *   GCP_SA_KEY_DEV='<sa-json>' npx tsx scripts/backfill-kids-age-group.ts --dry-run
 *   GCP_SA_KEY_DEV='<sa-json>' npx tsx scripts/backfill-kids-age-group.ts
 */
import * as admin from "firebase-admin";
import * as fs from "fs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const MODE = DRY_RUN ? "DRY-RUN" : "LIVE";

const TARGET_AGE_GROUP = "Kids";
const TARGET_GENDER = "Unisex";

let saJson: string;
const envKey = process.env.GCP_SA_KEY_DEV || process.env.SERVICE_ACCOUNT_JSON;
if (envKey) {
  saJson = envKey;
} else if (fs.existsSync("/tmp/gcp-sa-key.json")) {
  saJson = fs.readFileSync("/tmp/gcp-sa-key.json", "utf8");
} else if (fs.existsSync("/tmp/sa-dev.json")) {
  saJson = fs.readFileSync("/tmp/sa-dev.json", "utf8");
} else {
  console.error("❌  No SA credentials. Set GCP_SA_KEY_DEV or place /tmp/gcp-sa-key.json.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(saJson)),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore();

const BATCH_LIMIT = 400;

interface DocPlan {
  docId: string;
  mpn: string | null;
  before: { gender: unknown; age_group: unknown };
  after: { gender: string; age_group: string };
}

interface Summary {
  scanned: number;
  matched_kids_gender: number;
  to_migrate: number;
  no_op_already_set: number;
  written: number;
  audit_emitted: number;
}

async function verifyRegistry(): Promise<void> {
  const ag = await db.collection("attribute_registry").doc("age_group").get();
  const opts = ((ag.data() || {}).dropdown_options || []) as string[];
  if (!opts.includes(TARGET_AGE_GROUP)) {
    console.error(
      `❌  attribute_registry/age_group.dropdown_options does not include "${TARGET_AGE_GROUP}". Found: ${JSON.stringify(opts)}`
    );
    console.error(`    Per Decision X, PO must add "${TARGET_AGE_GROUP}" before backfill.`);
    process.exit(1);
  }
  const g = await db.collection("attribute_registry").doc("gender").get();
  const gOpts = ((g.data() || {}).dropdown_options || []) as string[];
  if (!gOpts.includes(TARGET_GENDER)) {
    console.error(
      `❌  attribute_registry/gender.dropdown_options does not include "${TARGET_GENDER}". Found: ${JSON.stringify(gOpts)}`
    );
    process.exit(1);
  }
  console.log(`    Registry verified: age_group includes "${TARGET_AGE_GROUP}", gender includes "${TARGET_GENDER}".`);
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`\n🛠   Phase 3.12 Track 1C — Kids age_group backfill — mode: ${MODE}`);
  console.log(`    Started: ${startedAt}`);
  console.log(`    Project: ropi-aoss-dev\n`);

  await verifyRegistry();

  const summary: Summary = {
    scanned: 0,
    matched_kids_gender: 0,
    to_migrate: 0,
    no_op_already_set: 0,
    written: 0,
    audit_emitted: 0,
  };

  // Use a where clause for efficiency (single-field index auto-created).
  const snap = await db.collection("products").where("gender", "==", "Kids").get();
  console.log(`    Products with gender == "Kids": ${snap.size}\n`);

  const plans: DocPlan[] = [];

  for (const doc of snap.docs) {
    summary.scanned++;
    summary.matched_kids_gender++;
    const data = doc.data() || {};
    const mpn = (data.mpn as string) || null;

    // Idempotency: if age_group is already set AND gender already canonical,
    // skip. If age_group is set but gender is still "Kids", we still need to
    // fix gender.
    const hasAge = data.age_group === TARGET_AGE_GROUP;
    const hasGender = data.gender === TARGET_GENDER;
    if (hasAge && hasGender) {
      summary.no_op_already_set++;
      continue;
    }

    plans.push({
      docId: doc.id,
      mpn,
      before: { gender: data.gender, age_group: data.age_group ?? null },
      after: { gender: TARGET_GENDER, age_group: TARGET_AGE_GROUP },
    });
    summary.to_migrate++;
  }

  console.log(`    Matched (gender=="Kids"):  ${summary.matched_kids_gender}`);
  console.log(`    Plans (to write):          ${summary.to_migrate}`);
  console.log(`    No-op (already set):       ${summary.no_op_already_set}\n`);

  if (DRY_RUN) {
    console.log("--- DRY-RUN: planned writes (sample of first 10) ---");
    for (const p of plans.slice(0, 10)) {
      console.log(`  [${p.docId}] mpn=${p.mpn}  ${JSON.stringify(p.before)} → ${JSON.stringify(p.after)}`);
    }
    if (plans.length > 10) console.log(`  ... and ${plans.length - 10} more`);
    console.log("\n🔎  Dry-run complete — no writes performed.");
    return;
  }

  if (plans.length === 0) {
    console.log("✅  Nothing to backfill.");
    return;
  }

  // ── LIVE: batched writes ─────────────────────────────────────────────
  let cursor = 0;
  while (cursor < plans.length) {
    const chunk = plans.slice(cursor, cursor + BATCH_LIMIT);
    const batch = db.batch();
    for (const p of chunk) {
      const ref = db.collection("products").doc(p.docId);
      batch.set(
        ref,
        {
          age_group: TARGET_AGE_GROUP,
          gender: TARGET_GENDER,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_by: "system-migration-track-1c",
        },
        { merge: true }
      );
    }
    await batch.commit();
    summary.written += chunk.length;
    console.log(`    Batch committed: docs ${cursor + 1}–${cursor + chunk.length}`);
    cursor += BATCH_LIMIT;
  }

  // ── Audit log emission ───────────────────────────────────────────────
  let acursor = 0;
  while (acursor < plans.length) {
    const chunk = plans.slice(acursor, acursor + BATCH_LIMIT);
    const auditBatch = db.batch();
    for (const p of chunk) {
      const auditRef = db.collection("audit_log").doc();
      auditBatch.set(auditRef, {
        event_type: "phase-3.12-track-1c-kids-backfill",
        target_product_id: p.docId,
        target_product_mpn: p.mpn,
        actor: "system-migration",
        before: p.before,
        after: p.after,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await auditBatch.commit();
    summary.audit_emitted += chunk.length;
    acursor += BATCH_LIMIT;
  }

  console.log(`\n✅  Backfill complete.`);
  console.log(`    Written:       ${summary.written}`);
  console.log(`    Audit emitted: ${summary.audit_emitted}`);
  console.log(`    No-op:         ${summary.no_op_already_set}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
