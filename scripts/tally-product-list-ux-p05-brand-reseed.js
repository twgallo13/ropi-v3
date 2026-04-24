// TALLY-PRODUCT-LIST-UX Phase 0.5 — Brand Registry canonical reseed.
//
// Reseeds brand_registry with the canonical 40-brand list (PO sheet derived,
// 2026-04-22 Lisa ruling). Supersedes the 10-entry seed from TALLY-128 Task 2.
//
// Behavior contract:
//   - Doc ID = brand_key (lowercase snake_case)
//   - Each entry written via createDocument or full overwrite (NO merge) —
//     this is a canonical reset, not a partial update.
//   - logo_url stamped null (future admin UI populates)
//   - is_active=true, po_confirmed=true on every entry
//   - notes=null
//   - created_by sentinel = "tally-product-list-ux-p05" (audit/cleanup filter)
//
// Idempotency: re-runnable. Existing docs are deleted and recreated to
// guarantee canonical state (no stale alias/owner drift).
//
// Flags:
//   --dry-run (default)  list intended writes, perform zero mutations
//   --execute            actually write to Firestore
//
// Codespace lacks ADC: uses Firestore REST API + gcloud access token.
"use strict";

const { execSync } = require("child_process");
const https = require("https");

const PROJECT = "ropi-aoss-dev";
const NOW_ISO = new Date().toISOString();
const CREATED_BY = "tally-product-list-ux-p05";

const argv = process.argv.slice(2);
const EXECUTE = argv.includes("--execute");
const DRY_RUN = !EXECUTE; // default to dry-run

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

// ─────────────────────────────────────────────────────────────────────────
// Canonical 40-brand seed (PO sheet derived, Lisa ruling 2026-04-22)
//   - Title Case display_names
//   - RO variants in aliases (lowercase; matchBrand normalizes case-insensitive)
//   - Dupes collapsed (Smoke Rise + SMOKE RISE/NEW WORL CREATION INC → one)
//   - default_site_owner per PO sheet
// ─────────────────────────────────────────────────────────────────────────
const SEED = [
  { brand_key: "weiv",                  display_name: "Weiv",                  aliases: ["weiv"],                                                                  default_site_owner: "karmaloop" },
  { brand_key: "nike",                  display_name: "Nike",                  aliases: ["nike", "nike inc", "nike inc."],                                         default_site_owner: "shiekh" },
  { brand_key: "jordan",                display_name: "Jordan",                aliases: ["jordan", "brand jordan"],                                                default_site_owner: "shiekh" },
  { brand_key: "pleaser",               display_name: "Pleaser",               aliases: ["pleaser"],                                                               default_site_owner: "shiekh" },
  { brand_key: "adidas",                display_name: "Adidas",                aliases: ["adidas"],                                                                default_site_owner: "shiekh" },
  { brand_key: "publish",               display_name: "Publish",               aliases: ["publish"],                                                               default_site_owner: "shiekh" },
  { brand_key: "legend_footwear",       display_name: "Legend Footwear",       aliases: ["legend footwear", "legend footwear inc"],                                default_site_owner: "shiekh" },
  { brand_key: "shiekh",                display_name: "Shiekh",                aliases: ["shiekh"],                                                                default_site_owner: "shiekh" },
  { brand_key: "converse",              display_name: "Converse",              aliases: ["converse"],                                                              default_site_owner: "shiekh" },
  { brand_key: "crocs",                 display_name: "Crocs",                 aliases: ["crocs"],                                                                 default_site_owner: "shiekh" },
  { brand_key: "new_era",               display_name: "New Era",               aliases: ["new era", "new era caps"],                                               default_site_owner: "shiekh" },
  { brand_key: "lilianas",              display_name: "Lilianas",              aliases: ["lilianas", "lilianas shoes"],                                            default_site_owner: "shiekh" },
  { brand_key: "puma",                  display_name: "Puma",                  aliases: ["puma"],                                                                  default_site_owner: "shiekh" },
  { brand_key: "new_balance",           display_name: "New Balance",           aliases: ["new balance", "new balance ath shoe", "new balance ath. shoe"],          default_site_owner: "shiekh" },
  { brand_key: "vans",                  display_name: "Vans",                  aliases: ["vans", "vans distribution cnt", "vans distribution"],                    default_site_owner: "shiekh" },
  { brand_key: "bamboo",                display_name: "Bamboo",                aliases: ["bamboo"],                                                                default_site_owner: "shiekh" },
  { brand_key: "fly_society",           display_name: "Fly Society",           aliases: ["fly society"],                                                           default_site_owner: "shiekh" },
  { brand_key: "fbrk",                  display_name: "FBRK",                  aliases: ["fbrk"],                                                                  default_site_owner: "shiekh" },
  { brand_key: "orisue",                display_name: "Orisue",                aliases: ["orisue"],                                                                default_site_owner: "shiekh" },
  { brand_key: "jp_original",           display_name: "JP Original",           aliases: ["jp original", "j p original"],                                           default_site_owner: "shiekh" },
  { brand_key: "smoke_rise",            display_name: "Smoke Rise",            aliases: ["smoke rise", "smoke rise/new worl creation inc"],                        default_site_owner: "shiekh" },
  { brand_key: "kleep",                 display_name: "Kleep",                 aliases: ["kleep"],                                                                 default_site_owner: "shiekh" },
  { brand_key: "true_religion",         display_name: "True Religion",         aliases: ["true religion"],                                                         default_site_owner: "shiekh" },
  { brand_key: "crep_protect",          display_name: "Crep Protect",          aliases: ["crep protect"],                                                          default_site_owner: "shiekh" },
  { brand_key: "psd",                   display_name: "PSD",                   aliases: ["psd", "psd underwear"],                                                  default_site_owner: "shiekh" },
  { brand_key: "mitchell_ness",         display_name: "Mitchell & Ness",       aliases: ["mitchell & ness", "mitchell and ness", "mitchell ness"],                 default_site_owner: "shiekh" },
  { brand_key: "timberland",            display_name: "Timberland",            aliases: ["timberland", "interbrandllc-timberland", "interbrandllc timberland"],    default_site_owner: "shiekh" },
  { brand_key: "the_north_face",        display_name: "The North Face",        aliases: ["the north face"],                                                        default_site_owner: "mltd" },
  { brand_key: "pro_standard",          display_name: "Pro Standard",          aliases: ["pro standard"],                                                          default_site_owner: "shiekh" },
  { brand_key: "ice_cream",             display_name: "Ice Cream",             aliases: ["ice cream", "ice cream/roc"],                                            default_site_owner: "karmaloop" },
  { brand_key: "billionaire_boys_club", display_name: "Billionaire Boys Club", aliases: ["billionaire boys club"],                                                 default_site_owner: "karmaloop" },
  { brand_key: "cape_robbin",           display_name: "Cape Robbin",           aliases: ["cape robbin"],                                                           default_site_owner: "shiekh" },
  { brand_key: "ripndip",               display_name: "RIPNDIP",               aliases: ["ripndip"],                                                               default_site_owner: "mltd" },
  { brand_key: "champion",              display_name: "Champion",              aliases: ["champion"],                                                              default_site_owner: "shiekh" },
  { brand_key: "carhartt",              display_name: "Carhartt",              aliases: ["carhartt"],                                                              default_site_owner: "mltd" },
  { brand_key: "sangre_mia",            display_name: "Sangre Mia",            aliases: ["sangre mia"],                                                            default_site_owner: "shiekh" },
  { brand_key: "nokwal",                display_name: "Nokwal",                aliases: ["nokwal"],                                                                default_site_owner: "shiekh" },
  { brand_key: "maxima",                display_name: "Maxima",                aliases: ["maxima"],                                                                default_site_owner: "shiekh" },
  { brand_key: "kappa",                 display_name: "Kappa",                 aliases: ["kappa"],                                                                 default_site_owner: "shiekh" },
  { brand_key: "paper_planes",          display_name: "Paper Planes",          aliases: ["paper planes"],                                                          default_site_owner: "karmaloop" },
];

