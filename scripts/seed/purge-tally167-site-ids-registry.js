#!/usr/bin/env node
/**
 * TALLY-167 — narrow one-shot purge of the legacy site_ids attribute_registry
 * shadow doc. Sibling fix in scripts/seed/seed-attribute-registry.js removes
 * the seed definition; this script removes the existing Firestore doc that
 * was previously seeded with display_label "Site Owner", which duplicates the
 * canonical site_owner dropdown in the operator Product Edit UI.
 *
 * Scope (narrow, per dispatch):
 *   • Deletes attribute_registry/site_ids only.
 *   • Does NOT touch any product attribute_values subcollection.
 *   • Does NOT sweep other registry fields.
 *
 * Usage:
 *   node scripts/seed/purge-tally167-site-ids-registry.js            # dry-run (default)
 *   node scripts/seed/purge-tally167-site-ids-registry.js --apply    # execute deletion
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

const FIELD_KEY = "site_ids";
const COLLECTION = "attribute_registry";
const APPLY = process.argv.includes("--apply");

(async () => {
  initApp();
  const db = admin.firestore();
  const ref = db.collection(COLLECTION).doc(FIELD_KEY);
  const snap = await ref.get();

  const mode = APPLY ? "APPLY" : "DRY-RUN";
  console.log(`[TALLY-167 purge] mode=${mode} target=${COLLECTION}/${FIELD_KEY}`);

  if (!snap.exists) {
    console.log(`[TALLY-167 purge] no-op — ${COLLECTION}/${FIELD_KEY} does not exist`);
    process.exit(0);
  }

  const data = snap.data() || {};
  console.log(`[TALLY-167 purge] doc found:`);
  console.log(JSON.stringify({
    field_key: data.field_key,
    display_label: data.display_label,
    field_type: data.field_type,
    destination_tab: data.destination_tab,
    display_group: data.display_group,
    display_order: data.display_order,
  }, null, 2));

  if (!APPLY) {
    console.log(`[TALLY-167 purge] DRY-RUN — re-run with --apply to delete.`);
    process.exit(0);
  }

  await ref.delete();
  const after = await ref.get();
  if (after.exists) {
    console.error(`[TALLY-167 purge] ❌ deletion verification failed — doc still exists`);
    process.exit(1);
  }
  console.log(`[TALLY-167 purge] ✅ deleted ${COLLECTION}/${FIELD_KEY}`);
  process.exit(0);
})().catch((err) => {
  console.error(`[TALLY-167 purge] error:`, err);
  process.exit(1);
});
