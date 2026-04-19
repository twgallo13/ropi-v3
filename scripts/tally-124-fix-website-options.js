/**
 * TALLY-124 — Fix attribute_registry/website dropdown_options.
 *
 * Problem: dropdown_options stored display names ['Shiekh', 'Karmaloop', 'MLTD', 'Sangre Mia']
 * instead of canonical site_key values from site_registry.
 *
 * Fix:
 *   1. Read site_registry → build display_name→site_key map
 *   2. Update attribute_registry/website.dropdown_options to site_key values
 *   3. Scan all products attribute_values/website docs and migrate old display-name
 *      values to site_key format
 *
 * Usage:
 *   DRY_RUN=1 node scripts/tally-124-fix-website-options.js   # preview
 *   node scripts/tally-124-fix-website-options.js              # live
 */

"use strict";

const admin = require("firebase-admin");

const KEY_ENV = process.env.GCP_SA_KEY_DEV || process.env.SERVICE_ACCOUNT_JSON;
if (!KEY_ENV) {
  console.error("❌  GCP_SA_KEY_DEV not set");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(KEY_ENV)),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore();

const DRY_RUN = process.env.DRY_RUN === "1";

async function main() {
  console.log(`\n=== TALLY-124: Fix website dropdown_options ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  // Step 1: Read site_registry to build canonical map
  const registrySnap = await db.collection("site_registry").get();
  const displayToKey = {};
  const allKeys = [];
  registrySnap.forEach((doc) => {
    const d = doc.data();
    displayToKey[d.display_name] = d.site_key;
    allKeys.push(d.site_key);
    // Also map lowercase shortname → site_key for safety
    // e.g. "shiekh" → "shiekh_com", "Shiekh" → "shiekh_com"
    const shortName = d.site_key.replace(/_com$/, "");
    displayToKey[shortName] = d.site_key;
    displayToKey[shortName.charAt(0).toUpperCase() + shortName.slice(1)] = d.site_key;
  });

  console.log("Site registry map:", displayToKey);

  // Step 2: Read current attribute_registry/website
  const regRef = db.collection("attribute_registry").doc("website");
  const regSnap = await regRef.get();
  if (!regSnap.exists) {
    console.error("❌ attribute_registry/website not found!");
    process.exit(1);
  }

  const oldOptions = regSnap.data().dropdown_options || [];
  console.log("Old dropdown_options:", oldOptions);

  // Build new options: active sites only, using site_key
  const activeSnap = await db.collection("site_registry").where("is_active", "==", true).get();
  const newOptions = [];
  activeSnap.forEach((doc) => {
    newOptions.push(doc.data().site_key);
  });
  newOptions.sort();
  console.log("New dropdown_options:", newOptions);

  if (!DRY_RUN) {
    await regRef.update({ dropdown_options: newOptions });
    console.log("✅ Updated attribute_registry/website.dropdown_options");
  } else {
    console.log("🔍 Would update attribute_registry/website.dropdown_options");
  }

  // Step 3: Scan all products' attribute_values/website for old display-name values
  const productsSnap = await db.collection("products").select().get();
  console.log(`\nScanning ${productsSnap.size} products for website attribute migration...`);

  let migratedCount = 0;
  let alreadyCorrect = 0;
  let noValue = 0;

  for (const productDoc of productsSnap.docs) {
    const attrRef = productDoc.ref.collection("attribute_values").doc("website");
    const attrSnap = await attrRef.get();
    if (!attrSnap.exists) {
      noValue++;
      continue;
    }

    const data = attrSnap.data();
    const currentValue = data.value;
    if (!currentValue) {
      noValue++;
      continue;
    }

    // Value could be a comma-separated string (multi_select format)
    const parts = String(currentValue).split(",").map((v) => v.trim()).filter(Boolean);
    let needsMigration = false;
    const newParts = parts.map((p) => {
      if (displayToKey[p] && displayToKey[p] !== p) {
        needsMigration = true;
        return displayToKey[p];
      }
      return p;
    });

    if (needsMigration) {
      const newValue = newParts.join(", ");
      if (!DRY_RUN) {
        await attrRef.update({ value: newValue });
      }
      migratedCount++;
      if (migratedCount <= 10) {
        console.log(`  ${DRY_RUN ? "🔍 Would migrate" : "✅ Migrated"} ${productDoc.id}: "${currentValue}" → "${newValue}"`);
      }
    } else {
      alreadyCorrect++;
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Products scanned: ${productsSnap.size}`);
  console.log(`Migrated: ${migratedCount}`);
  console.log(`Already correct: ${alreadyCorrect}`);
  console.log(`No website value: ${noValue}`);
  console.log(`Done.\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
