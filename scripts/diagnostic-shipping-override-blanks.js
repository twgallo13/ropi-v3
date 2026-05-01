#!/usr/bin/env node
/**
 * TALLY-SHIPPING-OVERRIDE-CLEANUP — PR 1.3 Phase A diagnostic.
 *
 * Read-only Firestore scan across products/*. Per product, inspect the
 * attribute_values/standard_shipping_override and
 * attribute_values/expedited_shipping_override docs and classify into:
 *   - no-doc            (subcollection doc missing entirely)
 *   - blank-valued      (doc exists, value is null / "" / whitespace-only)
 *   - 0-valued          (doc exists, numeric value === 0)
 *   - positive-valued   (doc exists, numeric value > 0)
 *   - other             (doc exists, value is something unexpected — captured
 *                         for surface-and-stop signaling)
 *
 * Output: JSON dump to
 *   scripts/diagnostic-shipping-override-blanks-output-{timestamp}.json
 *
 * Read-only — no writes performed.
 *
 * Usage:
 *   GCP_SA_KEY_DEV='...' node scripts/diagnostic-shipping-override-blanks.js
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

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(KEY_ENV)),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore();

const FIELD_KEYS = ["standard_shipping_override", "expedited_shipping_override"];

function classify(docSnap) {
  if (!docSnap.exists) return { bucket: "no-doc", value: undefined };
  const data = docSnap.data() || {};
  const v = data.value;
  if (v === null || v === undefined) return { bucket: "blank", value: v };
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return { bucket: "blank", value: v };
    const n = Number(trimmed);
    if (Number.isFinite(n)) {
      if (n === 0) return { bucket: "zero", value: v };
      if (n > 0) return { bucket: "positive", value: v };
      return { bucket: "other", value: v };
    }
    return { bucket: "other", value: v };
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return { bucket: "other", value: v };
    if (v === 0) return { bucket: "zero", value: v };
    if (v > 0) return { bucket: "positive", value: v };
    return { bucket: "other", value: v };
  }
  return { bucket: "other", value: v };
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`\n🔎  TALLY-SHIPPING-OVERRIDE-CLEANUP diagnostic (read-only)`);
  console.log(`    Started: ${startedAt}`);
  console.log(`    Project: ropi-aoss-dev\n`);

  const productsSnap = await db.collection("products").get();
  const totalProducts = productsSnap.size;
  console.log(`    Products scanned: ${totalProducts}`);

  const counters = {
    total_products: totalProducts,
    standard_shipping_override: { no_doc: 0, blank: 0, zero: 0, positive: 0, other: 0 },
    expedited_shipping_override: { no_doc: 0, blank: 0, zero: 0, positive: 0, other: 0 },
  };

  const otherSamples = { standard_shipping_override: [], expedited_shipping_override: [] };
  const MAX_SAMPLES = 25;

  let processed = 0;
  for (const productDoc of productsSnap.docs) {
    const docId = productDoc.id;
    const attrRef = productDoc.ref.collection("attribute_values");

    const [stdSnap, expSnap] = await Promise.all([
      attrRef.doc("standard_shipping_override").get(),
      attrRef.doc("expedited_shipping_override").get(),
    ]);

    const stdRes = classify(stdSnap);
    const expRes = classify(expSnap);

    const stdBucketKey =
      stdRes.bucket === "no-doc" ? "no_doc" : stdRes.bucket;
    const expBucketKey =
      expRes.bucket === "no-doc" ? "no_doc" : expRes.bucket;

    counters.standard_shipping_override[stdBucketKey] += 1;
    counters.expedited_shipping_override[expBucketKey] += 1;

    if (
      stdRes.bucket === "other" &&
      otherSamples.standard_shipping_override.length < MAX_SAMPLES
    ) {
      otherSamples.standard_shipping_override.push({
        product_doc_id: docId,
        value: stdRes.value,
        value_type: typeof stdRes.value,
      });
    }
    if (
      expRes.bucket === "other" &&
      otherSamples.expedited_shipping_override.length < MAX_SAMPLES
    ) {
      otherSamples.expedited_shipping_override.push({
        product_doc_id: docId,
        value: expRes.value,
        value_type: typeof expRes.value,
      });
    }

    processed += 1;
    if (processed % 250 === 0) {
      console.log(`    Progress: ${processed} / ${totalProducts}`);
    }
  }

  const completedAt = new Date().toISOString();

  const report = {
    tally: "TALLY-SHIPPING-OVERRIDE-CLEANUP",
    pr: "PR 1.3 Phase A diagnostic",
    project: "ropi-aoss-dev",
    started_at: startedAt,
    completed_at: completedAt,
    counters,
    other_samples: otherSamples,
    notes: [
      "Read-only scan. No Firestore writes performed.",
      "blank = doc exists with value null/undefined/empty/whitespace.",
      "no_doc = attribute_values subcollection has no document at this field_key.",
      "zero / positive = numeric value === 0 / > 0 (string numbers parsed as Number()).",
      "other = unexpected value type or non-finite number; samples captured for review.",
      "Affected (would-be-cleaned) per field = blank + no_doc.",
    ],
  };

  const tsForFilename = completedAt.replace(/[:.]/g, "-");
  const outDir = path.join(__dirname);
  const outPath = path.join(
    outDir,
    `diagnostic-shipping-override-blanks-output-${tsForFilename}.json`
  );
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");

  console.log(`\n📊  Counters:`);
  for (const fk of FIELD_KEYS) {
    const c = counters[fk];
    const affected = c.no_doc + c.blank;
    console.log(`    ${fk}:`);
    console.log(`      no_doc:   ${c.no_doc}`);
    console.log(`      blank:    ${c.blank}`);
    console.log(`      zero:     ${c.zero}`);
    console.log(`      positive: ${c.positive}`);
    console.log(`      other:    ${c.other}`);
    console.log(`      → affected (no_doc + blank): ${affected}`);
  }

  console.log(`\n💾  JSON output: ${path.relative(path.resolve(__dirname, ".."), outPath)}`);
  console.log(`✅  Diagnostic complete.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌  Diagnostic failed:", err);
    process.exit(1);
  });
