#!/usr/bin/env node
/**
 * TALLY-118 Closing Verification — 6 Artifacts
 * 
 * Artifacts:
 *  1. Shiekh Men's Footwear template fires for Male product
 *  2. Shiekh Women's Footwear template fires for Female product
 *  3. Shiekh Default fires for non-gendered product
 *  4. Karmaloop Streetwear template fires for karmaloop site_owner
 *  5. MLTD Contemporary template fires for mltd site_owner
 *  6. FAQ JSON-LD schema present in Shiekh output
 * 
 * Uses existing MPNs from Firestore, seeds minimal attribute docs for gender
 * matching, then cleans up after.
 */
"use strict";

const admin = require("firebase-admin");

const keyJson = JSON.parse(process.env.GCP_SA_KEY_DEV);
const app = admin.initializeApp({
  credential: admin.credential.cert(keyJson),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore(app);

const API_BASE = "https://ropi-aoss-api-j4kyg7fb4a-uc.a.run.app";
const FIREBASE_API_KEY = "AIzaSyCWxHKfmKzIh3PLXimA1DAEObwUinE2gIU";

// Use 3 distinct MPNs for the test (all are in Firestore from the import)
const MPN_MALE   = "1006302";   // will seed Male gender attr
const MPN_FEMALE = "1006303";   // will seed Female gender attr
const MPN_NEUTRAL= "1031309";   // no gender attr → Shiekh Default

async function getAuthToken() {
  const uid = "tally118-verify-" + Date.now();
  const customToken = await admin.auth().createCustomToken(uid, { role: "admin" });
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
  );
  const data = await res.json();
  if (!data.idToken) throw new Error("Token error: " + JSON.stringify(data));
  return data.idToken;
}

async function seedAttrs(mpn, genderValue) {
  const docId = mpn.replace(/[/.#$[\]]/g, "_");
  const col = db.collection("products").doc(docId).collection("attribute_values");
  await col.doc("gender").set({
    value: genderValue,
    origin_type: "RO-Import",
    verification_state: "Human-Verified",
    seeded_by_test: true,
  });
  await col.doc("department").set({
    value: "Footwear",
    origin_type: "RO-Import",
    verification_state: "Human-Verified",
    seeded_by_test: true,
  });
}

async function removeTestAttrs(mpn) {
  const docId = mpn.replace(/[/.#$[\]]/g, "_");
  const col = db.collection("products").doc(docId).collection("attribute_values");
  const snap = await col.where("seeded_by_test", "==", true).get();
  const deletes = snap.docs.map(d => d.ref.delete());
  await Promise.all(deletes);
}

async function callAiDescribe(token, mpn, siteOwners) {
  const res = await fetch(`${API_BASE}/api/v1/products/${mpn}/ai-describe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify({ site_owners: siteOwners }),
  });
  return res.json();
}

function checkResult(label, r, expectedTemplate, checkFaq = false) {
  const result = Array.isArray(r?.results) ? r.results[0] : r;
  const templateName = result?.template_name || "N/A";
  const desc = result?.parsed_output?.description || result?.parsed_output?.hero_hook || "";
  const hasFaq = desc.includes("application/ld+json");
  
  const templateMatch = templateName === expectedTemplate;
  const faqOk = !checkFaq || hasFaq;
  const hasContent = desc.length > 50;
  
  const status = (templateMatch && faqOk && hasContent) ? "✅ PASS" : "❌ FAIL";
  
  console.log(`\n[${status}] ${label}`);
  console.log(`  Expected template : "${expectedTemplate}"`);
  console.log(`  Got template      : "${templateName}"`);
  if (checkFaq) console.log(`  FAQ JSON-LD       : ${hasFaq ? "✅ present" : "❌ missing"}`);
  console.log(`  Content generated : ${hasContent ? `✅ ${desc.length} chars` : "❌ empty"}`);
  if (desc.length > 0) {
    console.log(`  First 180 chars   : ${desc.substring(0, 180).replace(/\n/g, " ")}`);
  }
  if (r?.error) console.log(`  API error: ${r.error}`);
  
  return { pass: templateMatch && faqOk && hasContent, templateName, hasFaq, descLength: desc.length };
}

async function main() {
  console.log("════════════════════════════════════════════");
  console.log("  TALLY-118 Closing Verification (6 Artifacts)");
  console.log("════════════════════════════════════════════\n");

  // 1. Auth token
  console.log("🔑 Getting auth token...");
  const token = await getAuthToken();
  console.log("✅ Token obtained\n");

  // 2. Seed gender attributes for Male and Female test products
  console.log("🌱 Seeding test gender+department attributes...");
  await seedAttrs(MPN_MALE, "Male");
  await seedAttrs(MPN_FEMALE, "Female");
  // Ensure neutral product has no test attrs
  await removeTestAttrs(MPN_NEUTRAL).catch(() => {});
  console.log(`  ${MPN_MALE} → gender=Male, department=Footwear`);
  console.log(`  ${MPN_FEMALE} → gender=Female, department=Footwear`);
  console.log(`  ${MPN_NEUTRAL} → no seeded attrs (Shiekh Default expected)\n`);

  const allResults = [];

  // ── ARTIFACT 1: Shiekh Men's Footwear ──
  console.log("━━ ARTIFACT 1 ━━");
  console.log(`POST /products/${MPN_MALE}/ai-describe  site_owners=["shiekh"]`);
  const r1 = await callAiDescribe(token, MPN_MALE, ["shiekh"]);
  allResults.push({ n: 1, label: "Shiekh Male → Men's Footwear",  ...checkResult("Shiekh Male → Men's Footwear", r1, "Shiekh Men's Footwear", true) });

  // ── ARTIFACT 2: Shiekh Women's Footwear ──
  console.log("\n━━ ARTIFACT 2 ━━");
  console.log(`POST /products/${MPN_FEMALE}/ai-describe  site_owners=["shiekh"]`);
  const r2 = await callAiDescribe(token, MPN_FEMALE, ["shiekh"]);
  allResults.push({ n: 2, label: "Shiekh Female → Women's Footwear", ...checkResult("Shiekh Female → Women's Footwear", r2, "Shiekh Women's Footwear", true) });

  // ── ARTIFACT 3: Shiekh Default (no gender) ──
  console.log("\n━━ ARTIFACT 3 ━━");
  console.log(`POST /products/${MPN_NEUTRAL}/ai-describe  site_owners=["shiekh"]`);
  const r3 = await callAiDescribe(token, MPN_NEUTRAL, ["shiekh"]);
  allResults.push({ n: 3, label: "Shiekh Neutral → Default", ...checkResult("Shiekh Neutral → Default", r3, "Shiekh Default", true) });

  // ── ARTIFACT 4: Karmaloop Streetwear ──
  console.log("\n━━ ARTIFACT 4 ━━");
  console.log(`POST /products/${MPN_MALE}/ai-describe  site_owners=["karmaloop"]`);
  const r4 = await callAiDescribe(token, MPN_MALE, ["karmaloop"]);
  allResults.push({ n: 4, label: "Karmaloop → Streetwear template", ...checkResult("Karmaloop → Streetwear template", r4, "Karmaloop Streetwear", false) });

  // ── ARTIFACT 5: MLTD Contemporary ──
  console.log("\n━━ ARTIFACT 5 ━━");
  console.log(`POST /products/${MPN_MALE}/ai-describe  site_owners=["mltd"]`);
  const r5 = await callAiDescribe(token, MPN_MALE, ["mltd"]);
  allResults.push({ n: 5, label: "MLTD → Contemporary template", ...checkResult("MLTD → Contemporary template", r5, "MLTD Contemporary", false) });

  // ── ARTIFACT 6: FAQ JSON-LD in Shiekh output (already checked in 1-3, do dedicated check) ──
  console.log("\n━━ ARTIFACT 6 ━━");
  const result3 = Array.isArray(r3?.results) ? r3.results[0] : r3;
  const desc3 = result3?.parsed_output?.description || "";
  const hasFaqSchema = desc3.includes("application/ld+json");
  const hasFaqType = desc3.includes('"@type":"FAQPage"') || desc3.includes('"@type": "FAQPage"');
  console.log(`  FAQ JSON-LD block present: ${hasFaqSchema ? "✅ yes" : "❌ no"}`);
  console.log(`  @type FAQPage present:     ${hasFaqType ? "✅ yes" : "❌ no"}`);
  allResults.push({ n: 6, label: "FAQ JSON-LD schema in Shiekh output", pass: hasFaqSchema });

  // ── CLEANUP ──
  console.log("\n\n🧹 Cleaning up seeded attributes...");
  await removeTestAttrs(MPN_MALE);
  await removeTestAttrs(MPN_FEMALE);
  console.log("  Done.\n");

  // ── FINAL SCORECARD ──
  const passed = allResults.filter(r => r.pass).length;
  const total = allResults.length;
  console.log("════════════════════════════════════════════");
  console.log(`  FINAL SCORECARD: ${passed}/${total} passed`);
  console.log("════════════════════════════════════════════");
  for (const a of allResults) {
    console.log(`  ${a.pass ? "✅" : "❌"} #${a.n}: ${a.label}`);
  }
  console.log("");
  if (passed === total) {
    console.log("🎉 ALL ARTIFACTS PASSED — TALLY-118 Step 2.3 COMPLETE");
  } else {
    console.log(`⚠️  ${total - passed} artifact(s) failed. See details above.`);
    process.exitCode = 1;
  }

  await app.delete();
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
