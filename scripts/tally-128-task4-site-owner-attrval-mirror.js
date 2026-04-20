// TALLY-128 Task 4 — attribute_values/site_owner subcollection mirror.
//
// Reader-verification (Step 1): Outcome A — Details-tab Site Owner dropdown
//   reads from products/{mpn}/attribute_values/site_owner.
// Schema-verification (Step 2): Outcome 2A — conform to existing 8-field
//   canonical attribute_values/* schema.
// Contract decision (PO ruling): Option B — verification_state="Unverified"
//   on all mirror writes. No completion-state flip; humans close the loop.
// Step 3b dry-run finding (PO ruling: Path A): create-only contract.
//   Pre-existing subcoll docs are NEVER touched (preserves Human-Verified
//   data such as 206991-6SW casing and HTG230493wht orphan). Casing /
//   writer-divergence carry-forward to separate tallies.
//
// Modes:
//   --dry-run            (default) scan owner-populated, emit category breakdown
//   --execute                       create-only merge-write for missing subcoll docs
//   --single=<MPN>                  canary single-product write (UI rendering check)
//
// Idempotent / create-only / merge-only. written_at and updated_at written
// on first-write only. Existing docs are skipped wholesale.
"use strict";

const { execSync } = require("child_process");
const https = require("https");

const PROJECT = "ropi-aoss-dev";
const NOW_ISO = new Date().toISOString();
const ORIGIN_RULE = "tally-128-task4-attrval-mirror";
const ORIGIN_DETAIL = "TALLY-128 Task 4 — attribute_values/site_owner mirror";
const BATCH_SIZE = 500;

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const singleArg = args.find((a) => a.startsWith("--single="));
const SINGLE_MPN = singleArg ? singleArg.split("=")[1] : null;

const MODE_LABEL = SINGLE_MPN ? "SINGLE(" + SINGLE_MPN + ")" : EXECUTE ? "EXECUTE" : "DRY-RUN";

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
    if (res.documents) out.push(...res.documents);
    pageToken = res.nextPageToken || null;
  } while (pageToken);
  return out;
}

function flat(doc) {
  const out = {};
  const f = doc.fields || {};
  for (const k of Object.keys(f)) out[k] = unwrap(f[k]);
  out._mpn = doc.name.split("/").pop();
  return out;
}

// Build the merge-write payload. firstWrite controls whether written_at is
// included (only on first-write so updates preserve original written_at).
function buildPayload(siteOwner, firstWrite) {
  const fields = {
    value: { stringValue: siteOwner },
    verification_state: { stringValue: "Unverified" },
    origin_type: { stringValue: "Backfill" },
    origin_detail: { stringValue: ORIGIN_DETAIL },
    origin_rule: { stringValue: ORIGIN_RULE },
    field_name: { stringValue: "site_owner" },
    updated_at: { timestampValue: NOW_ISO },
  };
  if (firstWrite) {
    fields.written_at = { timestampValue: NOW_ISO };
  }
  return { fields };
}

async function mirrorOne(mpn, siteOwner, existingDoc, tok) {
  const firstWrite = !existingDoc;
  const updateMaskFields = ["value", "verification_state", "origin_type", "origin_detail", "origin_rule", "field_name", "updated_at"];
  if (firstWrite) updateMaskFields.push("written_at");
  const updateMask = updateMaskFields.map((f) => "updateMask.fieldPaths=" + f).join("&");
  const path = "/products/" + encodeURIComponent(mpn) + "/attribute_values/site_owner?" + updateMask;
  const body = buildPayload(siteOwner, firstWrite);
  await fsReq("PATCH", path, body, tok);
}

