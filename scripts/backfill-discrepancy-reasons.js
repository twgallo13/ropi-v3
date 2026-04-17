/**
 * Backfill discrepancy_reasons for products currently in pricing_domain_state=="discrepancy".
 * Re-runs resolvePricing() which writes reasons correctly.
 */
const path = require("path");
const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.GCP_PROJECT || "ropi-aoss-dev",
});

const { resolvePricing } = require(path.join(
  __dirname,
  "..",
  "backend",
  "functions",
  "lib",
  "services",
  "pricingResolution"
));

(async () => {
  const db = admin.firestore();
  const snap = await db
    .collection("products")
    .where("pricing_domain_state", "==", "discrepancy")
    .get();

  console.log(`Found ${snap.size} products in discrepancy state`);
  const adminDoc = await db.collection("admin_settings").doc("global").get();
  const adminSettings = adminDoc.exists ? adminDoc.data() : {};

  let updated = 0;
  let skipped = 0;
  for (const doc of snap.docs) {
    const p = doc.data();
    const mpn = p.mpn || doc.id;

    // Skip if already has reasons
    if (Array.isArray(p.discrepancy_reasons) && p.discrepancy_reasons.length > 0) {
      console.log(`  SKIP ${mpn} — already has ${p.discrepancy_reasons.length} reasons`);
      skipped++;
      continue;
    }

    const mapDoc = await doc.ref.collection("map_state").doc("current").get();
    const mapState = mapDoc.exists
      ? mapDoc.data()
      : { is_active: false, map_price: 0, map_promo_price: null };

    try {
      const result = await resolvePricing(
        mpn,
        {
          rics_retail: Number(p.rics_retail) || 0,
          rics_offer: Number(p.rics_offer) || 0,
          scom: Number(p.scom) || 0,
          scom_sale: Number(p.scom_sale) || 0,
        },
        mapState,
        adminSettings
      );
      console.log(
        `  OK   ${mpn} → status=${result.status}, reasons=${JSON.stringify(
          result.discrepancy_reasons
        )}`
      );
      updated++;
    } catch (e) {
      console.error(`  FAIL ${mpn}:`, e.message);
    }
  }

  console.log(`\nDone. updated=${updated}, skipped=${skipped}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
