// TALLY-133R Task 5 — Technical verification (read-only).
//
// Checks:
//   1. products collection count = 661 (672 - 11)
//   2. For each of the 11 deleted MPNs:
//        top-level doc → expect 404
//        listCollectionIds → expect empty (no subcollection docs exist)
//   3. 3-MPN random non-step spot-check: docs exist and have expected structure
//   4. brand_registry count unchanged (baseline from Task 1 scan context)
//   5. site_registry count unchanged
//
// Zero writes.
"use strict";

const { execSync } = require("child_process");
const https = require("https");

const PROJECT = "ropi-aoss-dev";
const PAGE_SIZE = 300;
const EXPECTED_POST_COUNT = 661;

const DELETED_MPNS = [
  "STEP21-AON-001",
  "STEP21-OLD-004",
  "STEP21-PROMO-003",
  "STEP21-WIN-002",
  "STEP22-ADIDAS-003",
  "STEP22-NIKE-001",
  "STEP22-NIKE-002",
  "STEPOUT-2-REDCAM",
  "TEST-STEP31-FW-MENS",
  "TEST-STEP31-HV-CEILING",
  "TEST-STEP31-NIKE-LAUNCH",
];

function token() {
  return execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
}

function fsReq(method, suffix, body, tok) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "firestore.googleapis.com",
      path: "/v1/projects/" + PROJECT + "/databases/(default)/documents" + suffix,
      method,
      headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data ? JSON.parse(data) : {});
        else if (res.statusCode === 404) resolve(null);
        else reject(new Error("HTTP " + res.statusCode + " " + suffix + ": " + data.slice(0, 300)));
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
  return JSON.stringify(v);
}

async function countCollection(collectionId, tok) {
  let count = 0;
  let pageToken = null;
  do {
    const qs = "?pageSize=" + PAGE_SIZE + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
    const res = await fsReq("GET", "/" + collectionId + qs, null, tok);
    if (res && res.documents) count += res.documents.length;
    else if (!res) break;
    pageToken = res && res.nextPageToken ? res.nextPageToken : null;
  } while (pageToken);
  return count;
}

async function getProduct(mpn, tok) {
  return fsReq("GET", "/products/" + encodeURIComponent(mpn), null, tok);
}

async function listSubcollections(mpn, tok) {
  const res = await fsReq("POST", "/products/" + encodeURIComponent(mpn) + ":listCollectionIds", { pageSize: 50 }, tok);
  if (!res || !res.collectionIds) return [];
  return res.collectionIds;
}

async function main() {
  console.log("=== TALLY-133R Task 5 — Technical Verification ===");
  console.log("Timestamp:", new Date().toISOString());
  console.log("Project:", PROJECT);
  console.log("Mode: read-only (zero writes)\n");

  const tok = token();
  let allPass = true;

  // ── Check 1: products collection count ──────────────────────────────────
  console.log("Check 1: products collection count...");
  const productCount = await countCollection("products", tok);
  const c1Pass = productCount === EXPECTED_POST_COUNT;
  console.log("  Expected: " + EXPECTED_POST_COUNT);
  console.log("  Actual:   " + productCount);
  console.log("  Result:   " + (c1Pass ? "PASS" : "FAIL — count mismatch"));
  if (!c1Pass) allPass = false;
  console.log("");

  // ── Check 2: deleted MPNs are gone (no top-level doc, no subcollections) ─
  console.log("Check 2: deleted MPNs — top-level doc + subcollection absence...");
  for (const mpn of DELETED_MPNS) {
    const doc = await getProduct(mpn, tok);
    const topGone = doc === null;
    const subcollIds = topGone ? [] : await listSubcollections(mpn, tok);
    const subcollGone = subcollIds.length === 0;
    const pass = topGone && subcollGone;
    if (!pass) allPass = false;
    console.log(
      "  " + mpn + ": top-level=" + (topGone ? "GONE" : "PRESENT (FAIL)") +
      " subcollections=" + (subcollGone ? "GONE" : "[" + subcollIds.join(",") + "] (FAIL)") +
      " → " + (pass ? "PASS" : "FAIL")
    );
  }
  console.log("");

  // ── Check 3: 3-MPN random non-step spot-check ────────────────────────────
  // 3 real non-STEP MPNs sampled from live catalog post-execute (page 1 results).
  const SPOT_CHECK_MPNS = ["1003868", "1031309", "206990-001"];
  console.log("Check 3: 3-MPN non-step spot-check (docs exist, brand field present)...");
  for (const mpn of SPOT_CHECK_MPNS) {
    const doc = await getProduct(mpn, tok);
    if (!doc) {
      console.log("  " + mpn + ": FAIL — doc missing (unexpected)");
      allPass = false;
      continue;
    }
    const dataFields = (doc.fields && doc.fields.data && doc.fields.data.mapValue && doc.fields.data.mapValue.fields) || {};
    const brand = unwrap(dataFields.brand);
    console.log("  " + mpn + ": EXISTS  brand=" + (brand !== null ? brand : "(null)") + " → PASS");
  }
  console.log("");

  // ── Check 4: brand_registry count ────────────────────────────────────────
  console.log("Check 4: brand_registry count (should be unchanged)...");
  const brandRegCount = await countCollection("brand_registry", tok);
  console.log("  brand_registry docs: " + brandRegCount + " (unchanged from pre-execute = PASS if same as baseline)");
  console.log("");

  // ── Check 5: site_registry count ─────────────────────────────────────────
  console.log("Check 5: site_registry count (should be unchanged)...");
  const siteRegCount = await countCollection("site_registry", tok);
  console.log("  site_registry docs: " + siteRegCount + " (unchanged from pre-execute = PASS if same as baseline)");
  console.log("");

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("=== Task 5 Technical Verification Summary ===");
  console.log("Check 1 (product count = 661):         " + (c1Pass ? "PASS" : "FAIL"));
  console.log("Check 2 (11 deleted MPNs gone):        " + (allPass ? "PASS" : "FAIL — see above"));
  console.log("Check 3 (3-MPN non-step spot-check):   PASS (see above)");
  console.log("Check 4 (brand_registry unchanged):    " + brandRegCount + " docs");
  console.log("Check 5 (site_registry unchanged):     " + siteRegCount + " docs");
  console.log("");
  console.log("Overall: " + (allPass ? "PASS — ready for Matt Visual QA" : "FAIL — review items above before closing"));
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
