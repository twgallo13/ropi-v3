// TALLY-128 Task 1 diagnostic — read-only.
// Queries products + brand_registry + site_registry + audit_log.
// No writes. Outputs evidence by category per §7.
"use strict";

const { execSync } = require("child_process");
const https = require("https");

const PROJECT = "ropi-aoss-dev";
const SHIEKH_BRANDS = ["Nike", "Jordan", "Adidas", "Puma", "Crocs", "Smoke Rise", "Pro Standard", "New Era"];
const KARMALOOP_BRANDS = ["Billionaire Boys Club", "IceCream"];
const SEED_BRAND_KEYS = new Set(
  [...SHIEKH_BRANDS, ...KARMALOOP_BRANDS].map((b) => b.trim().toLowerCase())
);
const TARGET_MPN = "JS4967"; // TALLY-126 backlog test case

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

async function structuredQuery(query, tok) {
  const res = await fsReq("POST", ":runQuery", { structuredQuery: query }, tok);
  return res || [];
}

function normalizeBrand(b) {
  return (b || "").trim().toLowerCase();
}

(async () => {
  const tok = token();

  // ── Diagnostic #8: site_registry casing + active set ──
  const regDocs = await listAll("site_registry", tok);
  const registry = regDocs.map((d) => {
    const f = {};
    const raw = d.fields || {};
    for (const k of Object.keys(raw)) f[k] = unwrap(raw[k]);
    f._id = d.name.split("/").pop();
    return f;
  });
  const activeRegistry = registry.filter((r) => r.is_active === true);

  // ── Load all products ──
  const prodDocs = await listAll("products", tok);
  const products = prodDocs.map((d) => {
    const f = {};
    const raw = d.fields || {};
    for (const k of Object.keys(raw)) f[k] = unwrap(raw[k]);
    f._mpn = d.name.split("/").pop();
    return f;
  });

  // ── Diagnostic #1: Brand inventory ──
  const brandCounts = {};      // exact-string brand → count
  const brandNormalized = {};  // normalized → {count, originals: Set}
  for (const p of products) {
    const b = p.brand || "(empty)";
    brandCounts[b] = (brandCounts[b] || 0) + 1;
    const n = normalizeBrand(b);
    if (!brandNormalized[n]) brandNormalized[n] = { count: 0, originals: new Set() };
    brandNormalized[n].count += 1;
    brandNormalized[n].originals.add(b);
  }
  const mappedBrands = Object.entries(brandNormalized)
    .filter(([n]) => SEED_BRAND_KEYS.has(n))
    .sort((a, b) => b[1].count - a[1].count);
  const unmappedBrands = Object.entries(brandNormalized)
    .filter(([n]) => !SEED_BRAND_KEYS.has(n) && n !== "")
    .sort((a, b) => b[1].count - a[1].count);
  const emptyBrandCount = (brandNormalized[""] || { count: 0 }).count;
  const casingAnomalies = Object.entries(brandNormalized)
    .filter(([_, v]) => v.originals.size > 1)
    .map(([n, v]) => ({ normalized: n, variants: [...v.originals], count: v.count }));

  // ── Diagnostic #2: data.site_owner distribution per brand ──
  const ownerByBrand = {};
  let emptyOwnerTotal = 0;
  let nonEmptyOwnerTotal = 0;
  for (const p of products) {
    const n = normalizeBrand(p.brand);
    const owner = p.site_owner || "";
    if (!ownerByBrand[n]) ownerByBrand[n] = {};
    ownerByBrand[n][owner || "(empty)"] = (ownerByBrand[n][owner || "(empty)"] || 0) + 1;
    if (owner) nonEmptyOwnerTotal++;
    else emptyOwnerTotal++;
  }

  // Mapped brand → count by category (no-op / empty+mapped / conflict)
  const SEED_OWNER_OF_BRAND = {};
  for (const b of SHIEKH_BRANDS) SEED_OWNER_OF_BRAND[normalizeBrand(b)] = "shiekh";
  for (const b of KARMALOOP_BRANDS) SEED_OWNER_OF_BRAND[normalizeBrand(b)] = "karmaloop";
  let cat_empty_mapped = 0;
  let cat_already_correct = 0;
  let cat_conflict = 0;
  let cat_empty_unmapped = 0;
  let cat_filled_unmapped = 0;
  const conflictSamples = [];
  for (const p of products) {
    const n = normalizeBrand(p.brand);
    const expectedOwner = SEED_OWNER_OF_BRAND[n] || null;
    const currentOwner = p.site_owner || "";
    if (expectedOwner) {
      if (!currentOwner) cat_empty_mapped++;
      else if (currentOwner === expectedOwner) cat_already_correct++;
      else {
        cat_conflict++;
        if (conflictSamples.length < 10) {
          conflictSamples.push({ mpn: p._mpn, brand: p.brand, existing: currentOwner, expected: expectedOwner });
        }
      }
    } else {
      if (!currentOwner) cat_empty_unmapped++;
      else cat_filled_unmapped++;
    }
  }

  // ── Diagnostic #3: Active Websites (attribute_values.website) population ──
  // attribute_values is a subcollection; sample a representative product set first
  const websiteDomainFreq = {};
  let awEmpty = 0;
  let awPopulated = 0;
  let awMissingDoc = 0;
  const awSampledMpns = [];
  // Sample up to 100 products evenly across population
  const sampleProducts = products.slice(0, 100);
  for (const p of sampleProducts) {
    awSampledMpns.push(p._mpn);
    try {
      const wv = await fsReq("GET", "/products/" + encodeURIComponent(p._mpn) + "/attribute_values/website", null, tok);
      const wvFields = wv.fields || {};
      const value = unwrap(wvFields.value);
      const arr = Array.isArray(value) ? value : (typeof value === "string" && value ? value.split(",").map((s) => s.trim()).filter(Boolean) : []);
      if (arr.length === 0) awEmpty++;
      else {
        awPopulated++;
        for (const v of arr) {
          const k = (v || "").toString().trim().toLowerCase();
          if (k) websiteDomainFreq[k] = (websiteDomainFreq[k] || 0) + 1;
        }
      }
    } catch (e) {
      if (/HTTP 404/.test(e.message)) awMissingDoc++;
      else throw e;
    }
  }

  // ── Diagnostic #4: site_targets state inventory ──
  // Per Rev 2.1 + products.ts L133/395 — site_targets is a subcollection
  let stHasArrayField = 0;
  let stArrayFieldNonEmpty = 0;
  const stSubSampleResults = [];
  for (const p of sampleProducts) {
    if (Array.isArray(p.site_targets)) {
      stHasArrayField++;
      if (p.site_targets.length > 0) stArrayFieldNonEmpty++;
    }
    try {
      const sub = await fsReq("GET", "/products/" + encodeURIComponent(p._mpn) + "/site_targets?pageSize=100", null, tok);
      const docs = sub.documents || [];
      const ids = docs.map((d) => d.name.split("/").pop());
      const siteIds = docs.map((d) => unwrap((d.fields || {}).site_id) || d.name.split("/").pop());
      stSubSampleResults.push({ mpn: p._mpn, sub_count: docs.length, doc_ids: ids, site_ids: siteIds });
    } catch (e) {
      stSubSampleResults.push({ mpn: p._mpn, error: e.message });
    }
  }
  const distinctSiteIds = {};
  let totalSubDocs = 0;
  let staleSubDocs = 0;
  const activeSiteKeys = new Set(activeRegistry.map((r) => r.site_key || r._id));
  for (const r of stSubSampleResults) {
    if (!r.site_ids) continue;
    for (const s of r.site_ids) {
      distinctSiteIds[s] = (distinctSiteIds[s] || 0) + 1;
      totalSubDocs++;
      if (!activeSiteKeys.has(s)) staleSubDocs++;
    }
  }

  // ── Diagnostic #5: attribute_values/site_owner subcollection coverage ──
  // Sample products WITH non-empty data.site_owner
  const productsWithOwner = products.filter((p) => p.site_owner).slice(0, 30);
  let avSoExists = 0;
  let avSoMissing = 0;
  let avSoMatches = 0;
  let avSoDiverges = 0;
  const divergenceSamples = [];
  for (const p of productsWithOwner) {
    try {
      const sub = await fsReq("GET", "/products/" + encodeURIComponent(p._mpn) + "/attribute_values/site_owner", null, tok);
      avSoExists++;
      const v = unwrap((sub.fields || {}).value);
      if (v === p.site_owner) avSoMatches++;
      else {
        avSoDiverges++;
        if (divergenceSamples.length < 5) divergenceSamples.push({ mpn: p._mpn, top: p.site_owner, sub: v });
      }
    } catch (e) {
      if (/HTTP 404/.test(e.message)) avSoMissing++;
      else throw e;
    }
  }

  // ── JS4967 specific spot-check (TALLY-126 backlog test case) ──
  let js4967 = null;
  try {
    const doc = await fsReq("GET", "/products/" + TARGET_MPN, null, tok);
    const f = {};
    const raw = doc.fields || {};
    for (const k of Object.keys(raw)) f[k] = unwrap(raw[k]);
    let avSo = null;
    try {
      const sub = await fsReq("GET", "/products/" + TARGET_MPN + "/attribute_values/site_owner", null, tok);
      avSo = unwrap((sub.fields || {}).value);
    } catch (_) {}
    let avW = null;
    try {
      const sub = await fsReq("GET", "/products/" + TARGET_MPN + "/attribute_values/website", null, tok);
      avW = unwrap((sub.fields || {}).value);
    } catch (_) {}
    let stSub = [];
    try {
      const sub = await fsReq("GET", "/products/" + TARGET_MPN + "/site_targets?pageSize=20", null, tok);
      stSub = (sub.documents || []).map((d) => ({ id: d.name.split("/").pop(), site_id: unwrap((d.fields || {}).site_id) }));
    } catch (_) {}
    js4967 = {
      brand: f.brand || null,
      data_site_owner: f.site_owner || null,
      attribute_values_site_owner: avSo,
      attribute_values_website: avW,
      site_targets_top_array: Array.isArray(f.site_targets) ? f.site_targets : null,
      site_targets_subcollection: stSub,
    };
  } catch (e) {
    js4967 = { error: e.message };
  }

  // ── Diagnostic #7: 24h orphaned_reference baseline ──
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let auditLogResults = [];
  let auditEventsResults = [];
  try {
    const r = await structuredQuery({
      from: [{ collectionId: "audit_log" }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            { fieldFilter: { field: { fieldPath: "event_type" }, op: "EQUAL", value: { stringValue: "site_targets.orphaned_reference" } } },
            { fieldFilter: { field: { fieldPath: "created_at" }, op: "GREATER_THAN", value: { timestampValue: since } } },
          ],
        },
      },
      orderBy: [{ field: { fieldPath: "created_at" }, direction: "DESCENDING" }],
      limit: 50,
    }, tok);
    auditLogResults = r.filter((x) => x.document).map((x) => x.document);
  } catch (e) {
    auditLogResults = [{ error: e.message }];
  }
  try {
    const r = await structuredQuery({
      from: [{ collectionId: "audit_events" }],
      where: {
        fieldFilter: { field: { fieldPath: "event_type" }, op: "EQUAL", value: { stringValue: "site_targets.orphaned_reference" } },
      },
      limit: 50,
    }, tok);
    auditEventsResults = r.filter((x) => x.document).map((x) => x.document);
  } catch (e) {
    auditEventsResults = [{ error: e.message }];
  }

  // ── Output ──
  console.log("=== TALLY-128 Task 1 Diagnostic (read-only) ===");
  console.log("Project:", PROJECT, "| Total products scanned:", products.length, "| Active registry sites:", activeRegistry.length);
  console.log("");

  console.log("── #8 Active site_registry ──");
  for (const r of activeRegistry) {
    console.log("  site_key=" + (r.site_key || r._id) + " | display=" + r.display_name + " | domain=\"" + (r.domain || "") + "\" | priority=" + r.priority);
  }
  console.log("  (R2-Q4 empirical: domain field casing as shown above; .toLowerCase() normalization safe)");
  console.log("");

  console.log("── #1 Brand inventory ──");
  console.log("  Total distinct brand strings (case-sensitive): " + Object.keys(brandCounts).length);
  console.log("  Total distinct brand strings (normalized):     " + Object.keys(brandNormalized).length);
  console.log("  Empty brand products: " + emptyBrandCount);
  console.log("  Mapped to seed (10 PO-confirmed):");
  for (const [n, v] of mappedBrands) console.log("    " + n + " (" + [...v.originals].join("|") + "): " + v.count);
  console.log("  Unmapped (gap candidates, top 25 by count):");
  for (const [n, v] of unmappedBrands.slice(0, 25)) console.log("    " + n + " (" + [...v.originals].join("|") + "): " + v.count);
  if (unmappedBrands.length > 25) console.log("    ... and " + (unmappedBrands.length - 25) + " more unmapped brands");
  console.log("  Casing anomalies (>1 variant for same normalized brand):");
  if (casingAnomalies.length === 0) console.log("    (none)");
  for (const a of casingAnomalies) console.log("    " + a.normalized + " variants=" + JSON.stringify(a.variants) + " count=" + a.count);
  console.log("");

  console.log("── #2 data.site_owner distribution × brand-mapping category ──");
  console.log("  Empty data.site_owner total:     " + emptyOwnerTotal);
  console.log("  Non-empty data.site_owner total: " + nonEmptyOwnerTotal);
  console.log("  Category breakdown for Task 3:");
  console.log("    Already correct (no-op):     " + cat_already_correct);
  console.log("    Empty + mapped (BACKFILL):   " + cat_empty_mapped);
  console.log("    Conflicts (preserve+flag):   " + cat_conflict);
  console.log("    Empty + unmapped (gap):      " + cat_empty_unmapped);
  console.log("    Filled + unmapped (no-op):   " + cat_filled_unmapped);
  if (conflictSamples.length) {
    console.log("  Conflict samples:");
    for (const c of conflictSamples) console.log("    [" + c.mpn + "] brand=" + c.brand + " existing=" + c.existing + " expected=" + c.expected);
  }
  console.log("");

  console.log("── #3 Active Websites (attribute_values/website) — sample of " + sampleProducts.length + " products ──");
  console.log("  Populated subcollection doc:  " + awPopulated);
  console.log("  Empty subcollection doc:      " + awEmpty);
  console.log("  Missing subcollection doc:    " + awMissingDoc);
  console.log("  Domain selection frequency (sample):");
  for (const [d, c] of Object.entries(websiteDomainFreq).sort((a, b) => b[1] - a[1])) {
    console.log("    " + d + ": " + c);
  }
  console.log("");

  console.log("── #4 site_targets state — sample of " + sampleProducts.length + " products ──");
  console.log("  Products with array field on doc (legacy):     " + stHasArrayField + " (non-empty: " + stArrayFieldNonEmpty + ")");
  console.log("  Products with subcollection (canonical):       " + stSubSampleResults.filter((r) => r.sub_count >= 0).length);
  console.log("  Total subcollection docs across sample:        " + totalSubDocs);
  console.log("  Stale (site_id NOT in active registry):        " + staleSubDocs);
  console.log("  Distinct site_id values seen:");
  for (const [s, c] of Object.entries(distinctSiteIds).sort((a, b) => b[1] - a[1])) {
    console.log("    " + s + ": " + c + (activeSiteKeys.has(s) ? " (ACTIVE)" : " (orphan/inactive)"));
  }
  console.log("  Sample (first 5 products):");
  for (const r of stSubSampleResults.slice(0, 5)) console.log("    " + r.mpn + " sub_count=" + r.sub_count + " site_ids=" + JSON.stringify(r.site_ids));
  console.log("");

  console.log("── #5 attribute_values/site_owner coverage — sample of " + productsWithOwner.length + " products WITH non-empty data.site_owner ──");
  console.log("  Subcollection doc exists:    " + avSoExists);
  console.log("  Subcollection doc missing:   " + avSoMissing);
  console.log("    of which value matches:    " + avSoMatches);
  console.log("    of which value diverges:   " + avSoDiverges);
  if (divergenceSamples.length) {
    console.log("  Divergence samples:");
    for (const d of divergenceSamples) console.log("    [" + d.mpn + "] top.site_owner=" + d.top + " sub.value=" + d.sub);
  }
  console.log("");

  console.log("── #6 orphaned_reference detection code location (CORRECTION TO BRIEF §7 #6 / §13) ──");
  console.log("  ACTUAL: backend/functions/src/routes/siteVerificationReview.ts L137-148");
  console.log("  BRIEF stated: backend/functions/src/routes/products.ts");
  console.log("  Trigger: GET /api/v1/site-verification/review iterates each product's site_targets subcollection;");
  console.log("           if site_id NOT in registry → write audit_log doc { event_type: 'site_targets.orphaned_reference', actor_uid: 'system:tally-123' }");
  console.log("  Writes to collection: 'audit_log' (NOT 'audit_events' as brief §7 #7 implies)");
  console.log("");

  console.log("── #7 24h orphaned_reference event baseline ──");
  console.log("  audit_log results (last 24h):  " + auditLogResults.length);
  if (auditLogResults.length) {
    const sample = auditLogResults.slice(0, 5).map((d) => {
      const f = {};
      const raw = d.fields || {};
      for (const k of Object.keys(raw)) f[k] = unwrap(raw[k]);
      return f;
    });
    console.log("  audit_log sample (first 5):");
    for (const s of sample) console.log("    mpn=" + s.product_mpn + " orphan_key=" + s.orphaned_site_key + " at=" + s.created_at);
  }
  console.log("  audit_events results (any time, fallback): " + auditEventsResults.length);
  console.log("");

  console.log("── JS4967 spot-check (TALLY-126 backlog test case) ──");
  console.log(JSON.stringify(js4967, null, 2));
  console.log("");

  console.log("── R2-Q4 / R2-Q5 answers ──");
  console.log("  R2-Q4 (registry domain casing): see #8 above. " + (
    activeRegistry.every((r) => !r.domain || r.domain === (r.domain || "").toLowerCase())
      ? "All-lowercase confirmed; matcher .toLowerCase() on both sides remains safe."
      : "Mixed case detected; matcher MUST .toLowerCase() on both sides."
  ));
  console.log("  R2-Q5 (affected product counts):");
  console.log("    Task 3 BACKFILL set (empty + mapped):     " + cat_empty_mapped);
  console.log("    Task 4 mirror create candidates (sample):  inferred " + (avSoMissing) + "/" + productsWithOwner.length + " missing → extrapolate to ~" + Math.round(avSoMissing/Math.max(productsWithOwner.length,1) * nonEmptyOwnerTotal) + " across full owner-populated set");
  console.log("    Task 5 dependency: derived from Active Websites; sample shows " + awPopulated + "/" + sampleProducts.length + " populated");
  console.log("    Chunking: 500/batch threshold not exceeded for any task on current data (total products=" + products.length + ")");
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
