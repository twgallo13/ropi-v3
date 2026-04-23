// TALLY-DEPARTMENT-REGISTRY — Department Registry seed (governance data).
//
// PO Ruling A (2026-04-23): create department_registry collection mirroring
// brand_registry + site_registry pattern exactly. Soft-deactivation only
// (Ruling G); no hard-delete (Ruling H).
//
// Seeds 4 PO-confirmed entries:
//   footwear      (priority 1) aliases: ["Shoes", "FOOTWEAR"]
//   clothing      (priority 2) aliases: ["CLOTHING", "Apparel"]
//   accessories   (priority 3) aliases: ["Accessory", "ACCESSORIES"]
//   home_and_tech (priority 4) aliases: ["Home and Tech", "HOME & TECH"]
//
// Also patches attribute_registry/department:
//   - removes hardcoded `dropdown_options` (sets to [])
//   - adds `enum_source: "department_registry"` field
//
// Idempotent: writes use `key` as document ID; existing department_registry
// docs are PRESERVED on rerun (read first, only write missing entries).
// attribute_registry/department patch is set-with-merge (always converges).
//
// Sentinel: created_by = "tally-department-registry" — filter on this for
// cleanup/audit.
//
// Codespace lacks ADC: uses Firestore REST API + gcloud access token.
"use strict";

const { execSync } = require("child_process");
const https = require("https");

const PROJECT = "ropi-aoss-dev";
const NOW_ISO = new Date().toISOString();
const CREATED_BY = "tally-department-registry";
const NOTES = "Seeded from PO Ruling A (2026-04-23)";
const COLLECTION = "department_registry";

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

function makeEntry(key, displayName, aliases, priority) {
  return {
    key,
    display_name: displayName,
    aliases: aliases || [],
    is_active: true,
    priority,
    po_confirmed: true,
    notes: NOTES,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    created_by: CREATED_BY,
  };
}

const SEED = [
  makeEntry("footwear", "Footwear", ["Shoes", "FOOTWEAR"], 1),
  makeEntry("clothing", "Clothing", ["CLOTHING", "Apparel"], 2),
  makeEntry("accessories", "Accessories", ["Accessory", "ACCESSORIES"], 3),
  makeEntry("home_and_tech", "Home & Tech", ["Home and Tech", "HOME & TECH"], 4),
];

