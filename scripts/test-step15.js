#!/usr/bin/env node
/**
 * Step 1.5 Verification Script
 * Tests Weekly Operations Import, Pricing Resolution, Post-Import Calculations.
 *
 * Test cases:
 * 1. Normal product (39652001) → Pricing Current
 * 2. All-zero pricing (39652002) → Pricing Pending
 * 3. Sale > regular (39652003) → Pricing Discrepancy
 * 4. Below cost (39652004) → Loss-Leader Review Pending
 * 5. Normal product (39652005) → Pricing Current
 * 6. Non-existent MPN → failed row
 */
"use strict";
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

// ── Firebase init (reuse seed pattern) ──
const keyJson = process.env.GCP_SA_KEY_DEV || process.env.SERVICE_ACCOUNT_JSON;
let app;
if (keyJson) {
  const credential = admin.credential.cert(JSON.parse(keyJson));
  app = admin.initializeApp({ credential, projectId: "ropi-aoss-dev" });
} else {
  app = admin.initializeApp({ projectId: "ropi-aoss-dev" });
}
const db = admin.firestore(app);

// ── apply99Rounding test ──
function apply99Rounding(calculatedPrice) {
  if (Math.round((calculatedPrice % 1) * 100) === 99) return calculatedPrice;
  return Math.floor(calculatedPrice) - 0.01;
}

