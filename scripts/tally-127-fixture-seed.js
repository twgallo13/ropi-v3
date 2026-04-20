// TALLY-127 Task 1b fixture seed (dev environment only).
// These site_verification writes are TEMPORARY DEV FIXTURES created for Pass 4 evidence.
// They are expected to be overwritten or removed by the later clean CSV reimport.
// DO NOT treat seeded data as normal live dev state.
// Sentinel: reviewer_uid = "seed-tally-127" — filter on this value for cleanup/audit.
//
// Seeds 4 MPNs covering scenarios A–D for buyer-review fixture matrix.
// Scenario E (fully unverified) left alone — natural state on remaining 4 buyer-eligible products.
//
// Locked MPN assignments:
//   A — STEP21-AON-001   shiekh=verified_live (img+url+3 addl), karmaloop=verified_live (img+url)
//   B — STEP21-WIN-002   shiekh=verified_live (img+url) only
//   C — STEP21-PROMO-003 shiekh=mismatch (no img/url), karmaloop=verified_live (img+url)
//   D — STEP21-OLD-004   shiekh=verified_live (no img, has url), karmaloop=verified_live (img+url)
//
// Idempotent: PATCH with updateMask=site_verification merges per-site map keys.
// Re-running is safe.
// Uses Firestore REST API + gcloud access token (codespace lacks ADC).
"use strict";

const { execSync } = require("child_process");
const https = require("https");

const PROJECT = "ropi-aoss-dev";
const SENTINEL_UID = "seed-tally-127";
const NOW_ISO = new Date().toISOString();
const TODAY_STR = NOW_ISO.slice(0, 10);

function getToken() {
  return execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
}

