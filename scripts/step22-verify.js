// Step 2.2 verification: create a cadence rule, seed products, trigger cadence evaluation,
// verify recommendations land in buyer queue with correct MAP floor + never-raise guards.
const admin = require("/workspaces/ropi-v3/backend/functions/node_modules/firebase-admin");
const fs = require("fs");

const serviceAccount = JSON.parse(fs.readFileSync("/tmp/sa-key-deploy.json", "utf8"));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore();

const API_BASE = "https://ropi-aoss-api-j4kyg7fb4a-uc.a.run.app";
const API_KEY = "AIzaSyCWxHKfmKzIh3PLXimA1DAEObwUinE2gIU";

function daysAgoIso(d) {
  const t = new Date(Date.now() - d * 86400000);
  return t;
}

async function getAdminIdToken() {
  const uid = "step22-verify-bot";
  await admin
    .auth()
    .createUser({ uid, email: "step22-bot@ropi.dev" })
    .catch(() => {});
  await db.collection("users").doc(uid).set(
    { email: "step22-bot@ropi.dev", role: "admin" },
    { merge: true }
  );
  const customToken = await admin.auth().createCustomToken(uid, { role: "admin" });
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const d = await r.json();
  if (!d.idToken) throw new Error("Auth failed: " + JSON.stringify(d));
  return d.idToken;
}

