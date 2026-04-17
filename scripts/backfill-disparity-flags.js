#!/usr/bin/env node
/**
 * Step 3.2 Correction 1 — backfill is_store_sale_web_full + is_web_sale_store_full.
 *
 * Re-runs resolvePricing() (which now stamps the flags) against every complete
 * product using the current map_state and admin_settings.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *   NODE_PATH=/workspaces/ropi-v3/backend/functions/node_modules \
 *   node scripts/backfill-disparity-flags.js
 */
"use strict";

const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.applicationDefault() });

const { resolvePricing, writePricingSnapshot } = require(
  "../backend/functions/lib/services/pricingResolution"
);
const { getAdminSettings } = require(
  "../backend/functions/lib/services/adminSettings"
);
const { getMapState } = require(
  "../backend/functions/lib/services/mapState"
);

async function main() {
  const db = admin.firestore();
  const settings = await getAdminSettings();

  console.log("Scanning complete products…");
  const snap = await db
    .collection("products")
    .where("completion_state", "==", "complete")
    .get();

  console.log(`Found ${snap.size} complete products. Re-running resolvePricing()…`);

  let updated = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const p = doc.data();
    const mpn = p.mpn;
    if (!mpn) {
      skipped++;
      continue;
    }
    try {
      const inputs = {
        rics_retail: Number(p.rics_retail) || 0,
        rics_offer: Number(p.rics_offer) || 0,
        scom: Number(p.scom) || 0,
        scom_sale: Number(p.scom_sale) || 0,
        actual_cost:
          typeof p.actual_cost === "number" ? p.actual_cost : null,
      };
      const mapState = await getMapState(mpn);
      const result = await resolvePricing(mpn, inputs, mapState, settings);
      await writePricingSnapshot(mpn, "backfill-disparity-flags", result);
      updated++;
      const flags = [];
      if (result.effective_store_sale < result.effective_store_regular) flags.push("store_sale");
      if (result.effective_web_sale < result.effective_web_regular) flags.push("web_sale");
      if (updated % 25 === 0) console.log(`  …${updated} done`);
    } catch (err) {
      skipped++;
      console.error(`  SKIP ${mpn}: ${err.message}`);
    }
  }

  console.log(`\nDone. updated=${updated}, skipped=${skipped}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
