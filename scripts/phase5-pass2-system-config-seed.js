#!/usr/bin/env node
/**
 * TALLY-123 — Phase 5 Pass 2, Task 1
 * Seed system_config/site_verification with staleness_threshold_days: 14.
 *
 * Per Phase 4.4 §4.4 / §4.4.1:
 *   - Standalone namespace (do NOT merge with TALLY-060
 *     data_freshness_staleness_threshold_days).
 *   - Default 14 days.
 *
 * Idempotent:
 *   - If doc exists with the expected value, skip (no write).
 *   - If doc exists with a DIFFERENT value, leave untouched and log a warning
 *     (an admin may have changed it).
 *   - Otherwise create.
 *
 * Audit on successful create:
 *   { event_type: "system_config.seeded",
 *     doc_path: "system_config/site_verification",
 *     fields: ["staleness_threshold_days"],
 *     actor_uid: "system:tally-123" }
 *
 * Usage:
 *   GCP_SA_KEY_DEV='...' node scripts/phase5-pass2-system-config-seed.js [--dry-run]
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

const DOC_PATH = "system_config/site_verification";
const EXPECTED = {
  staleness_threshold_days: 14,
  notes:
    "Site Verification staleness threshold. Controls when a verified_live entry is derived as stale at read time. See Phase 4.4 spec §4.4.",
};

async function main() {
  console.log(`\n→ Seed ${DOC_PATH}${DRY_RUN ? "  [DRY RUN]" : ""}`);
  const ref = db.doc(DOC_PATH);
  const snap = await ref.get();

  if (snap.exists) {
    const cur = snap.data() || {};
    const curVal = cur.staleness_threshold_days;
    if (curVal === EXPECTED.staleness_threshold_days) {
      console.log(
        `  · Doc already exists with staleness_threshold_days=${curVal} — no-op (idempotent).`
      );
      return { action: "skipped" };
    }
    console.warn(
      `  ⚠  Doc exists with staleness_threshold_days=${JSON.stringify(curVal)} (expected ${EXPECTED.staleness_threshold_days}).`
    );
    console.warn(
      `      Leaving untouched (admin may have changed this value). No write performed.`
    );
    return { action: "skipped_admin_value" };
  }

  const payload = {
    staleness_threshold_days: EXPECTED.staleness_threshold_days,
    notes: EXPECTED.notes,
    created_at: ts(),
    updated_at: ts(),
  };

  console.log(`  Payload to write at ${DOC_PATH}:`);
  console.log(
    JSON.stringify(
      { ...payload, created_at: "<serverTimestamp>", updated_at: "<serverTimestamp>" },
      null,
      2
    )
  );

  if (DRY_RUN) {
    console.log(`\n  [DRY RUN] Would create doc + write audit_log entry.`);
    return { action: "would_create" };
  }

  await ref.set(payload);
  await db.collection("audit_log").add({
    event_type: "system_config.seeded",
    doc_path: DOC_PATH,
    fields: ["staleness_threshold_days"],
    actor_uid: "system:tally-123",
    created_at: ts(),
  });
  console.log(`  ✓ Created and audit-logged.`);

  // Verify
  const verify = await ref.get();
  console.log(`  Verify: staleness_threshold_days = ${verify.get("staleness_threshold_days")}`);
  return { action: "created" };
}

main()
  .then((r) => {
    console.log(`\n→ Result: ${r?.action}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
  });
