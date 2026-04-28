#!/usr/bin/env node
/**
 * TALLY-PRODUCT-EDITOR-REGISTRY-DROPDOWNS — Step 1 (Architecture B seed)
 *
 * Per Frink pre-audit + diagnostic 2026-04-26 (bucket B):
 *   attribute_registry/brand has   field_type="text",     dropdown_source=null  (BOTH wrong)
 *   attribute_registry/department has field_type="dropdown", dropdown_source=null (one wrong)
 *
 * Fix state:
 *   attribute_registry/brand      → { field_type: "dropdown", dropdown_source: "brand_registry" }
 *   attribute_registry/department → {                          dropdown_source: "department_registry" }
 *
 * Phase 5A pattern: value-aware idempotent stop conditions per doc.
 * - already-seeded → no-op + log
 * - first-run pre-state → write only the missing fields via merge:true
 * - any other state → STOP + report drift
 *
 * Out of scope (DO NOT touch):
 *   department.allowed_values, dropdown_options, enum_source,
 *   attribute_registry/site_owner, any other doc.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/tally-product-editor-registry-dropdowns-attribute-registry-seed.js
 *   (or export GCP_SA_KEY_DEV='...json...' and run)
 */
"use strict";

const admin = require("firebase-admin");

const KEY_ENV = process.env.GCP_SA_KEY_DEV;
if (!KEY_ENV) {
  console.error("❌  GCP_SA_KEY_DEV not set");
  process.exit(1);
}

let creds;
try {
  creds = JSON.parse(KEY_ENV);
} catch (e) {
  console.error("❌  GCP_SA_KEY_DEV is not valid JSON:", e.message);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(creds),
  projectId: "ropi-aoss-dev",
});

const db = admin.firestore();

// Hard-fail if SA key resolves to a different project.
if (creds.project_id && creds.project_id !== "ropi-aoss-dev") {
  console.error(
    `❌  SA key project_id "${creds.project_id}" !== "ropi-aoss-dev". Aborting.`
  );
  process.exit(1);
}

const TARGETS = [
  {
    docId: "brand",
    expectedPostFix: { field_type: "dropdown", dropdown_source: "brand_registry" },
    expectedPreFix: { field_type: "text", dropdown_source: null },
    writePayload: { field_type: "dropdown", dropdown_source: "brand_registry" },
  },
  {
    docId: "department",
    expectedPostFix: { field_type: "dropdown", dropdown_source: "department_registry" },
    expectedPreFix: { field_type: "dropdown", dropdown_source: null },
    // Department field_type is already correct — only seed dropdown_source.
    writePayload: { dropdown_source: "department_registry" },
  },
];

function matches(actual, expected) {
  // Path A gate widening (Lisa greenlight 2026-04-28): treat absent key as
  // equivalent to null. Live Firestore returns dropdown_source as undefined
  // when the field has never been set; Frink diagnostic stated `null`. Both
  // states are functionally identical to downstream readers (FE checks
  // dropdownSource === "site_registry" etc.; absent and null both fail).
  for (const k of Object.keys(expected)) {
    if ((actual[k] ?? null) !== expected[k]) return false;
  }
  return true;
}

function fmt(obj) {
  return JSON.stringify(obj, null, 2);
}

async function readDoc(docId) {
  const ref = db.collection("attribute_registry").doc(docId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error(`attribute_registry/${docId} does not exist`);
  }
  return { ref, data: snap.data() };
}

async function run() {
  console.log("\n========================================================");
  console.log("TALLY-PRODUCT-EDITOR-REGISTRY-DROPDOWNS — Step 1 seed");
  console.log("Project: ropi-aoss-dev");
  console.log("Started:", new Date().toISOString());
  console.log("========================================================\n");

  // ── READ-BEFORE ──
  console.log("─── READ-BEFORE ───");
  const preStates = {};
  for (const t of TARGETS) {
    const { data } = await readDoc(t.docId);
    preStates[t.docId] = data;
    console.log(`\nattribute_registry/${t.docId} (pre):`);
    console.log(fmt(data));
  }

  // ── DECISION + WRITE ──
  console.log("\n─── DECISION + WRITE ───");
  const actions = {};
  for (const t of TARGETS) {
    const pre = preStates[t.docId];
    if (matches(pre, t.expectedPostFix)) {
      console.log(`\n[${t.docId}] already seeded; no-op (skip write).`);
      actions[t.docId] = "noop-already-seeded";
      continue;
    }
    if (matches(pre, t.expectedPreFix)) {
      console.log(`\n[${t.docId}] first-run pre-state detected. Writing payload via merge:true:`);
      console.log(fmt(t.writePayload));
      const { ref } = await readDoc(t.docId);
      await ref.set(t.writePayload, { merge: true });
      actions[t.docId] = "wrote-first-run";
      console.log(`[${t.docId}] write complete.`);
      continue;
    }
    // Drift: state matches neither pre nor post.
    console.error(
      `\n❌  [${t.docId}] STOP — state matches neither expected pre-fix nor expected post-fix.`
    );
    console.error("    Expected pre-fix subset:", fmt(t.expectedPreFix));
    console.error("    Expected post-fix subset:", fmt(t.expectedPostFix));
    console.error("    Actual:", fmt(pre));
    process.exit(2);
  }

  // ── READ-AFTER ──
  console.log("\n─── READ-AFTER ───");
  let allOk = true;
  for (const t of TARGETS) {
    const { data } = await readDoc(t.docId);
    console.log(`\nattribute_registry/${t.docId} (post):`);
    console.log(fmt(data));

    // Verify expected post-fix state.
    if (!matches(data, t.expectedPostFix)) {
      console.error(`❌  [${t.docId}] post-fix state mismatch.`);
      allOk = false;
      continue;
    }

    // Verify all OTHER fields preserved (i.e., we did not delete or mutate
    // anything outside writePayload).
    const pre = preStates[t.docId];
    const writeKeys = new Set(Object.keys(t.writePayload));
    for (const k of Object.keys(pre)) {
      if (writeKeys.has(k)) continue;
      const a = JSON.stringify(pre[k]);
      const b = JSON.stringify(data[k]);
      if (a !== b) {
        console.error(`❌  [${t.docId}] field "${k}" changed unexpectedly: ${a} → ${b}`);
        allOk = false;
      }
    }
  }

  console.log("\n─── SUMMARY ───");
  for (const t of TARGETS) {
    console.log(`  ${t.docId}: ${actions[t.docId]}`);
  }
  if (!allOk) {
    console.error("\n❌  READ-AFTER verification failed. Investigate immediately.");
    process.exit(3);
  }
  console.log("\n✅  Seed complete. Both docs in expected post-fix state.");
  console.log("Finished:", new Date().toISOString());
}

run().catch((e) => {
  console.error("❌  Unhandled error:", e);
  process.exit(1);
});
