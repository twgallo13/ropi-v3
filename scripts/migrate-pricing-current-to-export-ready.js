#!/usr/bin/env node
/**
 * TALLY-107 migration — move completed products out of legacy "Pricing Current"
 * and into "export_ready" (Mark Complete now sets export_ready directly).
 *
 * Usage: node scripts/migrate-pricing-current-to-export-ready.js
 */
"use strict";
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}
const db = admin.firestore();

(async () => {
  const snap = await db
    .collection("products")
    .where("completion_state", "==", "complete")
    .where("pricing_domain_state", "==", "Pricing Current")
    .get();

  let fixed = 0;
  for (const doc of snap.docs) {
    await doc.ref.set({ pricing_domain_state: "export_ready" }, { merge: true });
    console.log("Fixed:", doc.id);
    fixed++;
  }
  console.log("Total fixed:", fixed);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
