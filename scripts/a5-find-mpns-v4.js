#!/usr/bin/env node
/**
 * A.5 MPN finder v4 — download the batch CSV from Firebase Storage to extract MPNs.
 * Batch file_path: imports/weekly-operations/8616a4e1-4805-4abc-8f91-3db5d19a79aa/weekend426.csv
 */
"use strict";
const admin = require("firebase-admin");
// Simple CSV parser — splits on newline + comma, handles quoted fields
function parseCsv(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(function(l) { return l.trim(); });
  if (lines.length === 0) return [];
  var cols = lines[0].split(",").map(function(c) { return c.trim().replace(/^"|"$/g, ""); });
  var records = [];
  for (var i = 1; i < lines.length; i++) {
    var vals = lines[i].split(",").map(function(c) { return c.trim().replace(/^"|"$/g, ""); });
    var row = {};
    cols.forEach(function(c, idx) { row[c] = vals[idx] || ""; });
    records.push(row);
  }
  return records;
}

const cred = JSON.parse(process.env.GCP_SA_KEY_DEV);
admin.initializeApp({
  credential: admin.credential.cert(cred),
  projectId: "ropi-aoss-dev",
  storageBucket: cred.project_id + ".appspot.com",
});

const FILE_PATH = "imports/weekly-operations/8616a4e1-4805-4abc-8f91-3db5d19a79aa/weekend426.csv";

async function main() {
  const bucket = admin.storage().bucket();
  console.log("Bucket:", bucket.name);
  console.log("Downloading:", FILE_PATH);

  // Try default bucket first, then explicit
  let file = bucket.file(FILE_PATH);
  
  const [buf] = await file.download();
  const csv = buf.toString("utf-8");
  console.log("CSV bytes:", buf.length);

  const records = parseCsv(csv);

  console.log("Total records:", records.length);
  console.log("Columns:", records.length > 0 ? Object.keys(records[0]).join(", ") : "(none)");

  const mpns = records.map(function(r) { return (r.MPN || r.mpn || "").trim(); }).filter(Boolean);
  console.log("MPNs (" + mpns.length + "):", mpns);

  // Sample 3: first, middle, last
  if (mpns.length === 0) return;
  const sample = mpns.length <= 3
    ? mpns
    : [mpns[0], mpns[Math.floor(mpns.length / 2)], mpns[mpns.length - 1]];
  console.log("\nSample 3:", sample);
}

main().catch(function(e) { console.error(e.message || e); process.exit(1); });
