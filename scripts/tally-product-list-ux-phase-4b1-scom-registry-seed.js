#!/usr/bin/env node
/**
 * TALLY-PRODUCT-LIST-UX Phase 4B.1 — targeted attribute_registry seed injection
 *
 * Background (Homer 2026-04-25 STOP):
 *   Live verification of `attribute_registry` on ropi-aoss-dev showed that
 *   `scom` and `scom_sale` docs do NOT exist, despite seed-attribute-registry.js
 *   declaring both. Standard / expedited shipping_override docs DO exist.
 *
 * PO ruling 2026-04-25: authorize targeted seed injection of the two missing
 * docs, source-of-truth = seed-attribute-registry.js (Architecture B pattern,
 * same as Phase 4B enum_source backfill).
 *
 * Source declarations (verbatim from
 *   scripts/seed/seed-attribute-registry.js L168-L169):
 *     attr("scom",      "Web Regular Price (SCOM)",   "number", "product_attributes",
 *          { display_group: "Pricing", display_order: 19 })
 *     attr("scom_sale", "Web Sale Price (SCOM Sale)", "number", "product_attributes",
 *          { display_group: "Pricing", display_order: 20 })
 *
 * The attr() factory shape (L21-L46 of the seed) expands those calls to:
 *     {
 *       field_key, display_label, field_type, destination_tab,
 *       display_group, display_order,
 *       required_for_completion: false,
 *       include_in_ai_prompt: false,
 *       include_in_cadence_targeting: false,
 *       active: true,
 *       export_enabled: true,
 *       dropdown_options: [],
 *     }
 * (no enum_source / dropdown_source — neither was passed in opts).
 *
 * This script:
 *   1. Auths via SA key (GOOGLE_APPLICATION_CREDENTIALS), confirms project.
 *   2. READ-BEFORE both docs; STOPS if either already exists.
 *   3. WRITE both with set({...}, { merge: true }) defensively.
 *   4. READ-AFTER and prints the full doc data for the audit trail.
 */
"use strict";

const admin = require("firebase-admin");

const COLLECTION = "attribute_registry";
const EXPECTED_PROJECT = "ropi-aoss-dev";

// Verbatim transcription of the attr() factory output for the two
// declarations cited above.
const DOCS = {
  scom: {
    field_key: "scom",
    display_label: "Web Regular Price (SCOM)",
    field_type: "number",
    destination_tab: "product_attributes",
    display_group: "Pricing",
    display_order: 19,
    required_for_completion: false,
    include_in_ai_prompt: false,
    include_in_cadence_targeting: false,
    active: true,
    export_enabled: true,
    dropdown_options: [],
  },
  scom_sale: {
    field_key: "scom_sale",
    display_label: "Web Sale Price (SCOM Sale)",
    field_type: "number",
    destination_tab: "product_attributes",
    display_group: "Pricing",
    display_order: 20,
    required_for_completion: false,
    include_in_ai_prompt: false,
    include_in_cadence_targeting: false,
    active: true,
    export_enabled: true,
    dropdown_options: [],
  },
};

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error("FATAL: GOOGLE_APPLICATION_CREDENTIALS not set.");
    process.exit(1);
  }
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: EXPECTED_PROJECT,
  });
  const db = admin.firestore();
  const projectId = (await admin.app().options).projectId
    || admin.app().options.projectId;
  if (projectId !== EXPECTED_PROJECT) {
    console.error(`FATAL: project mismatch (got '${projectId}', expected '${EXPECTED_PROJECT}')`);
    process.exit(1);
  }
  console.log(`Project: ${projectId}`);
  console.log(`Collection: ${COLLECTION}`);
  console.log(`Targets: ${Object.keys(DOCS).join(", ")}`);
  console.log("");

  // ── READ-BEFORE ──
  console.log("=== READ-BEFORE ===");
  const before = {};
  for (const id of Object.keys(DOCS)) {
    const snap = await db.collection(COLLECTION).doc(id).get();
    before[id] = snap.exists;
    console.log(`${id}: exists=${snap.exists}`);
    if (snap.exists) {
      console.log(`  data=${JSON.stringify(snap.data())}`);
    }
  }
  for (const id of Object.keys(DOCS)) {
    if (before[id]) {
      console.error(`STOP: ${id} already exists. Drift between prior verification and now.`);
      process.exit(2);
    }
  }
  console.log("");

  // ── WRITE ──
  console.log("=== WRITE ===");
  const writeAt = admin.firestore.FieldValue.serverTimestamp();
  for (const [id, data] of Object.entries(DOCS)) {
    const payload = { ...data, created_at: writeAt };
    await db.collection(COLLECTION).doc(id).set(payload, { merge: true });
    console.log(`${id}: written`);
  }
  console.log("");

  // ── READ-AFTER ──
  console.log("=== READ-AFTER ===");
  let allPass = true;
  for (const id of Object.keys(DOCS)) {
    const snap = await db.collection(COLLECTION).doc(id).get();
    const d = snap.data() || {};
    const checks = {
      exists: snap.exists,
      field_type_number: d.field_type === "number",
      active_true: d.active === true,
      destination_tab_product_attributes: d.destination_tab === "product_attributes",
    };
    const pass = Object.values(checks).every(Boolean);
    if (!pass) allPass = false;
    console.log(`${id}: pass=${pass}`);
    console.log(`  checks=${JSON.stringify(checks)}`);
    console.log(`  data=${JSON.stringify(d)}`);
  }
  console.log("");

  if (!allPass) {
    console.error("FATAL: READ-AFTER assertions failed.");
    process.exit(3);
  }
  console.log("All assertions passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
