// TALLY-128 Task 5 — site_targets subcollection cleanup (Path C: diff contract).
//
// Reuses deriveSiteTargetKeys + buildActiveRegistryView from the Task 2
// unit-tested helper (backend/functions/lib/lib/brandRegistry.js). No
// re-implementation.
//
// Modes:
//   --dry-run   (default) scan all 672, emit category breakdown, no writes
//   --execute              create/delete per diff, preserve intersection
//   --log=<path>           override per-product diff log path (dry-run only)
//
// Hard rules (Path C / Task 5):
//   - Scan all products; products with empty Active Websites → gap bucket,
//     NEVER mutated, NEVER counted in fully_deleted (R2-Q2).
//   - Layer boundary: NEVER consult data.site_owner for derivation.
//   - Never touch audit_log; never investigate orphaned_reference mismatches.
//   - Schema verification (5b) must be Outcome 2A before --execute.
//   - Chunked at 100 products/batch on execute.
"use strict";

const { execSync } = require("child_process");
const https = require("https");
const fs = require("fs");
const path = require("path");

const {
  buildActiveRegistryView,
  deriveSiteTargetKeys,
} = require("../backend/functions/lib/lib/brandRegistry.js");

const PROJECT = "ropi-aoss-dev";
const NOW_ISO = new Date().toISOString();
const SENTINEL = "tally-128-task5";
const BATCH_SIZE = 100;
const SCAN_PARALLELISM = 25;

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const logArg = args.find((a) => a.startsWith("--log="));
const LOG_PATH = logArg
  ? logArg.split("=")[1]
  : path.join(__dirname, "..", "evidence", "tally-128-task5", "dryrun-per-product.log");
const MODE_LABEL = EXECUTE ? "EXECUTE" : "DRY-RUN";

// Schema fields observed in Subtask 5b. Any write conforms exactly to this
// set plus the Task 5 sentinel + audit timestamp (updated_at already in
// observed schema doubles as audit timestamp per dispatch).
const OBSERVED_SCHEMA_FIELDS = ["site_id", "domain", "active", "updated_at"];

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
    if (res?.documents) out.push(...res.documents);
    pageToken = res?.nextPageToken || null;
  } while (pageToken);
  return out;
}

