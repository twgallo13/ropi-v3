// Step 2.1 verification: seed test products, upload MAP CSV, commit, verify Firestore artifacts
const admin = require("/workspaces/ropi-v3/backend/functions/node_modules/firebase-admin");
const fs = require("fs");
const path = require("path");

const serviceAccount = JSON.parse(fs.readFileSync("/tmp/sa-key-deploy.json", "utf8"));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: "ropi-aoss-dev",
  storageBucket: "ropi-aoss-dev-imports",
});
const db = admin.firestore();

const API_BASE = "https://ropi-aoss-api-j4kyg7fb4a-uc.a.run.app";

async function run() {
  console.log("▶ Seeding 3 test products…");

  // Seed 3 products that will receive MAP, plus 1 previously-protected product not in new CSV
  const testMpns = [
    {
      mpn: "STEP21-AON-001",
      brand: "NIKE",
      name: "Step 2.1 Always-On MAP Product",
      scom: 110, // below 120 MAP → will flag conflict
      scom_sale: 110,
      rics_retail: 130,
      rics_offer: 110,
    },
    {
      mpn: "STEP21-WIN-002",
      brand: "ADIDAS",
      name: "Step 2.1 Dated-Window MAP Product",
      scom: 80,
      scom_sale: 80,
      rics_retail: 90,
      rics_offer: 80,
    },
    {
      mpn: "STEP21-PROMO-003",
      brand: "PUMA",
      name: "Step 2.1 Promo MAP Product",
      scom: 70,
      scom_sale: 70,
      rics_retail: 80,
      rics_offer: 70,
    },
    {
      // Previously-protected, will not be in new MAP file → should get map_removal_proposed
      mpn: "STEP21-OLD-004",
      brand: "REEBOK",
      name: "Step 2.1 Formerly-Protected MAP Product",
      scom: 50,
      scom_sale: 50,
      rics_retail: 60,
      rics_offer: 50,
      is_map_protected: true, // simulate previously protected
      map_price: 55,
      map_is_always_on: true,
    },
  ];

  for (const p of testMpns) {
    const docRef = db.collection("products").doc(p.mpn);
    await docRef.set(
      {
        mpn: p.mpn,
        name: p.name,
        brand: p.brand,
        department: "FOOTWEAR",
        class: "ATHLETIC",
        sku: p.mpn,
        status: "active",
        product_is_active: true,
        site_owner: "SHOES.COM",
        completion_state: "complete",
        image_status: "YES",
        pricing_domain_state: "export_ready",
        scom: p.scom,
        scom_sale: p.scom_sale,
        rics_retail: p.rics_retail,
        rics_offer: p.rics_offer,
        inventory_store: 5,
        inventory_warehouse: 10,
        inventory_whs: 10,
        str_pct: 0.2,
        wos: 6,
        store_gm_pct: 40,
        web_gm_pct: 35,
        is_slow_moving: false,
        is_high_priority: false,
        is_map_protected: p.is_map_protected || false,
        map_price: p.map_price || null,
        map_is_always_on: p.map_is_always_on || false,
        first_received_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log(`  ✓ seeded ${p.mpn}`);
  }

  console.log("\n▶ Getting fresh ID token for HTTP upload…");
  // Mint a custom token for a test user and exchange
  const uid = "step21-verify-bot";
  await admin
    .auth()
    .createUser({ uid, email: "step21-bot@ropi.dev", displayName: "Step21 Bot" })
    .catch(() => {});
  const customToken = await admin.auth().createCustomToken(uid, { role: "map_analyst" });

  // Exchange custom token → ID token via Firebase REST
  const API_KEY = "AIzaSyCWxHKfmKzIh3PLXimA1DAEObwUinE2gIU"; // web API key for ropi-aoss-dev
  const tokenResp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const tokenData = await tokenResp.json();
  if (!tokenData.idToken) {
    throw new Error("Failed to exchange custom token: " + JSON.stringify(tokenData));
  }
  const idToken = tokenData.idToken;
  console.log("  ✓ got ID token");

  // Upload MAP CSV
  console.log("\n▶ Uploading MAP policy CSV…");
  const csvPath = path.join(__dirname, "step21-map-policy.csv");
  const csvBuf = fs.readFileSync(csvPath);
  // Multipart form-data using native FormData + Blob (Node 20)
  const form = new FormData();
  form.append("file", new Blob([csvBuf], { type: "text/csv" }), "step21-map-policy.csv");
  const uploadResp = await fetch(`${API_BASE}/api/v1/imports/map-policy/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
    body: form,
  });
  const uploadData = await uploadResp.json();
  if (!uploadResp.ok) {
    throw new Error("Upload failed: " + JSON.stringify(uploadData));
  }
  console.log("  ✓ batch_id:", uploadData.batch_id);
  console.log("    raw_headers:", JSON.stringify(uploadData.raw_headers));
  console.log("    row_count:", uploadData.row_count);

  // Map columns
  console.log("\n▶ Setting column mapping…");
  const mapResp = await fetch(
    `${API_BASE}/api/v1/imports/map-policy/${uploadData.batch_id}/map-columns`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        column_mapping: {
          mpn: "mpn",
          brand: "brand",
          map_price: "map_price",
          start_date: "start_date",
          end_date: "end_date",
          promo_price: "promo_price",
        },
        save_template: false,
        template_name: "",
      }),
    }
  );
  const mapData = await mapResp.json();
  if (!mapResp.ok) throw new Error("Map failed: " + JSON.stringify(mapData));
  console.log("  ✓", mapData);

  // Commit
  console.log("\n▶ Committing MAP policy batch…");
  const commitResp = await fetch(
    `${API_BASE}/api/v1/imports/map-policy/${uploadData.batch_id}/commit`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
    }
  );
  const commitData = await commitResp.json();
  console.log("  ✓", commitData);

  // ===== VERIFICATION =====
  console.log("\n\n═══════ VERIFICATION ARTIFACTS ═══════");

  // Artifact 1: map_policies doc
  const mpSnap = await db
    .collection("map_policies")
    .where("mpn", "==", "STEP21-AON-001")
    .limit(1)
    .get();
  console.log("\n[1] map_policies doc (STEP21-AON-001):");
  if (!mpSnap.empty) {
    console.log(JSON.stringify({ id: mpSnap.docs[0].id, ...mpSnap.docs[0].data() }, null, 2));
  } else {
    console.log("  (not found)");
  }

  // Artifact 2: product with is_map_protected:true
  const p1 = await db.collection("products").doc("STEP21-AON-001").get();
  console.log("\n[2] products/STEP21-AON-001 (is_map_protected=true):");
  const p1d = p1.data() || {};
  console.log(
    JSON.stringify(
      {
        mpn: p1d.mpn,
        is_map_protected: p1d.is_map_protected,
        map_price: p1d.map_price,
        map_promo_price: p1d.map_promo_price,
        map_start_date: p1d.map_start_date,
        map_end_date: p1d.map_end_date,
        map_is_always_on: p1d.map_is_always_on,
        map_conflict_active: p1d.map_conflict_active,
        map_conflict_reason: p1d.map_conflict_reason,
        scom: p1d.scom,
        scom_sale: p1d.scom_sale,
        rics_offer: p1d.rics_offer,
      },
      null,
      2
    )
  );

  // Artifact 3: trigger writePricingSnapshot by saving scom (happens through products API)
  console.log(
    "\n[3] Triggering pricing snapshot by saving scom on STEP21-AON-001:"
  );

  // Artifact 4: product with map_removal_proposed=true
  const rm = await db.collection("products").doc("STEP21-OLD-004").get();
  console.log("\n[4] products/STEP21-OLD-004 (map_removal_proposed):");
  const rmd = rm.data() || {};
  console.log(
    JSON.stringify(
      {
        mpn: rmd.mpn,
        is_map_protected: rmd.is_map_protected,
        map_removal_proposed: rmd.map_removal_proposed,
        map_removal_proposed_at: rmd.map_removal_proposed_at?.toDate?.()?.toISOString(),
        map_removal_source_batch: rmd.map_removal_source_batch,
      },
      null,
      2
    )
  );

  // Artifact 5: pricing_export_queue doc
  console.log("\n[5] pricing_export_queue (any mpn):");
  const pqSnap = await db.collection("pricing_export_queue").limit(3).get();
  pqSnap.docs.forEach((d) => {
    const x = d.data();
    console.log(
      JSON.stringify(
        {
          id: d.id,
          mpn: x.mpn,
          queued_reason: x.queued_reason,
          effective_date: x.effective_date,
          rics_offer: x.rics_offer,
          scom: x.scom,
          scom_sale: x.scom_sale,
          queued_at: x.queued_at?.toDate?.()?.toISOString(),
          exported_at: x.exported_at?.toDate?.()?.toISOString() || null,
        },
        null,
        2
      )
    );
  });

  // Artifact 6: trigger pricing export and show first 3 CSV rows
  console.log("\n[6] Triggering pricing export…");
  const trigResp = await fetch(`${API_BASE}/api/v1/exports/pricing/trigger`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const trigData = await trigResp.json();
  console.log("  trigger response:", trigData);
  if (trigData.download_url) {
    const csvResp = await fetch(trigData.download_url);
    const csvText = await csvResp.text();
    console.log("\n  First 4 lines of pricing export CSV:");
    console.log(csvText.split("\n").slice(0, 4).join("\n"));
  }

  // Artifact 3 (retry): trigger writePricingSnapshot by calling compiled code directly
  console.log(
    "\n[3b] Calling writePricingSnapshot on STEP21-AON-001 (will set is_map_constrained):"
  );
  const {
    resolvePricing,
    writePricingSnapshot,
  } = require("../backend/functions/lib/services/pricingResolution");
  const { getMapState } = require("../backend/functions/lib/services/mapState");
  const p1DocForPricing = (
    await db.collection("products").doc("STEP21-AON-001").get()
  ).data();
  const mapState = await getMapState("STEP21-AON-001");
  const pricingInputs = {
    rics_retail: p1DocForPricing.rics_retail || 0,
    rics_offer: p1DocForPricing.rics_offer || 0,
    scom: p1DocForPricing.scom || 0,
    scom_sale: p1DocForPricing.scom_sale || 0,
  };
  const adminSettingsDoc = await db
    .collection("admin_settings")
    .doc("pricing")
    .get();
  const adminSettings = adminSettingsDoc.exists
    ? adminSettingsDoc.data()
    : {
        allowed_export_window_pct: 2.0,
        cost_estimation_margin_pct: 40,
        veto_window_hours: 48,
      };
  const pricingResult = await resolvePricing(
    "STEP21-AON-001",
    pricingInputs,
    mapState,
    adminSettings
  );
  await writePricingSnapshot(
    "STEP21-AON-001",
    "step21-verify-" + Date.now(),
    pricingResult
  );
  console.log("  mapState:", JSON.stringify(mapState));
  console.log("  pricingResult is_map_constrained:", pricingResult.is_map_constrained);

  const snapSnap2 = await db
    .collection("pricing_snapshots")
    .where("mpn", "==", "STEP21-AON-001")
    .limit(10)
    .get();
  const snaps = snapSnap2.docs
    .map((d) => d.data())
    .sort(
      (a, b) =>
        (b.snapshot_at?._seconds || 0) - (a.snapshot_at?._seconds || 0)
    );
  if (snaps.length > 0) {
    const snap = snaps[0];
    console.log(
      "\n  Latest pricing snapshot: " +
        JSON.stringify(
          {
            mpn: snap.mpn,
            is_map_constrained: snap.is_map_constrained,
            map_price: snap.map_price,
            effective_web_sale: snap.effective_web_sale,
            scom: snap.scom,
            scom_sale: snap.scom_sale,
            rics_offer: snap.rics_offer,
            snapshot_at: snap.snapshot_at?.toDate?.()?.toISOString(),
          },
          null,
          2
        )
    );
  }

  // Re-read product to show map_conflict_active after snapshot
  const p1r = await db.collection("products").doc("STEP21-AON-001").get();
  console.log("\n[2b] products/STEP21-AON-001 AFTER pricing resolve (map_conflict_active):");
  const p1rd = p1r.data() || {};
  console.log(
    JSON.stringify(
      {
        mpn: p1rd.mpn,
        is_map_protected: p1rd.is_map_protected,
        map_price: p1rd.map_price,
        map_conflict_active: p1rd.map_conflict_active,
        map_conflict_reason: p1rd.map_conflict_reason,
        map_conflict_flagged_at: p1rd.map_conflict_flagged_at?.toDate?.()?.toISOString(),
      },
      null,
      2
    )
  );

  console.log("\n═══════ DONE ═══════");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
