// TALLY-PRODUCT-LIST-UX Phase 0.5 — Product brand_key + department_key backfill.
//
// Per-product backfill that resolves brand → brand_key (via brand_registry
// matchBrand contract) and department → department_key (normalize + active
// registry membership check), then PATCHes both fields onto the product doc.
//
// Mirrors structure of tally-product-list-ux-p05-brand-reseed.js (REST API
// + gcloud access token, --dry-run / --execute flags).
//
// Behavior contract:
//   - Read product.brand (string) and product.department (string).
//   - brand_key resolution: normalize (trim+lower) + exact key + alias walk.
//     Unresolved → null (non-blocking; matches importFullProduct.ts ruling).
//   - department_key resolution: normalize (trim+lower); membership in
//     active department_registry keys. Unresolved → null.
//   - Firestore PATCH with updateMask=brand_key,department_key (merge-style;
//     never deletes other fields).
//
// Flags:
//   --dry-run (default)   read + compute, no writes; full per-product log
//   --execute             actually PATCH products
//   --limit N             cap to first N products (omit = all)
//
// Codespace lacks ADC: REST API + gcloud access token.
"use strict";

const { execSync } = require("child_process");
const https = require("https");

const PROJECT = "ropi-aoss-dev";
const NOW_ISO = new Date().toISOString();

const argv = process.argv.slice(2);
const EXECUTE = argv.includes("--execute");
const DRY_RUN = !EXECUTE;
let LIMIT = null;
{
  const i = argv.indexOf("--limit");
  if (i >= 0 && argv[i + 1]) {
    const n = parseInt(argv[i + 1], 10);
    if (Number.isFinite(n) && n > 0) LIMIT = n;
  }
}

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
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  throw new Error("Unsupported value type for backfill: " + typeof v);
}

// Decode Firestore Value to plain JS (only the types we read here).
function fromFsValue(v) {
  if (!v) return null;
  if ("nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return parseInt(v.integerValue, 10);
  if ("doubleValue" in v) return v.doubleValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFsValue);
  if ("mapValue" in v) {
    const out = {};
    const f = v.mapValue.fields || {};
    for (const k of Object.keys(f)) out[k] = fromFsValue(f[k]);
    return out;
  }
  return null;
}

// Mirrors brandRegistry.normalizeBrand: trim + lowercase.
function normalizeBrand(s) {
  if (!s || typeof s !== "string") return "";
  return s.trim().toLowerCase();
}

// Mirrors routes/departmentRegistry.normalizeDepartment.
function normalizeDepartment(s) {
  return (s || "").trim().toLowerCase();
}

// Mirrors brandRegistry.matchBrand: exact key, then alias walk.
function matchBrand(inputBrand, registry) {
  const n = normalizeBrand(inputBrand);
  if (!n) return null;
  const direct = registry.get(n);
  if (direct) return direct;
  for (const entry of registry.values()) {
    if (!entry.aliases || entry.aliases.length === 0) continue;
    for (const alias of entry.aliases) {
      if (normalizeBrand(alias) === n) return entry;
    }
  }
  return null;
}

async function loadBrandRegistry(tok) {
  // List active brand_registry docs.
  const out = new Map();
  let pageToken = null;
  do {
    const qs = "?pageSize=300" + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
    const resp = await fsReq("GET", "/brand_registry" + qs, null, tok);
    const docs = (resp && resp.documents) || [];
    for (const d of docs) {
      const f = d.fields || {};
      const isActive = f.is_active && f.is_active.booleanValue === true;
      if (!isActive) continue;
      const brand_key = normalizeBrand(fromFsValue(f.brand_key));
      if (!brand_key) continue;
      const aliases = Array.isArray(fromFsValue(f.aliases)) ? fromFsValue(f.aliases) : [];
      out.set(brand_key, { brand_key, aliases });
    }
    pageToken = resp && resp.nextPageToken;
  } while (pageToken);
  return out;
}

async function loadActiveDepartmentKeys(tok) {
  const out = new Set();
  let pageToken = null;
  do {
    const qs = "?pageSize=300" + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
    const resp = await fsReq("GET", "/department_registry" + qs, null, tok);
    const docs = (resp && resp.documents) || [];
    for (const d of docs) {
      const f = d.fields || {};
      const isActive = f.is_active && f.is_active.booleanValue === true;
      if (!isActive) continue;
      const key = fromFsValue(f.key);
      if (typeof key === "string" && key.length > 0) out.add(key);
    }
    pageToken = resp && resp.nextPageToken;
  } while (pageToken);
  return out;
}