(async () => {
  console.log("=== TALLY-128 Task 4 " + MODE_LABEL + " ===");
  console.log("Project: " + PROJECT);
  console.log("Origin rule sentinel: " + ORIGIN_RULE);
  console.log("Timestamp: " + NOW_ISO);
  console.log("Contract: Option B (verification_state=\"Unverified\")");
  console.log("");

  const tok = token();

  // ── --single=<MPN> canary mode ──
  if (SINGLE_MPN) {
    const prod = await fsReq("GET", "/products/" + encodeURIComponent(SINGLE_MPN), null, tok);
    if (!prod) {
      console.error("Product not found: " + SINGLE_MPN);
      process.exit(1);
    }
    const pf = flat(prod);
    const siteOwner = (pf.site_owner || "").trim();
    if (!siteOwner) {
      console.error("Product " + SINGLE_MPN + " has empty data.site_owner — cannot mirror.");
      process.exit(1);
    }
    console.log("Canary product: " + SINGLE_MPN);
    console.log("  data.site_owner: " + JSON.stringify(siteOwner));
    console.log("  data.brand: " + JSON.stringify(pf.brand));

    const existing = await fsReq("GET", "/products/" + encodeURIComponent(SINGLE_MPN) + "/attribute_values/site_owner", null, tok);
    console.log("  attribute_values/site_owner pre-existing: " + (existing ? "YES" : "NO"));

    await mirrorOne(SINGLE_MPN, siteOwner, existing, tok);
    console.log("  ✓ Wrote canary mirror doc.");

    const verify = await fsReq("GET", "/products/" + encodeURIComponent(SINGLE_MPN) + "/attribute_values/site_owner", null, tok);
    console.log("  Post-write doc:");
    const vf = flat(verify);
    delete vf._mpn;
    for (const k of Object.keys(vf)) {
      console.log("    " + k + ": " + JSON.stringify(vf[k]));
    }
    console.log("");
    console.log("→ HUMAN VISUAL CHECK REQUIRED:");
    console.log("    1. Hard-refresh Product Detail page for MPN " + SINGLE_MPN);
    console.log("    2. Open Details tab → Core Information group → Site Owner dropdown");
    console.log("    3. UI-A if dropdown shows \"" + siteOwner + "\" selected (not blank)");
    console.log("    4. UI-B if dropdown still renders blank → STOP and escalate");
    return;
  }

  // ── Load all products ──
  const prodDocs = await listAll("products", tok);
  const products = prodDocs.map(flat);
  const targets = products.filter((p) => (p.site_owner || "").trim());
  console.log("Total products: " + products.length);
  console.log("Products with non-empty data.site_owner: " + targets.length);
  console.log("");

  // ── Categorize: GET each existing subcoll doc ──
  const cats = {
    will_create: [],   // {mpn, site_owner}
    will_update: [],   // {mpn, site_owner, existing_value}
    skip: [],          // {mpn, site_owner}
  };
  let scanned = 0;
  for (const p of targets) {
    scanned++;
    if (scanned % 100 === 0) process.stderr.write("  scanned " + scanned + "/" + targets.length + "\n");
    const expected = (p.site_owner || "").trim();
    const existing = await fsReq("GET", "/products/" + encodeURIComponent(p._mpn) + "/attribute_values/site_owner", null, tok);
    if (!existing) {
      cats.will_create.push({ mpn: p._mpn, site_owner: expected });
      continue;
    }
    // Path A (PO ruling): create-only. Any pre-existing doc is preserved.
    const ef = flat(existing);
    const existingValue = (ef.value || "").toString();
    if (existingValue === expected) {
      cats.skip.push({ mpn: p._mpn, site_owner: expected, reason: "value_matches" });
    } else {
      cats.skip.push({ mpn: p._mpn, site_owner: expected, reason: "preserve_existing", existing_value: existingValue });
    }
  }

  console.log("=== TALLY-128 Task 4 " + (EXECUTE ? "Execute Pre-Write" : "Dry-Run") + " ===");
  console.log("Total products scanned with non-empty data.site_owner:  " + targets.length);
  console.log("Category breakdown:");
  console.log("  Will create (subcoll doc missing):   " + cats.will_create.length + "  ← primary action set");
  console.log("  Will update (Path A: never):         0");
  console.log("  Skip (already matches or preserved): " + cats.skip.length);

  const preserved = cats.skip.filter((s) => s.reason === "preserve_existing");
  if (preserved.length > 0) {
    console.log("");
    console.log("Preserved (pre-existing docs left unchanged per Path A):");
    for (const s of preserved) {
      console.log("  " + s.mpn + ": existing=" + JSON.stringify(s.existing_value) + " | top.site_owner=" + JSON.stringify(s.site_owner));
    }
  }

  if (!EXECUTE) {
    console.log("");
    console.log("Dry-run complete. No writes performed. Re-run with --execute after PO ack.");
    return;
  }

  // ── EXECUTE phase (Path A: create-only) ──
  console.log("");
  console.log("=== EXECUTE phase (create-only) ===");
  const writes = cats.will_create.map((c) => ({ mpn: c.mpn, site_owner: c.site_owner, action: "create", existing: null }));

  console.log("Writes queued: " + writes.length + " (chunked at " + BATCH_SIZE + "/batch)");
  console.log("");

  let totalWritten = 0;
  let totalFailed = 0;
  const failures = [];
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const slice = writes.slice(i, i + BATCH_SIZE);
    let batchWritten = 0;
    let batchFailed = 0;
    for (const w of slice) {
      try {
        await mirrorOne(w.mpn, w.site_owner, w.existing, tok);
        batchWritten++;
      } catch (e) {
        batchFailed++;
        failures.push({ mpn: w.mpn, error: e.message });
      }
    }
    totalWritten += batchWritten;
    totalFailed += batchFailed;
    console.log("  batch " + (Math.floor(i / BATCH_SIZE) + 1) + ": " + batchWritten + " written, " + batchFailed + " failed (running " + totalWritten + "/" + writes.length + ")");
  }

  console.log("");
  console.log("=== EXECUTE complete ===");
  console.log("Total writes attempted:  " + writes.length);
  console.log("Total writes succeeded:  " + totalWritten);
  console.log("Total writes failed:     " + totalFailed);
  if (failures.length > 0) {
    console.log("Failure detail:");
    for (const f of failures) console.log("  " + f.mpn + ": " + f.error);
  }
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
