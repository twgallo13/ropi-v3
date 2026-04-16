#!/usr/bin/env node
/**
 * Diagnostic: missing products
 * Parses shiekh-real-ro.csv, counts valid rows (non-empty MPN, numeric prices),
 * queries Firestore products collection, and reports which MPNs are absent.
 *
 * Usage:
 *   GCP_SA_KEY_DEV='...' node scripts/diagnostic-products.js
 */
"use strict";
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const KEY_ENV = process.env.GCP_SA_KEY_DEV || process.env.SERVICE_ACCOUNT_JSON;
if (!KEY_ENV) { console.error("❌  GCP_SA_KEY_DEV not set"); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(KEY_ENV)), projectId: "ropi-aoss-dev" });
const db = admin.firestore();

const CSV_PATH = path.join(__dirname, "shiekh-real-ro.csv");
const PRICE_COLS = ["Web Regular Price", "Web Sale Price", "Retail Price", "Retail Sale Price"];

function mpnToDocId(mpn) { return mpn.replace(/\//g, "__"); }

async function main() {
  // ── 1. Parse CSV ──
  const csvContent = fs.readFileSync(CSV_PATH, "utf-8");
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });

  console.log(`\n📄  CSV file: ${path.basename(CSV_PATH)}`);
  console.log(`   Raw records parsed: ${records.length}`);

  const csvMpns = new Set();
  const skippedRows = [];

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const rowNum = i + 2;
    const mpn = (row.MPN || "").trim();

    if (!mpn) {
      skippedRows.push({ row: rowNum, mpn: "(blank)", reason: "MPN is empty" });
      continue;
    }

    let invalid = false;
    for (const col of PRICE_COLS) {
      const val = (row[col] || "").trim();
      if (val !== "" && isNaN(Number(val))) {
        skippedRows.push({ row: rowNum, mpn, reason: `Non-numeric price in [${col}]: "${val}"` });
        invalid = true;
        break;
      }
    }
    if (!invalid) csvMpns.add(mpn);
  }

  console.log(`   Valid MPN rows:    ${csvMpns.size}`);
  console.log(`   Skipped rows:      ${skippedRows.length}`);
  if (skippedRows.length) {
    console.log("\n   Skipped row details:");
    skippedRows.forEach(r => console.log(`      Row ${r.row} (MPN: ${r.mpn}): ${r.reason}`));
  }

  // ── 2. Query Firestore ──
  const snap = await db.collection("products").get();
  const firestoreMpns = new Set();
  snap.docs.forEach(d => {
    const mpn = d.data().mpn || d.id.replace(/__/g, "/");
    firestoreMpns.add(mpn);
  });

  console.log(`\n🔥  Firestore products count: ${firestoreMpns.size}`);

  // ── 3. Diff ──
  const missingInFirestore = [...csvMpns].filter(m => !firestoreMpns.has(m) && !firestoreMpns.has(mpnToDocId(m)));
  const extraInFirestore   = [...firestoreMpns].filter(m => !csvMpns.has(m));

  console.log(`\n🔍  MPNs in CSV but NOT in Firestore (${missingInFirestore.length}):`);
  if (missingInFirestore.length === 0) {
    console.log("   (none — all valid CSV rows are in Firestore)");
  } else {
    missingInFirestore.forEach((m, i) => console.log(`   ${i + 1}. "${m}"`));
  }

  console.log(`\n🔍  MPNs in Firestore but NOT in CSV (${extraInFirestore.length}):`);
  if (extraInFirestore.length === 0) {
    console.log("   (none)");
  } else {
    extraInFirestore.forEach((m, i) => console.log(`   ${i + 1}. "${m}"`));
  }

  // ── 4. Check latest import_batches for errors ──
  const batchSnap = await db.collection("import_batches")
    .orderBy("created_at", "desc")
    .limit(3)
    .get();

  console.log(`\n📦  Last ${batchSnap.size} import batch(es):`);
  batchSnap.docs.forEach(d => {
    const b = d.data();
    console.log(`   Batch ${d.id.slice(0, 8)}… | status: ${b.status} | rows: ${b.row_count} | committed: ${b.committed_rows} | failed: ${b.failed_rows}`);
    if (b.errors && b.errors.length) {
      console.log(`      Errors (${b.errors.length}):`);
      b.errors.forEach(e => console.log(`        Row ${e.row} MPN=${e.mpn}: ${e.error}`));
    }
    if (b.warnings && b.warnings.length) {
      console.log(`      Warnings (${b.warnings.length}):`);
      b.warnings.slice(0, 5).forEach(w => console.log(`        ${w}`));
      if (b.warnings.length > 5) console.log(`        … and ${b.warnings.length - 5} more`);
    }
  });

  console.log("\n✅  Diagnostic complete.\n");
}

main().catch(e => { console.error("❌  Diagnostic failed:", e); process.exit(1); });
