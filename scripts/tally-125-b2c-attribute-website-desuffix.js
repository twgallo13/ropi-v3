#!/usr/bin/env node
/**
 * TALLY-125 Phase B, Task B2c — products/{mpn}/attribute_values/website.value Normalization
 *
 * The "website" field is stored as a subcollection document:
 *   products/{mpn}/attribute_values/website → { value: "shiekh.com", ... }
 *
 * Normalization applies the same chain as siteVerificationImport.ts:
 *   toLowerCase → replace /[^a-z0-9]+/g,"_" → trim _ → strip _com$
 *
 * Defensive handling:
 *   - String (expected): normalize via chain above
 *   - Null/undefined: skip
 *   - Array/other: STOP and report
 *   - Multi-value strings (contains comma): flag for PO review
 *
 * Audit log: { event_type: "attribute_values.website_desuffix", mpn, from, to, round: 5 }
 *
 * Usage:
 *   node scripts/tally-125-b2c-attribute-website-desuffix.js --dry-run
 *   node scripts/tally-125-b2c-attribute-website-desuffix.js
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
const ts = function() { return admin.firestore.FieldValue.serverTimestamp(); };

// Same normalizer chain as siteVerificationImport.ts line ~205
function normalize(val) {
  return val
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/_com$/, "");
}

async function main() {
  console.log("\n=== TALLY-125 B2c: attribute_values/website.value Normalization ===");
  console.log("Mode: " + (DRY_RUN ? "DRY RUN" : "LIVE") + "\n");

  const productsSnap = await db.collection("products").get();
  console.log("Total products: " + productsSnap.size + "\n");

  // Load registry for orphan detection
  const registrySnap = await db.collection("site_registry").get();
  const registryKeys = new Set();
  const activeKeys = new Set();
  registrySnap.forEach(function(d) {
    registryKeys.add(d.id);
    if (d.data().is_active) activeKeys.add(d.id);
  });
  console.log("Registry keys: [" + Array.from(registryKeys).sort().join(", ") + "]");
  console.log("Active keys:   [" + Array.from(activeKeys).sort().join(", ") + "]\n");

  // Collect all website subcollection docs
  const shapeCounts = {};
  const valueCounts = {};
  const shapeProducts = {};
  let hasWebsite = 0;
  let noWebsite = 0;
  const productWebsites = [];
  const multiValueProducts = [];

  for (var i = 0; i < productsSnap.docs.length; i++) {
    var doc = productsSnap.docs[i];
    var wsDoc = await doc.ref.collection("attribute_values").doc("website").get();
    if (!wsDoc.exists) {
      noWebsite++;
      continue;
    }
    hasWebsite++;
    var wsData = wsDoc.data();
    var val = wsData.value;
    var mpn = doc.id;

    // Classify shape
    var shape;
    if (val === null || val === undefined) {
      shape = "null";
    } else if (typeof val === "string") {
      shape = "string";
    } else if (Array.isArray(val)) {
      shape = "array";
    } else {
      shape = "other:" + typeof val;
    }

    shapeCounts[shape] = (shapeCounts[shape] || 0) + 1;
    if (!shapeProducts[shape]) shapeProducts[shape] = [];
    shapeProducts[shape].push(mpn);

    if (typeof val === "string") {
      valueCounts[val] = (valueCounts[val] || 0) + 1;
      // Detect multi-value strings
      if (val.indexOf(",") !== -1) {
        multiValueProducts.push({ mpn: mpn, value: val });
      }
    }

    productWebsites.push({ doc: doc, wsDocRef: wsDoc.ref, wsData: wsData, val: val, shape: shape, mpn: mpn });
  }

  // ── Shape-by-Shape Report ──
  console.log("=== Shape-by-Shape Distribution Report ===\n");
  console.log("Products with attribute_values/website doc: " + hasWebsite);
  console.log("Products without: " + noWebsite);
  console.log("");

  var stopConditions = [];
  var shapeOrder = ["string", "null", "array"];
  for (var s in shapeCounts) {
    if (shapeOrder.indexOf(s) === -1) shapeOrder.push(s);
  }

  for (var si = 0; si < shapeOrder.length; si++) {
    var sh = shapeOrder[si];
    var count = shapeCounts[sh];
    if (!count) continue;
    console.log("--- Shape: " + sh + " (" + count + " products) ---");
    console.log("  Sample MPNs: " + shapeProducts[sh].slice(0, 5).join(", "));
    console.log("");

    if (sh === "array" || sh.startsWith("other:")) {
      stopConditions.push({ shape: sh, count: count, mpns: shapeProducts[sh].slice(0, 5) });
    }
  }

  // ── Value Distribution ──
  console.log("=== Value Distribution (string values) ===\n");
  var sorted = Object.entries(valueCounts).sort(function(a, b) { return b[1] - a[1]; });
  var needsMigrationTotal = 0;
  var alreadyBareTotal = 0;
  for (var vi = 0; vi < sorted.length; vi++) {
    var entry = sorted[vi];
    var rawVal = entry[0];
    var rawCount = entry[1];
    var normalized = normalize(rawVal);
    var changes = normalized !== rawVal;
    if (changes) needsMigrationTotal += rawCount;
    else alreadyBareTotal += rawCount;

    var inRegistry = registryKeys.has(normalized);
    var isActive = activeKeys.has(normalized);
    var regLabel = inRegistry ? "✓ registry" : "✗ NOT in registry";
    var activeLabel = isActive ? " (active)" : inRegistry ? " (INACTIVE)" : "";
    // Orphans (not in registry) are SKIPPED — preserve raw value
    var action = !changes ? "(no-op)" : !inRegistry ? "← SKIP (orphan, preserve raw)" : "← MIGRATE";
    console.log("  \"" + rawVal + "\" × " + rawCount + " → \"" + normalized + "\" [" + regLabel + activeLabel + "] " + action);
  }

  // ── Multi-Value String Warning ──
  if (multiValueProducts.length > 0) {
    console.log("\n⚠️  Multi-value strings detected (" + multiValueProducts.length + " products):");
    for (var mi = 0; mi < multiValueProducts.length; mi++) {
      var mv = multiValueProducts[mi];
      console.log("  " + mv.mpn + ": \"" + mv.value + "\"");
      console.log("    → normalizer would produce: \"" + normalize(mv.value) + "\" (mangled)");
      console.log("    → SKIPPING (requires PO decision)");
    }
  }

  // ── Migration Summary ──
  console.log("\n=== Migration Summary ===");
  console.log("  Values needing migration: " + needsMigrationTotal + " products");
  console.log("  Already bare (no change): " + alreadyBareTotal + " products");
  console.log("  Multi-value (skipped): " + multiValueProducts.length + " products");
  console.log("  Stop conditions: " + stopConditions.length);

  if (stopConditions.length > 0) {
    console.log("\n❌ STOP CONDITIONS DETECTED — do NOT proceed to live-run");
    for (var sci = 0; sci < stopConditions.length; sci++) {
      var sc = stopConditions[sci];
      console.log("  Shape: " + sc.shape + " (" + sc.count + " products)");
      console.log("  Sample MPNs: " + sc.mpns.join(", "));
    }
    process.exit(1);
  }

  // ── Execute Migration ──
  if (!DRY_RUN) {
    console.log("\n=== Executing migration ===\n");
  }

  var migrated = 0;
  var unchanged = 0;
  var skipped = 0;
  var errors = 0;
  var inactiveRefs = [];
  var orphanRefs = [];

  for (var pi = 0; pi < productWebsites.length; pi++) {
    var pw = productWebsites[pi];
    if (pw.shape === "null") {
      skipped++;
      continue;
    }
    if (pw.shape !== "string") {
      skipped++;
      continue;
    }

    // Skip multi-value strings
    if (pw.val.indexOf(",") !== -1) {
      skipped++;
      continue;
    }

    var norm = normalize(pw.val);
    if (norm === pw.val) {
      unchanged++;
      continue;
    }

    // ORPHAN CHECK: if normalized value has no registry entry, SKIP and preserve raw
    if (!registryKeys.has(norm)) {
      orphanRefs.push({ mpn: pw.mpn, value: norm, from: pw.val });
      skipped++;
      continue;
    }

    // Track inactive-site references (still migrate — format normalization only)
    if (!activeKeys.has(norm)) {
      inactiveRefs.push({ mpn: pw.mpn, value: norm, from: pw.val });
    }

    if (!DRY_RUN) {
      try {
        await pw.wsDocRef.update({ value: norm });
        await db.collection("audit_log").add({
          event_type: "attribute_values.website_desuffix",
          mpn: pw.mpn,
          from: pw.val,
          to: norm,
          round: 5,
          timestamp: ts(),
        });
      } catch (err) {
        console.error("  ❌ Error migrating " + pw.mpn + ": " + err.message);
        errors++;
        continue;
      }
    }
    migrated++;
  }

  console.log("\n=== Final Summary ===");
  console.log("  Migrated: " + migrated);
  console.log("  Unchanged (already bare): " + unchanged);
  console.log("  Skipped (null/orphan/multi-value): " + skipped);
  console.log("  Orphan refs (not in registry): " + orphanRefs.length);
  console.log("  Inactive-site references: " + inactiveRefs.length);
  console.log("  Errors: " + errors);

  if (orphanRefs.length > 0) {
    console.log("\n=== Orphan-Site Reference Report ===");
    console.log("(These normalized values have no matching registry key — preserved raw)");
    var bySite = {};
    for (var oi = 0; oi < orphanRefs.length; oi++) {
      var ref = orphanRefs[oi];
      if (!bySite[ref.value]) bySite[ref.value] = { count: 0, from: ref.from, mpns: [] };
      bySite[ref.value].count++;
      bySite[ref.value].mpns.push(ref.mpn);
    }
    for (var site in bySite) {
      var info = bySite[site];
      console.log("  \"" + info.from + "\" → \"" + site + "\": " + info.count + " products");
      for (var j = 0; j < Math.min(3, info.mpns.length); j++) {
        console.log("    - " + info.mpns[j]);
      }
      if (info.mpns.length > 3) console.log("    ... and " + (info.mpns.length - 3) + " more");
    }
  }

  if (inactiveRefs.length > 0) {
    console.log("\n=== Inactive-Site Reference Report ===");
    var byIS = {};
    for (var ii = 0; ii < inactiveRefs.length; ii++) {
      var iref = inactiveRefs[ii];
      if (!byIS[iref.value]) byIS[iref.value] = { count: 0, from: iref.from, mpns: [] };
      byIS[iref.value].count++;
      byIS[iref.value].mpns.push(iref.mpn);
    }
    for (var isite in byIS) {
      var iinfo = byIS[isite];
      console.log("  \"" + iinfo.from + "\" → \"" + isite + "\": " + iinfo.count + " products (INACTIVE in registry)");
      for (var k = 0; k < Math.min(3, iinfo.mpns.length); k++) {
        console.log("    - " + iinfo.mpns[k]);
      }
      if (iinfo.mpns.length > 3) console.log("    ... and " + (iinfo.mpns.length - 3) + " more");
    }
  }

  if (errors > 0) {
    console.error("\n❌ " + errors + " error(s) — review above.");
    process.exit(1);
  }
  console.log("\n✅ B2c " + (DRY_RUN ? "dry-run" : "live-run") + " complete.");
  process.exit(0);
}

main().catch(function(err) {
  console.error("Fatal:", err);
  process.exit(1);
});
