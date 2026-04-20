// TALLY-128 Task 6 Subtask 6a — investigation script. Read-only.
// Queries audit_log time buckets + post-Task-5 events for
// site_targets.orphaned_reference. Zero writes.
"use strict";
const { execSync } = require("child_process");
const https = require("https");
const tok = execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();

const PROJECT = "ropi-aoss-dev";

function fsReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "firestore.googleapis.com",
      path: "/v1/projects/" + PROJECT + "/databases/(default)" + path,
      method,
      headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
    }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(d ? JSON.parse(d) : {});
        else if (res.statusCode === 404) resolve(null);
        else reject(new Error("HTTP " + res.statusCode + ": " + d));
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
function unwrap(v){if(!v)return null;if("nullValue"in v)return null;if("stringValue"in v)return v.stringValue;if("booleanValue"in v)return v.booleanValue;if("timestampValue"in v)return v.timestampValue;if("integerValue"in v)return Number(v.integerValue);return JSON.stringify(v);}

async function runQuery(structuredQuery) {
  const res = await fsReq("POST", "/documents:runQuery", { structuredQuery });
  if (!Array.isArray(res)) return [];
  return res.filter((r) => r.document).map((r) => {
    const f = r.document.fields || {};
    const o = { _name: r.document.name };
    for (const k of Object.keys(f)) o[k] = unwrap(f[k]);
    return o;
  });
}

function bucketQuery(sinceISO, untilISO) {
  const where = {
    compositeFilter: {
      op: "AND",
      filters: [
        { fieldFilter: { field: { fieldPath: "event_type" }, op: "EQUAL", value: { stringValue: "site_targets.orphaned_reference" } } },
      ],
    },
  };
  if (sinceISO) where.compositeFilter.filters.push({ fieldFilter: { field: { fieldPath: "created_at" }, op: "GREATER_THAN_OR_EQUAL", value: { timestampValue: sinceISO } } });
  if (untilISO) where.compositeFilter.filters.push({ fieldFilter: { field: { fieldPath: "created_at" }, op: "LESS_THAN" }, value: { timestampValue: untilISO } });
  return {
    from: [{ collectionId: "audit_log" }],
    where,
    orderBy: [{ field: { fieldPath: "created_at" }, direction: "DESCENDING" }],
    limit: 10000,
  };
}

