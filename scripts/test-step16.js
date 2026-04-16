#!/usr/bin/env node
/**
 * Step 1.6 Verification Script
 * Tests Buyer Review endpoints and buyer actions.
 */
"use strict";
const admin = require("firebase-admin");
const keyJson = process.env.GCP_SA_KEY_DEV || process.env.SERVICE_ACCOUNT_JSON;
let app;
if (keyJson) {
  const credential = admin.credential.cert(JSON.parse(keyJson));
  app = admin.initializeApp({ credential, projectId: "ropi-aoss-dev" });
} else {
  app = admin.initializeApp({ projectId: "ropi-aoss-dev" });
}
const db = admin.firestore(app);

const API_BASE = "https://ropi-aoss-api-j4kyg7fb4a-uc.a.run.app";

// .99 rounding
function apply99Rounding(price) {
  if (price <= 0 || price < 1) return price;
  if (Math.round((price % 1) * 100) === 99) return price;
  return Math.floor(price) - 0.01;
}

async function main() {
  console.log("\n════════════════════════════════════════");
  console.log("  STEP 1.6 VERIFICATION");
  console.log("════════════════════════════════════════\n");

  // ── Ensure test product 39652001 is in the right state ──
  console.log("── Setup: Ensure test products are in buyer-review-eligible state ──");
  const testMpn = "39652001";
  const testMpn2 = "39652005";
  
  // Set both to Pricing Current + complete for buyer review eligibility
  for (const mpn of [testMpn, testMpn2]) {
    await db.collection("products").doc(mpn).set({
      pricing_domain_state: "Pricing Current",
      completion_state: "complete",
      pricing_resolved_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`  ${mpn} → Pricing Current + complete ✅`);
  }
  // Brief pause for consistency
  await new Promise(r => setTimeout(r, 1000));

  // ── Test 1: GET /api/v1/buyer-review ──
  console.log("\n── Test 1: GET /api/v1/buyer-review ──");
  const reviewRes = await fetch(`${API_BASE}/api/v1/buyer-review`);
  const reviewData = await reviewRes.json();
  console.log(`  Status: ${reviewRes.status}`);
  console.log(`  Total items: ${reviewData.total}`);
  
  if (reviewData.items && reviewData.items.length > 0) {
    const item = reviewData.items[0];
    console.log(`  First item MPN: ${item.mpn}`);
    console.log(`  Has recommendation: ${!!item.recommendation} ✅`);
    console.log(`  recommendation.pct: ${item.recommendation?.pct}`);
    console.log(`  recommendation.new_rics_offer: ${item.recommendation?.new_rics_offer}`);
    console.log(`  recommendation.export_price: ${item.recommendation?.export_price}`);
    console.log(`  recommendation.rule_name: ${item.recommendation?.rule_name}`);
    console.log(`  Has KPIs: str_pct=${item.str_pct}, wos=${item.wos}, store_gm_pct=${item.store_gm_pct}`);
    console.log(`  Has site_targets: ${JSON.stringify(item.site_targets)}`);
    console.log(`  is_loss_leader: ${item.is_loss_leader}`);
    console.log(`  days_in_queue: ${item.days_in_queue}`);
    
    // Verify .99 rounding: apply99Rounding(72.2415) should = 71.99
    const expectedExport = apply99Rounding(item.rics_retail * 0.85);
    console.log(`  .99 rounding check: apply99Rounding(${(item.rics_retail * 0.85).toFixed(4)}) = ${expectedExport} ${expectedExport === item.recommendation?.export_price ? "✅" : "❌"}`);
  } else {
    console.log("  ⚠️  No items returned (might need products with Pricing Current + complete)");
  }

  // ── Test 2: GET /api/v1/buyer-review/price-projection/:mpn ──
  console.log("\n── Test 2: GET /api/v1/buyer-review/price-projection/:mpn ──");
  const projRes = await fetch(`${API_BASE}/api/v1/buyer-review/price-projection/${testMpn}`);
  const projData = await projRes.json();
  console.log(`  Status: ${projRes.status}`);
  console.log(`  MPN: ${projData.mpn}`);
  console.log(`  Cost: ${projData.cost} (estimated: ${projData.cost_is_estimated})`);
  console.log(`  Steps: ${projData.steps?.length}`);
  if (projData.steps) {
    for (const s of projData.steps) {
      console.log(`    Step ${s.step}: ${s.label} → offer=${s.rics_offer}, export=${s.export_price}, gm=${s.gm_pct}%, below_cost=${s.is_below_cost}`);
    }
  }

  // ── Test 3: POST /api/v1/buyer-actions/markdown (approve) ──
  console.log("\n── Test 3: POST /api/v1/buyer-actions/markdown (approve) ──");
  const approveRes = await fetch(`${API_BASE}/api/v1/buyer-actions/markdown`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mpn: testMpn, action_type: "approve" }),
  });
  const approveData = await approveRes.json();
  console.log(`  Status: ${approveRes.status}`);
  console.log(`  Result: ${JSON.stringify(approveData)}`);
  
  // Check product state changed
  const afterApprove = await db.collection("products").doc(testMpn).get();
  const afterApproveData = afterApprove.data();
  console.log(`  Product state after approve: ${afterApproveData.pricing_domain_state} ${afterApproveData.pricing_domain_state === "export_ready" ? "✅" : "❌"}`);
  
  // Check buyer_actions document
  const actionsSnap = await db.collection("buyer_actions")
    .where("mpn", "==", testMpn)
    .limit(1).get();
  console.log(`  buyer_actions doc created: ${!actionsSnap.empty ? "✅" : "❌"}`);
  if (!actionsSnap.empty) {
    const actionData = actionsSnap.docs[0].data();
    console.log(`    action_type: ${actionData.action_type}`);
    console.log(`    export_rics_offer: ${actionData.export_rics_offer}`);
  }

  // ── Test 4: Reset and test deny ──
  console.log("\n── Test 4: POST /api/v1/buyer-actions/markdown (deny) ──");
  await db.collection("products").doc(testMpn2).set({
    pricing_domain_state: "Pricing Current",
    completion_state: "complete",
  }, { merge: true });
  
  const denyRes = await fetch(`${API_BASE}/api/v1/buyer-actions/markdown`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mpn: testMpn2, action_type: "deny" }),
  });
  const denyData = await denyRes.json();
  console.log(`  Status: ${denyRes.status}`);
  console.log(`  Result: ${JSON.stringify(denyData)}`);
  
  const afterDeny = await db.collection("products").doc(testMpn2).get();
  console.log(`  Product state after deny: ${afterDeny.data().pricing_domain_state} ${afterDeny.data().pricing_domain_state === "buyer_denied" ? "✅" : "❌"}`);

  // ── Test 5: Test adjust with effective date ──
  console.log("\n── Test 5: POST /api/v1/buyer-actions/markdown (adjust + effective date) ──");
  // Reset product first
  await db.collection("products").doc(testMpn).set({
    pricing_domain_state: "Pricing Current",
    completion_state: "complete",
  }, { merge: true });
  await new Promise(r => setTimeout(r, 500));
  
  const adjustRes = await fetch(`${API_BASE}/api/v1/buyer-actions/markdown`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mpn: testMpn,
      action_type: "adjust",
      adjustment: { type: "pct", value: 20, effective_date: "2026-05-01" },
    }),
  });
  const adjustData = await adjustRes.json();
  console.log(`  Status: ${adjustRes.status}`);
  console.log(`  Result: ${JSON.stringify(adjustData)}`);
  
  const afterAdjust = await db.collection("products").doc(testMpn).get();
  console.log(`  Product state after adjust+date: ${afterAdjust.data().pricing_domain_state} ${afterAdjust.data().pricing_domain_state === "scheduled" ? "✅" : "❌"}`);

  // ── Test 6: Loss-leader acknowledge ──
  console.log("\n── Test 6: POST /api/v1/buyer-actions/loss-leader-acknowledge ──");
  await db.collection("products").doc("39652004").set({
    pricing_domain_state: "Loss-Leader Review Pending",
  }, { merge: true });
  await new Promise(r => setTimeout(r, 500));
  
  const ackRes = await fetch(`${API_BASE}/api/v1/buyer-actions/loss-leader-acknowledge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mpn: "39652004", reason: "Clearance item — must move inventory before season end, accepted negative margin" }),
  });
  const ackData = await ackRes.json();
  console.log(`  Status: ${ackRes.status}`);
  console.log(`  Result: ${JSON.stringify(ackData)}`);
  
  // Test short reason validation
  const shortRes = await fetch(`${API_BASE}/api/v1/buyer-actions/loss-leader-acknowledge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mpn: "39652004", reason: "ok" }),
  });
  const shortData = await shortRes.json();
  console.log(`  Short reason rejected: ${shortRes.status === 400 ? "✅" : "❌"} (status ${shortRes.status})`);

  // ── Test 7: Loss-leader veto ──
  console.log("\n── Test 7: POST /api/v1/buyer-actions/loss-leader-veto ──");
  const vetoRes = await fetch(`${API_BASE}/api/v1/buyer-actions/loss-leader-veto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mpn: "39652004", veto_reason: "Margin too negative — return to vendor instead" }),
  });
  const vetoData = await vetoRes.json();
  console.log(`  Status: ${vetoRes.status}`);
  console.log(`  Result: ${JSON.stringify(vetoData)}`);
  
  const afterVeto = await db.collection("products").doc("39652004").get();
  console.log(`  Product state after veto: ${afterVeto.data().pricing_domain_state} ${afterVeto.data().pricing_domain_state === "loss_leader_vetoed" ? "✅" : "❌"}`);

  // ── Audit log check ──
  console.log("\n── Audit Log Verification ──");
  const auditSnap = await db.collection("audit_log")
    .where("event_type", "==", "buyer_action")
    .limit(5).get();
  console.log(`  buyer_action audit entries: ${auditSnap.size}`);
  for (const doc of auditSnap.docs) {
    const d = doc.data();
    console.log(`    MPN: ${d.product_mpn}, action: ${d.action_type}`);
  }

  // ── Reset test products ──
  console.log("\n── Cleanup: Reset test products ──");
  for (const mpn of [testMpn, testMpn2]) {
    await db.collection("products").doc(mpn).set({
      pricing_domain_state: "Pricing Current",
      completion_state: "complete",
    }, { merge: true });
  }
  console.log("  Reset complete ✅");

  console.log("\n════════════════════════════════════════");
  console.log("  STEP 1.6 VERIFICATION COMPLETE");
  console.log("════════════════════════════════════════\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
