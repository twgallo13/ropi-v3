#!/usr/bin/env node
/**
 * TALLY-PRODUCT-LIST-UX Phase 4B — enum_source live injection.
 *
 * Stamps `enum_source` on the live `attribute_registry` docs that the new
 * 4B handler enforcement relies on. Idempotent (set with merge); preserves
 * any existing fields including `dropdown_source` on site_owner (set by
 * the TALLY-125 separate script).
 *
 * Mappings:
 *   attribute_registry/brand       → enum_source: "brand_registry"
 *   attribute_registry/site_owner  → enum_source: "site_registry"
 *   attribute_registry/department  → enum_source: "department_registry" (already live; reaffirmed)
 *
 * Auth: SA key only. Reads $GCP_SA_KEY_DEV (raw JSON) into a tempfile,
 * sets GOOGLE_APPLICATION_CREDENTIALS, then ApplicationDefault. No
 * FIREBASE_TOKEN.
 *
 * Run:  node scripts/tally-product-list-ux-phase-4b-enum-source.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const admin = require("firebase-admin");

const PROJECT_ID = "ropi-aoss-dev";

const TARGETS = [
  { docId: "brand", enum_source: "brand_registry" },
  { docId: "site_owner", enum_source: "site_registry" },
  { docId: "department", enum_source: "department_registry" },
];

function bootstrapAuth() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    return;
  }
  const raw = process.env.GCP_SA_KEY_DEV;
  if (!raw) throw new Error("GCP_SA_KEY_DEV is not set");
  const tmp = path.join(os.tmpdir(), `gcp-sa-key-${process.pid}.json`);
  fs.writeFileSync(tmp, raw, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

async function main() {
  bootstrapAuth();
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
  const db = admin.firestore();

  for (const t of TARGETS) {
    const ref = db.collection("attribute_registry").doc(t.docId);

    // ── read-before ──
    const before = await ref.get();
    if (!before.exists) {
      console.log(`[skip] attribute_registry/${t.docId}: doc does not exist`);
      continue;
    }
    const beforeData = before.data() || {};
    console.log(`\n[before] attribute_registry/${t.docId}:`, {
      enum_source: beforeData.enum_source ?? null,
      dropdown_source: beforeData.dropdown_source ?? null,
      field_type: beforeData.field_type ?? null,
      active: beforeData.active ?? null,
    });

    if (beforeData.enum_source === t.enum_source) {
      console.log(`[noop] attribute_registry/${t.docId}: enum_source already "${t.enum_source}"`);
      continue;
    }

    // ── write ──
    await ref.set({ enum_source: t.enum_source }, { merge: true });

    // ── read-after ──
    const after = await ref.get();
    const afterData = after.data() || {};
    console.log(`[after]  attribute_registry/${t.docId}:`, {
      enum_source: afterData.enum_source ?? null,
      dropdown_source: afterData.dropdown_source ?? null,
      field_type: afterData.field_type ?? null,
      active: afterData.active ?? null,
    });

    // Sanity: dropdown_source must survive on site_owner (TALLY-125 invariant).
    if (t.docId === "site_owner" && afterData.dropdown_source !== "site_registry") {
      throw new Error(
        `INVARIANT BROKEN: site_owner.dropdown_source no longer "site_registry" after merge (got ${JSON.stringify(afterData.dropdown_source)})`,
      );
    }
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((e) => { console.error("Failed:", e); process.exit(1); });
