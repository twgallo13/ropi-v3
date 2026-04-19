#!/usr/bin/env node
/**
 * Phase 4.4 — Pre-Pass-1 Diagnostic (READ-ONLY)
 * For: Lisa
 * By:  Homer
 *
 * Five steps. No writes.
 *   1) site_owner value distribution across products/
 *   2) site_verification map key distribution across products/
 *   3) Cross-reference: does site_owner match a map key (with shiekh ↔ shiekh_com equivalence)?
 *   4) site_registry collection dump (verbatim)
 *   5) (answered by Homer in chat — not in this script)
 *
 * Usage:
 *   GCP_SA_KEY_DEV must be set (or pass JSON via SERVICE_ACCOUNT_JSON).
 *   node scripts/phase-4-4-prepass1-diagnostic.js
 */
"use strict";

const admin = require("firebase-admin");
const fs = require("fs");

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

// Treat shiekh ↔ shiekh_com as equivalent.
// Strategy: lower-case, strip non-alphanumeric (so "shiekh_com" -> "shiekhcom",
// "Shiekh.com" -> "shiekhcom", "shiekh" -> "shiekh"), then also produce a
// "stem" by removing a trailing "com" so we can match "shiekh" to "shiekh_com".
function normalizeKey(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  return s.replace(/[^a-z0-9]/g, ""); // shiekh_com -> shiekhcom
}
function stem(normalized) {
  if (!normalized) return null;
  return normalized.endsWith("com") ? normalized.slice(0, -3) : normalized;
}
function equivalent(a, b) {
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return stem(na) === stem(nb);
}

async function streamProducts() {
  // Single full scan; we tee into all three product-level analyses.
  console.log("→ Scanning products/ collection (single full read)…");
  const snap = await db.collection("products").get();
  console.log(`  Total product documents: ${snap.size}`);
  return snap;
}

function step1_siteOwner(snap) {
  const counts = new Map(); // raw value -> count
  let missing = 0;
  let nonString = 0;
  for (const doc of snap.docs) {
    const v = doc.get("site_owner");
    if (v === undefined || v === null || v === "") {
      missing++;
      continue;
    }
    if (typeof v !== "string") {
      nonString++;
      const key = `<non-string:${typeof v}:${JSON.stringify(v)}>`;
      counts.set(key, (counts.get(key) || 0) + 1);
      continue;
    }
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return {
    total_products: snap.size,
    missing_or_empty: missing,
    non_string: nonString,
    distinct_values: counts.size,
    distribution: Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, count })),
  };
}

function step2_mapKeys(snap) {
  const keyCounts = new Map(); // map key -> count of products containing it
  let productsWithMap = 0;
  let productsWithoutMap = 0;
  for (const doc of snap.docs) {
    const sv = doc.get("site_verification");
    if (!sv || typeof sv !== "object" || Array.isArray(sv)) {
      productsWithoutMap++;
      continue;
    }
    const keys = Object.keys(sv);
    if (keys.length === 0) {
      productsWithoutMap++;
      continue;
    }
    productsWithMap++;
    for (const k of keys) {
      keyCounts.set(k, (keyCounts.get(k) || 0) + 1);
    }
  }
  return {
    products_with_site_verification_map: productsWithMap,
    products_without_site_verification_map: productsWithoutMap,
    distinct_map_keys: keyCounts.size,
    distribution: Array.from(keyCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count })),
  };
}

function step3_crossref(snap) {
  let bothPresent = 0;
  let matchAtLeastOne = 0;
  let noMatch = 0;
  const noMatchSamples = [];
  for (const doc of snap.docs) {
    const owner = doc.get("site_owner");
    const sv = doc.get("site_verification");
    if (!owner || typeof owner !== "string") continue;
    if (!sv || typeof sv !== "object" || Array.isArray(sv)) continue;
    const keys = Object.keys(sv);
    if (keys.length === 0) continue;
    bothPresent++;
    const matched = keys.some((k) => equivalent(owner, k));
    if (matched) {
      matchAtLeastOne++;
    } else {
      noMatch++;
      if (noMatchSamples.length < 10) {
        noMatchSamples.push({ doc_id: doc.id, site_owner: owner, map_keys: keys });
      }
    }
  }
  return {
    products_with_both_owner_and_map: bothPresent,
    site_owner_matches_a_map_key: matchAtLeastOne,
    site_owner_matches_no_map_key: noMatch,
    no_match_samples_first_10: noMatchSamples,
    equivalence_rule:
      "lower-case, strip non-alphanumeric, then strip trailing 'com' (so 'shiekh' ≡ 'shiekh_com' ≡ 'Shiekh.com')",
  };
}

async function step4_siteRegistry() {
  const snap = await db.collection("site_registry").get();
  if (snap.empty) {
    return { exists: false, document_count: 0, documents: [] };
  }
  const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  return { exists: true, document_count: docs.length, documents: docs };
}

async function main() {
  const snap = await streamProducts();

  const step1 = step1_siteOwner(snap);
  const step2 = step2_mapKeys(snap);
  const step3 = step3_crossref(snap);
  const step4 = await step4_siteRegistry();

  const report = {
    generated_at: new Date().toISOString(),
    project: "ropi-aoss-dev",
    step1_site_owner_distribution: step1,
    step2_site_verification_map_key_distribution: step2,
    step3_cross_reference: step3,
    step4_site_registry_dump: step4,
  };

  const outPath = "/tmp/phase-4-4-prepass1-diagnostic.json";
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n✅  Report written: ${outPath}`);

  // Also echo to stdout for the chat transcript.
  console.log("\n──────── REPORT ────────");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
