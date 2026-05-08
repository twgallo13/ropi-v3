#!/usr/bin/env node
/**
 * A.5 MPN finder — uses collection group query on pricing_snapshots subcollection
 * to find all MPNs processed in batch 8616a4e1-4805-4abc-8f91-3db5d19a79aa.
 */
"use strict";
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.GCP_SA_KEY_DEV)), projectId: "ropi-aoss-dev" });
const db = admin.firestore();
const BATCH_ID = "8616a4e1-4805-4abc-8f91-3db5d19a79aa";

async function main() {
  // Collection group query across all pricing_snapshots subcollections
  const snap = await db.collectionGroup("pricing_snapshots")
    .where("import_batch_id", "==", BATCH_ID)
    .limit(200)
    .get();

  console.log("pricing_snapshots hits:", snap.size);

  const mpns = [];
  snap.docs.forEach(function(d) {
    // parent path: products/{docId}/pricing_snapshots/{snapshotId}
    const parts = d.ref.path.split("/");
    const docId = parts[1]; // products/{docId}
    // docId is mpn with / replaced by __
    const mpn = docId.replace(/__/g, "/");
    if (!mpns.includes(mpn)) mpns.push(mpn);
  });

  console.log("Unique MPNs (" + mpns.length + "):", mpns);

  // Sample: first, middle, last
  if (mpns.length === 0) {
    console.log("No MPNs found.");
    return;
  }
  const sample = mpns.length <= 3
    ? mpns
    : [mpns[0], mpns[Math.floor(mpns.length / 2)], mpns[mpns.length - 1]];
  console.log("Sample 3:", sample);
}

main().catch(function(e) { console.error(e); process.exit(1); });
