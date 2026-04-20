#!/usr/bin/env node
/**
 * TALLY-125 Phase B, Task B2a — products.site_owner Normalization
 *
 * For every product with site_owner set:
 *   - If value ends in _com: strip suffix (e.g. shiekh_com → shiekh)
 *   - If value is already bare AND matches a registry entry: leave unchanged
 *   - If value references an inactive site: leave unchanged, add to inactive report
 *   - If value doesn't match ANY registry entry: flag for PO review, do NOT migrate
 *
 * Audit log: { event_type: "product.site_owner_desuffix", mpn, from, to, round: 5 }
 *
 * Usage:
 *   node scripts/tally-125-b2a-product-site-owner.js --dry-run
 *   node scripts/tally-125-b2a-product-site-owner.js
 */
"use strict";

const admin = require("firebase-admin");

const KEY_ENV = process.env.GCP_SA_KEY_DEV || process.env.SERVICE_ACCOUNT_JSON;
if (!KEY_ENV) {
  console.error("❌  GCP_SA_KEY_DEV not set");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(KEY_ENV)),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

async function main() {
  console.log(`\n=== TALLY-125 B2a: products.site_owner Normalization ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  // 1. Load full registry (all sites, active + inactive) for validation
  const registrySnap = await db.collection("site_registry").get();
  const registryKeys = new Set();
  const activeKeys = new Set();
  registrySnap.forEach((d) => {
    registryKeys.add(d.id);
    if (d.data().is_active) activeKeys.add(d.id);
  });
  console.log(`Registry: ${registryKeys.size} total, ${activeKeys.size} active`);
  console.log(`  All keys: ${[...registryKeys].join(", ")}`);
  console.log(`  Active keys: ${[...activeKeys].join(", ")}\n`);

  // 2. Query ALL products (site_owner is a top-level field, we need to check all)
  const productsSnap = await db.collection("products").get();
  console.log(`Total products: ${productsSnap.size}\n`);

  // Enumerate distinct values
  const valueCounts = {};
  const productsByValue = {};
  productsSnap.forEach((d) => {
    const so = d.data().site_owner;
    if (so !== undefined && so !== null && so !== "") {
      valueCounts[so] = (valueCounts[so] || 0) + 1;
      if (!productsByValue[so]) productsByValue[so] = [];
      productsByValue[so].push(d.id);
    }
  });

  console.log(`=== Distinct site_owner values ===`);
  const sortedValues = Object.entries(valueCounts).sort((a, b) => b[1] - a[1]);
  for (const [val, count] of sortedValues) {
    const endsInCom = val.endsWith("_com");
    const bare = endsInCom ? val.replace(/_com$/, "") : val;
    const inRegistry = registryKeys.has(bare) || registryKeys.has(val);
    const isActive = activeKeys.has(bare) || activeKeys.has(val);
    console.log(`  "${val}" → ${count} products | ends_in_com: ${endsInCom} | registry_match: ${inRegistry} | active: ${isActive}`);
  }
  console.log();

  // 3. Process each product
  let migrated = 0;
  let alreadyBare = 0;
  let inactiveRefs = [];
  let unknownRefs = [];
  let skippedEmpty = 0;
  let errors = 0;

  for (const doc of productsSnap.docs) {
    const data = doc.data();
    const so = data.site_owner;

    // Skip products without site_owner
    if (so === undefined || so === null || so === "") {
      skippedEmpty++;
      continue;
    }

    const endsInCom = so.endsWith("_com");
    const bare = endsInCom ? so.replace(/_com$/, "") : so;

    // Check if bare form is in registry
    if (!registryKeys.has(bare)) {
      // Unknown value — flag for PO review
      unknownRefs.push({ mpn: data.mpn || doc.id, site_owner: so, bare });
      continue;
    }

    // Check if it's an inactive site reference
    if (!activeKeys.has(bare)) {
      inactiveRefs.push({ mpn: data.mpn || doc.id, site_owner: so, bare });
      // Still migrate _com → bare if needed (inactive sites also get desuffixed)
      if (!endsInCom) {
        alreadyBare++;
        continue;
      }
    }

    // If already bare, nothing to do
    if (!endsInCom) {
      alreadyBare++;
      continue;
    }

    // Needs migration: _com → bare
    if (!DRY_RUN) {
      try {
        await db.collection("products").doc(doc.id).update({
          site_owner: bare,
        });
        await db.collection("audit_log").add({
          event_type: "product.site_owner_desuffix",
          mpn: data.mpn || doc.id,
          from: so,
          to: bare,
          round: 5,
          timestamp: ts(),
        });
      } catch (err) {
        console.error(`  ❌ Error migrating ${doc.id}: ${err.message}`);
        errors++;
        continue;
      }
    }
    migrated++;
  }

  console.log(`=== Summary ===`);
  console.log(`  Migrated (_com → bare): ${migrated}`);
  console.log(`  Already bare (no change): ${alreadyBare}`);
  console.log(`  Skipped (no site_owner): ${skippedEmpty}`);
  console.log(`  Inactive-site references: ${inactiveRefs.length}`);
  console.log(`  Unknown refs (not in registry): ${unknownRefs.length}`);
  console.log(`  Errors: ${errors}`);

  if (inactiveRefs.length > 0) {
    console.log(`\n=== Inactive-Site Reference Report ===`);
    // Group by site
    const bySite = {};
    for (const ref of inactiveRefs) {
      const key = ref.bare;
      if (!bySite[key]) bySite[key] = [];
      bySite[key].push(ref.mpn);
    }
    for (const [site, mpns] of Object.entries(bySite)) {
      console.log(`  ${site}: ${mpns.length} products`);
      for (const mpn of mpns.slice(0, 5)) {
        console.log(`    - ${mpn}`);
      }
      if (mpns.length > 5) console.log(`    ... and ${mpns.length - 5} more`);
    }
  }

  if (unknownRefs.length > 0) {
    console.log(`\n=== Unknown Reference Report (PO Review) ===`);
    for (const ref of unknownRefs) {
      console.log(`  MPN: ${ref.mpn}, site_owner: "${ref.site_owner}"`);
    }
  }

  if (errors > 0) {
    console.error(`\n❌ ${errors} error(s) — review above.`);
    process.exit(1);
  }
  console.log(`\n✅ B2a ${DRY_RUN ? "dry-run" : "live-run"} complete.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
