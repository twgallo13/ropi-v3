#!/usr/bin/env node
/**
 * A.5 MPN finder v3 — sample products to understand last_weekly_import_at field,
 * then try wider window query.
 */
"use strict";
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.GCP_SA_KEY_DEV)), projectId: "ropi-aoss-dev" });
const db = admin.firestore();

async function main() {
  // Sample 5 products that have last_weekly_import_at
  const snap = await db.collection("products")
    .where("last_weekly_import_at", ">", new Date("2020-01-01"))
    .limit(5)
    .get();
  
  console.log("Products with last_weekly_import_at:", snap.size);
  snap.docs.forEach(function(d) {
    const data = d.data();
    const ts = data.last_weekly_import_at;
    const tsStr = ts && typeof ts.toDate === "function" ? ts.toDate().toISOString() : String(ts);
    console.log("  mpn:", data.mpn, "last_weekly_import_at:", tsStr, "import_batch_id:", data.import_batch_id);
  });

  // Also check import_batch_id on any product
  const batchSnap = await db.collection("products")
    .orderBy("updated_at", "desc")
    .limit(5)
    .get();
  console.log("\nRecent products by updated_at:");
  batchSnap.docs.forEach(function(d) {
    const data = d.data();
    function fmt(v) { return v && typeof v.toDate === "function" ? v.toDate().toISOString() : v; }
    console.log("  mpn:", data.mpn, "updated_at:", fmt(data.updated_at), "import_batch_id:", data.import_batch_id, "last_weekly_import_at:", fmt(data.last_weekly_import_at));
  });
}

main().catch(function(e) { console.error(e); process.exit(1); });
