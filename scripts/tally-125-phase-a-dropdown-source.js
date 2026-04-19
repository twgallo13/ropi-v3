#!/usr/bin/env node
/**
 * TALLY-125 Phase A, Task A1
 * Set dropdown_source: "site_registry" on attribute_registry/site_owner and /website.
 * Clear dropdown_options (set to empty array) since options now come from site_registry.
 *
 * Usage:
 *   node scripts/tally-125-phase-a-dropdown-source.js --dry-run   # preview
 *   node scripts/tally-125-phase-a-dropdown-source.js              # live
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

const TARGETS = [
  { doc_id: "site_owner", description: "Site Owner dropdown" },
  { doc_id: "website", description: "Active Websites multi-select" },
];

async function main() {
  console.log(`\n=== TALLY-125 Phase A Task A1: Set dropdown_source ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  for (const target of TARGETS) {
    const ref = db.collection("attribute_registry").doc(target.doc_id);
    const snap = await ref.get();

    if (!snap.exists) {
      console.error(`❌ attribute_registry/${target.doc_id} NOT FOUND — aborting`);
      process.exit(1);
    }

    const current = snap.data();
    console.log(`--- ${target.doc_id} (${target.description}) ---`);
    console.log(`  Current dropdown_source: ${current.dropdown_source ?? "(not set)"}`);
    console.log(`  Current dropdown_options: ${JSON.stringify(current.dropdown_options)}`);

    if (current.dropdown_source === "site_registry") {
      console.log(`  ℹ️  Already has dropdown_source: "site_registry" — idempotent skip`);
      if (current.dropdown_options && current.dropdown_options.length > 0) {
        console.log(`  ⚠️  dropdown_options still populated — will clear`);
      } else {
        console.log(`  ✅  dropdown_options already empty — nothing to do\n`);
        continue;
      }
    }

    const update = {
      dropdown_source: "site_registry",
      dropdown_options: [],
    };

    if (DRY_RUN) {
      console.log(`  🔍 Would set: dropdown_source: "site_registry", dropdown_options: []\n`);
    } else {
      await ref.update(update);
      console.log(`  ✅ Updated: dropdown_source: "site_registry", dropdown_options: []\n`);

      // Audit log
      await db.collection("audit_log").add({
        event_type: "attribute_registry.dropdown_source_set",
        doc_id: target.doc_id,
        source: "site_registry",
        previous_dropdown_options: current.dropdown_options || [],
        round: 5,
        tally: "TALLY-125",
        task: "A1",
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`  📝 Audit log written: attribute_registry.dropdown_source_set\n`);
    }
  }

  // Verify final state
  console.log("=== Verification ===");
  for (const target of TARGETS) {
    const snap = await db.collection("attribute_registry").doc(target.doc_id).get();
    const data = snap.data();
    const ok =
      data.dropdown_source === "site_registry" &&
      Array.isArray(data.dropdown_options) &&
      data.dropdown_options.length === 0;
    const status = DRY_RUN ? "(dry-run, pre-change state)" : ok ? "✅ PASS" : "❌ FAIL";
    console.log(
      `  ${target.doc_id}: dropdown_source=${data.dropdown_source ?? "(not set)"}, ` +
        `dropdown_options=[${(data.dropdown_options || []).join(",")}] → ${status}`
    );
  }

  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
