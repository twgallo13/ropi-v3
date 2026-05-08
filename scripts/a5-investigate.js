#!/usr/bin/env node
/**
 * A.5 investigation — check other recent batches, understand MPN linkage pattern.
 * Also try querying products with last_weekly_import_at in different time windows.
 */
"use strict";
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.GCP_SA_KEY_DEV)), projectId: "ropi-aoss-dev" });
var db = admin.firestore();

function fmt(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  return v;
}

async function main() {
  // 1. Check batch b2b544b8 to understand its family
  var b2Snap = await db.collection("import_batches").doc("b2b544b8-fd56-4655-8811-84a778f6b980").get();
  if (b2Snap.exists) {
    var raw = b2Snap.data();
    var d = {};
    Object.keys(raw).forEach(function(k) { d[k] = fmt(raw[k]); });
    console.log("Batch b2b544b8 (recent):", JSON.stringify({
      batch_id: d.batch_id,
      family: d.family,
      status: d.status,
      committed_rows: d.committed_rows,
      row_count: d.row_count,
      created_at: d.created_at,
      completed_at: d.completed_at,
      file_path: d.file_path,
    }, null, 2));
  } else {
    console.log("Batch b2b544b8 not found.");
  }

  // 2. List recent import_batches
  var batchesSnap = await db.collection("import_batches")
    .orderBy("created_at", "desc")
    .limit(10)
    .get();
  console.log("\nRecent batches:");
  batchesSnap.docs.forEach(function(d) {
    var data = d.data();
    console.log("  " + d.id.substring(0, 8) + "... family=" + data.family + " status=" + data.status + " rows=" + data.committed_rows + " created=" + fmt(data.created_at));
  });

  // 3. For target batch, query products with last_weekly_import_at within batch window
  // Try wide window: entire May 5
  var startOfDay = new Date("2026-05-05T00:00:00.000Z");
  var endOf5am   = new Date("2026-05-05T06:00:00.000Z");
  var prodSnap = await db.collection("products")
    .where("last_weekly_import_at", ">=", startOfDay)
    .where("last_weekly_import_at", "<", endOf5am)
    .limit(10)
    .get();
  console.log("\nProducts with last_weekly_import_at in [00:00, 06:00] UTC May 5:", prodSnap.size);
  prodSnap.docs.slice(0, 5).forEach(function(d) {
    var data = d.data();
    console.log("  mpn=" + data.mpn + " import_batch_id=" + data.import_batch_id + " last_weekly_import_at=" + fmt(data.last_weekly_import_at));
  });

  // 4. Check if there's a pricing_snapshots collection (direct product subcollection)
  // Try a specific product to see its pricing_snapshots
  var sampleMpnSnap = await db.collection("products").limit(1).get();
  if (!sampleMpnSnap.empty) {
    var sampleRef = sampleMpnSnap.docs[0].ref;
    var psSnap = await sampleRef.collection("pricing_snapshots")
      .orderBy("resolved_at", "desc")
      .limit(3)
      .get();
    console.log("\nSample product (" + sampleMpnSnap.docs[0].data().mpn + ") pricing_snapshots:", psSnap.size);
    psSnap.docs.forEach(function(d) {
      var data = d.data();
      console.log("  import_batch_id=" + data.import_batch_id + " resolved_at=" + fmt(data.resolved_at));
    });
  }
}

main().catch(function(e) { console.error(e); process.exit(1); });
