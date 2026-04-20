// TALLY-128 Task 2 — Brand Registry seed (governance data, not test fixtures).
//
// Seeds 10 PO-confirmed brand_registry entries (2026-04-20 ruling):
//   shiekh (priority 10):    Nike, Jordan, Adidas, Puma, Crocs, Smoke Rise,
//                            Pro Standard, New Era
//   karmaloop (priority 20): Billionaire Boys Club, IceCream
//   mltd (priority 30):      0 in this round (Frink R1 Q2: explicitly incomplete)
//
// Aliases (3 PO-approved per Task 1 diagnostic gap surfacing):
//   nike    aliases: ["NIKE INC."]      (recovers 23 products)
//   jordan  aliases: ["BRAND JORDAN"]   (recovers 23 products)
//   new_era aliases: ["NEW ERA CAPS"]   (recovers  6 products)
//
// Idempotent: writes use brand_key as document ID; existing docs are
// preserved (we read first; only write missing entries to avoid clobbering
// any aliases that may have been hand-extended). Re-runnable.
//
// Sentinel: created_by = "tally-128-task2" — filter on this for cleanup/audit.
//
// Codespace lacks ADC: uses Firestore REST API + gcloud access token.
"use strict";

const { execSync } = require("child_process");
const https = require("https");

const PROJECT = "ropi-aoss-dev";
const NOW_ISO = new Date().toISOString();
const CREATED_BY = "tally-128-task2";
const NOTES = "Seeded from PO ruling 2026-04-20";

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
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data ? JSON.parse(data) : {});
        } else if (res.statusCode === 404) {
          resolve(null);
        } else {
          reject(new Error("HTTP " + res.statusCode + " " + suffix + ": " + data));
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

// brand_key normalization mirrors backend/functions/src/lib/brandRegistry.ts
function normalizeBrand(s) {
  return (s || "").trim().toLowerCase();
}

function makeEntry(displayName, defaultSiteOwner, aliases) {
  return {
    brand_key: normalizeBrand(displayName),
    display_name: displayName,
    aliases: aliases || [],
    default_site_owner: defaultSiteOwner,
    is_active: true,
    po_confirmed: true,
    notes: NOTES,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    created_by: CREATED_BY,
  };
}

const SEED = [
  // shiekh — 8 brands
  makeEntry("Nike", "shiekh", ["NIKE INC."]),
  makeEntry("Jordan", "shiekh", ["BRAND JORDAN"]),
  makeEntry("Adidas", "shiekh", []),
  makeEntry("Puma", "shiekh", []),
  makeEntry("Crocs", "shiekh", []),
  makeEntry("Smoke Rise", "shiekh", []),
  makeEntry("Pro Standard", "shiekh", []),
  makeEntry("New Era", "shiekh", ["NEW ERA CAPS"]),
  // karmaloop — 2 brands
  makeEntry("Billionaire Boys Club", "karmaloop", []),
  makeEntry("IceCream", "karmaloop", []),
];

async function main() {
  console.log("=== TALLY-128 Task 2 Brand Registry seed ===");
  console.log("Project: " + PROJECT);
  console.log("Sentinel created_by: " + CREATED_BY);
  console.log("Timestamp: " + NOW_ISO);
  console.log("");

  const tok = token();

  let written = 0;
  let skipped = 0;

  for (const entry of SEED) {
    const docId = entry.brand_key;
    const path = "/brand_registry/" + encodeURIComponent(docId);

    // Idempotency check: skip if doc exists.
    const existing = await fsReq("GET", path, null, tok);
    if (existing) {
      const existingFields = existing.fields || {};
      const existingAliases = (existingFields.aliases && existingFields.aliases.arrayValue && existingFields.aliases.arrayValue.values || [])
        .map((v) => v.stringValue);
      console.log("- " + docId + " (default_site_owner=" + entry.default_site_owner +
        ") EXISTS; preserving (existing aliases: " + JSON.stringify(existingAliases) + ")");
      skipped++;
      continue;
    }

    const fields = {};
    for (const k of Object.keys(entry)) fields[k] = toFsValue(entry[k]);

    // Use createDocument so docId is set explicitly (matches brand_key).
    const createPath = "/brand_registry?documentId=" + encodeURIComponent(docId);
    await fsReq("POST", createPath, { fields }, tok);
    console.log("+ " + docId + " (default_site_owner=" + entry.default_site_owner +
      ", aliases=" + JSON.stringify(entry.aliases) + ") WRITTEN");
    written++;
  }

  console.log("");
  console.log("=== Seed complete: " + written + " written, " + skipped + " skipped ===");

  // ── Spot-check: read back is_active==true entries via runQuery ──
  console.log("");
  console.log("── Spot-check: SELECT * FROM brand_registry WHERE is_active==true ──");
  const queryRes = await new Promise((resolve, reject) => {
    const body = JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "brand_registry" }],
        where: { fieldFilter: { field: { fieldPath: "is_active" }, op: "EQUAL", value: { booleanValue: true } } },
      },
    });
    const opts = {
      hostname: "firestore.googleapis.com",
      path: "/v1/projects/" + PROJECT + "/databases/(default)/documents:runQuery",
      method: "POST",
      headers: {
        Authorization: "Bearer " + tok,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(data));
        else reject(new Error("HTTP " + res.statusCode + ": " + data));
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });

  const rows = (queryRes || []).filter((x) => x.document).map((x) => {
    const f = x.document.fields || {};
    const aliases = (f.aliases && f.aliases.arrayValue && f.aliases.arrayValue.values || [])
      .map((v) => v.stringValue);
    return {
      brand_key: f.brand_key && f.brand_key.stringValue,
      display_name: f.display_name && f.display_name.stringValue,
      default_site_owner: f.default_site_owner && f.default_site_owner.stringValue,
      aliases: aliases,
      po_confirmed: f.po_confirmed && f.po_confirmed.booleanValue,
      created_by: f.created_by && f.created_by.stringValue,
    };
  });
  rows.sort((a, b) => (a.brand_key || "").localeCompare(b.brand_key || ""));
  console.log("Total active entries: " + rows.length);
  for (const r of rows) {
    console.log("  " + r.brand_key + " | display=" + r.display_name +
      " | owner=" + r.default_site_owner +
      " | po_confirmed=" + r.po_confirmed +
      " | aliases=" + JSON.stringify(r.aliases) +
      " | created_by=" + r.created_by);
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