async function run() {
  const idToken = await getAdminIdToken();
  const H = { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" };

  console.log("▶ Clean prior test artifacts");
  const existing = await db
    .collection("cadence_rules")
    .where("rule_name", "==", "Step22 Test Rule")
    .get();
  for (const doc of existing.docs) await doc.ref.delete();
  for (const mpn of ["STEP22-NIKE-001", "STEP22-NIKE-002", "STEP22-ADIDAS-003"]) {
    await db.collection("products").doc(mpn).delete().catch(() => {});
    await db.collection("cadence_assignments").doc(mpn).delete().catch(() => {});
  }

  console.log("\n▶ Create cadence rule via API (case-sensitive brand=NIKE, str_pct<20)");
  const ruleResp = await fetch(`${API_BASE}/api/v1/cadence-rules`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      rule_name: "Step22 Test Rule",
      is_active: true,
      owner_buyer_id: "step22-verify-bot",
      owner_site_owner: "SHOES.COM",
      target_filters: [
        { field: "brand", operator: "equals", value: "NIKE", case_sensitive: true },
      ],
      trigger_conditions: [
        { field: "str_pct", operator: "less_than", value: 20, logic: "AND" },
      ],
      markdown_steps: [
        {
          step_number: 1,
          day_threshold: 30,
          action_type: "markdown_pct",
          markdown_scope: "store_and_web",
          value: 15,
          apply_99_rounding: true,
        },
        {
          step_number: 2,
          day_threshold: 60,
          action_type: "markdown_pct",
          markdown_scope: "store_and_web",
          value: 30,
          apply_99_rounding: true,
        },
      ],
    }),
  });
  const ruleData = await ruleResp.json();
  if (!ruleResp.ok) throw new Error("Rule create failed: " + JSON.stringify(ruleData));
  console.log("  ✓ rule_id=" + ruleData.rule_id + " v" + ruleData.version);

  console.log("\n▶ Seed 3 products");
  const firstReceived40d = admin.firestore.Timestamp.fromDate(daysAgoIso(40));

  // Product 1: NIKE, str 10% → should match Step 1 (15% off $100 = $85 → $84.99)
  await db.collection("products").doc("STEP22-NIKE-001").set({
    mpn: "STEP22-NIKE-001",
    brand: "NIKE",
    name: "Nike Match Product",
    department: "FOOTWEAR",
    class: "ATHLETIC",
    site_owner: "SHOES.COM",
    status: "active",
    product_is_active: true,
    completion_state: "complete",
    image_status: "YES",
    pricing_domain_state: "export_ready",
    rics_retail: 100,
    rics_offer: 100,
    scom: 100,
    scom_sale: 100,
    inventory_store: 10,
    inventory_warehouse: 0,
    inventory_whs: 0,
    str_pct: 10,
    wos: 12,
    store_gm_pct: 40,
    web_gm_pct: 35,
    is_slow_moving: false,
    is_map_protected: false,
    first_received_at: firstReceived40d,
  });

  // Product 2: NIKE MAP-protected (MAP $90) → candidate web = $84.99 → MAP floor pushes to $90
  await db.collection("products").doc("STEP22-NIKE-002").set({
    mpn: "STEP22-NIKE-002",
    brand: "NIKE",
    name: "Nike MAP-Protected",
    department: "FOOTWEAR",
    class: "ATHLETIC",
    site_owner: "SHOES.COM",
    status: "active",
    product_is_active: true,
    completion_state: "complete",
    image_status: "YES",
    pricing_domain_state: "export_ready",
    rics_retail: 100,
    rics_offer: 100,
    scom: 100,
    scom_sale: 100,
    inventory_store: 10,
    inventory_warehouse: 0,
    inventory_whs: 0,
    str_pct: 10,
    wos: 12,
    store_gm_pct: 40,
    web_gm_pct: 35,
    is_slow_moving: false,
    is_map_protected: true,
    map_price: 90,
    map_is_always_on: true,
    first_received_at: firstReceived40d,
  });

  // Product 3: brand "nike" (lowercase) → should NOT match (case-sensitive TALLY-104)
  await db.collection("products").doc("STEP22-ADIDAS-003").set({
    mpn: "STEP22-ADIDAS-003",
    brand: "nike",
    name: "Case-Sensitivity Miss",
    department: "FOOTWEAR",
    class: "ATHLETIC",
    site_owner: "SHOES.COM",
    status: "active",
    product_is_active: true,
    completion_state: "complete",
    image_status: "YES",
    pricing_domain_state: "export_ready",
    rics_retail: 100,
    rics_offer: 100,
    scom: 100,
    scom_sale: 100,
    inventory_store: 10,
    inventory_warehouse: 0,
    inventory_whs: 0,
    str_pct: 10,
    wos: 12,
    store_gm_pct: 40,
    web_gm_pct: 35,
    is_slow_moving: false,
    is_map_protected: false,
    first_received_at: firstReceived40d,
  });
  console.log("  ✓ seeded 3 products");

  console.log("\n▶ Run cadence evaluation directly via service");
  // Call the service through a tiny admin trigger: use importWeeklyOperations path only if
  // available; simpler: import service from compiled lib and run.
  const {
    runCadenceEvaluation,
  } = require("/workspaces/ropi-v3/backend/functions/lib/services/cadenceEngine");
  const result = await runCadenceEvaluation([
    "STEP22-NIKE-001",
    "STEP22-NIKE-002",
    "STEP22-ADIDAS-003",
  ]);
  console.log("  result=", JSON.stringify(result));

  console.log("\n▶ Verify assignments");
  const a1 = await db.collection("cadence_assignments").doc("STEP22-NIKE-001").get();
  const a2 = await db.collection("cadence_assignments").doc("STEP22-NIKE-002").get();
  const a3 = await db.collection("cadence_assignments").doc("STEP22-ADIDAS-003").get();

  function assert(cond, msg) {
    if (!cond) {
      console.error("  ✗ FAIL: " + msg);
      process.exitCode = 1;
    } else {
      console.log("  ✓ " + msg);
    }
  }

  assert(a1.exists && a1.data().in_buyer_queue === true, "NIKE-001 assigned to buyer queue");
  if (a1.exists) {
    const r = a1.data().recommendation || {};
    assert(r.new_rics_offer === 85, `NIKE-001 new_rics_offer=85 raw (got ${r.new_rics_offer})`);
    assert(
      r.export_rics_offer === 84.99,
      `NIKE-001 export_rics_offer=84.99 (got ${r.export_rics_offer})`
    );
    assert(r.new_scom_sale === 85, `NIKE-001 web sale raw 85 (got ${r.new_scom_sale})`);
    assert(
      r.export_scom_sale === 84.99,
      `NIKE-001 export_scom_sale=84.99 (got ${r.export_scom_sale})`
    );
    assert(a1.data().matched_rule_version === 1, "NIKE-001 matched_rule_version=1");
  }

  assert(a2.exists && a2.data().in_buyer_queue === true, "NIKE-002 assigned to buyer queue");
  if (a2.exists) {
    const r = a2.data().recommendation || {};
    assert(r.new_rics_offer === 85, `NIKE-002 store price raw 85`);
    assert(
      r.new_scom_sale === 90,
      `NIKE-002 web sale floored at MAP $90 (got ${r.new_scom_sale})`
    );
    assert(
      r.export_scom_sale === 90,
      `NIKE-002 export_scom_sale=90 (no 99-round below MAP, got ${r.export_scom_sale})`
    );
  }

  assert(
    a3.exists && a3.data().cadence_state === "unassigned",
    "lowercase 'nike' rejected by case-sensitive filter (state=unassigned)"
  );

  console.log("\n▶ Verify audit log entries");
  const audits = await db
    .collection("audit_log")
    .where("event_type", "==", "cadence_evaluated")
    .limit(5)
    .get();
  console.log(`  ${audits.size} cadence_evaluated audit entries`);
  assert(audits.size > 0, "audit_log has cadence_evaluated events");

  console.log("\n▶ Verify unassigned queue lists lowercase-nike");
  const unassignedResp = await fetch(`${API_BASE}/api/v1/cadence-assignments/unassigned`, {
    headers: H,
  });
  const unassigned = await unassignedResp.json();
  const hasNoMatch = unassigned.items.some((i) => i.mpn === "STEP22-ADIDAS-003");
  assert(hasNoMatch, "unassigned queue contains STEP22-ADIDAS-003");

  console.log("\n▶ Verify cadence review endpoint returns items");
  const reviewResp = await fetch(`${API_BASE}/api/v1/cadence-review`, { headers: H });
  const review = await reviewResp.json();
  assert(reviewResp.ok, "cadence-review endpoint 200");
  assert(
    review.items.some((i) => i.mpn === "STEP22-NIKE-001"),
    "cadence-review includes NIKE-001"
  );

  console.log("\n✅ Step 2.2 verification complete");
  process.exit(process.exitCode || 0);
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
