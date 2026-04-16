#!/usr/bin/env node
/**
 * TALLY-107 verification — two tests:
 *  (1) POST /complete on a complete product with valid pricing → pricing_domain_state = export_ready
 *  (2) POST /attributes/map with a MAP-active value → scom / scom_sale auto-populate to rics_retail
 */
"use strict";
const admin = require("firebase-admin");

const keyJson = process.env.GCP_SA_KEY_DEV || process.env.SERVICE_ACCOUNT_JSON;
let app;
if (keyJson) {
  app = admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(keyJson)),
    projectId: "ropi-aoss-dev",
  });
} else {
  app = admin.initializeApp({ projectId: "ropi-aoss-dev" });
}
const db = admin.firestore(app);

const API_BASE = "https://ropi-aoss-api-j4kyg7fb4a-uc.a.run.app";
const FIREBASE_API_KEY = "AIzaSyCWxHKfmKzIh3PLXimA1DAEObwUinE2gIU";

async function getAuthToken() {
  const uid = "tally107-test-" + Date.now();
  const customToken = await admin.auth().createCustomToken(uid);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!data.idToken) throw new Error("Failed to get ID token: " + JSON.stringify(data));
  return { idToken: data.idToken, uid };
}

async function main() {
  const { idToken, uid } = await getAuthToken();
  console.log("Acting as uid:", uid);

  // ── TEST 1 — Mark Complete sets export_ready ─────────────
  console.log("\n=== TEST 1: Mark Complete → export_ready ===");
  const TEST_MPN_1 = "CRY-SPR226-019";
  const docId1 = TEST_MPN_1.replace(/[\/\.#\$\[\]]/g, "_");

  // Reset product to incomplete and clear pricing state so we can re-complete
  await db.collection("products").doc(docId1).set(
    {
      completion_state: "incomplete",
      pricing_domain_state: "pending",
      scom: 49.99,
      scom_sale: 39.99,
    },
    { merge: true }
  );
  console.log("  Reset product:", docId1, "to incomplete + scom=49.99 / scom_sale=39.99 (no discrepancy)");

  const r1 = await fetch(`${API_BASE}/api/v1/products/${encodeURIComponent(TEST_MPN_1)}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const body1 = await r1.json();
  console.log("  POST /complete →", r1.status, JSON.stringify(body1));

  const post1 = (await db.collection("products").doc(docId1).get()).data();
  console.log(
    `  Firestore now: completion_state=${post1.completion_state} | pricing_domain_state=${post1.pricing_domain_state}`
  );
  const t1Pass =
    post1.completion_state === "complete" && post1.pricing_domain_state === "export_ready";
  console.log("  " + (t1Pass ? "✅ PASS" : "❌ FAIL"));

  // ── TEST 1b — Discrepancy branch (sale > regular) ───────
  console.log("\n=== TEST 1b: Discrepancy (sale > regular) → discrepancy state ===");
  await db.collection("products").doc(docId1).set(
    {
      completion_state: "incomplete",
      pricing_domain_state: "pending",
      scom: 20,
      scom_sale: 30,
      discrepancy_reasons: admin.firestore.FieldValue.delete(),
    },
    { merge: true }
  );
  const r1b = await fetch(`${API_BASE}/api/v1/products/${encodeURIComponent(TEST_MPN_1)}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const body1b = await r1b.json();
  console.log("  POST /complete →", r1b.status, JSON.stringify(body1b));
  const post1b = (await db.collection("products").doc(docId1).get()).data();
  console.log(
    `  Firestore now: pricing_domain_state=${post1b.pricing_domain_state} | discrepancy_reasons=${JSON.stringify(post1b.discrepancy_reasons)}`
  );
  const t1bPass =
    post1b.pricing_domain_state === "discrepancy" &&
    Array.isArray(post1b.discrepancy_reasons) &&
    post1b.discrepancy_reasons.length > 0;
  console.log("  " + (t1bPass ? "✅ PASS" : "❌ FAIL"));

  // Restore product to clean export_ready state
  await db.collection("products").doc(docId1).set(
    {
      completion_state: "complete",
      pricing_domain_state: "export_ready",
      scom: 49.99,
      scom_sale: 39.99,
      discrepancy_reasons: admin.firestore.FieldValue.delete(),
    },
    { merge: true }
  );

  // ── TEST 2 — MAP auto-populate ──────────────────────────
  console.log("\n=== TEST 2: MAP auto-populate ===");
  const TEST_MPN_2 = "206991-6SW";
  const docId2 = TEST_MPN_2.replace(/[\/\.#\$\[\]]/g, "_");
  const pre2 = (await db.collection("products").doc(docId2).get()).data();
  console.log(
    `  Before: scom=${pre2.scom} | scom_sale=${pre2.scom_sale} | rics_retail=${pre2.rics_retail}`
  );
  // Zero out scom first
  await db.collection("products").doc(docId2).set({ scom: 0, scom_sale: 0 }, { merge: true });

  const r2 = await fetch(
    `${API_BASE}/api/v1/products/${encodeURIComponent(TEST_MPN_2)}/attributes/map`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ value: "MAP" }),
    }
  );
  const body2 = await r2.json();
  console.log("  POST /attributes/map value=MAP →", r2.status);
  console.log("  map_auto_populate:", JSON.stringify(body2.map_auto_populate));

  const post2 = (await db.collection("products").doc(docId2).get()).data();
  console.log(
    `  After top-level: scom=${post2.scom} | scom_sale=${post2.scom_sale} | rics_retail=${post2.rics_retail}`
  );
  const scomAv = (
    await db
      .collection("products")
      .doc(docId2)
      .collection("attribute_values")
      .doc("scom")
      .get()
  ).data();
  const scomSaleAv = (
    await db
      .collection("products")
      .doc(docId2)
      .collection("attribute_values")
      .doc("scom_sale")
      .get()
  ).data();
  console.log(
    `  attribute_values.scom: value=${scomAv?.value} origin=${scomAv?.origin_type} state=${scomAv?.verification_state}`
  );
  console.log(
    `  attribute_values.scom_sale: value=${scomSaleAv?.value} origin=${scomSaleAv?.origin_type} state=${scomSaleAv?.verification_state}`
  );
  const t2Pass =
    post2.scom === pre2.rics_retail &&
    post2.scom_sale === pre2.rics_retail &&
    scomAv?.verification_state === "Human-Verified" &&
    (scomAv?.origin_detail || "").includes("MAP auto-populate");
  console.log("  " + (t2Pass ? "✅ PASS" : "❌ FAIL"));

  // ── TEST 2b — Non-MAP value should NOT auto-populate ───
  console.log("\n=== TEST 2b: map=NO should NOT auto-populate ===");
  await db.collection("products").doc(docId2).set({ scom: 0, scom_sale: 0 }, { merge: true });
  const r2b = await fetch(
    `${API_BASE}/api/v1/products/${encodeURIComponent(TEST_MPN_2)}/attributes/map`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ value: "NO" }),
    }
  );
  const body2b = await r2b.json();
  console.log("  POST /attributes/map value=NO →", r2b.status, "map_auto_populate:", JSON.stringify(body2b.map_auto_populate));
  const post2b = (await db.collection("products").doc(docId2).get()).data();
  console.log(`  After: scom=${post2b.scom} | scom_sale=${post2b.scom_sale}`);
  const t2bPass = post2b.scom === 0 && body2b.map_auto_populate?.triggered === false;
  console.log("  " + (t2bPass ? "✅ PASS" : "❌ FAIL"));

  console.log("\n─── Summary ───");
  console.log("Test 1 (complete→export_ready):", t1Pass ? "✅" : "❌");
  console.log("Test 1b (discrepancy branch):  ", t1bPass ? "✅" : "❌");
  console.log("Test 2 (MAP auto-populate):    ", t2Pass ? "✅" : "❌");
  console.log("Test 2b (non-MAP no-op):       ", t2bPass ? "✅" : "❌");

  process.exit(t1Pass && t1bPass && t2Pass && t2bPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
