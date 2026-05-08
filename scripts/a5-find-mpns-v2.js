#!/usr/bin/env node
/**
 * A.5 MPN finder v2 — query products by last_weekly_import_at time window matching batch.
 * Batch created_at: 2026-05-05T05:01:53.678Z, completed_at: 2026-05-05T05:02:46.678Z
 * Query window: 5:01 to 5:03 UTC with 30s buffer on each end.
 */
"use strict";
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.GCP_SA_KEY_DEV)), projectId: "ropi-aoss-dev" });
const db = admin.firestore();

// Batch time window with 60s buffer
const WINDOW_START = new Date("2026-05-05T05:00:53.000Z");
const WINDOW_END   = new Date("2026-05-05T05:03:46.000Z");

async function main() {
  console.log("Querying products with last_weekly_import_at in:", WINDOW_START.toISOString(), "to", WINDOW_END.toISOString());

  const snap = await db.collection("products")
    .where("last_weekly_import_at", ">=", WINDOW_START)
    .where("last_weekly_import_at", "<=", WINDOW_END)
    .limit(200)
    .get();

  console.log("Products found:", snap.size);

  const mpns = [];
  snap.docs.forEach(function(d) {
    const data = d.data();
    const mpn = data.mpn || d.id;
    const ts = data.last_weekly_import_at;
    const tsStr = ts && typeof ts.toDate === "function" ? ts.toDate().toISOString() : ts;
    mpns.push({ mpn, last_weekly_import_at: tsStr });
  });

  console.log("MPNs:", JSON.stringify(mpns.map(function(m) { return m.mpn; })));
}

main().catch(function(e) { console.error(e); process.exit(1); });
