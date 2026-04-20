// TALLY-128 Task 3 — Brand → Site Owner backfill.
//
// Reuses the matcher library committed in Task 2:
//   backend/functions/src/lib/brandRegistry.ts (compiled to lib/lib/brandRegistry.js)
//   exports: normalizeBrand(), matchBrand()
//
// loadBrandRegistry() in the library requires firebase-admin (ADC) which
// codespace lacks; this script loads the registry via Firestore REST and
// hands the resulting Map to matchBrand(). matchBrand() + normalizeBrand()
// are pure functions so they're safe to require here.
//
// Behavior per §9 + Frink R1 Q3 + Q6:
//   • --dry-run (default): scan all products, emit category breakdown
//   • --execute            : commit empty+mapped writes; preserve+flag conflicts
//
// Idempotent: empty+mapped is the only write set; products already carrying
// any data.site_owner are either no-ops (already correct) or conflicts
// (preserve+flag, never overwrite).
"use strict";

const { execSync } = require("child_process");
const https = require("https");
const path = require("path");

const PROJECT = "ropi-aoss-dev";
const NOW_ISO = new Date().toISOString();
const SOURCE_SENTINEL = "tally-128-task3";
const BATCH_SIZE = 500; // Firestore commit limit

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const MODE_LABEL = EXECUTE ? "EXECUTE" : "DRY-RUN";