// Extract raw Active Websites values from attribute_values/website doc.
// Mirror Task 1 diagnostic extraction pattern: array passthrough OR
// comma-split string. Returns [] if doc missing or value empty.
function extractAwValues(websiteDoc) {
  if (!websiteDoc) return [];
  const f = websiteDoc.fields || {};
  const value = unwrap(f.value);
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map((v) => (v === null || v === undefined ? "" : String(v)));
  if (typeof value === "string") {
    if (!value.trim()) return [];
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

// Scan site_targets subcollection. Returns array of {id, fields}.
async function loadSiteTargets(mpn, tok) {
  const out = [];
  let pt = null;
  do {
    const qs = "?pageSize=100" + (pt ? "&pageToken=" + encodeURIComponent(pt) : "");
    const res = await fsReq("GET", "/products/" + encodeURIComponent(mpn) + "/site_targets" + qs, null, tok);
    if (res?.documents) {
      for (const d of res.documents) {
        out.push({ id: d.name.split("/").pop(), fields: d.fields || {} });
      }
    }
    pt = res?.nextPageToken || null;
  } while (pt);
  return out;
}

// Returns true iff doc fields are exactly the 4 observed-schema fields.
// Extra fields → STOP-and-report (Subtask 5e guardrail).
function hasOnlyObservedSchema(fields) {
  const keys = Object.keys(fields || {});
  for (const k of keys) {
    if (!OBSERVED_SCHEMA_FIELDS.includes(k)) return false;
  }
  return true;
}

function buildCreatePayload(siteKey, domain) {
  return {
    fields: {
      site_id: { stringValue: siteKey },
      domain: { stringValue: domain || "" },
      active: { booleanValue: true },
      updated_at: { timestampValue: NOW_ISO },
      site_targets_source: { stringValue: SENTINEL },
    },
  };
}

async function pool(items, parallelism, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(parallelism, items.length); i++) workers.push(run());
  await Promise.all(workers);
  return results;
}

(async () => {
  console.log("=== TALLY-128 Task 5 " + MODE_LABEL + " ===");
  console.log("Project: " + PROJECT);
  console.log("Sentinel: " + SENTINEL);
  console.log("Timestamp: " + NOW_ISO);
  console.log("");

  const tok = token();

  // ── Load active registry view ──
  const regDocs = await listAll("site_registry", tok);
  const activeSites = [];
  for (const d of regDocs) {
    const f = d.fields || {};
    const siteKey = unwrap(f.site_key) || d.name.split("/").pop();
    const domain = unwrap(f.domain);
    const isActive = unwrap(f.is_active) === true;
    activeSites.push({ site_key: siteKey, domain, is_active: isActive });
  }
  const activeView = buildActiveRegistryView(activeSites);
  const activeKeys = activeView.allSiteKeys().sort();
  console.log("Active registry sites: [" + activeKeys.join(", ") + "]");
  console.log("");

  // ── Load all products ──
  const prodDocs = await listAll("products", tok);
  const allMpns = prodDocs.map((d) => d.name.split("/").pop());
  console.log("Total products scanned: " + allMpns.length);

  // ── Per-product scan (parallel) ──
  const perProduct = await pool(allMpns, SCAN_PARALLELISM, async (mpn) => {
    const [websiteDoc, currentDocs] = await Promise.all([
      fsReq("GET", "/products/" + encodeURIComponent(mpn) + "/attribute_values/website", null, tok),
      loadSiteTargets(mpn, tok),
    ]);
    const awValues = extractAwValues(websiteDoc);
    const currentKeys = new Set(currentDocs.map((d) => d.id));
    const { targetKeys: expectedKeys, nonRegistryValues } = deriveSiteTargetKeys(awValues, activeView);

    const create = [];
    for (const k of expectedKeys) if (!currentKeys.has(k)) create.push(k);
    const del = [];
    for (const k of currentKeys) if (!expectedKeys.has(k)) del.push(k);
    const preserve = [];
    for (const k of currentKeys) if (expectedKeys.has(k)) preserve.push(k);

    // Schema audit: any existing doc with fields beyond observed schema is
    // a Subtask 5e STOP trigger. Record for reporting.
    const schemaViolations = [];
    for (const d of currentDocs) {
      if (!hasOnlyObservedSchema(d.fields)) {
        schemaViolations.push({ id: d.id, keys: Object.keys(d.fields || {}) });
      }
    }

    return {
      mpn,
      awValues,
      awEmpty: awValues.length === 0,
      currentKeys: Array.from(currentKeys).sort(),
      expectedKeys: Array.from(expectedKeys).sort(),
      nonRegistryValues,
      create: create.sort(),
      delete: del.sort(),
      preserve: preserve.sort(),
      schemaViolations,
      currentDocsRaw: currentDocs, // kept for schema verification output
    };
  });

  // ── Categorize ──
  const cats = {
    gap: [],                   // empty AW, preserved
    no_change: [],             // non-empty AW, current == expected
    create_only: [],
    delete_only: [],
    mixed: [],
    fully_deleted: [],         // non-empty AW + non-empty current + expected empty
    noop_both_empty: [],       // non-empty AW (non-registry-only) + empty current + expected empty
  };
  let totalCreate = 0;
  let totalDelete = 0;
  let totalPreserve = 0;
  const nonRegFreq = {};
  const schemaViolAll = [];

  for (const r of perProduct) {
    if (r.schemaViolations.length > 0) schemaViolAll.push({ mpn: r.mpn, v: r.schemaViolations });
    if (r.awEmpty) {
      cats.gap.push(r);
      continue;
    }
    for (const v of r.nonRegistryValues) nonRegFreq[v] = (nonRegFreq[v] || 0) + 1;
    const hasCreate = r.create.length > 0;
    const hasDelete = r.delete.length > 0;
    totalCreate += r.create.length;
    totalDelete += r.delete.length;
    totalPreserve += r.preserve.length;

    const expectedEmpty = r.expectedKeys.length === 0;
    const currentEmpty = r.currentKeys.length === 0;

    if (!hasCreate && !hasDelete) {
      if (currentEmpty && expectedEmpty) cats.noop_both_empty.push(r);
      else cats.no_change.push(r);
      continue;
    }
    if (expectedEmpty && !currentEmpty) {
      cats.fully_deleted.push(r);
      continue;
    }
    if (hasCreate && hasDelete) cats.mixed.push(r);
    else if (hasCreate) cats.create_only.push(r);
    else cats.delete_only.push(r);
  }

  // ── Per-product log (dry-run only) ──
  if (!EXECUTE) {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    const lines = [];
    lines.push("# TALLY-128 Task 5 per-product diff — " + NOW_ISO);
    lines.push("# Format: <mpn> | aw=[...] | cur=[...] | exp=[...] | create=[...] | delete=[...] | preserve=[...] | nonReg=[...]");
    for (const r of perProduct) {
      lines.push(
        r.mpn +
        " | aw=[" + r.awValues.join(",") + "]" +
        " | cur=[" + r.currentKeys.join(",") + "]" +
        " | exp=[" + r.expectedKeys.join(",") + "]" +
        " | create=[" + r.create.join(",") + "]" +
        " | delete=[" + r.delete.join(",") + "]" +
        " | preserve=[" + r.preserve.join(",") + "]" +
        " | nonReg=[" + r.nonRegistryValues.join(",") + "]"
      );
    }
    fs.writeFileSync(LOG_PATH, lines.join("\n") + "\n");
  }

  // ── Subtask 5b: schema verification across ALL observed site_targets docs ──
  let totalExistingDocs = 0;
  for (const r of perProduct) totalExistingDocs += r.currentDocsRaw.length;

  console.log("");
  console.log("=== Subtask 5b — Schema verification ===");
  console.log("Observed schema fields (from JS4967 + 5 samples + all scanned): " + OBSERVED_SCHEMA_FIELDS.join(", "));
  console.log("Total existing site_targets docs scanned: " + totalExistingDocs);
  console.log("Docs with fields outside observed schema: " + schemaViolAll.length);
  let schemaOutcome;
  if (schemaViolAll.length === 0 && totalExistingDocs > 0) {
    schemaOutcome = "2A";
    console.log("Outcome: 2A — schema consistent across all samples. Creates will write:");
    console.log("  site_id (string), domain (string), active (bool), updated_at (timestamp),");
    console.log("  site_targets_source (string, sentinel=\"" + SENTINEL + "\")");
  } else if (schemaViolAll.length > 0) {
    schemaOutcome = "2B";
    console.log("Outcome: 2B — schema varies / non-derived fields present. STOP before execute.");
    for (const sv of schemaViolAll.slice(0, 10)) {
      console.log("  " + sv.mpn + ":");
      for (const v of sv.v) console.log("    doc=" + v.id + " unexpected_keys=[" + v.keys.filter((k) => !OBSERVED_SCHEMA_FIELDS.includes(k)).join(",") + "]");
    }
  } else {
    schemaOutcome = "2C";
    console.log("Outcome: 2C — no existing docs to sample. Ambiguous; STOP.");
  }

  // ── Category breakdown ──
  console.log("");
  console.log("=== TALLY-128 Task 5 Dry-Run ===");
  console.log("Total products scanned:                    " + allMpns.length);
  console.log("Active registry sites:                     [" + activeKeys.join(", ") + "]");
  console.log("");
  console.log("Gap bucket (empty Active Websites, preserved unchanged per R2-Q2):");
  console.log("  Products counted:                        " + cats.gap.length);
  console.log("");
  console.log("Mutation-candidate bucket (non-empty Active Websites):");
  const mutCount = cats.no_change.length + cats.create_only.length + cats.delete_only.length + cats.mixed.length + cats.fully_deleted.length + cats.noop_both_empty.length;
  console.log("  No change (current == expected):         " + cats.no_change.length);
  console.log("  Create-only (pure add):                  " + cats.create_only.length);
  console.log("  Delete-only (pure remove):               " + cats.delete_only.length);
  console.log("  Mixed (create + delete in same product): " + cats.mixed.length);
  console.log("  Fully deleted (expected empty):          " + cats.fully_deleted.length + "   ← GUARDRAIL 1: PO sign-off required");
  if (cats.noop_both_empty.length > 0) {
    console.log("  No-op (current empty + expected empty):  " + cats.noop_both_empty.length + "   (non-registry-only AW; neither mutated)");
  }
  console.log("  Mutation-candidate total:                " + mutCount);
  console.log("");
  console.log("Operation totals (mutation-candidates only):");
  console.log("  Docs to create:                          " + totalCreate);
  console.log("  Docs to delete:                          " + totalDelete);
  console.log("  Docs to preserve untouched:              " + totalPreserve);

  // Fully-deleted detail
  if (cats.fully_deleted.length > 0) {
    console.log("");
    console.log("Fully-deleted sample (all " + cats.fully_deleted.length + " listed):");
    for (const r of cats.fully_deleted) {
      console.log("  " + r.mpn + " | aw=[" + r.awValues.join(",") + "] | current=[" + r.currentKeys.join(",") + "] | nonReg=[" + r.nonRegistryValues.join(",") + "]");
    }
  }

  // Non-registry audit
  console.log("");
  console.log("Non-registry Active Websites audit (informational):");
  const freqEntries = Object.entries(nonRegFreq).sort((a, b) => b[1] - a[1]);
  if (freqEntries.length === 0) {
    console.log("  (none)");
  } else {
    for (const [val, n] of freqEntries) console.log("  " + JSON.stringify(val) + ": " + n);
  }

  if (!EXECUTE) {
    console.log("");
    console.log("Dry-run complete. Per-product log: " + LOG_PATH);
    console.log("Schema verification outcome: " + schemaOutcome);
    console.log("Re-run with --execute after PO ack.");
    return;
  }

  // ── EXECUTE ──
  if (schemaOutcome !== "2A") {
    console.error("");
    console.error("STOP — schema verification outcome is " + schemaOutcome + ", not 2A. Execute blocked.");
    process.exit(2);
  }
  if (schemaViolAll.length > 0) {
    console.error("");
    console.error("STOP — non-observed fields present in existing docs. Execute blocked.");
    process.exit(2);
  }

  const toWrite = [...cats.create_only, ...cats.delete_only, ...cats.mixed, ...cats.fully_deleted];
  console.log("");
  console.log("=== EXECUTE phase ===");
  console.log("Products with diff: " + toWrite.length + " (chunked at " + BATCH_SIZE + "/batch)");

  // Domain lookup map for create payloads.
  const domainBySiteKey = new Map();
  for (const s of activeSites) {
    if (s.is_active) domainBySiteKey.set((s.site_key || "").toLowerCase(), (s.domain || "").toLowerCase());
  }

  let productsTouched = 0;
  let docsCreated = 0;
  let docsDeleted = 0;
  let errors = 0;
  const failures = [];
  for (let i = 0; i < toWrite.length; i += BATCH_SIZE) {
    const slice = toWrite.slice(i, i + BATCH_SIZE);
    for (const r of slice) {
      try {
        for (const k of r.delete) {
          await fsReq(
            "DELETE",
            "/products/" + encodeURIComponent(r.mpn) + "/site_targets/" + encodeURIComponent(k),
            null,
            tok,
          );
          docsDeleted++;
        }
        for (const k of r.create) {
          const body = buildCreatePayload(k, domainBySiteKey.get(k) || "");
          await fsReq(
            "PATCH",
            "/products/" + encodeURIComponent(r.mpn) + "/site_targets/" + encodeURIComponent(k),
            body,
            tok,
          );
          docsCreated++;
        }
        productsTouched++;
      } catch (e) {
        errors++;
        failures.push({ mpn: r.mpn, error: e.message });
      }
    }
    console.log("  batch " + (Math.floor(i / BATCH_SIZE) + 1) + ": " + slice.length + " products (running " + productsTouched + "/" + toWrite.length + ")");
  }

  console.log("");
  console.log("=== EXECUTE complete ===");
  console.log("Products touched:      " + productsTouched);
  console.log("Docs created:          " + docsCreated);
  console.log("Docs deleted:          " + docsDeleted);
  console.log("Docs preserved:        " + totalPreserve);
  console.log("Gap products skipped:  " + cats.gap.length);
  console.log("Errors:                " + errors);
  if (failures.length > 0) {
    console.log("Failure detail:");
    for (const f of failures) console.log("  " + f.mpn + ": " + f.error);
  }
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