function fsRequest(method, pathSuffix, body, token) {
  return new Promise(function (resolve, reject) {
    const opts = {
      hostname: "firestore.googleapis.com",
      path: "/v1/projects/" + PROJECT + "/databases/(default)/documents" + pathSuffix,
      method: method,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
    };
    const req = https.request(opts, function (res) {
      let data = "";
      res.on("data", function (c) { data += c; });
      res.on("end", function () {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data ? JSON.parse(data) : {});
        } else {
          reject(new Error("HTTP " + res.statusCode + " " + opts.path + ": " + data));
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) return { timestampValue: v };
    return { stringValue: v };
  }
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === "object") {
    const fields = {};
    for (const k of Object.keys(v)) fields[k] = toFsValue(v[k]);
    return { mapValue: { fields } };
  }
  throw new Error("Unsupported value type: " + typeof v);
}

function verifiedLive(opts) {
  return {
    verification_state: "verified_live",
    image_url: opts.image_url || null,
    product_url: opts.product_url || null,
    additional_image_url: opts.additional_image_url || null,
    mismatch_reason: null,
    reviewer_uid: SENTINEL_UID,
    reviewer_action_at: NOW_ISO,
    verification_date: TODAY_STR,
    last_verified_at: NOW_ISO,
  };
}

function mismatchEntry(opts) {
  return {
    verification_state: "mismatch",
    image_url: null,
    product_url: null,
    additional_image_url: null,
    mismatch_reason: opts.reason,
    reviewer_uid: SENTINEL_UID,
    reviewer_action_at: NOW_ISO,
    verification_date: TODAY_STR,
    last_verified_at: NOW_ISO,
  };
}

const FIXTURES = [
  {
    scenario: "A",
    mpn: "STEP21-AON-001",
    site_verification: {
      shiekh: verifiedLive({
        image_url: "https://placehold.co/600x600/16a34a/ffffff?text=A+shiekh+primary",
        product_url: "https://placehold.co/1000x800/166534/ffffff?text=A+shiekh+product+page+(fixture)",
        additional_image_url:
          "https://placehold.co/600x600/0d9488/ffffff?text=A+shiekh+addl+1," +
          "https://placehold.co/600x600/0d9488/ffffff?text=A+shiekh+addl+2," +
          "https://placehold.co/600x600/0d9488/ffffff?text=A+shiekh+addl+3,",
      }),
      karmaloop: verifiedLive({
        image_url: "https://placehold.co/600x600/2563eb/ffffff?text=A+karmaloop",
        product_url: "https://placehold.co/1000x800/1e3a8a/ffffff?text=A+karmaloop+product+page+(fixture)",
        additional_image_url: null,
      }),
    },
  },
  {
    scenario: "B",
    mpn: "STEP21-WIN-002",
    site_verification: {
      shiekh: verifiedLive({
        image_url: "https://placehold.co/600x600/16a34a/ffffff?text=B+shiekh+primary",
        product_url: "https://placehold.co/1000x800/166534/ffffff?text=B+shiekh+product+page+(fixture)",
        additional_image_url: null,
      }),
    },
  },
  {
    scenario: "C",
    mpn: "STEP21-PROMO-003",
    site_verification: {
      shiekh: mismatchEntry({
        reason: "TALLY-127 Task 1b fixture: primary mismatch — fallback available on karmaloop",
      }),
      karmaloop: verifiedLive({
        image_url: "https://placehold.co/600x600/2563eb/ffffff?text=C+karmaloop+FALLBACK",
        product_url: "https://placehold.co/1000x800/1e3a8a/ffffff?text=C+karmaloop+product+page+(fixture)",
        additional_image_url: null,
      }),
    },
  },
  {
    scenario: "D",
    mpn: "STEP21-OLD-004",
    site_verification: {
      shiekh: {
        verification_state: "verified_live",
        image_url: null,
        product_url: "https://placehold.co/1000x800/166534/ffffff?text=D+shiekh+product+page+(fixture)",
        additional_image_url: null,
        mismatch_reason: null,
        reviewer_uid: SENTINEL_UID,
        reviewer_action_at: NOW_ISO,
        verification_date: TODAY_STR,
        last_verified_at: NOW_ISO,
      },
      karmaloop: verifiedLive({
        image_url: "https://placehold.co/600x600/2563eb/ffffff?text=D+karmaloop+FALLBACK",
        product_url: "https://placehold.co/1000x800/1e3a8a/ffffff?text=D+karmaloop+product+page+(fixture)",
        additional_image_url: null,
      }),
    },
  },
];

async function main() {
  console.log("=== TALLY-127 Task 1b fixture seed ===");
  console.log("Project: " + PROJECT);
  console.log("Sentinel reviewer_uid: " + SENTINEL_UID);
  console.log("Timestamp: " + NOW_ISO);
  console.log("");

  const token = getToken();

  for (const fx of FIXTURES) {
    try {
      await fsRequest("GET", "/products/" + fx.mpn + "?mask.fieldPaths=mpn", null, token);
    } catch (e) {
      console.error("X Scenario " + fx.scenario + " MPN " + fx.mpn + " GET failed: " + e.message);
      process.exit(1);
    }

    console.log("-> Scenario " + fx.scenario + " - " + fx.mpn);

    const fields = { site_verification: toFsValue(fx.site_verification) };
    const path = "/products/" + fx.mpn + "?updateMask.fieldPaths=site_verification";

    for (const siteKey of Object.keys(fx.site_verification)) {
      const entry = fx.site_verification[siteKey];
      const fieldList = Object.keys(entry).join(", ");
      console.log("    site_verification." + siteKey + " <- " + entry.verification_state + " { " + fieldList + " }");
    }

    await fsRequest("PATCH", path, { fields: fields }, token);
    console.log("    written");
  }

  console.log("");
  console.log("=== Seed complete: " + FIXTURES.length + " products written ===");
  console.log("Cleanup query: products where site_verification.{any}.reviewer_uid == 'seed-tally-127'");
}

main().catch(function (e) {
  console.error("FATAL:", e.message);
  process.exit(1);
});
