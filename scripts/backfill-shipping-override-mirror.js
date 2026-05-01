#!/usr/bin/env node
/**
 * TALLY-SHIPPING-OVERRIDE-CLEANUP — PR 1.4 backfill (3-pair mirror).
 *
 * Per dispatch v2.4: identify products that have a positive numeric value
 * in attribute_values/{standard,expedited}_shipping_override but a null /
 * missing value at the corresponding product-root field, and mirror the
 * attribute_values value up to product root.
 *
 * Production diagnostic baseline (PR 1.3 Phase A, 2026-05-01, ropi-aoss-dev):
 *   - standard_shipping_override: 2 positive
 *   - expedited_shipping_override: 1 positive
 *   = 3 (field_key, value) pairs across 2 unique product docs.
 *
 * --dry-run (default): no Firestore writes. Emits proposed-mirror plan to
 *   scripts/backfill-shipping-override-mirror-output-{ts}.json.
 * --apply: performs the writes. Gated — PO greenlight required at the
 *   inter-PR gate. Refuses to run without an explicit --i-am-sure-apply
 *   confirmation flag to prevent accidental invocation.
 *
 * Usage:
 *   GCP_SA_KEY_DEV='...' node scripts/backfill-shipping-override-mirror.js
 *   GCP_SA_KEY_DEV='...' node scripts/backfill-shipping-override-mirror.js --apply --i-am-sure-apply
 */
"use strict";

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const KEY_ENV = process.env.GCP_SA_KEY_DEV || process.env.SERVICE_ACCOUNT_JSON;
if (!KEY_ENV) {
  console.error("❌  GCP_SA_KEY_DEV not set");
  process.exit(1);
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const APPLY_CONFIRM = args.includes("--i-am-sure-apply");

if (APPLY && !APPLY_CONFIRM) {
  console.error(
    "❌  Refusing to --apply without --i-am-sure-apply confirmation flag.\n" +
      "    PR 1.4 dispatch hard-gates the apply phase: PO greenlight required."
  );
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(KEY_ENV)),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore();

const FIELD_KEYS = ["standard_shipping_override", "expedited_shipping_override"];

function toFiniteNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function main() {
  const startedAt = new Date().toISOString();
  const mode = APPLY ? "APPLY" : "DRY-RUN";
  console.log(`\n🛠   TALLY-SHIPPING-OVERRIDE-CLEANUP backfill — mode: ${mode}`);
  console.log(`    Started: ${startedAt}`);
  console.log(`    Project: ropi-aoss-dev\n`);

  const productsSnap = await db.collection("products").get();
  const totalProducts = productsSnap.size;
  console.log(`    Products scanned: ${totalProducts}`);

  const planned = [];        // (doc_id, field_key, mirror_value, root_before)
  const skipped = [];        // (doc_id, field_key, reason)
  let pairsApplied = 0;
  let pairsSkippedNoOp = 0;
  let pairsSkippedRootHasValue = 0;
  let pairsSkippedAttrNotPositive = 0;
  let pairsSkippedAttrMissing = 0;

  for (const productDoc of productsSnap.docs) {
    const docId = productDoc.id;
    const root = productDoc.data();

    const [stdSnap, expSnap] = await Promise.all([
      productDoc.ref.collection("attribute_values").doc("standard_shipping_override").get(),
      productDoc.ref.collection("attribute_values").doc("expedited_shipping_override").get(),
    ]);

    const checks = [
      { field: "standard_shipping_override", attrSnap: stdSnap },
      { field: "expedited_shipping_override", attrSnap: expSnap },
    ];

    for (const { field, attrSnap } of checks) {
      if (!attrSnap.exists) {
        pairsSkippedAttrMissing += 1;
        continue;
      }
      const attrValue = attrSnap.data().value;
      const numeric = toFiniteNumber(attrValue);
      if (numeric === null || numeric <= 0) {
        pairsSkippedAttrNotPositive += 1;
        continue;
      }

      const rootBefore = root[field];
      const rootHasValue =
        rootBefore !== null && rootBefore !== undefined;
      if (rootHasValue) {
        // Idempotent no-op when root already matches
        if (toFiniteNumber(rootBefore) === numeric) {
          pairsSkippedNoOp += 1;
          skipped.push({
            product_doc_id: docId,
            field_key: field,
            reason: "root_already_matches",
            attr_value: attrValue,
            root_before: rootBefore,
          });
          continue;
        }
        // Root has a different value — refuse to overwrite
        pairsSkippedRootHasValue += 1;
        skipped.push({
          product_doc_id: docId,
          field_key: field,
          reason: "root_has_different_value_refusing_overwrite",
          attr_value: attrValue,
          root_before: rootBefore,
        });
        continue;
      }

      const planEntry = {
        product_doc_id: docId,
        mpn: root.mpn || null,
        field_key: field,
        attr_value_raw: attrValue,
        attr_value_type: typeof attrValue,
        mirror_value: numeric,
        root_before: rootBefore ?? null,
      };
      planned.push(planEntry);

      if (APPLY) {
        await productDoc.ref.set(
          {
            [field]: numeric,
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        pairsApplied += 1;
      }
    }
  }

  const completedAt = new Date().toISOString();

  const report = {
    tally: "TALLY-SHIPPING-OVERRIDE-CLEANUP",
    pr: "PR 1.4 backfill",
    mode,
    project: "ropi-aoss-dev",
    started_at: startedAt,
    completed_at: completedAt,
    total_products_scanned: totalProducts,
    counters: {
      planned_pairs: planned.length,
      applied_pairs: pairsApplied,
      skipped_attr_missing: pairsSkippedAttrMissing,
      skipped_attr_not_positive: pairsSkippedAttrNotPositive,
      skipped_root_already_matches_noop: pairsSkippedNoOp,
      skipped_root_has_different_value: pairsSkippedRootHasValue,
    },
    planned,
    skipped,
    notes: [
      "Dry-run by default. --apply requires --i-am-sure-apply confirmation.",
      "Mirrors attr_value -> product root only when root is null/undefined.",
      "Refuses to overwrite a non-null product-root value (logged in skipped).",
      "Idempotent: re-running after apply produces planned_pairs=0 (root_already_matches no-op).",
    ],
  };

  const tsForFilename = completedAt.replace(/[:.]/g, "-");
  const outPath = path.join(
    __dirname,
    `backfill-shipping-override-mirror-output-${tsForFilename}.json`
  );
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");

  console.log(`\n📊  Counters:`);
  console.log(`    Mode:                                  ${mode}`);
  console.log(`    Planned pairs (would-mirror):          ${planned.length}`);
  console.log(`    Applied pairs:                         ${pairsApplied}`);
  console.log(`    Skipped — attr missing:                ${pairsSkippedAttrMissing}`);
  console.log(`    Skipped — attr not positive:           ${pairsSkippedAttrNotPositive}`);
  console.log(`    Skipped — root already matches (noop): ${pairsSkippedNoOp}`);
  console.log(`    Skipped — root has different value:    ${pairsSkippedRootHasValue}`);
  console.log(`\n💾  JSON output: ${path.relative(path.resolve(__dirname, ".."), outPath)}`);
  console.log(`✅  Backfill ${mode} complete.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌  Backfill failed:", err);
    process.exit(1);
  });
