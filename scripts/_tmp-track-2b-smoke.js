// Track 2B smoke: verification_rollup_state field + spot-checks.
const admin = require("/workspaces/ropi-v3/backend/functions/node_modules/firebase-admin");
const fs = require("fs");

const sa = JSON.parse(fs.readFileSync("/tmp/sa-dev.json", "utf8"));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: "ropi-aoss-dev" });

const API_BASE = "https://ropi-aoss-api-719351392467.us-central1.run.app";
const FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY || "AIzaSyCWxHKfmKzIh3PLXimA1DAEObwUinE2gIU";

async function getAdminIdToken() {
  const uid = "track-2b-smoke-bot";
  await admin.auth().createUser({ uid, email: "track-2b-bot@ropi.dev" }).catch(() => {});
  await admin.firestore().collection("users").doc(uid).set(
    { email: "track-2b-bot@ropi.dev", role: "admin" },
    { merge: true }
  );
  const ct = await admin.auth().createCustomToken(uid, { role: "admin" });
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: ct, returnSecureToken: true }),
    }
  );
  const d = await r.json();
  if (!d.idToken) throw new Error("Auth failed: " + JSON.stringify(d));
  return d.idToken;
}

(async () => {
  const token = await getAdminIdToken();
  const url = `${API_BASE}/api/v1/buyer-review?limit=100`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  console.log(`HTTP ${r.status}`);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { console.error("non-json:", text.slice(0, 500)); process.exit(1); }
  const items = body.items || [];
  console.log(`items.length=${items.length} total=${body.total}`);

  // T1
  const t1 = items[0] && Object.prototype.hasOwnProperty.call(items[0], "verification_rollup_state");
  console.log(`\nT1 — has(verification_rollup_state) on items[0]: ${t1}`);

  // Distribution
  const dist = items.reduce((acc, i) => {
    const v = i.verification_rollup_state;
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});
  console.log(`T1b — rollup distribution: ${JSON.stringify(dist)}`);

  // T2 — find a "live" candidate and verify
  const live = items.find((i) => i.verification_rollup_state === "live");
  if (live) {
    const liveSites = Object.entries(live.site_verification || {})
      .filter(([, v]) => v.verification_state === "verified_live")
      .map(([k]) => k);
    console.log(`T2 — sample LIVE mpn=${live.mpn} verified_live_sites=${JSON.stringify(liveSites)}`);
    // Verify by reading site_targets directly from Firestore
    const docId = live.mpn; // simple case; mpnToDocId may differ
    // Try direct lookup
    const candidates = await admin.firestore().collection("products").where("mpn", "==", live.mpn).limit(1).get();
    if (!candidates.empty) {
      const stSnap = await candidates.docs[0].ref.collection("site_targets").get();
      const targets = stSnap.docs.map(d => ({ id: d.id, active: d.data().active, site_id: d.data().site_id }));
      console.log(`T2b — site_targets for mpn=${live.mpn}: ${JSON.stringify(targets)}`);
      const intersection = targets
        .filter(t => t.active !== false)
        .map(t => t.site_id || t.id)
        .filter(k => liveSites.includes(k));
      console.log(`T2c — intersection (active target ∩ verified_live): ${JSON.stringify(intersection)}`);
      console.log(`T2 PASS: ${intersection.length > 0 ? "YES" : "NO"}`);
    }
  } else {
    console.log("T2 — no LIVE rows in payload");
  }

  // T3 — find an "unverified" candidate and verify
  const unv = items.find((i) => i.verification_rollup_state === "unverified");
  if (unv) {
    const liveSites = Object.entries(unv.site_verification || {})
      .filter(([, v]) => v.verification_state === "verified_live")
      .map(([k]) => k);
    const candidates = await admin.firestore().collection("products").where("mpn", "==", unv.mpn).limit(1).get();
    let targetIds = [];
    if (!candidates.empty) {
      const stSnap = await candidates.docs[0].ref.collection("site_targets").get();
      targetIds = stSnap.docs
        .filter(d => d.data().active !== false)
        .map(d => d.data().site_id || d.id);
    }
    const intersection = targetIds.filter(k => liveSites.includes(k));
    console.log(`\nT3 — sample UNVERIFIED mpn=${unv.mpn} active_targets=${JSON.stringify(targetIds)} verified_live=${JSON.stringify(liveSites)} intersection=${JSON.stringify(intersection)}`);
    console.log(`T3 PASS (intersection empty): ${intersection.length === 0 ? "YES" : "NO"}`);
  } else {
    console.log("\nT3 — no UNVERIFIED rows in payload");
  }

  // T4 — site_verification + primary_site_key still present
  const t4a = items[0] && Object.prototype.hasOwnProperty.call(items[0], "site_verification");
  const t4b = items[0] && Object.prototype.hasOwnProperty.call(items[0], "primary_site_key");
  console.log(`\nT4 — site_verification present: ${t4a} | primary_site_key present: ${t4b}`);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