// ── Reuse the matcher library from Task 2 (must be compiled) ──
let matchBrand, normalizeBrand;
try {
  const lib = require(path.join(__dirname, "..", "backend", "functions", "lib", "lib", "brandRegistry.js"));
  matchBrand = lib.matchBrand;
  normalizeBrand = lib.normalizeBrand;
  if (typeof matchBrand !== "function" || typeof normalizeBrand !== "function") {
    throw new Error("matchBrand/normalizeBrand not exported");
  }
} catch (e) {
  console.error("FATAL: cannot load compiled brandRegistry.js — run `cd backend/functions && npx tsc` first.");
  console.error(e.message);
  process.exit(1);
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

function unwrap(v) {
  if (!v) return null;
  if ("nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(unwrap);
  if ("mapValue" in v) {
    const o = {};
    const f = v.mapValue.fields || {};
    for (const k of Object.keys(f)) o[k] = unwrap(f[k]);
    return o;
  }
  return null;
}

async function listAll(collection, tok) {
  const out = [];
  let pageToken = null;
  do {
    const qs = "?pageSize=300" + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
    const res = await fsReq("GET", "/" + collection + qs, null, tok);
    if (res.documents) out.push(...res.documents);
    pageToken = res.nextPageToken || null;
  } while (pageToken);
  return out;
}

function docToFlat(doc) {
  const f = {};
  const raw = doc.fields || {};
  for (const k of Object.keys(raw)) f[k] = unwrap(raw[k]);
  f._mpn = doc.name.split("/").pop();
  return f;
}

// Build matchBrand-compatible Map<brand_key, BrandRegistryEntry> from REST.
async function loadBrandRegistryViaRest(tok) {
  const res = await fsReq(
    "POST",
    ":runQuery",
    {
      structuredQuery: {
        from: [{ collectionId: "brand_registry" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "is_active" },
            op: "EQUAL",
            value: { booleanValue: true },
          },
        },
      },
    },
    tok,
  );
  const out = new Map();
  for (const row of res || []) {
    if (!row.document) continue;
    const f = docToFlat(row.document);
    const key = normalizeBrand(f.brand_key);
    if (!key) continue;
    out.set(key, {
      brand_key: key,
      display_name: f.display_name || key,
      aliases: Array.isArray(f.aliases) ? f.aliases : [],
      default_site_owner: f.default_site_owner ?? null,
      is_active: f.is_active !== false,
      po_confirmed: !!f.po_confirmed,
      notes: f.notes ?? null,
    });
  }
  return out;
}

// ── Commit batch: PATCH each product (write site_owner + audit fields only) ──
async function commitBatch(writes, tok) {
  // updateMask preserves untouched fields. PATCH each doc individually within
  // the same logical "batch" — Firestore REST :commit supports atomic, but
  // batching via :commit requires document name + updates per write. Using
  // sequential PATCHes here keeps the script simple and provides per-doc
  // failure visibility; at 139 expected writes this is well under any quota.
  let written = 0;
  let failed = 0;
  const failures = [];
  for (const w of writes) {
    const updateMask = "updateMask.fieldPaths=site_owner&updateMask.fieldPaths=site_owner_backfill_source&updateMask.fieldPaths=site_owner_backfilled_at";
    const url = "/products/" + encodeURIComponent(w.mpn) + "?" + updateMask;
    const body = {
      fields: {
        site_owner: { stringValue: w.site_owner },
        site_owner_backfill_source: { stringValue: SOURCE_SENTINEL },
        site_owner_backfilled_at: { timestampValue: NOW_ISO },
      },
    };
    try {
      await fsReq("PATCH", url, body, tok);
      written++;
    } catch (e) {
      failed++;
      failures.push({ mpn: w.mpn, error: e.message });
    }
  }
  return { written, failed, failures };
}

(async () => {
  console.log("=== TALLY-128 Task 3 " + MODE_LABEL + " ===");
  console.log("Project: " + PROJECT);
  console.log("Source sentinel: " + SOURCE_SENTINEL);
  console.log("Timestamp: " + NOW_ISO);
  console.log("");

  const tok = token();

  // ── Load Brand Registry via REST (matcher lib's loadBrandRegistry needs ADC) ──
  const registry = await loadBrandRegistryViaRest(tok);
  console.log("Brand Registry loaded: " + registry.size + " active entries");
  const aliasIndex = []; // [{display, brand_key, alias, default_owner}]
  for (const e of registry.values()) {
    for (const a of e.aliases) {
      aliasIndex.push({ display: e.display_name, brand_key: e.brand_key, alias: a, default_owner: e.default_site_owner });
    }
  }
  console.log("Aliases registered: " + aliasIndex.length);
  for (const a of aliasIndex) {
    console.log("  " + a.alias + " → " + a.display + " (owner=" + a.default_owner + ")");
  }
  console.log("");

  // ── Load all products ──
  const prodDocs = await listAll("products", tok);
  const products = prodDocs.map(docToFlat);
  console.log("Products scanned: " + products.length);
  console.log("");

  // ── Categorize ──
  const cats = {
    already_correct: [],
    empty_mapped_direct: [],   // {mpn, brand, owner}
    empty_mapped_alias: [],    // {mpn, brand, owner, matched_alias, canonical_display}
    conflict: [],              // {mpn, brand, existing, expected}
    empty_unmapped: [],        // {mpn, brand}
    filled_unmapped: [],       // {mpn, brand, owner} — informational only
  };

  for (const p of products) {
    const brand = p.brand || "";
    const currentOwner = p.site_owner || "";
    const matched = matchBrand(brand, registry);

    if (!matched) {
      if (!currentOwner) cats.empty_unmapped.push({ mpn: p._mpn, brand });
      else cats.filled_unmapped.push({ mpn: p._mpn, brand, owner: currentOwner });
      continue;
    }

    const expectedOwner = matched.default_site_owner;

    if (!currentOwner) {
      // Determine direct vs alias by comparing normalized brand to brand_key
      const isDirect = normalizeBrand(brand) === matched.brand_key;
      if (isDirect) {
        cats.empty_mapped_direct.push({ mpn: p._mpn, brand, owner: expectedOwner });
      } else {
        // Find which alias matched
        const aliasHit = (matched.aliases || []).find((a) => normalizeBrand(a) === normalizeBrand(brand)) || brand;
        cats.empty_mapped_alias.push({
          mpn: p._mpn,
          brand,
          owner: expectedOwner,
          matched_alias: aliasHit,
          canonical_display: matched.display_name,
        });
      }
    } else if (currentOwner === expectedOwner) {
      cats.already_correct.push({ mpn: p._mpn, brand, owner: currentOwner });
    } else {
      cats.conflict.push({
        mpn: p._mpn,
        brand,
        existing: currentOwner,
        expected: expectedOwner,
      });
    }
  }

  // ── Emit category breakdown per Frink R1 Q6 format ──
  const totalEmptyMapped = cats.empty_mapped_direct.length + cats.empty_mapped_alias.length;

  // Per-alias breakdown
  const aliasBreakdown = {}; // key: "ALIAS → Display" → count
  for (const r of cats.empty_mapped_alias) {
    const key = r.matched_alias + "  → " + r.canonical_display;
    aliasBreakdown[key] = (aliasBreakdown[key] || 0) + 1;
  }

  // Gap by brand (top N)
  const gapByBrand = {};
  for (const r of cats.empty_unmapped) {
    const b = r.brand || "(empty)";
    gapByBrand[b] = (gapByBrand[b] || 0) + 1;
  }
  const gapTop = Object.entries(gapByBrand).sort((a, b) => b[1] - a[1]);

  console.log("=== TALLY-128 Task 3 " + (EXECUTE ? "Execute Pre-Write" : "Dry-Run") + " ===");
  console.log("Total products scanned:                " + products.length);
  console.log("Category breakdown:");
  console.log("  Already correct (no-op):             " + cats.already_correct.length + "   (brand maps to current site_owner)");
  console.log("  Empty site_owner + mapped:           " + totalEmptyMapped + "   (would backfill) ← primary action set");
  console.log("    Direct matches:                    " + cats.empty_mapped_direct.length);
  console.log("    Alias matches:                     " + cats.empty_mapped_alias.length);
  for (const [k, v] of Object.entries(aliasBreakdown)) {
    console.log("      " + k.padEnd(36) + " " + v);
  }
  console.log("  Conflicts (preserve+flag):           " + cats.conflict.length);
  if (cats.conflict.length === 0) {
    console.log("    [none — Task 1 diagnostic prediction confirmed]");
  } else {
    for (const c of cats.conflict) {
      console.log("    " + c.mpn + " | brand=" + c.brand + " | existing=" + c.existing + " | expected=" + c.expected);
    }
  }
  console.log("  Empty site_owner + unmapped:         " + cats.empty_unmapped.length + "   (gap — no action)");
  console.log("    Gap by brand (top 20):");
  for (const [b, n] of gapTop.slice(0, 20)) {
    console.log("      " + b.padEnd(36) + " " + n + " products");
  }
  if (gapTop.length > 20) {
    console.log("      ... " + (gapTop.length - 20) + " additional unmapped brands not shown");
  }
  console.log("  Filled + unmapped (informational):   " + cats.filled_unmapped.length + "   (existing owners w/ no registry match)");
  console.log("");

  // ── Stop-and-report: surprise-check ──
  if (cats.conflict.length > 0 && !EXECUTE) {
    console.log("⚠️  STOP-AND-REPORT: Task 1 diagnostic predicted 0 conflicts, dry-run found " + cats.conflict.length + ".");
    console.log("    Escalating to Lisa+PO before execute. Not exiting non-zero (dry-run is read-only).");
  }

  if (!EXECUTE) {
    console.log("Dry-run complete. No writes performed. Re-run with --execute after PO ack.");
    return;
  }

  // ── EXECUTE: write empty+mapped only ──
  console.log("=== EXECUTE phase ===");
  const writes = [];
  for (const r of cats.empty_mapped_direct) {
    writes.push({ mpn: r.mpn, brand: r.brand, site_owner: r.owner, matched_via: "direct" });
  }
  for (const r of cats.empty_mapped_alias) {
    writes.push({
      mpn: r.mpn,
      brand: r.brand,
      site_owner: r.owner,
      matched_via: "alias:" + r.matched_alias,
    });
  }

  console.log("Writes queued: " + writes.length);
  console.log("Conflict writes skipped: " + cats.conflict.length + " (preserve+flag policy per Frink R1 Q3)");
  console.log("");
  console.log("Per-product write log (MPN | brand | matched_via | assigned_site_owner):");

  // Chunked at 500/batch (per spec, even though under threshold)
  let totalWritten = 0;
  let totalFailed = 0;
  const allFailures = [];
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const slice = writes.slice(i, i + BATCH_SIZE);
    const result = await commitBatch(slice, tok);
    for (const w of slice) {
      console.log("  " + w.mpn + " | " + w.brand + " | " + w.matched_via + " | " + w.site_owner);
    }
    totalWritten += result.written;
    totalFailed += result.failed;
    allFailures.push(...result.failures);
    console.log("  (batch " + (Math.floor(i / BATCH_SIZE) + 1) + ": written=" + result.written + ", failed=" + result.failed + ")");
  }

  console.log("");
  console.log("=== EXECUTE complete ===");
  console.log("Total writes attempted:  " + writes.length);
  console.log("Total writes succeeded:  " + totalWritten);
  console.log("Total writes failed:     " + totalFailed);
  if (allFailures.length > 0) {
    console.log("Failure detail:");
    for (const f of allFailures) console.log("  " + f.mpn + ": " + f.error);
  }
  console.log("Conflicts preserved:     " + cats.conflict.length);
  console.log("Gap (no action):         " + cats.empty_unmapped.length);
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
