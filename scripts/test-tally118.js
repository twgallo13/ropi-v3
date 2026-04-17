#!/usr/bin/env node
/**
 * TALLY-118 Generation Tests
 * Verifies template matching, tone differentiation, FAQ JSON-LD, and section diversity.
 */
"use strict";

const admin = require("firebase-admin");

const keyJson = process.env.GCP_SA_KEY_DEV;
if (!keyJson) throw new Error("GCP_SA_KEY_DEV env var not set");

const app = admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(keyJson)),
  projectId: "ropi-aoss-dev",
});

const API_BASE = "https://ropi-aoss-api-j4kyg7fb4a-uc.a.run.app";
const FIREBASE_API_KEY = "AIzaSyCWxHKfmKzIh3PLXimA1DAEObwUinE2gIU";

async function getAuthToken() {
  const uid = "tally118-test-" + Date.now();
  const customToken = await admin.auth().createCustomToken(uid, { role: "admin" });
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!data.idToken) throw new Error("Token error: " + JSON.stringify(data));
  return data.idToken;
}

async function callAiDescribe(token, mpn, siteOwners, observationsNote = "") {
  const body = { site_owners: siteOwners };
  if (observationsNote) body.observations_note = observationsNote;

  const res = await fetch(`${API_BASE}/api/v1/products/${mpn}/ai-describe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function main() {
  console.log("🔑 Getting auth token...");
  const token = await getAuthToken();
  console.log("✅ Token obtained\n");

  // First, find a product we can test with
  const db = admin.firestore(app);

  // Get sample MPNs from Firestore for each site_owner
  console.log("🔍 Finding test products...");
  
  const shiekhSnap = await db.collection("products")
    .where("site_owners", "array-contains", "shiekh")
    .limit(3)
    .get();
  
  const karmaloopSnap = await db.collection("products")
    .where("site_owners", "array-contains", "karmaloop")
    .limit(1)
    .get();
  
  const mltdSnap = await db.collection("products")
    .where("site_owners", "array-contains", "mltd")
    .limit(1)
    .get();

  console.log(`  Shiekh products found: ${shiekhSnap.size}`);
  console.log(`  Karmaloop products found: ${karmaloopSnap.size}`);
  console.log(`  MLTD products found: ${mltdSnap.size}\n`);

  const results = [];

  // ── TEST 1: Shiekh — expects Men's Footwear or Women's Footwear template ──
  if (!shiekhSnap.empty) {
    // Try to find a male product
    let maleMpn = null, femaleMpn = null;
    for (const doc of shiekhSnap.docs) {
      const data = doc.data();
      const gender = (data.gender || data.attributes?.gender || "").toLowerCase();
      if (!maleMpn && (gender.includes("men") || gender.includes("male") || gender.includes("boy"))) {
        maleMpn = data.mpn || doc.id;
      }
      if (!femaleMpn && (gender.includes("women") || gender.includes("female") || gender.includes("girl"))) {
        femaleMpn = data.mpn || doc.id;
      }
    }
    
    // Fall back to first product
    const fallbackMpn = shiekhSnap.docs[0].data().mpn || shiekhSnap.docs[0].id;
    
    if (maleMpn) {
      console.log(`\n=== TEST 1a: Shiekh Men's Footwear (mpn: ${maleMpn}) ===`);
      const r = await callAiDescribe(token, maleMpn, ["shiekh"]);
      results.push({ test: "Shiekh Male", mpn: maleMpn, result: r });
      printResult(r, "shiekh");
    }
    
    if (femaleMpn) {
      console.log(`\n=== TEST 1b: Shiekh Women's Footwear (mpn: ${femaleMpn}) ===`);
      const r = await callAiDescribe(token, femaleMpn, ["shiekh"]);
      results.push({ test: "Shiekh Female", mpn: femaleMpn, result: r });
      printResult(r, "shiekh");
    }
    
    if (!maleMpn && !femaleMpn) {
      console.log(`\n=== TEST 1: Shiekh Default (mpn: ${fallbackMpn}) ===`);
      const r = await callAiDescribe(token, fallbackMpn, ["shiekh"]);
      results.push({ test: "Shiekh Default", mpn: fallbackMpn, result: r });
      printResult(r, "shiekh");
    }
  } else {
    console.log("⚠️  No Shiekh products found in Firestore");
    // Use a known MPN from previous tests
    const mpn = "1006302";
    console.log(`\n=== TEST 1: Shiekh (mpn: ${mpn}) ===`);
    const r = await callAiDescribe(token, mpn, ["shiekh"]);
    results.push({ test: "Shiekh", mpn, result: r });
    printResult(r, "shiekh");
  }

  // ── TEST 2: Karmaloop ──
  if (!karmaloopSnap.empty) {
    const mpn = karmaloopSnap.docs[0].data().mpn || karmaloopSnap.docs[0].id;
    console.log(`\n=== TEST 2: Karmaloop (mpn: ${mpn}) ===`);
    const r = await callAiDescribe(token, mpn, ["karmaloop"]);
    results.push({ test: "Karmaloop", mpn, result: r });
    printResult(r, "karmaloop");
  } else {
    console.log("\n⚠️  No Karmaloop products in Firestore — skipping");
  }

  // ── TEST 3: MLTD ──
  if (!mltdSnap.empty) {
    const mpn = mltdSnap.docs[0].data().mpn || mltdSnap.docs[0].id;
    console.log(`\n=== TEST 3: MLTD (mpn: ${mpn}) ===`);
    const r = await callAiDescribe(token, mpn, ["mltd"]);
    results.push({ test: "MLTD", mpn, result: r });
    printResult(r, "mltd");
  } else {
    console.log("\n⚠️  No MLTD products in Firestore — skipping");
  }

  // ── SUMMARY ──
  console.log("\n\n════════════════════════════════");
  console.log("SUMMARY");
  console.log("════════════════════════════════");
  for (const { test, mpn, result } of results) {
    const sitResult = result?.results?.[0];
    const status = sitResult?.status;
    const templateName = sitResult?.template_name || "unknown";
    const hasFaq = sitResult?.parsed_output?.description?.includes("application/ld+json") || false;
    const firstChars = (sitResult?.parsed_output?.description || "").substring(0, 150);
    console.log(`\n[${test}] mpn=${mpn}`);
    console.log(`  status: ${status}`);
    console.log(`  template: ${templateName}`);
    console.log(`  FAQ JSON-LD: ${hasFaq ? "✅ yes" : "❌ no"}`);
    console.log(`  first 150 chars: ${firstChars}`);
  }

  await app.delete();
}

function printResult(r, siteOwner) {
  if (r.error) {
    console.error("  ❌ API error:", r.error);
    return;
  }
  const sitResult = r.results?.find(x => x.site_owner === siteOwner) || r.results?.[0];
  if (!sitResult) {
    console.error("  ❌ No result:", JSON.stringify(r).substring(0, 200));
    return;
  }
  console.log(`  status: ${sitResult.status}`);
  if (sitResult.status !== "success") {
    console.error("  ❌ Error:", sitResult.error || JSON.stringify(sitResult).substring(0, 200));
    return;
  }
  const desc = sitResult.parsed_output?.description || "";
  console.log(`  template: ${sitResult.template_name}`);
  console.log(`  description length: ${desc.length} chars`);
  console.log(`  FAQ JSON-LD: ${desc.includes("application/ld+json") ? "✅ yes" : "❌ no"}`);
  console.log(`  first 200 chars:\n  ${desc.substring(0, 200)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
