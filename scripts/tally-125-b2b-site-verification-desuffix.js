#!/usr/bin/env node
/**
 * TALLY-125 Phase B, Task B2b — products.site_verification Map Key Rename
 *
 * For every product with a site_verification map:
 *   - For each top-level key matching {slug}_com: rename to bare form
 *   - Preserve all field values under the new key
 *   - Delete the old key to prevent duplicates
 *
 * Uses Firestore FieldValue.delete() + merge set to atomically rename keys.
 *
 * Audit log: { event_type: "site_verification.map_key_desuffix", mpn, old_key, new_key, round: 5 }
 *
 * Usage:
 *   node scripts/tally-125-b2b-site-verification-desuffix.js --dry-run
 *   node scripts/tally-125-b2b-site-verification-desuffix.js
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
const DEL = admin.firestore.FieldValue.delete();

async function main() {
  console.log(`\n=== TALLY-125 B2b: site_verification Map Key Rename ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  const productsSnap = await db.collection("products").get();
  console.log(`Total products: ${productsSnap.size}\n`);

  // Enumerate all distinct map keys across all products
  const keyCounts = {};
  let productsWithSV = 0;
  let productsWithoutSV = 0;

  for (const doc of productsSnap.docs) {
    const sv = doc.data().site_verification;
    if (!sv || typeof sv !== "object") {
      productsWithoutSV++;
      continue;
    }
    productsWithSV++;
    for (const key of Object.keys(sv)) {
      keyCounts[key] = (keyCounts[key] || 0) + 1;
    }
  }

  console.log(`Products with site_verification: ${productsWithSV}`);
  console.log(`Products without site_verification: ${productsWithoutSV}\n`);

  console.log(`=== Distinct site_verification map keys ===`);
  for (const [key, count] of Object.entries(keyCounts).sort((a, b) => b[1] - a[1])) {
    const endsInCom = key.endsWith("_com");
    console.log(`  "${key}" → ${count} products | ends_in_com: ${endsInCom}`);
  }
  console.log();

  // Process: rename _com keys to bare form
  let migrated = 0;
  let keysRenamed = 0;
  let alreadyBare = 0;
  let inactiveRefs = [];
  let errors = 0;

  // Load registry for inactive-site detection
  const registrySnap = await db.collection("site_registry").get();
  const activeKeys = new Set();
  registrySnap.forEach((d) => { if (d.data().is_active) activeKeys.add(d.id); });

  for (const doc of productsSnap.docs) {
    const data = doc.data();
    const sv = data.site_verification;
    if (!sv || typeof sv !== "object") continue;

    const keys = Object.keys(sv);
    const comKeys = keys.filter((k) => k.endsWith("_com"));

    if (comKeys.length === 0) {
      // Check for inactive-site references on bare keys
      for (const k of keys) {
        if (!activeKeys.has(k)) {
          inactiveRefs.push({ mpn: data.mpn || doc.id, key: k });
        }
      }
      alreadyBare++;
      continue;
    }

    // Has _com keys to rename
    const updatePayload = {};
    const auditEntries = [];

    for (const oldKey of comKeys) {
      const newKey = oldKey.replace(/_com$/, "");
      // Copy all values from old key to new key
      updatePayload[`site_verification.${newKey}`] = sv[oldKey];
      // Delete old key
      updatePayload[`site_verification.${oldKey}`] = DEL;
      auditEntries.push({ old_key: oldKey, new_key: newKey });

      // Check if this is an inactive-site reference
      if (!activeKeys.has(newKey)) {
        inactiveRefs.push({ mpn: data.mpn || doc.id, key: newKey });
      }
    }

    if (!DRY_RUN) {
      try {
        await db.collection("products").doc(doc.id).update(updatePayload);
        for (const entry of auditEntries) {
          await db.collection("audit_log").add({
            event_type: "site_verification.map_key_desuffix",
            mpn: data.mpn || doc.id,
            old_key: entry.old_key,
            new_key: entry.new_key,
            round: 5,
            timestamp: ts(),
          });
        }
      } catch (err) {
        console.error(`  ❌ Error migrating ${doc.id}: ${err.message}`);
        errors++;
        continue;
      }
    }

    migrated++;
    keysRenamed += comKeys.length;
  }

  console.log(`=== Summary ===`);
  console.log(`  Products migrated: ${migrated}`);
  console.log(`  Map keys renamed: ${keysRenamed}`);
  console.log(`  Products already bare (no _com keys): ${alreadyBare}`);
  console.log(`  Products without site_verification: ${productsWithoutSV}`);
  console.log(`  Inactive-site references: ${inactiveRefs.length}`);
  console.log(`  Errors: ${errors}`);

  if (inactiveRefs.length > 0) {
    console.log(`\n=== Inactive-Site Reference Report ===`);
    const bySite = {};
    for (const ref of inactiveRefs) {
      if (!bySite[ref.key]) bySite[ref.key] = [];
      bySite[ref.key].push(ref.mpn);
    }
    for (const [site, mpns] of Object.entries(bySite)) {
      console.log(`  ${site}: ${mpns.length} products`);
      for (const mpn of mpns.slice(0, 5)) {
        console.log(`    - ${mpn}`);
      }
      if (mpns.length > 5) console.log(`    ... and ${mpns.length - 5} more`);
    }
  }

  if (errors > 0) {
    console.error(`\n❌ ${errors} error(s) — review above.`);
    process.exit(1);
  }
  console.log(`\n✅ B2b ${DRY_RUN ? "dry-run" : "live-run"} complete.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
