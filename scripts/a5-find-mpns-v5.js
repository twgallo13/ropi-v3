#!/usr/bin/env node
/**
 * A.5 MPN finder v5 — find 3 MPNs from batch 8616a4e1 by checking pricing_snapshots
 * across a sample of catalog products. We already know 1003868 is in the batch.
 */
"use strict";
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.GCP_SA_KEY_DEV)), projectId: "ropi-aoss-dev" });
var db = admin.firestore();

var TARGET_BATCH = "8616a4e1-4805-4abc-8f91-3db5d19a79aa";
// Target window: batch ran 05:01:53 to 05:02:46 UTC May 5 2026
var WIN_START = new Date("2026-05-05T05:01:00.000Z");
var WIN_END   = new Date("2026-05-05T05:03:00.000Z");

function fmt(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  return v;
}

async function hasBatchSnapshot(mpn) {
  var docId = mpn.replace(/\//g, "__");
  var psSnap = await db.collection("products").doc(docId)
    .collection("pricing_snapshots")
    .where("import_batch_id", "==", TARGET_BATCH)
    .limit(1)
    .get();
  return !psSnap.empty;
}

async function main() {
  // Sample products from catalog — take first 50 to scan
  var prodSnap = await db.collection("products").limit(50).get();
  var all = prodSnap.docs.map(function(d) { return d.data().mpn || d.id; }).filter(Boolean);
  console.log("Scanning", all.length, "products for batch", TARGET_BATCH);

  var found = [];
  for (var mpn of all) {
    if (found.length >= 3) break;
    var inBatch = await hasBatchSnapshot(mpn);
    if (inBatch) {
      found.push(mpn);
      console.log("  Found:", mpn);
    }
    if (found.length === 0 && all.indexOf(mpn) > 10) {
      // After 10 misses, try wider scan
      console.log("  (still searching...)");
    }
  }

  if (found.length < 3) {
    // Try next page
    var lastDoc = prodSnap.docs[prodSnap.docs.length - 1];
    var prodSnap2 = await db.collection("products").startAfter(lastDoc).limit(50).get();
    var all2 = prodSnap2.docs.map(function(d) { return d.data().mpn || d.id; }).filter(Boolean);
    for (var mpn2 of all2) {
      if (found.length >= 3) break;
      var inBatch2 = await hasBatchSnapshot(mpn2);
      if (inBatch2) {
        found.push(mpn2);
        console.log("  Found:", mpn2);
      }
    }
  }

  console.log("\nConfirmed sample (", found.length, "):", found);
  return found;
}

main().catch(function(e) { console.error(e); process.exit(1); });