function buildEntry(seed) {
  return {
    brand_key: seed.brand_key,
    display_name: seed.display_name,
    aliases: seed.aliases,
    default_site_owner: seed.default_site_owner,
    is_active: true,
    po_confirmed: true,
    notes: null,
    logo_url: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    created_by: CREATED_BY,
  };
}

async function main() {
  console.log("=== TALLY-PRODUCT-LIST-UX Phase 0.5 — brand_registry reseed ===");
  console.log("Project: " + PROJECT);
  console.log("Mode:    " + (DRY_RUN ? "DRY-RUN (no writes)" : "EXECUTE (will overwrite)"));
  console.log("Sentinel created_by: " + CREATED_BY);
  console.log("Timestamp: " + NOW_ISO);
  console.log("Total seed entries: " + SEED.length);
  console.log("");

  // Validate uniqueness of brand_key in seed (defensive guard).
  const keys = new Set();
  for (const s of SEED) {
    if (keys.has(s.brand_key)) {
      console.error("FATAL: duplicate brand_key in seed: " + s.brand_key);
      process.exit(2);
    }
    keys.add(s.brand_key);
  }

  let tok = null;
  if (!DRY_RUN) tok = token();

  let wrote = 0;
  let skipped = 0;
  let errors = 0;

  for (const seed of SEED) {
    const entry = buildEntry(seed);
    const docId = entry.brand_key;
    const path = "/brand_registry/" + encodeURIComponent(docId);

    if (DRY_RUN) {
      console.log("[DRY] would write " + docId +
        " (display='" + entry.display_name +
        "', owner=" + entry.default_site_owner +
        ", aliases=" + JSON.stringify(entry.aliases) + ")");
      skipped++;
      continue;
    }

    try {
      // Canonical reset: delete-if-exists, then create with explicit docId.
      const existing = await fsReq("GET", path, null, tok);
      if (existing) {
        await fsReq("DELETE", path, null, tok);
      }
      const fields = {};
      for (const k of Object.keys(entry)) fields[k] = toFsValue(entry[k]);
      const createPath = "/brand_registry?documentId=" + encodeURIComponent(docId);
      await fsReq("POST", createPath, { fields }, tok);
      console.log("+ " + docId +
        " (display='" + entry.display_name +
        "', owner=" + entry.default_site_owner +
        ", aliases=" + JSON.stringify(entry.aliases) + ") WRITTEN");
      wrote++;
    } catch (err) {
      console.error("! " + docId + " ERROR: " + err.message);
      errors++;
    }
  }

  console.log("");
  console.log("=== Reseed complete ===");
  console.log("  Mode:    " + (DRY_RUN ? "DRY-RUN" : "EXECUTE"));
  console.log("  Staged:  " + (DRY_RUN ? skipped : 0));
  console.log("  Wrote:   " + wrote);
  console.log("  Errors:  " + errors);

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
