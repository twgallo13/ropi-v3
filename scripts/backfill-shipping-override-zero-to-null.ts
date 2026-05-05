#!/usr/bin/env -S npx tsx
/**
 * Phase 3.9 Track 1A-FU — Coerce $0 shipping override to null.
 *
 * Backfills products with standard_shipping_override === 0 OR
 * expedited_shipping_override === 0 (on the root doc). For each match:
 *   1. Sets the root field to null.
 *   2. Sets the attribute_values/{field_key}.value to null
 *      (preserves verification_state, last_verified_at, etc.).
 *   3. Emits an audit_log entry with event_type="track-1a-fu-backfill".
 *
 * Idempotent: re-runs are no-ops because the query selects only
 * products where the value is still numeric 0.
 *
 * Genuine non-zero overrides (the 6 standard + 4 expedited rows in dev)
 * are excluded by the query predicate (== 0) and never touched.
 *
 * Usage:
 *   GCP_SA_KEY_DEV='<sa-json>' npx tsx scripts/backfill-shipping-override-zero-to-null.ts --dry-run
 *   GCP_SA_KEY_DEV='<sa-json>' npx tsx scripts/backfill-shipping-override-zero-to-null.ts
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

const FIELD_KEYS = ["standard_shipping_override", "expedited_shipping_override"] as const;
const BATCH_LIMIT = 500;

interface Plan {
  doc_id: string;
  mpn: string;
  field_key: typeof FIELD_KEYS[number];
  before: number;
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`\n🛠   Track 1A-FU $0→null backfill — mode: ${MODE}`);
  console.log(`    Started: ${startedAt}`);
  console.log(`    Project: ropi-aoss-dev\n`);

  const plans: Plan[] = [];
  const nonZeroSurvivors: Record<string, number> = {};
  for (const fk of FIELD_KEYS) nonZeroSurvivors[fk] = 0;

  for (const fk of FIELD_KEYS) {
    const snap = await db.collection("products").where(fk, "==", 0).get();
    console.log(`    ${fk}: ${snap.size} candidates with value === 0`);
    for (const doc of snap.docs) {
      plans.push({
        doc_id: doc.id,
        mpn: doc.data().mpn || doc.id,
        field_key: fk,
        before: 0,
      });
    }
    // Count genuine non-zero survivors (sanity)
    const nzSnap = await db.collection("products").where(fk, "!=", null).get();
    let nz = 0;
    for (const d of nzSnap.docs) {
      const v = d.data()[fk];
      if (typeof v === "number" && v !== 0) nz++;
    }
    nonZeroSurvivors[fk] = nz;
  }

  console.log(`\n    Plan summary:`);
  console.log(`      Total $0→null operations planned: ${plans.length}`);
  for (const fk of FIELD_KEYS) {
    const n = plans.filter((p) => p.field_key === fk).length;
    console.log(`        ${fk}: ${n}`);
  }
  console.log(`\n    Non-zero genuine overrides (will NOT be touched):`);
  for (const fk of FIELD_KEYS) {
    console.log(`        ${fk}: ${nonZeroSurvivors[fk]}`);
  }

  if (DRY_RUN) {
    console.log(`\n    [DRY-RUN] First 5 planned operations:`);
    for (const p of plans.slice(0, 5)) {
      console.log(
        `      doc=${p.doc_id} mpn=${p.mpn} field=${p.field_key} before=${p.before} → null`
      );
    }
    console.log(`\n✅  Dry-run complete. Re-run without --dry-run to apply.`);
    return;
  }

  // LIVE mode — apply in batches.
  console.log(`\n    Applying ${plans.length} writes in batches of ${BATCH_LIMIT}...`);
  let applied = 0;
  for (let i = 0; i < plans.length; i += BATCH_LIMIT) {
    const slice = plans.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const p of slice) {
      const productRef = db.collection("products").doc(p.doc_id);
      batch.set(
        productRef,
        {
          [p.field_key]: null,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      const attrRef = productRef.collection("attribute_values").doc(p.field_key);
      batch.set(attrRef, { value: null }, { merge: true });
      const auditRef = db.collection("audit_log").doc();
      batch.set(auditRef, {
        product_mpn: p.mpn,
        event_type: "track-1a-fu-backfill",
        field_key: p.field_key,
        old_value: p.before,
        new_value: null,
        acting_user_id: "backfill:track-1a-fu",
        origin_type: "Backfill",
        source_type: "backfill",
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    applied += slice.length;
    console.log(`      committed ${applied}/${plans.length}`);
  }

  console.log(`\n✅  LIVE backfill complete. Applied ${applied} writes.`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