async function main() {
  console.log("\n════════════════════════════════════════");
  console.log("  STEP 1.5 VERIFICATION");
  console.log("════════════════════════════════════════\n");

  // ── Test 1: apply99Rounding ──
  console.log("── Test: apply99Rounding() ──");
  const roundingTests = [
    { input: 85.00, expected: 84.99 },
    { input: 67.50, expected: 66.99 },
    { input: 84.99, expected: 84.99 },
    { input: 100.00, expected: 99.99 },
  ];
  for (const t of roundingTests) {
    const result = apply99Rounding(t.input);
    const pass = result === t.expected;
    console.log(`  apply99Rounding(${t.input}) → ${result} ${pass ? "✅" : `❌ expected ${t.expected}`}`);
  }

  // ── Upload test CSV ──
  console.log("\n── Test: Weekly Operations Upload ──");
  const API_BASE = "https://ropi-aoss-api-j4kyg7fb4a-uc.a.run.app";
  const csvPath = path.join(__dirname, "test-weekly-ops.csv");
  const csvBuffer = fs.readFileSync(csvPath);

  // Build multipart request
  const boundary = "----TestBoundary" + Date.now();
  const bodyParts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="test-weekly-ops.csv"\r\n`,
    `Content-Type: text/csv\r\n\r\n`,
    csvBuffer,
    `\r\n--${boundary}--\r\n`,
  ];

  // Concatenate into single Buffer
  const bodyBuffer = Buffer.concat(bodyParts.map(p => typeof p === 'string' ? Buffer.from(p) : p));

  const uploadRes = await fetch(`${API_BASE}/api/v1/imports/weekly-operations/upload`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(bodyBuffer.length),
    },
    body: bodyBuffer,
  });
  const uploadData = await uploadRes.json();
  console.log(`  Upload status: ${uploadRes.status}`);
  console.log(`  batch_id: ${uploadData.batch_id}`);
  console.log(`  row_count: ${uploadData.row_count}`);

  if (!uploadData.batch_id) {
    console.error("  ❌ Upload failed — cannot continue");
    console.log("  Response:", JSON.stringify(uploadData, null, 2));
    process.exit(1);
  }

  // ── Commit ──
  console.log("\n── Test: Weekly Operations Commit ──");
  const commitRes = await fetch(
    `${API_BASE}/api/v1/imports/weekly-operations/${uploadData.batch_id}/commit`,
    { method: "POST", headers: { "Content-Type": "application/json" } }
  );
  const commitData = await commitRes.json();
  console.log(`  Commit status: ${commitRes.status}`);
  console.log(`  Result: ${JSON.stringify(commitData, null, 2)}`);

  // ── Verify Firestore state for each test product ──
  console.log("\n── Firestore Verification ──");

  const testMpns = [
    { mpn: "39652001", expect: "should be Pricing Current" },
    { mpn: "39652002", expect: "should be Pricing Pending (all zeros)" },
    { mpn: "39652003", expect: "should be Pricing Discrepancy (sale > regular)" },
    { mpn: "39652004", expect: "should be Loss-Leader Review (below cost)" },
    { mpn: "39652005", expect: "should be Pricing Current" },
  ];

  for (const t of testMpns) {
    const docId = t.mpn.replace(/\//g, "__");
    const doc = await db.collection("products").doc(docId).get();
    if (!doc.exists) {
      console.log(`\n  ${t.mpn}: ❌ Product not found in Firestore`);
      continue;
    }
    const data = doc.data();
    console.log(`\n  ${t.mpn} (${t.expect}):`);
    console.log(`    pricing_domain_state: ${data.pricing_domain_state}`);
    console.log(`    rics_retail: ${data.rics_retail}, rics_offer: ${data.rics_offer}`);
    console.log(`    scom: ${data.scom}, scom_sale: ${data.scom_sale}`);
    console.log(`    store_gm_pct: ${data.store_gm_pct}, web_gm_pct: ${data.web_gm_pct}`);
    console.log(`    str_pct: ${data.str_pct}, wos: ${data.wos}`);
    console.log(`    is_slow_moving: ${data.is_slow_moving}`);
    console.log(`    is_loss_leader: ${data.is_loss_leader}`);
    console.log(`    is_map_constrained: ${data.is_map_constrained}`);

    // Check pricing_snapshots subcollection
    const snapshots = await db.collection("products").doc(docId)
      .collection("pricing_snapshots").orderBy("resolved_at", "desc").limit(1).get();
    if (snapshots.empty) {
      console.log(`    pricing_snapshots: ❌ No snapshots found`);
    } else {
      const snap = snapshots.docs[0].data();
      console.log(`    pricing_snapshots: ✅ Found (status: ${snap.pricing_domain_state})`);
      console.log(`      effective_store_regular: ${snap.effective_store_regular}`);
      console.log(`      effective_store_sale: ${snap.effective_store_sale}`);
      console.log(`      effective_web_regular: ${snap.effective_web_regular}`);
      console.log(`      effective_web_sale: ${snap.effective_web_sale}`);
      console.log(`      is_loss_leader: ${snap.is_loss_leader}`);
      console.log(`      cost: ${snap.cost}, cost_is_estimated: ${snap.cost_is_estimated}`);
      console.log(`      discrepancy_reasons: ${JSON.stringify(snap.discrepancy_reasons)}`);
    }
  }

  // ── Check audit_log entries ──
  console.log("\n── Audit Log Verification ──");

  // Query each event type separately to avoid composite index requirement
  for (const eventType of ["pricing_resolution", "pricing_discrepancy_flagged", "loss_leader_review_initiated"]) {
    const snap = await db.collection("audit_log")
      .where("event_type", "==", eventType)
      .limit(10)
      .get();
    console.log(`  ${eventType}: ${snap.size} entries`);
    for (const doc of snap.docs) {
      const d = doc.data();
      console.log(`    MPN: ${d.product_mpn} ${d.pricing_status ? `→ ${d.pricing_status}` : ""} ${d.reasons ? `reasons: ${JSON.stringify(d.reasons)}` : ""}`);
    }
  }

  // ── Check discrepancy reasons for 39652003 ──
  console.log("\n── Discrepancy Reasons for 39652003 ──");
  const discDoc = await db.collection("products").doc("39652003").get();
  if (discDoc.exists) {
    const data = discDoc.data();
    console.log(`  discrepancy_reasons: ${JSON.stringify(data.discrepancy_reasons || [])}`);
  }

  // ── Check loss_leader_payload for 39652004 ──
  console.log("\n── Loss-Leader Payload for 39652004 ──");
  const llDoc = await db.collection("products").doc("39652004").get();
  if (llDoc.exists) {
    const data = llDoc.data();
    console.log(`  loss_leader_payload: ${JSON.stringify(data.loss_leader_payload || null, null, 2)}`);
  }

  console.log("\n════════════════════════════════════════");
  console.log("  VERIFICATION COMPLETE");
  console.log("════════════════════════════════════════\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
