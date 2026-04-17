// TALLY-113 / Step 2.1 — Six verification queries, raw output
const admin = require("/workspaces/ropi-v3/backend/functions/node_modules/firebase-admin");
const fs = require("fs");

const sa = JSON.parse(fs.readFileSync("/tmp/sa-key-deploy.json", "utf8"));
admin.initializeApp({
  credential: admin.credential.cert(sa),
  projectId: "ropi-aoss-dev",
  storageBucket: "ropi-aoss-dev-imports",
});
const db = admin.firestore();
const API_BASE = "https://ropi-aoss-api-j4kyg7fb4a-uc.a.run.app";
const API_KEY = "AIzaSyCWxHKfmKzIh3PLXimA1DAEObwUinE2gIU";

async function getIdToken() {
  const uid = "step21-verify-bot";
  await admin.auth().createUser({ uid, email: "step21-bot@ropi.dev" }).catch(() => {});
  const custom = await admin.auth().createCustomToken(uid, { role: "map_analyst" });
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    }
  );
  const d = await r.json();
  return d.idToken;
}

async function run() {
  const idToken = await getIdToken();
  const authHeader = { Authorization: `Bearer ${idToken}` };

  // ─── Query 1 ─── map_import_templates
  console.log("═══ QUERY 1 — map_import_templates ═══");
  // Save a template first via the mapping endpoint so there's data to read
  // Upload a new batch to save a template
  const csv1 = 'mpn,brand,map_price,start_date,end_date,promo_price\nSTEP21-AON-001,NIKE,120,,,\n';
  const form1 = new FormData();
  form1.append("file", new Blob([csv1], { type: "text/csv" }), "q1.csv");
  const up1 = await fetch(`${API_BASE}/api/v1/imports/map-policy/upload`, {
    method: "POST", headers: authHeader, body: form1,
  });
  const up1d = await up1.json();
  await fetch(`${API_BASE}/api/v1/imports/map-policy/${up1d.batch_id}/map-columns`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader },
    body: JSON.stringify({
      column_mapping: {
        mpn: "mpn", brand: "brand", map_price: "map_price",
        start_date: "start_date", end_date: "end_date", promo_price: "promo_price",
      },
      save_template: true,
      template_name: "Q1 Test Template " + Date.now(),
    }),
  });
  const tpls = await db.collection("map_import_templates").get();
  tpls.forEach((d) => console.log(d.id, JSON.stringify(d.data())));
  console.log("Total templates:", tpls.size);

  // ─── Query 2 ─── MPN not found in catalog
  console.log("\n═══ QUERY 2 — FAKE-MPN-99999 dead-letter ═══");
  const csv2 = 'mpn,brand,map_price,start_date,end_date,promo_price\nFAKE-MPN-99999,NIKE,120,,,\n';
  const form2 = new FormData();
  form2.append("file", new Blob([csv2], { type: "text/csv" }), "q2.csv");
  const up2 = await fetch(`${API_BASE}/api/v1/imports/map-policy/upload`, {
    method: "POST", headers: authHeader, body: form2,
  });
  const up2d = await up2.json();
  await fetch(`${API_BASE}/api/v1/imports/map-policy/${up2d.batch_id}/map-columns`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader },
    body: JSON.stringify({
      column_mapping: {
        mpn: "mpn", brand: "brand", map_price: "map_price",
        start_date: "start_date", end_date: "end_date", promo_price: "promo_price",
      },
      save_template: false, template_name: "",
    }),
  });
  const commit2 = await fetch(`${API_BASE}/api/v1/imports/map-policy/${up2d.batch_id}/commit`, {
    method: "POST", headers: authHeader,
  });
  const commit2d = await commit2.json();
  console.log("commit response:", JSON.stringify(commit2d, null, 2));

  // ─── Query 3 ─── pricing_snapshots subcollection on STEP21-AON-001
  console.log("\n═══ QUERY 3 — pricing_snapshots subcollection (latest) ═══");
  // Trigger a fresh snapshot by calling resolve + write
  const { resolvePricing, writePricingSnapshot } = require("../backend/functions/lib/services/pricingResolution");
  const { getMapState } = require("../backend/functions/lib/services/mapState");
  const pd = (await db.collection("products").doc("STEP21-AON-001").get()).data();
  const ms = await getMapState("STEP21-AON-001");
  const as = (await db.collection("admin_settings").doc("pricing").get()).data() || {
    allowed_export_window_pct: 2.0, cost_estimation_margin_pct: 40, veto_window_hours: 48,
  };
  const pr = await resolvePricing("STEP21-AON-001", {
    rics_retail: pd.rics_retail || 0, rics_offer: pd.rics_offer || 0,
    scom: pd.scom || 0, scom_sale: pd.scom_sale || 0,
  }, ms, as);
  await writePricingSnapshot("STEP21-AON-001", "q3-" + Date.now(), pr);

  const snaps = await db.collection("products").doc("STEP21-AON-001")
    .collection("pricing_snapshots")
    .orderBy("resolved_at", "desc").limit(1).get();
  snaps.forEach((d) => console.log(JSON.stringify(d.data(), null, 2)));

  // Ensure map_conflict_active is true before Query 4
  console.log("\n  (pre-Q4) ensuring map_conflict_active=true on STEP21-AON-001…");
  await db.collection("products").doc("STEP21-AON-001").set({
    map_conflict_active: true,
    map_conflict_reason: "Web sale ($110.00) is below MAP floor ($120.00)",
  }, { merge: true });

  // ─── Query 4 ─── accept_map action
  console.log("\n═══ QUERY 4 — accept_map on STEP21-AON-001 ═══");
  const q4 = await fetch(`${API_BASE}/api/v1/map-review/conflict/STEP21-AON-001/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader },
    body: JSON.stringify({ action: "accept_map", note: "Test" }),
  });
  const q4d = await q4.json();
  console.log("resolve response:", JSON.stringify(q4d));
  const q4doc = await db.collection("products").doc("STEP21-AON-001").get();
  console.log("scom:", q4doc.data().scom);
  console.log("scom_sale:", q4doc.data().scom_sale);
  console.log("map_conflict_active:", q4doc.data().map_conflict_active);

  // ─── Query 5 ─── audit_log latest 10
  console.log("\n═══ QUERY 5 — audit_log latest 10 ═══");
  const al = await db.collection("audit_log").orderBy("created_at", "desc").limit(10).get();
  al.forEach((d) => console.log(d.data().event_type, "|", d.data().product_mpn || d.data().mpn || "(no mpn)"));

  // ─── Query 6 ─── buyer blocked on MAP-conflicted product
  console.log("\n═══ QUERY 6 — buyer markdown blocked when MAP conflict active ═══");
  // Re-set conflict active to simulate blocker
  await db.collection("products").doc("STEP21-AON-001").set({
    map_conflict_active: true,
    pricing_domain_state: "Pricing Current",
  }, { merge: true });
  const q6 = await fetch(`${API_BASE}/api/v1/buyer-actions/markdown`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader },
    body: JSON.stringify({ mpn: "STEP21-AON-001", action_type: "approve" }),
  });
  console.log("HTTP status:", q6.status);
  const q6d = await q6.json();
  console.log("response body:", JSON.stringify(q6d));

  console.log("\n═══ DONE ═══");
}

run().catch((e) => { console.error(e); process.exit(1); });
