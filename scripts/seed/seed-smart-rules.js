#!/usr/bin/env node
/**
 * Seed: smart_rules — 3 docs (TALLY-081, TALLY-082)
 * Verbatim from SPEC.md Part 3, Seed 3.
 * Idempotent (set-with-merge).
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "smart_rules";

const RULES = [
  {
    id: "rule_uuid_name_cleanup",
    rule_name: "UUID Name Cleanup",
    conditions: [{ source_field: "name", operator: "matches", target_value: "UUID_PATTERN" }],
    condition_logic: "AND",
    action: { target_attribute: "name", output_value: "" },
    always_overwrite: true,
    priority: 1,
    is_active: true,
    tally_ref: "TALLY-082",
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  },
  {
    id: "rule_media_no_images",
    rule_name: "Media Presence - No Images",
    conditions: [{ source_field: "media_status", operator: "is empty", target_value: "" }],
    condition_logic: "AND",
    action: { target_attribute: "image_status", output_value: "NO" },
    always_overwrite: true,
    priority: 2,
    is_active: true,
    tally_ref: "TALLY-081",
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  },
  {
    id: "rule_media_has_images",
    rule_name: "Media Presence - Has Images",
    conditions: [{ source_field: "media_status", operator: "is not empty", target_value: "" }],
    condition_logic: "AND",
    action: { target_attribute: "image_status", output_value: "YES" },
    always_overwrite: true,
    priority: 2,
    is_active: true,
    tally_ref: "TALLY-081",
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  },
];

async function main() {
  const app = initApp();
  const db = admin.firestore(app);
  console.log(`\n🌱  Seeding "${COLLECTION}" (${RULES.length} docs) …`);

  let created = 0, updated = 0;
  for (const rule of RULES) {
    const { id, ...data } = rule;
    const ref = db.collection(COLLECTION).doc(id);
    const snap = await ref.get();
    if (snap.exists) {
      const { created_at, ...upd } = data;
      await ref.set({ ...upd, updated_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      updated++;
    } else {
      await ref.set(data);
      created++;
    }
  }
  console.log(`   Summary → created: ${created}, updated: ${updated}, total: ${RULES.length}`);
  console.log(`   ✔  "${COLLECTION}" seed complete.\n`);
}

main().catch(e => { console.error("❌  Seed failed:", e); process.exit(1); });
