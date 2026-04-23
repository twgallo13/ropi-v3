// TALLY-133R Task 1 — STEP-Prefix Product Diagnostic (read-only).
//
// Scans the products collection for MPNs matching /step/i.
// For each match:
//   - Reports MPN, data.brand, data.site_owner
//   - Lists every subcollection and its document count
//
// Also reports total product count (pre-execute baseline for Task 5 delta).
//
// ZERO Firestore writes. Read-only.
//
// Pattern: Firestore REST + gcloud access token (no ADC in codespace).
"use strict";

const { execSync } = require("child_process");
const https = require("https");

const PROJECT = "ropi-aoss-dev";
const STEP_RE = /step/i;
const PAGE_SIZE = 300;

function token() {
  return execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
}

function fsReq(method, suffix, body, tok) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "firestore.googleapis.com",
      path: "/v1/projects/" + PROJECT + "/databases/(default)/documents" + suffix,
      method,
      headers: {
        Authorization: "Bearer " + tok,
        "Content-Type": "application/json",
      },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data ? JSON.parse(data) : {});
        } else if (res.statusCode === 404) {
          resolve(null);
        } else {
          reject(new Error("HTTP " + res.statusCode + " on " + suffix + ": " + data.slice(0, 300)));
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function unwrap(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return parseInt(v.integerValue, 10);
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("doubleValue" in v) return v.doubleValue;
  return JSON.stringify(v);
}

async function getAllProducts(tok) {
  const all = [];
  let pageToken = null;
  do {
    const qs = "?pageSize=" + PAGE_SIZE + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
    const res = await fsReq("GET", "/products" + qs, null, tok);
    if (res && res.documents) {
      for (const doc of res.documents) {
        const nameParts = doc.name.split("/");
        const mpn = nameParts[nameParts.length - 1];
        const fields = doc.fields || {};
        const dataFields = (fields.data && fields.data.mapValue && fields.data.mapValue.fields) || {};
        all.push({
          mpn,
          brand: unwrap(dataFields.brand),
          site_owner: unwrap(dataFields.site_owner),
        });
      }
    }
    pageToken = res && res.nextPageToken ? res.nextPageToken : null;
  } while (pageToken);
  return all;
}

// List subcollection IDs under a product document.
async function listSubcollections(mpn, tok) {
  const encodedMpn = encodeURIComponent(mpn);
  const suffix = "/products/" + encodedMpn + ":listCollectionIds";
  const res = await fsReq("POST", suffix, { pageSize: 50 }, tok);
  if (!res || !res.collectionIds) return [];
  return res.collectionIds;
}

// Count documents in a subcollection.
async function countSubcollectionDocs(mpn, subcollId, tok) {
  const encodedMpn = encodeURIComponent(mpn);
  const suffix = "/products/" + encodedMpn + "/" + subcollId + "?pageSize=300";
  const res = await fsReq("GET", suffix, null, tok);
  if (!res || !res.documents) return 0;
  return res.documents.length;
}

async function main() {
  console.log("=== TALLY-133R Task 1 — STEP-Prefix Product Diagnostic ===");
  console.log("Timestamp:", new Date().toISOString());
  console.log("Project:", PROJECT);
  console.log("Mode: read-only (zero writes)\n");

  const tok = token();

  // ── Phase 1: Total product count baseline ──
  console.log("Phase 1: scanning all products for baseline count...");
  const allProducts = await getAllProducts(tok);
  const totalCount = allProducts.length;
  console.log("  Total products in collection:", totalCount);

  // ── Phase 2: Filter /step/i matches ──
  const stepProducts = allProducts.filter((p) => STEP_RE.test(p.mpn));
  console.log("\nPhase 2: /step/i MPN filter...");
  console.log("  Matched:", stepProducts.length, "product(s)");

  if (stepProducts.length === 0) {
    console.log("\nSTOP: match count is 0. Report to Lisa. Do NOT proceed to Task 2.");
    process.exit(1);
  }
  if (stepProducts.length > 50) {
    console.log("\nSTOP: match count (" + stepProducts.length + ") is unexpectedly high. Report to Lisa. Do NOT proceed to Task 2.");
    process.exit(1);
  }

  // ── Phase 3: Per-match detail + subcollection inventory ──
  console.log("\nPhase 3: per-match detail + subcollection inventory...\n");

  const allDiscoveredSubcollNames = new Set();
  const matchDetails = [];

  for (const p of stepProducts) {
    const subcollIds = await listSubcollections(p.mpn, tok);
    const subcollDetail = [];
    for (const sid of subcollIds) {
      const count = await countSubcollectionDocs(p.mpn, sid, tok);
      subcollDetail.push({ name: sid, count });
      allDiscoveredSubcollNames.add(sid);
    }
    matchDetails.push({ ...p, subcollections: subcollDetail });
  }

  // ── Report ──
  console.log("--- STEP-Prefix Product Inventory ---");
  for (const p of matchDetails) {
    console.log("\nMPN:        " + p.mpn);
    console.log("  brand:      " + (p.brand ?? "(null)"));
    console.log("  site_owner: " + (p.site_owner ?? "(null)"));
    if (p.subcollections.length === 0) {
      console.log("  subcollections: (none)");
    } else {
      for (const s of p.subcollections) {
        console.log("  subcollection: " + s.name + " (" + s.count + " doc" + (s.count !== 1 ? "s" : "") + ")");
      }
    }
  }

  console.log("\n--- Distinct subcollection names discovered across all STEP products ---");
  const namesArr = Array.from(allDiscoveredSubcollNames).sort();
  if (namesArr.length === 0) {
    console.log("  (none)");
  } else {
    for (const n of namesArr) {
      console.log("  " + n);
    }
  }

  console.log("\n--- Summary ---");
  console.log("Total products (baseline):  " + totalCount);
  console.log("STEP-prefix matches:        " + stepProducts.length);
  console.log("Distinct subcoll names:     " + namesArr.length + " — " + (namesArr.length > 0 ? namesArr.join(", ") : "(none)"));
  console.log("\nNOTE: §3 approved-list assertion BLOCKED — Notion dispatch page requires");
  console.log("authentication and could not be read. Provide the §3 approved list to");
  console.log("complete the assertion check before Task 2 greenlight.");
  console.log("\n--- Task 1 Gate: awaiting Lisa review ---");
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