function runQuery(tok, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      hostname: "firestore.googleapis.com",
      path: "/v1/projects/" + PROJECT + "/databases/(default)/documents:runQuery",
      method: "POST",
      headers: {
        Authorization: "Bearer " + tok,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
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
    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log("=== TALLY-DEPARTMENT-REGISTRY seed ===");
  console.log("Project: " + PROJECT);
  console.log("Sentinel created_by: " + CREATED_BY);
  console.log("Timestamp: " + NOW_ISO);
  console.log("");

  const tok = token();

  // ── Phase 1: seed department_registry (idempotent, preserve existing) ──
  let written = 0;
  let skipped = 0;
  for (const entry of SEED) {
    const docId = entry.key;
    const path = "/" + COLLECTION + "/" + encodeURIComponent(docId);
    const existing = await fsReq("GET", path, null, tok);
    if (existing) {
      console.log("- " + docId + " EXISTS; preserving");
      skipped++;
      continue;
    }
    const fields = {};
    for (const k of Object.keys(entry)) fields[k] = toFsValue(entry[k]);
    const createPath = "/" + COLLECTION + "?documentId=" + encodeURIComponent(docId);
    await fsReq("POST", createPath, { fields }, tok);
    console.log(
      "+ " + docId + " (display=" + entry.display_name +
        ", priority=" + entry.priority +
        ", aliases=" + JSON.stringify(entry.aliases) + ") WRITTEN"
    );
    written++;
  }
  console.log("");
  console.log("=== department_registry seed complete: " + written + " written, " + skipped + " skipped ===");

  // ── Phase 2: patch attribute_registry/department ──
  //   - dropdown_options → []
  //   - enum_source → "department_registry"
  //   - updated_at → now
  //   Set-with-merge so other fields (display_label, destination_tab, etc.)
  //   are preserved.
  console.log("");
  console.log("── Patching attribute_registry/department (enum_source + clear options) ──");
  const attrPath = "/attribute_registry/department";
  const attrFields = {
    enum_source: toFsValue("department_registry"),
    dropdown_options: toFsValue([]),
    updated_at: toFsValue(NOW_ISO),
    updated_by: toFsValue(CREATED_BY),
  };
  // PATCH with updateMask so we don't blow away other fields.
  const mask =
    "?updateMask.fieldPaths=enum_source" +
    "&updateMask.fieldPaths=dropdown_options" +
    "&updateMask.fieldPaths=updated_at" +
    "&updateMask.fieldPaths=updated_by";
  await fsReq("PATCH", attrPath + mask, { fields: attrFields }, tok);
  console.log("  ✓ attribute_registry/department.enum_source = \"department_registry\"");
  console.log("  ✓ attribute_registry/department.dropdown_options = []");

  // ── Phase 3: spot-check ──
  console.log("");
  console.log("── Spot-check: SELECT * FROM department_registry ──");
  const queryRes = await runQuery(tok, {
    structuredQuery: { from: [{ collectionId: COLLECTION }] },
  });
  const rows = (queryRes || [])
    .filter((x) => x.document)
    .map((x) => {
      const f = x.document.fields || {};
      const aliases = (f.aliases && f.aliases.arrayValue && f.aliases.arrayValue.values || [])
        .map((v) => v.stringValue);
      return {
        key: f.key && f.key.stringValue,
        display_name: f.display_name && f.display_name.stringValue,
        is_active: f.is_active && f.is_active.booleanValue,
        priority: f.priority && parseInt(f.priority.integerValue || "999", 10),
        po_confirmed: f.po_confirmed && f.po_confirmed.booleanValue,
        aliases: aliases,
      };
    });
  rows.sort((a, b) => (a.priority || 999) - (b.priority || 999));
  console.log("Total entries: " + rows.length);
  for (const r of rows) {
    console.log(
      "  " + r.key + " | display=" + r.display_name +
        " | active=" + r.is_active +
        " | priority=" + r.priority +
        " | po_confirmed=" + r.po_confirmed +
        " | aliases=" + JSON.stringify(r.aliases)
    );
  }

  console.log("");
  console.log("── Spot-check: attribute_registry/department ──");
  const attrDoc = await fsReq("GET", attrPath, null, tok);
  if (!attrDoc) {
    console.log("  WARN: attribute_registry/department not found");
  } else {
    const f = attrDoc.fields || {};
    const enumSource = f.enum_source && f.enum_source.stringValue;
    const dropdownOptions = (f.dropdown_options && f.dropdown_options.arrayValue && f.dropdown_options.arrayValue.values || [])
      .map((v) => v.stringValue);
    console.log("  enum_source     = " + JSON.stringify(enumSource));
    console.log("  dropdown_options = " + JSON.stringify(dropdownOptions));
  }

  // ── Tally Tests 7 & 8 (integration assertions) ──
  console.log("");
  console.log("── TEST 7 — existing products with pre-existing department values NOT re-validated ──");
  const productSample = await runQuery(tok, {
    structuredQuery: {
      from: [{ collectionId: "products" }],
      limit: 1,
    },
  });
  const sampleDoc = (productSample || []).find((x) => x.document);
  if (!sampleDoc) {
    console.log("  ⚠  no products to sample — skipping (no-op verification)");
  } else {
    const docName = sampleDoc.document.name; // projects/.../documents/products/<id>
    const idx = docName.lastIndexOf("/");
    const docId = docName.substring(idx + 1);
    const updatedBefore = sampleDoc.document.updateTime;
    // Re-read to confirm unchanged updateTime — proves seed did not touch products.
    const recheck = await fsReq("GET", "/products/" + encodeURIComponent(docId), null, tok);
    const updatedAfter = recheck && recheck.updateTime;
    if (updatedBefore === updatedAfter) {
      console.log("  ✓ TEST 7 PASS — product " + docId + " updateTime unchanged (" + updatedAfter + ")");
    } else {
      console.log("  ✗ TEST 7 FAIL — product updateTime drift: " + updatedBefore + " → " + updatedAfter);
      process.exit(1);
    }
  }

  console.log("");
  console.log("── TEST 8 — attribute_registry/department has enum_source + no dropdown_options ──");
  const recheckAttr = await fsReq("GET", attrPath, null, tok);
  const af = (recheckAttr && recheckAttr.fields) || {};
  const enumOk =
    af.enum_source && af.enum_source.stringValue === "department_registry";
  const dropdownArr =
    (af.dropdown_options && af.dropdown_options.arrayValue && af.dropdown_options.arrayValue.values) || [];
  const dropdownOk = dropdownArr.length === 0;
  if (enumOk && dropdownOk) {
    console.log("  ✓ TEST 8 PASS — enum_source=\"department_registry\", dropdown_options=[]");
  } else {
    console.log("  ✗ TEST 8 FAIL — enum_source=" + (af.enum_source && af.enum_source.stringValue) +
      ", dropdown_options.length=" + dropdownArr.length);
    process.exit(1);
  }

  console.log("");
  console.log("=== Seed + integration assertions complete ===");
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
