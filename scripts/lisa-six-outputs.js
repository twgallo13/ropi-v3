/**
 * Lisa's 6 raw outputs for Step 2.4 closeout.
 */
const admin = require("./seed/node_modules/firebase-admin");
const fs = require("fs");
const path = require("path");

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
const API_BASE = "https://ropi-aoss-api-j4kyg7fb4a-uc.a.run.app";

const sa = JSON.parse(process.env.GCP_SA_KEY_DEV);
admin.initializeApp({
  credential: admin.credential.cert(sa),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore();

async function getIdToken() {
  const usersSnap = await db.collection("users").where("role", "==", "admin").limit(1).get();
  const uid = usersSnap.docs[0].id;
  const custom = await admin.auth().createCustomToken(uid, { admin: true, role: "admin" });
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: custom, returnSecureToken: true }) }
  );
  const d = await r.json();
  return d.idToken;
}

async function api(path, method = "GET", body, idToken) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  const r = await fetch(API_BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, body: data };
}

async function main() {
  // ── OUTPUT 1 — Full launch_records document (by mpn SHIEKH-ACCEPTANCE-001) ──
  console.log("════════════════════════════════════════════════════════");
  console.log("OUTPUT 1 — Full launch_records document");
  console.log("  (queried by mpn = SHIEKH-ACCEPTANCE-001)");
  console.log("════════════════════════════════════════════════════════");
  const snap = await db.collection("launch_records")
    .where("mpn", "==", "SHIEKH-ACCEPTANCE-001").limit(1).get();
  if (snap.empty) {
    console.log("(none found)");
  } else {
    const d = snap.docs[0];
    console.log("doc_id:", d.id);
    console.log(JSON.stringify(d.data(), null, 2));
  }

  // ── OUTPUT 2 — Public response ──
  console.log("\n════════════════════════════════════════════════════════");
  console.log("OUTPUT 2 — GET /api/v1/launches/public");
  console.log("════════════════════════════════════════════════════════");
  const pubRes = await fetch(`${API_BASE}/api/v1/launches/public`);
  const pubJson = await pubRes.json();
  console.log("HTTP", pubRes.status);
  console.log(JSON.stringify(pubJson, null, 2));

  const leakKeys = ["token_status", "internal_comments_count", "mpn"];
  const allCards = [...(pubJson.upcoming || []), ...(pubJson.past || [])];
  const leaks = [];
  for (const c of allCards) {
    for (const k of leakKeys) {
      if (k in c) leaks.push(`${c.launch_id}.${k}`);
    }
  }
  console.log("\nLEAK CHECK (should be empty):", leaks.length === 0 ? "✅ CLEAN" : leaks);

  // ── OUTPUT 3 — Publish BLOCKED ──
  console.log("\n════════════════════════════════════════════════════════");
  console.log("OUTPUT 3 — Publish BLOCKED (missing token + image)");
  console.log("════════════════════════════════════════════════════════");
  const idToken = await getIdToken();

  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 5);
  const future = futureDate.toISOString().substring(0, 10);

  const createRes = await api("/api/v1/launches", "POST", {
    mpn: "LISA-GATE-TEST-001",
    product_name: "Lisa Gate Test",
    brand: "Shiekh",
    launch_date: future,
    sales_channel: "Online",
    drawing_fcfs: "FCFS",
  }, idToken);
  const blockedLaunchId = createRes.body?.launch?.launch_id;
  console.log("Created draft:", blockedLaunchId);

  const blockedRes = await api(`/api/v1/launches/${blockedLaunchId}/publish`, "POST", null, idToken);
  console.log("HTTP", blockedRes.status);
  console.log(JSON.stringify(blockedRes.body, null, 2));

  // ── OUTPUT 4 — Publish SUCCESS ──
  console.log("\n════════════════════════════════════════════════════════");
  console.log("OUTPUT 4 — Publish SUCCESS (all gates satisfied)");
  console.log("════════════════════════════════════════════════════════");
  await api(`/api/v1/launches/${blockedLaunchId}/token-status`, "POST",
    { token_status: "Set" }, idToken);
  await db.collection("launch_records").doc(blockedLaunchId).update({
    image_1_url: "https://storage.googleapis.com/ropi-aoss-dev-imports/launches/lisa/image_1.jpg",
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });
  const pubOK = await api(`/api/v1/launches/${blockedLaunchId}/publish`, "POST", null, idToken);
  console.log("HTTP", pubOK.status);
  console.log(JSON.stringify(pubOK.body, null, 2));

  // ── OUTPUT 5 — Products doc with stamped high priority ──
  console.log("\n════════════════════════════════════════════════════════");
  console.log("OUTPUT 5 — Products doc with is_high_priority stamped");
  console.log("════════════════════════════════════════════════════════");

  // The LISA-GATE-TEST-001 MPN has no products row. The acceptance test
  // used SHIEKH-ACCEPTANCE-001 which also has no products row. Force a
  // recompute against a real MPN that has a product record.
  const prodSnap = await db.collection("products")
    .where("is_high_priority", "==", true).limit(5).get();

  if (prodSnap.empty) {
    console.log("No products with is_high_priority=true found.");
    console.log("Creating a launch record tied to a real product to prove the stamp works...");
    // Find any product to tie to
    const anyProd = await db.collection("products").limit(1).get();
    if (!anyProd.empty) {
      const realDoc = anyProd.docs[0];
      const realMpn = realDoc.data().mpn || realDoc.id.replace(/__/g, "/");
      console.log("Using real product mpn:", realMpn);
      await api("/api/v1/launches", "POST", {
        mpn: realMpn,
        product_name: "High Priority Stamp Test",
        brand: "Shiekh",
        launch_date: future,
        sales_channel: "Online",
        drawing_fcfs: "FCFS",
      }, idToken);
      const retry = await db.collection("products")
        .where("is_high_priority", "==", true).limit(5).get();
      retry.forEach((d) => {
        console.log(d.id,
          "is_high_priority:", d.data().is_high_priority,
          "launch_days_remaining:", d.data().launch_days_remaining,
          "upcoming_launch_date:", d.data().upcoming_launch_date,
          "completion_state:", d.data().completion_state);
      });
    }
  } else {
    prodSnap.forEach((d) => {
      console.log(d.id,
        "is_high_priority:", d.data().is_high_priority,
        "launch_days_remaining:", d.data().launch_days_remaining,
        "upcoming_launch_date:", d.data().upcoming_launch_date,
        "completion_state:", d.data().completion_state);
    });
  }

  // ── OUTPUT 6 — Admin settings ──
  console.log("\n════════════════════════════════════════════════════════");
  console.log("OUTPUT 6 — Admin settings confirm");
  console.log("════════════════════════════════════════════════════════");
  for (const key of ["smtp_throttle_hours", "launch_priority_window_days", "launch_past_retention_days"]) {
    const d = await db.collection("admin_settings").doc(key).get();
    if (d.exists) {
      console.log(key, ":", "value=" + d.data().value, "type=" + d.data().type, "category=" + d.data().category);
    } else {
      console.log(key, ": NOT FOUND");
    }
  }

  await admin.app().delete();
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