(async () => {
  const now = new Date();
  const iso = (d) => d.toISOString();
  const day = 24 * 60 * 60 * 1000;

  const t_now = iso(now);
  const t_24h = iso(new Date(now.getTime() - day));
  const t_7d = iso(new Date(now.getTime() - 7 * day));
  const t_30d = iso(new Date(now.getTime() - 30 * day));
  // TALLY-125 Round 5 finished ~2026-04-17 per repo memory; use start-of-day boundary
  const t_round5 = "2026-04-17T00:00:00Z";
  // Task 5 execute completion: 22:32:49Z 2026-04-20 per execute.log
  const t_task5 = "2026-04-20T22:32:49Z";

  console.log("=== TALLY-128 Task 6 Subtask 6a — Investigation ===");
  console.log("Now: " + t_now);
  console.log("");
  console.log("Step 2 — historical time-bucket counts");
  console.log("event_type = site_targets.orphaned_reference");
  console.log("");

  async function count(label, sinceISO, untilISO) {
    // Single-field where for simpler counting: filter event_type AND optional time bounds.
    const filters = [
      { fieldFilter: { field: { fieldPath: "event_type" }, op: "EQUAL", value: { stringValue: "site_targets.orphaned_reference" } } },
    ];
    if (sinceISO) filters.push({ fieldFilter: { field: { fieldPath: "created_at" }, op: "GREATER_THAN_OR_EQUAL", value: { timestampValue: sinceISO } } });
    if (untilISO) filters.push({ fieldFilter: { field: { fieldPath: "created_at" }, op: "LESS_THAN", value: { timestampValue: untilISO } } });
    const q = {
      from: [{ collectionId: "audit_log" }],
      where: filters.length === 1 ? filters[0] : { compositeFilter: { op: "AND", filters } },
      // We need just count, but Firestore REST doesn't support COUNT cleanly for our setup.
      // Use a select with no fields to get just doc names.
      select: { fields: [] },
      limit: 20000,
    };
    const res = await fsReq("POST", "/documents:runQuery", { structuredQuery: q });
    const rows = Array.isArray(res) ? res.filter((r) => r.document) : [];
    console.log("  " + label + ": " + rows.length);
    return rows;
  }

  const all = await count("all-time            ", null, null);
  await count("last 24h            ", t_24h, null);
  await count("last 7d             ", t_7d, null);
  await count("last 30d            ", t_30d, null);
  await count("since Round 5 (4/17)", t_round5, null);
  const postTask5 = await count("since Task 5 (4/20T22:32:49Z)", t_task5, null);
  console.log("");
  console.log("(per-bucket queries are limit-20000; verify all-time count below matches Task 1 ~5875)");

  // For all-time, fetch full event docs to bucket by orphaned_site_key.
  console.log("");
  console.log("Step 1 follow-up — orphaned_site_key value distribution (all-time, sample of " + all.length + ")");
  // Re-fetch with all fields for distribution. Re-use /runQuery but without select.
  const fullQ = {
    from: [{ collectionId: "audit_log" }],
    where: { fieldFilter: { field: { fieldPath: "event_type" }, op: "EQUAL", value: { stringValue: "site_targets.orphaned_reference" } } },
    limit: 20000,
  };
  const fullRes = await fsReq("POST", "/documents:runQuery", { structuredQuery: fullQ });
  const fullRows = (Array.isArray(fullRes) ? fullRes : []).filter((r) => r.document).map((r) => {
    const f = r.document.fields || {};
    return {
      created_at: unwrap(f.created_at),
      orphaned_site_key: unwrap(f.orphaned_site_key),
      product_mpn: unwrap(f.product_mpn),
      actor_uid: unwrap(f.actor_uid),
    };
  });
  console.log("  fetched: " + fullRows.length);
  const freq = {};
  for (const r of fullRows) {
    const k = r.orphaned_site_key || "(null)";
    freq[k] = (freq[k] || 0) + 1;
  }
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  for (const [k, n] of sorted) console.log("  " + JSON.stringify(k) + ": " + n);

  // Step 2 follow-up: last 24h orphan keys distribution
  console.log("");
  console.log("Step 2 follow-up — last-24h orphaned_site_key distribution");
  const last24 = fullRows.filter((r) => r.created_at && r.created_at >= t_24h);
  console.log("  count: " + last24.length);
  const f24 = {};
  for (const r of last24) f24[r.orphaned_site_key || "(null)"] = (f24[r.orphaned_site_key || "(null)"] || 0) + 1;
  for (const [k, n] of Object.entries(f24).sort((a, b) => b[1] - a[1])) console.log("  " + JSON.stringify(k) + ": " + n);

  // Step 3: post-Task-5 events
  console.log("");
  console.log("Step 3 — post-Task-5 events (since " + t_task5 + ")");
  const postRows = fullRows.filter((r) => r.created_at && r.created_at >= t_task5);
  console.log("  count: " + postRows.length);
  if (postRows.length > 0) {
    const fp = {};
    for (const r of postRows) fp[r.orphaned_site_key || "(null)"] = (fp[r.orphaned_site_key || "(null)"] || 0) + 1;
    for (const [k, n] of Object.entries(fp).sort((a, b) => b[1] - a[1])) console.log("  " + JSON.stringify(k) + ": " + n);
    console.log("  sample (up to 10):");
    for (const r of postRows.slice(0, 10)) console.log("    " + r.created_at + " | " + r.product_mpn + " | " + r.orphaned_site_key + " | actor=" + r.actor_uid);
  }

  // Min/max created_at of all events
  console.log("");
  console.log("Step 2 — created_at range");
  const ts = fullRows.map((r) => r.created_at).filter(Boolean).sort();
  console.log("  earliest: " + (ts[0] || "(none)"));
  console.log("  latest:   " + (ts[ts.length - 1] || "(none)"));

  // Bucket by date for trend
  const byDate = {};
  for (const r of fullRows) {
    if (!r.created_at) continue;
    const d = r.created_at.slice(0, 10);
    byDate[d] = (byDate[d] || 0) + 1;
  }
  console.log("");
  console.log("Step 2 — daily counts");
  for (const d of Object.keys(byDate).sort()) console.log("  " + d + ": " + byDate[d]);
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
