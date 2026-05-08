#!/usr/bin/env node
"use strict";
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.GCP_SA_KEY_DEV)), projectId: "ropi-aoss-dev" });
const db = admin.firestore();
const BATCH_ID = "8616a4e1-4805-4abc-8f91-3db5d19a79aa";

function fmt(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  return v;
}

async function main() {
  // Full batch doc — all keys
  const snap = await db.collection("import_batches").doc(BATCH_ID).get();
  const raw = snap.data() || {};
  const formatted = {};
  for (const [k, v] of Object.entries(raw)) {
    formatted[k] = fmt(v);
  }
  console.log("Full batch doc keys:", Object.keys(raw));
  console.log("Full batch doc:", JSON.stringify(formatted, null, 2));

  // audit_log — look for entries tagged with this batch_id
  const logSnap = await db.collection("audit_log")
    .where("batch_id", "==", BATCH_ID)
    .limit(10)
    .get();
  console.log("audit_log hits for batch_id:", logSnap.size);
  logSnap.docs.forEach(function(d) { console.log(JSON.stringify(d.data())); });

  // Try acting_user_id pattern: import:<batch_id>
  const actingSnap = await db.collection("audit_log")
    .where("acting_user_id", "==", "import:" + BATCH_ID)
    .limit(10)
    .get();
  console.log("audit_log hits for acting_user_id:", actingSnap.size);
  actingSnap.docs.forEach(function(d) { console.log(JSON.stringify(d.data())); });
}

main().catch(function(e) { console.error(e); process.exit(1); });
