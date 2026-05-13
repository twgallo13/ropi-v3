/**
 * TALLY-BRAND-JORDAN-CANONICALIZATION — Firestore data patch (dev).
 *
 * Mode: TINY DEV DATA PATCH SCRIPT.
 *
 * PO rulings (locked):
 *   - "jordan" is the canonical brand key.
 *   - "Brand Jordan", "Nike Jordan", "Jordan Brand" all normalize to "jordan".
 *   - brand_jordan is soft-deactivated, not deleted.
 *
 * Targeted changes (single-batch update across two docs):
 *   1) brand_registry/jordan
 *      - aliases = ["jordan","brand jordan","nike jordan","jordan brand"]
 *   2) brand_registry/brand_jordan
 *      - display_name = "Jordan"
 *      - is_active   = false
 *
 * Hard guards:
 *   - SA project_id must be ropi-aoss-dev.
 *   - Dry-run by default. --apply required for write.
 *   - Both docs must exist; brand_key fields must match if present.
 *   - Apply re-reads both docs immediately before writing.
 *   - Apply re-reads both docs after write and asserts targets.
 *   - Apply asserts no fields beyond the approved set changed.
 *   - Two audit_log entries (one per doc) on apply.
 *
 * Usage:
 *   Dry-run: GCP_SA_KEY_DEV='<sa json>' node scripts/tally-brand-jordan-canonicalization-apply.js
 *   Apply:   GCP_SA_KEY_DEV='<sa json>' node scripts/tally-brand-jordan-canonicalization-apply.js --apply
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const PROJECT_ID = "ropi-aoss-dev";
const TALLY_ID = "TALLY-BRAND-JORDAN-CANONICALIZATION";
const EVIDENCE_DIR = "evidence/tally-brand-jordan-canonicalization";
const ACTOR = "system:tally-brand-jordan-canonicalization";

const TARGET_JORDAN_ALIASES = ["jordan", "brand jordan", "nike jordan", "jordan brand"];
const TARGET_BRAND_JORDAN_DISPLAY_NAME = "Jordan";
const TARGET_BRAND_JORDAN_IS_ACTIVE = false;

const APPLY = process.argv.includes("--apply");
const MODE = APPLY ? "apply" : "dry-run";

// ---------- auth ----------
let saJson = process.env.GCP_SA_KEY_DEV || process.env.SERVICE_ACCOUNT_JSON;
if (!saJson && fs.existsSync("/tmp/sa-dev.json")) {
  saJson = fs.readFileSync("/tmp/sa-dev.json", "utf8");
}
if (!saJson) { console.error("ERROR: GCP_SA_KEY_DEV not set"); process.exit(1); }
const sa = JSON.parse(saJson);
if (sa.project_id !== PROJECT_ID) {
  console.error(`ERROR: Project guard failed: SA=${sa.project_id}, expected ${PROJECT_ID}`);
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: PROJECT_ID });
const db = admin.firestore();

function ts() { return new Date().toISOString().replace(/[:.]/g, "-"); }
function writeEvidence(filename, payload) {
  if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const fp = path.join(EVIDENCE_DIR, filename);
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2));
  return fp;
}

// Stable JSON for deep equality of arbitrary doc data.
function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}
function arraysEqualOrdered(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function readBoth() {
  const [j, bj] = await Promise.all([
    db.collection("brand_registry").doc("jordan").get(),
    db.collection("brand_registry").doc("brand_jordan").get(),
  ]);
  return {
    jordan: { exists: j.exists, data: j.exists ? j.data() : null },
    brand_jordan: { exists: bj.exists, data: bj.exists ? bj.data() : null },
  };
}

function precheck(state) {
  const errs = [];
  if (!state.jordan.exists) errs.push("brand_registry/jordan does not exist");
  if (!state.brand_jordan.exists) errs.push("brand_registry/brand_jordan does not exist");
  if (state.jordan.exists && state.jordan.data.brand_key !== undefined &&
      state.jordan.data.brand_key !== "jordan") {
    errs.push(`brand_registry/jordan.brand_key is ${JSON.stringify(state.jordan.data.brand_key)}, expected "jordan"`);
  }
  if (state.brand_jordan.exists && state.brand_jordan.data.brand_key !== undefined &&
      state.brand_jordan.data.brand_key !== "brand_jordan") {
    errs.push(`brand_registry/brand_jordan.brand_key is ${JSON.stringify(state.brand_jordan.data.brand_key)}, expected "brand_jordan"`);
  }
  return errs;
}

function buildPlan(state) {
  const j = state.jordan.data || {};
  const bj = state.brand_jordan.data || {};
  const jordanFields = Object.keys(j).sort();
  const bjFields = Object.keys(bj).sort();
  return {
    jordan: {
      doc_path: "brand_registry/jordan",
      fields_touched: ["aliases"],
      fields_left_untouched: jordanFields.filter((f) => f !== "aliases"),
      before: { aliases: j.aliases ?? null },
      after:  { aliases: TARGET_JORDAN_ALIASES },
      no_op: arraysEqualOrdered(j.aliases || [], TARGET_JORDAN_ALIASES),
      doc_snapshot_before: j,
    },
    brand_jordan: {
      doc_path: "brand_registry/brand_jordan",
      fields_touched: ["display_name", "is_active"],
      fields_left_untouched: bjFields.filter((f) => f !== "display_name" && f !== "is_active"),
      before: { display_name: bj.display_name ?? null, is_active: bj.is_active ?? null },
      after:  { display_name: TARGET_BRAND_JORDAN_DISPLAY_NAME, is_active: TARGET_BRAND_JORDAN_IS_ACTIVE },
      no_op: bj.display_name === TARGET_BRAND_JORDAN_DISPLAY_NAME &&
             bj.is_active === TARGET_BRAND_JORDAN_IS_ACTIVE,
      doc_snapshot_before: bj,
    },
  };
}

const NORMALIZATION_EXPECTATIONS = {
  description: "post-apply expected resolution under buildBrandCanonicalizer (key→display→alias, active-only)",
  expected: {
    "Brand Jordan": "jordan",
    "Nike Jordan":  "jordan",
    "Jordan Brand": "jordan",
    "Jordan":       "jordan",
  },
};

(async function main() {
  const startedAt = new Date().toISOString();
  console.log(`[${TALLY_ID}] mode=${MODE} project=${PROJECT_ID} started=${startedAt}`);

  const state = await readBoth();
  const errs = precheck(state);
  if (errs.length) {
    const ev = {
      tally: TALLY_ID, mode: MODE, project_id: PROJECT_ID,
      result: "STOP", reason: "precheck failed", errors: errs,
      started_at: startedAt, finished_at: new Date().toISOString(),
    };
    const fp = writeEvidence(`${MODE}-${ts()}.json`, ev);
    console.error(`STOP: precheck failed. Evidence: ${fp}`);
    process.exit(2);
  }

  const plan = buildPlan(state);
  const planBase = {
    tally: TALLY_ID, mode: MODE, project_id: PROJECT_ID,
    plan,
    normalization_expectations_post_apply: NORMALIZATION_EXPECTATIONS,
    started_at: startedAt,
  };

  // No-op short-circuit
  if (plan.jordan.no_op && plan.brand_jordan.no_op) {
    const ev = { ...planBase, result: "no-op",
      reason: "both docs already at target values",
      write_planned: false, writes_performed: false,
      finished_at: new Date().toISOString() };
    const fp = writeEvidence(`${MODE}-${ts()}.json`, ev);
    console.log(`No-op: both docs at target. Evidence: ${fp}`);
    return;
  }

  if (!APPLY) {
    const ev = { ...planBase, result: "dry-run-ok",
      write_planned: true, writes_performed: false,
      next_step: "re-run with --apply",
      finished_at: new Date().toISOString() };
    const fp = writeEvidence(`dry-run-${ts()}.json`, ev);
    console.log(`Dry-run OK. jordan.aliases plan + brand_jordan.{display_name,is_active} plan. Evidence: ${fp}`);
    return;
  }

  // ---------- APPLY ----------
  // Re-read immediately before write to guard against drift.
  const reState = await readBoth();
  const reErrs = precheck(reState);
  if (reErrs.length) {
    const ev = { ...planBase, result: "STOP", reason: "pre-apply re-read precheck failed",
      errors: reErrs, write_planned: true, writes_performed: false,
      finished_at: new Date().toISOString() };
    const fp = writeEvidence(`apply-${ts()}.json`, ev);
    console.error(`STOP: pre-apply re-read precheck failed. Evidence: ${fp}`);
    process.exit(3);
  }
  // Confirm pre-apply baseline matches what we planned against (no concurrent edits).
  if (stableStringify(reState.jordan.data) !== stableStringify(state.jordan.data) ||
      stableStringify(reState.brand_jordan.data) !== stableStringify(state.brand_jordan.data)) {
    const ev = { ...planBase, result: "STOP",
      reason: "doc(s) changed between initial read and pre-apply re-read",
      write_planned: true, writes_performed: false,
      reread_snapshot: {
        jordan: reState.jordan.data, brand_jordan: reState.brand_jordan.data,
      },
      finished_at: new Date().toISOString() };
    const fp = writeEvidence(`apply-${ts()}.json`, ev);
    console.error(`STOP: drift detected on re-read. Evidence: ${fp}`);
    process.exit(4);
  }

  // Atomic batch write of approved fields only.
  const jordanRef = db.collection("brand_registry").doc("jordan");
  const brandJordanRef = db.collection("brand_registry").doc("brand_jordan");
  const batch = db.batch();
  if (!plan.jordan.no_op) {
    batch.update(jordanRef, { aliases: TARGET_JORDAN_ALIASES });
  }
  if (!plan.brand_jordan.no_op) {
    batch.update(brandJordanRef, {
      display_name: TARGET_BRAND_JORDAN_DISPLAY_NAME,
      is_active: TARGET_BRAND_JORDAN_IS_ACTIVE,
    });
  }
  await batch.commit();

  // Verification re-read
  const verState = await readBoth();
  const verJordan = verState.jordan.data || {};
  const verBrandJordan = verState.brand_jordan.data || {};
  const verifyErrs = [];
  if (!arraysEqualOrdered(verJordan.aliases || [], TARGET_JORDAN_ALIASES)) {
    verifyErrs.push(`jordan.aliases mismatch: got ${JSON.stringify(verJordan.aliases)}`);
  }
  if (verBrandJordan.display_name !== TARGET_BRAND_JORDAN_DISPLAY_NAME) {
    verifyErrs.push(`brand_jordan.display_name mismatch: got ${JSON.stringify(verBrandJordan.display_name)}`);
  }
  if (verBrandJordan.is_active !== TARGET_BRAND_JORDAN_IS_ACTIVE) {
    verifyErrs.push(`brand_jordan.is_active mismatch: got ${JSON.stringify(verBrandJordan.is_active)}`);
  }

  // Integrity: confirm no other field changed.
  const otherChangedJordan = [];
  const otherChangedBrandJordan = [];
  const beforeJ = state.jordan.data || {};
  const beforeBJ = state.brand_jordan.data || {};
  for (const k of new Set([...Object.keys(beforeJ), ...Object.keys(verJordan)])) {
    if (k === "aliases") continue;
    if (stableStringify(beforeJ[k]) !== stableStringify(verJordan[k])) {
      otherChangedJordan.push({ field: k, before: beforeJ[k], after: verJordan[k] });
    }
  }
  for (const k of new Set([...Object.keys(beforeBJ), ...Object.keys(verBrandJordan)])) {
    if (k === "display_name" || k === "is_active") continue;
    if (stableStringify(beforeBJ[k]) !== stableStringify(verBrandJordan[k])) {
      otherChangedBrandJordan.push({ field: k, before: beforeBJ[k], after: verBrandJordan[k] });
    }
  }
  if (otherChangedJordan.length || otherChangedBrandJordan.length) {
    verifyErrs.push("integrity failure: untouched field(s) changed");
  }

  if (verifyErrs.length) {
    const ev = { ...planBase, result: "STOP",
      reason: "post-apply verification failed",
      errors: verifyErrs,
      other_fields_changed: { jordan: otherChangedJordan, brand_jordan: otherChangedBrandJordan },
      doc_snapshot_after: { jordan: verJordan, brand_jordan: verBrandJordan },
      write_planned: true, writes_performed: true,
      finished_at: new Date().toISOString() };
    const fp = writeEvidence(`apply-${ts()}.json`, ev);
    console.error(`STOP: ${verifyErrs.join("; ")}. Evidence: ${fp}`);
    process.exit(5);
  }

  // Audit logs (one per doc).
  let auditJordanId = null, auditBrandJordanId = null, auditErr = null;
  try {
    if (!plan.jordan.no_op) {
      const ref = await db.collection("audit_log").add({
        actor_user_id: ACTOR,
        event_type: "brand_registry_canonicalization",
        tally: TALLY_ID,
        collection: "brand_registry",
        doc_id: "jordan",
        fields: ["aliases"],
        before: { aliases: beforeJ.aliases ?? null },
        after:  { aliases: TARGET_JORDAN_ALIASES },
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      auditJordanId = ref.id;
    }
    if (!plan.brand_jordan.no_op) {
      const ref = await db.collection("audit_log").add({
        actor_user_id: ACTOR,
        event_type: "brand_registry_canonicalization",
        tally: TALLY_ID,
        collection: "brand_registry",
        doc_id: "brand_jordan",
        fields: ["display_name", "is_active"],
        before: { display_name: beforeBJ.display_name ?? null, is_active: beforeBJ.is_active ?? null },
        after:  { display_name: TARGET_BRAND_JORDAN_DISPLAY_NAME, is_active: TARGET_BRAND_JORDAN_IS_ACTIVE },
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      auditBrandJordanId = ref.id;
    }
  } catch (e) {
    auditErr = String(e && e.message ? e.message : e);
  }

  const ev = {
    ...planBase,
    result: auditErr ? "STOP" : "apply-ok",
    reason: auditErr ? `audit_log write failed: ${auditErr}` : undefined,
    write_planned: true,
    writes_performed: true,
    audit_log_ids: { jordan: auditJordanId, brand_jordan: auditBrandJordanId },
    audit_log_error: auditErr,
    doc_snapshot_after: { jordan: verJordan, brand_jordan: verBrandJordan },
    verification: {
      jordan_aliases: verJordan.aliases,
      brand_jordan_display_name: verBrandJordan.display_name,
      brand_jordan_is_active: verBrandJordan.is_active,
      other_fields_changed: { jordan: otherChangedJordan, brand_jordan: otherChangedBrandJordan },
      matches_target: true,
    },
    finished_at: new Date().toISOString(),
  };
  const fp = writeEvidence(`apply-${ts()}.json`, ev);
  if (auditErr) {
    console.error(`STOP: audit_log write failed. Evidence: ${fp}`);
    process.exit(6);
  }
  console.log(`Apply OK. audit_log: jordan=${auditJordanId} brand_jordan=${auditBrandJordanId}. Evidence: ${fp}`);
})().catch((e) => { console.error("Unhandled:", e); process.exit(99); });
