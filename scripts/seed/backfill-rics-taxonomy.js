/**
 * backfill-rics-taxonomy.js — Import Intelligence Layer
 *
 * Pulls the published Google Sheets CSV of the current RO export and
 * applies the full column mapping + RICS Category parser + name /
 * color normalization to every product already in Firestore.
 *
 * Safe to re-run: Human-Verified attributes are never overwritten.
 *
 * Usage:
 *   GCP_SA_KEY_DEV=... node scripts/seed/backfill-rics-taxonomy.js
 *   GCP_SA_KEY_DEV=... node scripts/seed/backfill-rics-taxonomy.js --limit=100
 */

"use strict";

const https = require("https");
const { parse } = require("csv-parse/sync");
const admin = require("firebase-admin");
const { initApp } = require("./utils");

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQlmikpzDnxQAo7_zWpsa2vD6JkWddP57uSeHxPP4ctsxkn_TU7E0lYuzm1WDNvWVnnguPH6Lk4Wa-z/pub?output=csv";

// ─── Inline port of services/ricsParser.ts (CJS) ────────────────────────

const FOOTWEAR_DEPT_ALIASES = new Set([
  "footwear",
  "shiekh branded fw",
  "shiekh branded",
]);
const GENDER_FIRST_SEGMENTS = new Set([
  "mens",
  "men's",
  "womens",
  "women's",
  "kids",
]);

function normalizeGender(raw) {
  if (!raw) return "";
  const map = {
    "men's": "Mens",
    mens: "Mens",
    men: "Mens",
    "women's": "Womens",
    womens: "Womens",
    women: "Womens",
    kids: "Kids",
    boys: "Boys",
    girls: "Girls",
    unisex: "Unisex",
    toddler: "Toddler",
    "grade school": "Kids",
    infant: "Toddler",
  };
  return map[raw.toLowerCase().trim()] || raw;
}

function parseRicsCategory(ricsCategory) {
  if (!ricsCategory) return {};
  const segments = ricsCategory.split("||").map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return {};
  const seg0 = segments[0].toLowerCase();
  const r = {};

  if (seg0 === "apparel") {
    r.department = "Clothing";
    r.gender = normalizeGender(segments[1] || "");
    r.class = segments[2];
    r.category = segments[3];
    return r;
  }
  if (seg0 === "accessories") {
    r.department = "Accessories";
    if (segments[1]) {
      const maybe = normalizeGender(segments[1]);
      if (maybe !== segments[1]) r.gender = maybe;
    }
    r.class = segments[2];
    r.category = segments[3];
    return r;
  }
  if (seg0 === "kids") {
    r.gender = "Kids";
    r.age_group_detail = segments[1];
    const deptIdx = segments.findIndex(
      (s, i) => i >= 2 && FOOTWEAR_DEPT_ALIASES.has(s.toLowerCase())
    );
    if (deptIdx >= 0) {
      r.department = "Footwear";
      r.class = segments[deptIdx + 1];
      r.category = segments[deptIdx + 2];
    } else {
      r.class = segments[2];
      r.category = segments[3];
    }
    return r;
  }
  if (GENDER_FIRST_SEGMENTS.has(seg0)) {
    r.gender = normalizeGender(segments[0]);
    const seg1 = (segments[1] || "").toLowerCase();
    r.department = FOOTWEAR_DEPT_ALIASES.has(seg1) ? "Footwear" : segments[1];
    r.class = segments[2];
    r.category = segments[3];
    return r;
  }
  r.department = segments[0];
  return r;
}

function formatRicsShortDesc(raw) {
  if (!raw) return "";
  return raw
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ")
    .trim();
}

function getNikeIndustryMpn(mpn, brand) {
  if (!mpn || !brand) return null;
  const b = brand.toLowerCase();
  if (!b.includes("nike") && !b.includes("jordan")) return null;
  return mpn.replace(/\s+(\w+)$/, "-$1");
}

const COLOR_NORMALIZATIONS = {
  blk: "Black",
  wht: "White",
  rd: "Red",
  brn: "Brown",
  gry: "Grey",
  pnk: "Pink",
  yllw: "Yellow",
  orng: "Orange",
  prpl: "Purple",
  grn: "Green",
  nvy: "Navy",
  slvr: "Silver",
  gld: "Gold",
  tnl: "Tonal",
  mlti: "Multi",
  "univ blue": "University Blue",
  "univ red": "University Red",
  lt: "Light",
  dk: "Dark",
  med: "Medium",
};

