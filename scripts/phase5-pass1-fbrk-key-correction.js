#!/usr/bin/env node
/**
 * TALLY-122 — Phase 5 Pass 1, post-execution correction
 * Rename site_registry doc fbrk_com → fbrkclothing_com.
 *
 *   Rationale: {slug}_com convention is domain-derived, not bare-slug-derived.
 *   shiekh.com → shiekh_com, karmaloop.com → karmaloop_com,
 *   fbrkclothing.com → fbrkclothing_com (NOT fbrk_com).
 *
 *   Brief's Task 1 table specified fbrk → fbrkclothing_com explicitly.
 *   Low-risk: FBRK is is_active=false with zero product references.
 *
 *   Process:
 *     1. Verify zero references to fbrk_com in products (defensive).
 *     2. Create fbrkclothing_com with all fields copied from fbrk_com,
 *        with site_key field updated to the new value.
 *     3. Verify new doc exists.
 *     4. Delete fbrk_com.
 *     5. Audit-log: site_registry.key_correction.
 *
 * Usage:
 *   GCP_SA_KEY_DEV='...' node scripts/phase5-pass1-fbrk-key-correction.js [--dry-run]
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

const FROM_ID = "fbrk_com";
const TO_ID = "fbrkclothing_com";

async function defensiveProductRefCheck() {
  // Check both site_owner literal and presence as a site_verification map key.
  const snap = await db.collection("products").get();
  let ownerHits = 0;
  let mapKeyHits = 0;
  for (const doc of snap.docs) {
    if (doc.get("site_owner") === FROM_ID) ownerHits++;
    const sv = doc.get("site_verification");
    if (sv && typeof sv === "object" && Object.prototype.hasOwnProperty.call(sv, FROM_ID)) {
      mapKeyHits++;
    }
  }
  return { ownerHits, mapKeyHits, scanned: snap.size };
}

async function main() {
  console.log(`\n→ FBRK key correction: ${FROM_ID} → ${TO_ID}${DRY_RUN ? "  [DRY RUN]" : ""}`);

  const refs = await defensiveProductRefCheck();
  console.log(`  Defensive product ref check: scanned ${refs.scanned} products`);
  console.log(`    site_owner == "${FROM_ID}":      ${refs.ownerHits}`);
  console.log(`    site_verification map key "${FROM_ID}": ${refs.mapKeyHits}`);
  if (refs.ownerHits > 0 || refs.mapKeyHits > 0) {
    console.error(`✗ Aborting: live references exist. This script is only safe when both counts are zero.`);
    process.exit(2);
  }

  const fromRef = db.collection("site_registry").doc(FROM_ID);
  const toRef = db.collection("site_registry").doc(TO_ID);

  const [fromSnap, toSnap] = await Promise.all([fromRef.get(), toRef.get()]);

  if (!fromSnap.exists && toSnap.exists) {
    console.log(`  · ${TO_ID} already exists and ${FROM_ID} already gone — no-op (idempotent).`);
    return;
  }
  if (!fromSnap.exists) {
    console.error(`✗ Source doc ${FROM_ID} does not exist and target ${TO_ID} also missing — nothing to do.`);
    process.exit(3);
  }

  const src = fromSnap.data() || {};
  const payload = { ...src, site_key: TO_ID };

  console.log(`\n  Payload to write at site_registry/${TO_ID}:`);
  console.log(JSON.stringify(payload, null, 2));

  if (DRY_RUN) {
    console.log(`\n  [DRY RUN] Would create ${TO_ID}, verify, then delete ${FROM_ID}.`);
    return;
  }

  // 1. Create new doc.
  await toRef.set(payload);

  // 2. Verify.
  const verifySnap = await toRef.get();
  if (!verifySnap.exists) {
    console.error(`✗ Verification failed: ${TO_ID} not present after write. Aborting before delete.`);
    process.exit(4);
  }

  // 3. Delete old doc.
  await fromRef.delete();

  // 4. Audit log (per brief: event_type field, not action — brief is explicit).
  await db.collection("audit_log").add({
    event_type: "site_registry.key_correction",
    entity_type: "site_registry",
    entity_id: TO_ID,
    actor_uid: "system:tally-122-correction",
    from: FROM_ID,
    to: TO_ID,
    reason: "domain-derived canonical form",
    timestamp: ts(),
  });

  console.log(`\n  ✓ Correction complete. ${FROM_ID} → ${TO_ID}.`);

  // Final state.
  console.log(`\n→ Final site_registry state:`);
  const finalSnap = await db.collection("site_registry").get();
  const summary = finalSnap.docs
    .map((d) => ({ id: d.id, is_active: d.get("is_active"), priority: d.get("priority"), display_name: d.get("display_name") }))
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  console.table(summary);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error("FATAL:", err); process.exit(1); });
