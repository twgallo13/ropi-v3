// TALLY-133R — STEP-Prefix Product Cleanup
//
// Classification rule : MPN.toLowerCase().includes('step')
//
// Approved subcollection cascade list (§3, 9 entries):
//   site_targets, attribute_values, attributes, pricing_snapshots,
//   site_content, content_versions, comments, domain_states, flags
//
// Tripwire: EXPECTED_STEP_COUNT = 11 (Task 1 Gate–verified fixture count).
//   If runtime classification count ≠ 11: STOP immediately.
//   Report expected vs actual + delta. Do NOT proceed to --execute.
//   Likely cause: new STEP-prefix fixture imported since Task 1. Lisa rules.
//
// Modes:
//   (default / --dry-run)  Scan + classify + assert approved list. Zero writes.
//   --execute              Cascade-delete subcoll docs (§3 order), then delete
//                          top-level product doc LAST per product. Batched at
//                          500/chunk. Re-asserts approved list per product before
//                          deletion (second defense).
//
// On any error: stop immediately; no silent failures.
// Idempotent: safe to re-run after partial failure.
//
// Pattern: Firestore REST API + gcloud access token (no ADC in codespace).
// Mirrors: tally-128-task5-site-targets-cleanup.js
"use strict";

const { execSync } = require("child_process");
const https = require("https");

const PROJECT = "ropi-aoss-dev";

// ── Tripwire ──────────────────────────────────────────────────────────────────
// Task 1 Gate–verified fixture count (2026-04-22, cleared by Lisa).
// This is NOT a preserve list. It is a runtime sanity check: if a new
// STEP-prefix fixture was imported between Task 1 and Task 2, this aborts
// before Homer has re-verified the new product. Lisa rules on updated count.
const EXPECTED_STEP_COUNT = 11;

// ── §3 Approved subcollection cascade list ────────────────────────────────────
// Order defines deletion sequence in --execute mode.
// Any name returned by listCollectionIds() NOT in this set → immediate abort.
const APPROVED_SUBCOLLECTIONS_ORDERED = [
  "site_targets",
  "attribute_values",
  "attributes",
  "pricing_snapshots",
  "site_content",
  "content_versions",
  "comments",
  "domain_states",
  "flags",
];
const APPROVED_SUBCOLLECTIONS = new Set(APPROVED_SUBCOLLECTIONS_ORDERED);

const PAGE_SIZE = 300;
const BATCH_SIZE = 500;

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const MODE_LABEL = EXECUTE ? "Execute" : "Dry-Run";

// ── Helpers ───────────────────────────────────────────────────────────────────

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
          reject(
            new Error(
              "HTTP " + res.statusCode + " on " + suffix + ": " + data.slice(0, 400)
            )
          );
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

// Label + value row with right-aligned value at fixed column.
function row(label, value, col) {
  const c = col || 52;
  const v = String(value);
  const pad = Math.max(1, c - label.length - v.length);
  return label + " ".repeat(pad) + v;
}

// ── Firestore helpers ─────────────────────────────────────────────────────────