function normalizeColor(ricsColor) {
  if (!ricsColor) return "";
  const trimmed = ricsColor.trim();
  const lower = trimmed.toLowerCase();
  if (COLOR_NORMALIZATIONS[lower]) return COLOR_NORMALIZATIONS[lower];
  return trimmed
    .split(/[\s/\-]+/)
    .map((w) => {
      if (!w) return w;
      const n = COLOR_NORMALIZATIONS[w.toLowerCase()];
      return n || w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function mpnToDocId(mpn) {
  return (mpn || "").trim().replace(/\//g, "__");
}

// ─── CSV fetch ──────────────────────────────────────────────────────────

function fetchCsv(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(fetchCsv(res.headers.location));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`CSV fetch returned HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      })
      .on("error", reject);
  });
}

// ─── Main ───────────────────────────────────────────────────────────────

async function run() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 0;
  const dryRun = process.argv.includes("--dry-run");

  initApp();
  const firestore = admin.firestore();

  console.log("📥  Fetching Google Sheets CSV…");
  const csv = await fetchCsv(CSV_URL);
  const rows = parse(csv, {
    columns: (hdr) => hdr.map((h) => h.trim().replace(/^\uFEFF/, "")),
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
  console.log(`   → ${rows.length} rows`);

  const toProcess = limit > 0 ? rows.slice(0, limit) : rows;

  let processed = 0;
  let skippedNoDoc = 0;
  let updated = 0;
  let humanVerifiedSkips = 0;

  for (const row of toProcess) {
    const mpn = (row.MPN || "").trim();
    if (!mpn) continue;
    processed++;

    const docId = mpnToDocId(mpn);
    const ref = firestore.collection("products").doc(docId);
    const snap = await ref.get();
    if (!snap.exists) {
      skippedNoDoc++;
      continue;
    }

    // CSV-first, RICS-fallback
    const csvGender = normalizeGender((row.Group || "").trim());
    const csvDepartment = (row.Department || "").trim();
    const csvClass = (row.Class || "").trim();
    const csvCategory = (row.Category || "").trim();
    const ricsParsed = parseRicsCategory(row["RICS Category"] || "");

    const resolved = {
      gender: csvGender || ricsParsed.gender,
      department: csvDepartment || ricsParsed.department,
      class: csvClass || ricsParsed.class,
      category: csvCategory || ricsParsed.category,
      age_group_detail: ricsParsed.age_group_detail,
    };

    const brand = (row.Brand || snap.data().brand || "").trim();
    const industryMpn = getNikeIndustryMpn(mpn, brand);

    // Name resolution
    const csvName = (row.Name || "").trim();
    const rics = (row["RICS Short Description"] || "").trim();
    let name = snap.data().name;
    let name_source = snap.data().name_source;
    if (!csvName || (rics && csvName.toLowerCase() === rics.toLowerCase())) {
      if (rics) {
        name = formatRicsShortDesc(rics);
        name_source = "rics_short_desc";
      }
    } else if (csvName) {
      name = csvName;
      name_source = "csv_name";
    }

    // Top-level stamp
    const topLevel = {};
    for (const k of ["gender", "department", "class", "category", "age_group_detail"]) {
      if (resolved[k]) topLevel[k] = resolved[k];
    }
    if (industryMpn) topLevel.rics_industry_mpn = industryMpn;
    if (name) topLevel.name = name;
    if (name_source) topLevel.name_source = name_source;
    if (name_source === "rics_short_desc") topLevel.needs_ai_name = true;

    // Descriptive color
    const descColor = (row["Descriptive Color"] || "").trim();
    const ricsColor = (row["RICS Color"] || "").trim();
    const normColor = descColor || normalizeColor(ricsColor);
    if (!normColor) topLevel.needs_ai_color = true;

    // attribute_values writes (respect Human-Verified)
    const attrWrites = {
      gender: resolved.gender,
      department: resolved.department,
      class: resolved.class,
      category: resolved.category,
      age_group_detail: resolved.age_group_detail,
      descriptive_color: normColor,
      primary_color: (row["Primary Color"] || "").trim(),
      rics_industry_mpn: industryMpn,
    };

    if (dryRun) {
      console.log(`DRY ${mpn} →`, { topLevel, attrWrites });
      continue;
    }

    if (Object.keys(topLevel).length) {
      await ref.set(topLevel, { merge: true });
    }

    for (const [key, value] of Object.entries(attrWrites)) {
      if (!value) continue;
      const attrRef = ref.collection("attribute_values").doc(key);
      const existing = await attrRef.get();
      if (
        existing.exists &&
        existing.data().verification_state === "Human-Verified"
      ) {
        humanVerifiedSkips++;
        continue;
      }
      await attrRef.set(
        {
          value,
          origin_type: "Import",
          origin_detail: "Backfill from Google Sheets",
          verification_state: "System-Applied",
          written_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    updated++;
    if (updated % 50 === 0) console.log(`   ✔  ${updated} updated…`);
  }

  console.log("\n──── Backfill complete ────");
  console.log(`  Rows processed:         ${processed}`);
  console.log(`  Products updated:       ${updated}`);
  console.log(`  Skipped (no Firestore): ${skippedNoDoc}`);
  console.log(`  Human-Verified skips:   ${humanVerifiedSkips}`);
  process.exit(0);
}

run().catch((e) => {
  console.error("❌ Backfill failed:", e);
  process.exit(1);
});
