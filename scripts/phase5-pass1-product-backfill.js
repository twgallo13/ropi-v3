#!/usr/bin/env node
/**
 * TALLY-122 — Phase 5 Pass 1, Task 2
 * Product Data Migration:
 *   • Backfill: 428 products with site_verification.shiekh_com map key →
 *     site_owner = "shiekh_com" (only when site_owner is currently empty).
 *   • Remap:    7 products with site_owner == "SHOES.COM" → "shiekh_com".
 *
 * Both passes are idempotent and audit-logged.
 *
 * Usage:
 *   GCP_SA_KEY_DEV='...' node scripts/phase5-pass1-product-backfill.js [--dry-run]
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

const TARGET_SITE_KEY = "shiekh_com";
const REMAP_FROM_VALUES = new Set(["SHOES.COM"]); // pre-Pass-1 anomaly
const BATCH_SIZE = 400; // Firestore batched-write limit is 500; leave headroom for audit_log adds.

async function writeAudit(batch, action, mpn, details) {
  const auditRef = db.collection("audit_log").doc();
  batch.set(auditRef, {
    action,
    entity_type: "product",
    entity_id: mpn,
    actor_uid: "system:tally-122",
    details,
    timestamp: ts(),
  });
}

async function run() {
  console.log(`\n→ Phase 5 Pass 1, Task 2 — Product Data Migration${DRY_RUN ? "  [DRY RUN]" : ""}`);
  const snap = await db.collection("products").get();
  console.log(`  Scanned ${snap.size} product documents.`);

  let backfillEligible = 0;
  let backfillApplied = 0;
  let backfillAlreadyCorrect = 0;
  let remapEligible = 0;
  let remapApplied = 0;
  let conflictSkipped = 0;
  const conflicts = [];

  let writeBatch = db.batch();
  let opsInBatch = 0;
  const flush = async () => {
    if (opsInBatch === 0) return;
    if (!DRY_RUN) await writeBatch.commit();
    writeBatch = db.batch();
    opsInBatch = 0;
  };

  for (const doc of snap.docs) {
    const mpn = doc.id;
    const data = doc.data() || {};
    const ownerRaw = data.site_owner;
    const sv = data.site_verification && typeof data.site_verification === "object" ? data.site_verification : {};
    const hasShiekhMapKey = Object.prototype.hasOwnProperty.call(sv, TARGET_SITE_KEY);

    // Pass A: REMAP (SHOES.COM → shiekh_com). Takes priority over backfill.
    if (typeof ownerRaw === "string" && REMAP_FROM_VALUES.has(ownerRaw)) {
      remapEligible++;
      writeBatch.update(doc.ref, { site_owner: TARGET_SITE_KEY });
      await writeAudit(writeBatch, "product.site_owner_remapped", mpn, {
        from: ownerRaw,
        to: TARGET_SITE_KEY,
        reason: "TALLY-122 Phase 5 Pass 1 — pre-canonicalization anomaly remap.",
      });
      opsInBatch += 2;
      remapApplied++;
      if (opsInBatch >= BATCH_SIZE) await flush();
      continue;
    }

    // Pass B: BACKFILL (empty owner + has shiekh_com map key → set to shiekh_com).
    if (hasShiekhMapKey) {
      if (ownerRaw === TARGET_SITE_KEY) {
        backfillAlreadyCorrect++;
        continue;
      }
      if (ownerRaw === undefined || ownerRaw === null || ownerRaw === "") {
        backfillEligible++;
        writeBatch.update(doc.ref, { site_owner: TARGET_SITE_KEY });
        await writeAudit(writeBatch, "product.site_owner_backfilled", mpn, {
          from: null,
          to: TARGET_SITE_KEY,
          source: "site_verification map key",
          reason: "TALLY-122 Phase 5 Pass 1 — Layer-2 wireability seed.",
        });
        opsInBatch += 2;
        backfillApplied++;
        if (opsInBatch >= BATCH_SIZE) await flush();
        continue;
      }
      // Owner exists with a non-shiekh_com, non-anomaly value — record but do not overwrite.
      conflictSkipped++;
      conflicts.push({ mpn, current_site_owner: ownerRaw, has_map_key: TARGET_SITE_KEY });
    }
  }

  await flush();

  console.log("\n→ Migration summary:");
  console.table({
    backfill_eligible: backfillEligible,
    backfill_applied: backfillApplied,
    backfill_already_correct: backfillAlreadyCorrect,
    remap_eligible: remapEligible,
    remap_applied: remapApplied,
    conflict_skipped: conflictSkipped,
  });
  if (conflicts.length) {
    console.log(`\n→ Conflicts (existing site_owner ≠ "${TARGET_SITE_KEY}", not overwritten):`);
    console.table(conflicts.slice(0, 25));
    if (conflicts.length > 25) console.log(`  …and ${conflicts.length - 25} more.`);
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => { console.error("FATAL:", err); process.exit(1); });
