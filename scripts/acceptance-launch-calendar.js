/**
 * Step 2.4 Acceptance Artifacts — Launch Calendar.
 *
 * Produces four artifacts:
 *   1. Full launch_records document with all fields populated.
 *   2. GET /api/v1/launches/public response (confirms no internal fields leak).
 *   3. POST /:id/publish BLOCKED response (missing token_status, image, etc.).
 *   4. POST /:id/publish SUCCESS response (launch_status: published).
 *
 * Usage: node scripts/acceptance-launch-calendar.js
 *
 * Requires env: GCP_SA_KEY_DEV, FIREBASE_API_KEY.
 */
const admin = require("./seed/node_modules/firebase-admin");
const fs = require("fs");
const path = require("path");

const API_BASE = "https://ropi-aoss-api-j4kyg7fb4a-uc.a.run.app";

// Load .env
const envPath = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) {
      const k = t.substring(0, eq).trim();
      const v = t.substring(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY || "AIzaSyCWxHKfmKzIh3PLXimA1DAEObwUinE2gIU";
const PROJECT = "ropi-aoss-dev";

const sa = JSON.parse(process.env.GCP_SA_KEY_DEV);
admin.initializeApp({
  credential: admin.credential.cert(sa),
  projectId: PROJECT,
});

const db = admin.firestore();

async function getAdminIdToken() {
  // Mint an ID token for the SA via custom token exchange
  // Use a known admin test user uid. If none exists, pick the first admin.
  const usersSnap = await db.collection("users").where("role", "==", "admin").limit(1).get();
  if (usersSnap.empty) {
    throw new Error("No admin users found in users collection");
  }
  const uid = usersSnap.docs[0].id;
  const customToken = await admin.auth().createCustomToken(uid, {
    admin: true,
    role: "admin",
  });
  // Exchange custom token for ID token
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error("Token exchange failed: " + JSON.stringify(data));
  return data.idToken;
}

async function api(path, method = "GET", body, idToken) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, body: data };
}

async function main() {
  console.log("🚀 Step 2.4 Acceptance — Launch Calendar\n");
  const idToken = await getAdminIdToken();
  console.log("✅ Obtained admin ID token\n");

  // ── Artifact 1: Create a launch with all fields populated ──────────────
  const launchDate = new Date();
  launchDate.setDate(launchDate.getDate() + 5); // 5 days out → qualifies for High Priority
  const launchDateStr = launchDate.toISOString().substring(0, 10);

  console.log("── Step 1: Create launch record ──");
  const createRes = await api(
    "/api/v1/launches",
    "POST",
    {
      mpn: "SHIEKH-ACCEPTANCE-001",
      mpn_is_placeholder: false,
      product_name: "Acceptance Test Launch",
      brand: "Shiekh",
      launch_date: launchDateStr,
      sales_channel: "Online",
      drawing_fcfs: "FCFS",
      gender: "Men",
      category: "Footwear",
      class: "Sneaker",
      primary_color: "Black",
      teaser_text: "A landmark release for QA verification.",
    },
    idToken
  );
  console.log("Status:", createRes.status);
  const launchId = createRes.body?.launch?.launch_id;
  if (!launchId) {
    console.error("Create failed:", JSON.stringify(createRes.body, null, 2));
    process.exit(1);
  }
  console.log("Created launch_id:", launchId);

  // ── Artifact 3 (before 4): Attempt publish → should be BLOCKED ────────
  console.log("\n── Step 2: Attempt publish (should BLOCK) ──");
  const blockedRes = await api(
    `/api/v1/launches/${launchId}/publish`,
    "POST",
    null,
    idToken
  );

  // Fill in the gating fields: token_status, image_1_url
  console.log("\n── Step 3: Set token_status=Set ──");
  await api(
    `/api/v1/launches/${launchId}/token-status`,
    "POST",
    { token_status: "Set" },
    idToken
  );

  console.log("── Step 4: Inject image_1_url via Firestore (test fixture) ──");
  await db.collection("launch_records").doc(launchId).update({
    image_1_url:
      "https://storage.googleapis.com/ropi-aoss-dev-imports/launches/acceptance/image_1.jpg",
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });

  // ── Artifact 4: Successful publish ──────────────────────────────────
  console.log("\n── Step 5: Attempt publish (should SUCCEED) ──");
  const publishRes = await api(
    `/api/v1/launches/${launchId}/publish`,
    "POST",
    null,
    idToken
  );

  // ── Artifact 1: Fetch final full record ─────────────────────────────
  console.log("\n── Step 6: Fetch full launch record ──");
  const fullDoc = await db.collection("launch_records").doc(launchId).get();
  const fullData = { launch_id: launchId, ...fullDoc.data() };

  // ── Artifact 2: Public endpoint ────────────────────────────────────
  console.log("── Step 7: Fetch /launches/public ──");
  const publicRes = await fetch(`${API_BASE}/api/v1/launches/public`).then((r) =>
    r.json()
  );

  // ── OUTPUT ─────────────────────────────────────────────────────────
  const out = {
    artifact_1_full_launch_record: fullData,
    artifact_2_public_response: publicRes,
    artifact_3_publish_blocked: blockedRes,
    artifact_4_publish_success: publishRes,
  };

  const outPath = path.join(__dirname, "acceptance-launch-calendar.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("\n✅ Artifacts written to:", outPath);

  console.log("\n════════════════════════════════════════");
  console.log("ARTIFACT 1 — Full launch_records doc");
  console.log("════════════════════════════════════════");
  console.log(JSON.stringify(fullData, null, 2));

  console.log("\n════════════════════════════════════════");
  console.log("ARTIFACT 2 — GET /launches/public");
  console.log("════════════════════════════════════════");
  console.log(JSON.stringify(publicRes, null, 2));

  console.log("\n════════════════════════════════════════");
  console.log("ARTIFACT 3 — Publish BLOCKED response");
  console.log("════════════════════════════════════════");
  console.log("HTTP", blockedRes.status);
  console.log(JSON.stringify(blockedRes.body, null, 2));

  console.log("\n════════════════════════════════════════");
  console.log("ARTIFACT 4 — Publish SUCCESS response");
  console.log("════════════════════════════════════════");
  console.log("HTTP", publishRes.status);
  console.log(JSON.stringify(publishRes.body, null, 2));

  await admin.app().delete();
}

main().catch((e) => {
  console.error("❌ FAILED:", e);
  process.exit(1);
});
