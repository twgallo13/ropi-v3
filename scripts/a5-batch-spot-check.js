#!/usr/bin/env node
/**
 * A.5 Spot-Check — Phase 3.9
 * Dumps 3 MPNs from batch 8616a4e1-4805-4abc-8f91-3db5d19a79aa.
 * For each MPN: full root doc, attribute_values subcollection, site_targets subcollection.
 *
 * Usage:
 *   GCP_SA_KEY_DEV='...' node scripts/a5-batch-spot-check.js
 */
"use strict";
const admin = require("firebase-admin");

const KEY_ENV = process.env.GCP_SA_KEY_DEV || process.env.SERVICE_ACCOUNT_JSON;
if (!KEY_ENV) { console.error("❌  GCP_SA_KEY_DEV not set"); process.exit(1); }

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(KEY_ENV)),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore();

const BATCH_ID = "8616a4e1-4805-4abc-8f91-3db5d19a79aa";

function mpnToDocId(mpn) { return mpn.replace(/\//g, "__"); }

function ts(val) {
  if (!val) return null;
  if (val && typeof val.toDate === "function") return val.toDate().toISOString();
  return val;
}

function formatDoc(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v.toDate === "function") {
      out[k] = v.toDate().toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function dumpProduct(mpn) {
  const docId = mpnToDocId(mpn);
  const ref = db.collection("products").doc(docId);

  // Root doc
  const snap = await ref.get();
  const rootData = snap.exists ? formatDoc(snap.data()) : null;

  // attribute_values subcollection
  const avSnap = await ref.collection("attribute_values").get();
  const attributeValues = {};
  for (const d of avSnap.docs) {
    attributeValues[d.id] = formatDoc(d.data());
  }

  // site_targets subcollection
  const stSnap = await ref.collection("site_targets").get();
  const siteTargets = {};
  for (const d of stSnap.docs) {
    siteTargets[d.id] = formatDoc(d.data());
  }

  return { mpn, docId, rootData, attributeValues, siteTargets };
}

async function main() {
  // 1. Fetch batch doc to get MPNs
  console.log(`\n══ Batch: ${BATCH_ID} ══`);
  const batchRef = db.collection("import_batches").doc(BATCH_ID);
  const batchSnap = await batchRef.get();

  if (!batchSnap.exists) {
    console.error("❌  Batch document not found in import_batches collection.");
    console.error("    Trying query on products where import_batch_id == batch_id...");

    // Fallback: query products by import_batch_id
    const pSnap = await db.collection("products")
      .where("import_batch_id", "==", BATCH_ID)
      .limit(5)
      .get();

    if (pSnap.empty) {
      console.error("❌  No products found with import_batch_id == batch. Batch may not exist in this env.");
      process.exit(1);
    }

    console.log(`\n✅  Found ${pSnap.size} products via product query (batch doc missing or different structure).`);
    const allMpns = pSnap.docs.map(d => d.data().mpn || d.id).filter(Boolean);
    console.log("All MPNs found:", allMpns);
    const sample = allMpns.slice(0, 3);
    console.log("Sampling 3:", sample);

    for (const mpn of sample) {
      const result = await dumpProduct(mpn);
      printResult(result);
    }
    return;
  }

  const batchData = formatDoc(batchSnap.data());
  console.log("\n── Batch metadata ──");
  console.log(JSON.stringify({
    batch_id: batchData.batch_id,
    status: batchData.status,
    committed_at: batchData.committed_at,
    total_rows: batchData.total_rows,
    processed_rows: batchData.processed_rows,
    failed_rows: batchData.failed_rows,
    created_at: batchData.created_at,
    updated_at: batchData.updated_at,
  }, null, 2));

  // 2. Get MPNs — check if stored on batch doc or need to query products
  let mpns = [];
  if (Array.isArray(batchData.mpns) && batchData.mpns.length > 0) {
    mpns = batchData.mpns;
    console.log(`\n  Batch doc has mpns array (${mpns.length} entries). Sampling first 3.`);
  } else {
    // Query products by import_batch_id
    console.log("\n  Batch doc has no mpns array — querying products by import_batch_id...");
    const pSnap = await db.collection("products")
      .where("import_batch_id", "==", BATCH_ID)
      .limit(20)
      .get();
    mpns = pSnap.docs.map(d => d.data().mpn).filter(Boolean);
    console.log(`  Found ${mpns.length} products with this batch_id (capped at 20).`);
  }

  if (mpns.length === 0) {
    console.error("❌  No MPNs found for this batch.");
    process.exit(1);
  }

  // 3. Pick 3 spread across the result
  const sample = mpns.length <= 3
    ? mpns
    : [mpns[0], mpns[Math.floor(mpns.length / 2)], mpns[mpns.length - 1]];

  console.log(`\n  Spot-checking MPNs: ${sample.join(", ")}`);

  // 4. Dump each MPN
  for (const mpn of sample) {
    const result = await dumpProduct(mpn);
    printResult(result);
  }

  console.log("\n══ Done ══\n");
}

function printResult({ mpn, docId, rootData, attributeValues, siteTargets }) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`MPN: ${mpn}  |  docId: ${docId}`);
  console.log("─".repeat(70));

  console.log("\n── ROOT DOC ──");
  if (!rootData) {
    console.log("  (not found)");
  } else {
    console.log(JSON.stringify(rootData, null, 2));
  }

  console.log("\n── ATTRIBUTE_VALUES subcollection ──");
  const avKeys = Object.keys(attributeValues);
  if (avKeys.length === 0) {
    console.log("  (empty)");
  } else {
    // Print key list first, then full data for shipping-relevant docs
    console.log(`  Keys (${avKeys.length}): ${avKeys.sort().join(", ")}`);
    const shippingKeys = avKeys.filter(k => k.includes("shipping_override") || k.includes("shipping"));
    if (shippingKeys.length > 0) {
      console.log("\n  ── Shipping-related attribute_values ──");
      for (const k of shippingKeys) {
        console.log(`  [${k}]:`);
        console.log(JSON.stringify(attributeValues[k], null, 4));
      }
    } else {
      console.log("  No shipping_override keys found.");
    }
    // Print full attribute_values
    console.log("\n  ── Full attribute_values ──");
    console.log(JSON.stringify(attributeValues, null, 2));
  }

  console.log("\n── SITE_TARGETS subcollection ──");
  const stKeys = Object.keys(siteTargets);
  if (stKeys.length === 0) {
    console.log("  (empty)");
  } else {
    console.log(JSON.stringify(siteTargets, null, 2));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