async function listProducts(tok, hardLimit) {
  const out = [];
  let pageToken = null;
  do {
    const remaining = hardLimit ? hardLimit - out.length : null;
    if (remaining !== null && remaining <= 0) break;
    const pageSize = remaining !== null ? Math.min(100, remaining) : 100;
    const qs =
      "?pageSize=" + pageSize +
      (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
    const resp = await fsReq("GET", "/products" + qs, null, tok);
    const docs = (resp && resp.documents) || [];
    for (const d of docs) {
      // d.name = "projects/.../databases/(default)/documents/products/<docId>"
      const parts = d.name.split("/");
      const docId = parts[parts.length - 1];
      const f = d.fields || {};
      out.push({
        docId,
        mpn: fromFsValue(f.mpn) || fromFsValue(f.MPN) || docId,
        brand: fromFsValue(f.brand),
        department: fromFsValue(f.department),
      });
      if (hardLimit && out.length >= hardLimit) break;
    }
    pageToken = resp && resp.nextPageToken;
  } while (pageToken);
  return out;
}

async function patchProductKeys(tok, docId, brand_key, department_key) {
  const fields = {
    brand_key: toFsValue(brand_key),
    department_key: toFsValue(department_key),
  };
  const path =
    "/products/" + encodeURIComponent(docId) +
    "?updateMask.fieldPaths=brand_key&updateMask.fieldPaths=department_key";
  await fsReq("PATCH", path, { fields }, tok);
}

async function main() {
  console.log("=== TALLY-PRODUCT-LIST-UX Phase 0.5 — product backfill ===");
  console.log("Project: " + PROJECT);
  console.log("Mode:    " + (DRY_RUN ? "DRY-RUN (no writes)" : "EXECUTE (will PATCH)"));
  console.log("Limit:   " + (LIMIT === null ? "ALL" : LIMIT));
  console.log("Timestamp: " + NOW_ISO);
  console.log("");

  const tok = token();

  console.log("Loading brand_registry (active)...");
  const brandRegistry = await loadBrandRegistry(tok);
  console.log("  active brands: " + brandRegistry.size);

  console.log("Loading department_registry (active)...");
  const activeDeptKeys = await loadActiveDepartmentKeys(tok);
  console.log("  active department keys: " + activeDeptKeys.size + " " +
    JSON.stringify(Array.from(activeDeptKeys)));

  console.log("Listing products" + (LIMIT ? " (cap " + LIMIT + ")" : "") + "...");
  const products = await listProducts(tok, LIMIT);
  console.log("  products: " + products.length);
  console.log("");

  let total = 0;
  let resolvedBoth = 0;
  let resolvedBrandOnly = 0;
  let resolvedDeptOnly = 0;
  let unresolvedBoth = 0;
  let wrote = 0;
  let errors = 0;

  // TALLY-PRODUCT-LIST-UX Phase 0.5 — track distinct unresolved input
  // strings (brand + department) with frequency for Lisa/John registry
  // triage. Key = exact raw input (preserves case + whitespace so the
  // PO-sheet review is unambiguous).
  const unresolvedBrandCounts = new Map();
  const unresolvedDeptCounts = new Map();
  function bump(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
  }

  // Batch in chunks of 100 (PATCH is per-doc, but batching log/flush in
  // groups of 100 keeps output legible and matches the dispatch contract).
  const BATCH_SIZE = 100;
  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    if (products.length > BATCH_SIZE) {
      console.log("--- batch " + (i / BATCH_SIZE + 1) +
        " (" + batch.length + " products) ---");
    }
    for (const p of batch) {
      total++;
      const matched = matchBrand(p.brand, brandRegistry);
      const brand_key = matched ? matched.brand_key : null;

      const deptNorm = normalizeDepartment(p.department || "");
      const department_key = deptNorm && activeDeptKeys.has(deptNorm) ? deptNorm : null;

      if (brand_key && department_key) resolvedBoth++;
      else if (brand_key && !department_key) resolvedBrandOnly++;
      else if (!brand_key && department_key) resolvedDeptOnly++;
      else unresolvedBoth++;

      if (!brand_key) {
        bump(unresolvedBrandCounts, p.brand == null ? "" : String(p.brand));
      }
      if (!department_key) {
        bump(unresolvedDeptCounts, p.department == null ? "" : String(p.department));
      }

      const tag = (DRY_RUN ? "[DRY] " : "");
      const bTag = brand_key || "UNRESOLVED";
      const dTag = department_key || "UNRESOLVED";
      console.log(
        tag + p.mpn +
        "  brand='" + (p.brand == null ? "" : String(p.brand)) + "' -> " + bTag +
        "  | dept='" + (p.department == null ? "" : String(p.department)) + "' -> " + dTag
      );

      if (!DRY_RUN) {
        try {
          await patchProductKeys(tok, p.docId, brand_key, department_key);
          wrote++;
        } catch (err) {
          errors++;
          console.error("  ! PATCH error " + p.docId + ": " + err.message);
        }
      }
    }
  }

  console.log("");
  console.log("=== Summary ===");
  console.log("  Mode:               " + (DRY_RUN ? "DRY-RUN" : "EXECUTE"));
  console.log("  Total processed:    " + total);
  console.log("  Resolved both:      " + resolvedBoth);
  console.log("  Resolved brand only:" + resolvedBrandOnly);
  console.log("  Resolved dept only: " + resolvedDeptOnly);
  console.log("  Unresolved both:    " + unresolvedBoth);
  if (!DRY_RUN) {
    console.log("  PATCH wrote:        " + wrote);
    console.log("  PATCH errors:       " + errors);
  }

  // TALLY-PRODUCT-LIST-UX Phase 0.5 — distinct unresolved tables for
  // registry triage. Sort by count desc, then alphabetical for ties.
  function sortDistinct(map) {
    return Array.from(map.entries()).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    });
  }
  const ubrands = sortDistinct(unresolvedBrandCounts);
  const udepts = sortDistinct(unresolvedDeptCounts);

  console.log("");
  console.log("=== Unresolved brand strings (distinct, frequency-sorted) ===");
  for (const [k, n] of ubrands) {
    console.log("  " + n + " \u00d7 '" + k + "'");
  }
  console.log("Total distinct unresolved: " + ubrands.length);

  console.log("");
  console.log("=== Unresolved department strings (distinct, frequency-sorted) ===");
  for (const [k, n] of udepts) {
    const label = k === "" ? "'' (empty)" : "'" + k + "'";
    console.log("  " + n + " \u00d7 " + label);
  }
  console.log("Total distinct unresolved: " + udepts.length);

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