async function getAllProducts(tok) {
  const all = [];
  let pageToken = null;
  do {
    const qs =
      "?pageSize=" +
      PAGE_SIZE +
      (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
    const res = await fsReq("GET", "/products" + qs, null, tok);
    if (res && res.documents) {
      for (const doc of res.documents) {
        const parts = doc.name.split("/");
        const mpn = parts[parts.length - 1];
        const fields = doc.fields || {};
        const dataFields =
          (fields.data && fields.data.mapValue && fields.data.mapValue.fields) || {};
        all.push({
          mpn,
          fullName: doc.name,
          brand: unwrap(dataFields.brand),
          site_owner: unwrap(dataFields.site_owner),
        });
      }
    }
    pageToken = res && res.nextPageToken ? res.nextPageToken : null;
  } while (pageToken);
  return all;
}

async function listSubcollections(mpn, tok) {
  const suffix = "/products/" + encodeURIComponent(mpn) + ":listCollectionIds";
  const res = await fsReq("POST", suffix, { pageSize: 50 }, tok);
  if (!res || !res.collectionIds) return [];
  return res.collectionIds;
}

async function listSubcollDocs(mpn, subcollId, tok) {
  const docs = [];
  let pageToken = null;
  do {
    const qs =
      "?pageSize=" +
      PAGE_SIZE +
      (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
    const suffix =
      "/products/" + encodeURIComponent(mpn) + "/" + subcollId + qs;
    const res = await fsReq("GET", suffix, null, tok);
    if (res && res.documents) {
      for (const doc of res.documents) {
        docs.push(doc.name); // full resource path for batchWrite delete
      }
    }
    pageToken = res && res.nextPageToken ? res.nextPageToken : null;
  } while (pageToken);
  return docs;
}

// Batch-delete an array of full resource paths via batchWrite.
// Returns { deleted: N, batches: M }.
async function batchDelete(docNames, tok) {
  if (docNames.length === 0) return { deleted: 0, batches: 0 };
  const chunks = [];
  for (let i = 0; i < docNames.length; i += BATCH_SIZE) {
    chunks.push(docNames.slice(i, i + BATCH_SIZE));
  }
  let totalDeleted = 0;
  for (let ci = 0; ci < chunks.length; ci++) {
    const writes = chunks[ci].map((name) => ({ delete: name }));
    await fsReq("POST", ":batchWrite", { writes }, tok);
    totalDeleted += chunks[ci].length;
    console.log(
      "    Batch " +
        (ci + 1) +
        "/" +
        chunks.length +
        ": " +
        chunks[ci].length +
        " doc(s) deleted (running total: " +
        totalDeleted +
        ")"
    );
  }
  return { deleted: totalDeleted, batches: chunks.length };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startMs = Date.now();

  console.log("=== TALLY-133R " + MODE_LABEL + " ===");
  console.log("Timestamp: " + new Date().toISOString());
  console.log("Project:   " + PROJECT);
  console.log("Mode:      " + (EXECUTE ? "EXECUTE (writes enabled)" : "DRY-RUN (zero writes)"));
  console.log("");

  const tok = token();

  // ── Phase 1: Scan + classify ──────────────────────────────────────────────
  console.log("Scanning products collection...");
  const allProducts = await getAllProducts(tok);
  const stepProducts = allProducts.filter((p) =>
    p.mpn.toLowerCase().includes("step")
  );
  const nonStepCount = allProducts.length - stepProducts.length;

  console.log(row("Total products scanned:", allProducts.length));
  console.log(row("STEP-match set (/step/i):", stepProducts.length));
  console.log(row("Non-match set (preserved):", nonStepCount));
  console.log("");

  // ── Phase 2: Tripwire ─────────────────────────────────────────────────────
  if (stepProducts.length !== EXPECTED_STEP_COUNT) {
    console.log("STOP: classification count mismatch.");
    console.log(
      "  Expected (Task 1 Gate–verified): " + EXPECTED_STEP_COUNT
    );
    console.log("  Got:                             " + stepProducts.length);
    const delta = stepProducts.length - EXPECTED_STEP_COUNT;
    console.log(
      "  Delta:                           " + (delta > 0 ? "+" : "") + delta
    );
    console.log("  Found MPNs:");
    for (const p of stepProducts) console.log("    " + p.mpn);
    console.log("");
    console.log(
      "Likely cause: new STEP-prefix fixture imported since Task 1 Gate."
    );
    console.log(
      "Lisa rules on updated expected count before proceeding. Do NOT execute."
    );
    process.exit(1);
  }
  console.log(
    "Count tripwire: PASS (runtime classification = " +
      EXPECTED_STEP_COUNT +
      " = expected)"
  );
  console.log("");

  // ── Phase 3: Per-product subcollection discovery ──────────────────────────
  console.log("=== STEP-match MPNs (to delete) ===");

  const unknownSubcolls = []; // { mpn, name }
  const perProduct = [];      // { mpn, fullName, brand, site_owner, subcollections: [{name, docs:[]}] }

  // Running totals for cascade preview
  const subcollTotals = {};
  for (const n of APPROVED_SUBCOLLECTIONS_ORDERED) subcollTotals[n] = 0;

  for (const p of stepProducts) {
    const liveSubcollIds = await listSubcollections(p.mpn, tok);

    // Assert approved list — collect unknowns (don't abort yet; surface all)
    for (const sid of liveSubcollIds) {
      if (!APPROVED_SUBCOLLECTIONS.has(sid)) {
        unknownSubcolls.push({ mpn: p.mpn, name: sid });
      }
    }

    // Enumerate docs in §3 order (skips any unknown — we abort below if any)
    const subcollections = [];
    for (const sid of APPROVED_SUBCOLLECTIONS_ORDERED) {
      if (!liveSubcollIds.includes(sid)) continue;
      const docs = await listSubcollDocs(p.mpn, sid, tok);
      subcollections.push({ name: sid, docs });
      subcollTotals[sid] += docs.length;
    }

    perProduct.push({ ...p, subcollections });

    // Per-product output line
    const subcollSummary =
      subcollections.length === 0
        ? "(no subcollections)"
        : subcollections.map((s) => s.name + ":" + s.docs.length).join(", ");
    console.log("  MPN:        " + p.mpn);
    console.log("  brand:      " + (p.brand !== null ? p.brand : "(null)"));
    console.log("  site_owner: " + (p.site_owner !== null ? p.site_owner : "(null)"));
    console.log("  subcoll:    " + subcollSummary);
    console.log("");
  }

  // ── Phase 4: Cascade preview ──────────────────────────────────────────────
  console.log("=== Cascade preview ===");
  console.log(row("Total top-level product docs to delete:", stepProducts.length));
  for (const n of APPROVED_SUBCOLLECTIONS_ORDERED) {
    console.log(row("Total " + n + " docs to delete:", subcollTotals[n]));
  }
  console.log("");

  // ── Phase 5: Approved-list assertion ─────────────────────────────────────
  // Collect all distinct discovered names (including unknowns)
  const allDiscovered = new Set();
  for (const p of perProduct) {
    for (const s of p.subcollections) allDiscovered.add(s.name);
  }
  for (const u of unknownSubcolls) allDiscovered.add(u.name);
  const allDiscoveredArr = Array.from(allDiscovered).sort();

  console.log("=== Subcollection approved-list assertion ===");
  console.log(
    "All subcollections discovered across " +
      stepProducts.length +
      " products: [" +
      allDiscoveredArr.join(", ") +
      "]"
  );

  if (unknownSubcolls.length > 0) {
    console.log("All ∈ approved-list (§3): FAIL");
    console.log("");
    console.log("STOP: unknown subcollection(s) found:");
    for (const u of unknownSubcolls) {
      console.log("  MPN=" + u.mpn + "  subcollection=" + u.name);
    }
    console.log(
      "Lisa rules before any deletion proceeds. Do NOT execute."
    );
    process.exit(1);
  }

  console.log("All ∈ approved-list (§3): PASS");
  console.log("");

  if (!EXECUTE) {
    console.log("=== DRY-RUN COMPLETE — zero writes performed ===");
    console.log(
      "Run with --execute to perform deletions (requires Task 3 PO ack)."
    );
    return;
  }

  // ── Phase 6: Execute ──────────────────────────────────────────────────────
  console.log(
    "=== EXECUTE — deleting " + stepProducts.length + " products + cascade ==="
  );
  console.log("");

  let totalSubcollDocs = 0;
  let totalTopLevel = 0;
  let totalBatches = 0;
  const execSubcollTotals = {};
  for (const n of APPROVED_SUBCOLLECTIONS_ORDERED) execSubcollTotals[n] = 0;

  for (const p of perProduct) {
    console.log("Product: " + p.mpn);

    // Second-defense: re-assert approved list at delete time
    const liveIds = await listSubcollections(p.mpn, tok);
    for (const sid of liveIds) {
      if (!APPROVED_SUBCOLLECTIONS.has(sid)) {
        console.log(
          "STOP (second-defense): unknown subcollection on " +
            p.mpn +
            " — " +
            sid
        );
        console.log("Halting. No further deletes. Report to Lisa.");
        process.exit(1);
      }
    }

    // Delete subcollection docs first, §3 order
    const subcollDocNames = [];
    const subcollDocBySid = {};
    for (const sid of APPROVED_SUBCOLLECTIONS_ORDERED) {
      const subcoll = p.subcollections.find((s) => s.name === sid);
      if (!subcoll || subcoll.docs.length === 0) continue;
      subcollDocNames.push(...subcoll.docs);
      subcollDocBySid[sid] = subcoll.docs.length;
    }

    if (subcollDocNames.length > 0) {
      console.log(
        "  Deleting " + subcollDocNames.length + " subcollection doc(s)..."
      );
      const result = await batchDelete(subcollDocNames, tok);
      totalSubcollDocs += result.deleted;
      totalBatches += result.batches;
      for (const [sid, cnt] of Object.entries(subcollDocBySid)) {
        execSubcollTotals[sid] += cnt;
      }
    }

    // Delete top-level product doc LAST
    console.log("  Deleting top-level product doc: " + p.mpn);
    await fsReq("DELETE", "/products/" + encodeURIComponent(p.mpn), null, tok);
    totalTopLevel++;
    totalBatches++; // each single DELETE counts as one operation batch

    console.log("  Done: " + p.mpn);
    console.log("");
  }

  const elapsedMs = Date.now() - startMs;

  console.log("=== EXECUTE COMPLETE ===");
  console.log(row("Products deleted:", totalTopLevel));
  console.log(row("Subcollection docs deleted:", totalSubcollDocs));
  for (const n of APPROVED_SUBCOLLECTIONS_ORDERED) {
    if (execSubcollTotals[n] > 0) {
      console.log(row("  " + n + " docs deleted:", execSubcollTotals[n]));
    }
  }
  console.log(row("Errors:", 0));
  console.log(row("Elapsed:", Math.round(elapsedMs / 1000) + "s"));
  console.log("");
  console.log(
    "Task 4 Gate: report Products deleted=" +
      totalTopLevel +
      ", subcoll docs deleted=" +
      totalSubcollDocs +
      ", errors=0."
  );
  console.log("Proceed to Task 5 verification.");
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
