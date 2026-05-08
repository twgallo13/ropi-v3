// Track 1B smoke: 3 GET /api/v1/active-overrides probes.
const admin = require("/workspaces/ropi-v3/backend/functions/node_modules/firebase-admin");
const fs = require("fs");

const sa = JSON.parse(fs.readFileSync("/tmp/sa-dev.json", "utf8"));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: "ropi-aoss-dev" });

const API_BASE = "https://ropi-aoss-api-719351392467.us-central1.run.app";
const FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY || "AIzaSyCWxHKfmKzIh3PLXimA1DAEObwUinE2gIU";

async function getAdminIdToken() {
  const uid = "track-1b-smoke-bot";
  await admin.auth().createUser({ uid, email: "track-1b-bot@ropi.dev" }).catch(() => {});
  await admin.firestore().collection("users").doc(uid).set(
    { email: "track-1b-bot@ropi.dev", role: "admin" },
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

async function probe(label, qs, token) {
  const url = `${API_BASE}/api/v1/review/active-overrides${qs}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const status = r.status;
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  const total = body && typeof body === "object" ? body.total : "(non-json)";
  const itemsLen = body && Array.isArray(body.items) ? body.items.length : "(n/a)";
  console.log(`${label}: status=${status} total=${total} items.length=${itemsLen}`);
  return { label, status, total, itemsLen };
}

(async () => {
  const token = await getAdminIdToken();
  console.log("▶ Token minted; running 3 probes against", API_BASE);
  const r1 = await probe("Test 1 (no params)         ", "", token);
  const r2 = await probe("Test 2 (explicit no-op)    ", "?days_min=0&sales_max=9999999&inventory_min=-1", token);
  const r3 = await probe("Test 3 (restrictive)       ", "?days_min=30&sales_max=1&inventory_min=1", token);
  console.log("\nSummary JSON:", JSON.stringify({ r1, r2, r3 }, null, 2));
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
