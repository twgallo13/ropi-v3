/**
 * TALLY-BRAND-JORDAN-REGISTRY-CLARIFICATION — Firestore data patch (dev).
 *
 * Mode: TINY DEV DATA PATCH SCRIPT.
 *
 * Scope (single field on a single doc):
 *   collection: brand_registry
 *   doc_id:     brand_jordan
 *   field:      display_name
 *   before:     "Jordan"
 *   after:      "Nike Jordan"
 *
 * PO ruling: brand_jordan = "Nike Jordan" brand. Distinct from "jordan" key.
 * No deletion, no merge, no migration. Display label only.
 *
 * Hard guards:
 *   - Project must be ropi-aoss-dev (SA project_id).
 *   - Dry-run by default. --apply required for write.
 *   - Re-read + re-assert before write.
 *   - Re-read + verify after write.
 *   - No update touches any field other than display_name.
 *
 * Usage:
 *   Dry-run: GCP_SA_KEY_DEV='<sa json>' node scripts/tally-brand-jordan-registry-clarification-apply.js
 *   Apply:   GCP_SA_KEY_DEV='<sa json>' node scripts/tally-brand-jordan-registry-clarification-apply.js --apply
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const PROJECT_ID = "ropi-aoss-dev";
const TALLY_ID = "TALLY-BRAND-JORDAN-REGISTRY-CLARIFICATION";
const EVIDENCE_DIR = "evidence/tally-brand-jordan-registry-clarification";
const COLLECTION = "brand_registry";
const DOC_ID = "brand_jordan";
const FIELD = "display_name";
const BEFORE_VALUE = "Jordan";
const AFTER_VALUE = "Nike Jordan";
const ACTOR = "system:tally-brand-jordan-registry-clarification";

const APPLY = process.argv.includes("--apply");
const MODE = APPLY ? "apply" : "dry-run";

// ---------- auth ----------
let saJson = process.env.GCP_SA_KEY_DEV || process.env.SERVICE_ACCOUNT_JSON;
if (!saJson && fs.existsSync("/tmp/sa-dev.json")) {
  saJson = fs.readFileSync("/tmp/sa-dev.json", "utf8");
}
if (!saJson) {
  console.error("ERROR: GCP_SA_KEY_DEV not set");
  process.exit(1);
}
const sa = JSON.parse(saJson);
if (sa.project_id !== PROJECT_ID) {
  console.error(`ERROR: Project guard failed: SA project_id=${sa.project_id}, expected ${PROJECT_ID}`);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(sa), projectId: PROJECT_ID });
const db = admin.firestore();

function ts() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeEvidence(filename, payload) {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
  const fp = path.join(EVIDENCE_DIR, filename);
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2));
  return fp;
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`[${TALLY_ID}] mode=${MODE} project=${PROJECT_ID} started=${startedAt}`);

  const ref = db.collection(COLLECTION).doc(DOC_ID);
  const snap = await ref.get();

  if (!snap.exists) {
    const ev = {
      tally: TALLY_ID, mode: MODE, project_id: PROJECT_ID,
      doc_path: `${COLLECTION}/${DOC_ID}`,
      result: "STOP",
      reason: "doc_not_found",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
    const fp = writeEvidence(`${MODE}-${ts()}.json`, ev);
    console.error(`STOP: ${ev.reason}. Evidence: ${fp}`);
    process.exit(2);
  }

  const beforeData = snap.data() || {};
  const currentDisplayName = beforeData.display_name;
  const fieldsBefore = Object.keys(beforeData).sort();
  const fieldsLeftUntouched = fieldsBefore.filter((f) => f !== FIELD);

  const planBase = {
    tally: TALLY_ID,
    mode: MODE,
    project_id: PROJECT_ID,
    doc_path: `${COLLECTION}/${DOC_ID}`,
    field: FIELD,
    before_value: currentDisplayName,
    after_value: AFTER_VALUE,
    fields_touched: [FIELD],
    fields_left_untouched: fieldsLeftUntouched,
    doc_snapshot_before: beforeData,
    started_at: startedAt,
  };

  // No-op case: already at target value
  if (currentDisplayName === AFTER_VALUE) {
    const ev = {
      ...planBase,
      result: "no-op",
      reason: "display_name already at target value",
      write_planned: false,
      writes_performed: false,
      finished_at: new Date().toISOString(),
    };
    const fp = writeEvidence(`${MODE}-${ts()}.json`, ev);
    console.log(`No-op: display_name already "${AFTER_VALUE}". Evidence: ${fp}`);
    return;
  }

  // Pre-write assertion
  if (currentDisplayName !== BEFORE_VALUE) {
    const ev = {
      ...planBase,
      result: "STOP",
      reason: `display_name is not "${BEFORE_VALUE}" (got ${JSON.stringify(currentDisplayName)})`,
      write_planned: false,
      writes_performed: false,
      finished_at: new Date().toISOString(),
    };
    const fp = writeEvidence(`${MODE}-${ts()}.json`, ev);
    console.error(`STOP: ${ev.reason}. Evidence: ${fp}`);
    process.exit(3);
  }

  // ---------- DRY-RUN ----------
  if (!APPLY) {
    const ev = {
      ...planBase,
      result: "dry-run-ok",
      write_planned: true,
      writes_performed: false,
      next_step: "re-run with --apply to perform the write",
      finished_at: new Date().toISOString(),
    };
    const fp = writeEvidence(`dry-run-${ts()}.json`, ev);
    console.log(`Dry-run OK. Plan: ${COLLECTION}/${DOC_ID}.${FIELD} "${BEFORE_VALUE}" -> "${AFTER_VALUE}". Evidence: ${fp}`);
    return;
  }

  // ---------- APPLY ----------
  // Re-read immediately before write to guard against drift.
  const reSnap = await ref.get();
  if (!reSnap.exists) {
    const ev = { ...planBase, result: "STOP", reason: "doc disappeared between initial read and pre-apply re-read",
      write_planned: false, writes_performed: false, finished_at: new Date().toISOString() };
    const fp = writeEvidence(`apply-${ts()}.json`, ev);
    console.error(`STOP: ${ev.reason}. Evidence: ${fp}`);
    process.exit(4);
  }
  const reData = reSnap.data() || {};
  if (reData.display_name !== BEFORE_VALUE) {
    const ev = { ...planBase, result: "STOP",
      reason: `pre-apply re-read failed: display_name is ${JSON.stringify(reData.display_name)}, expected "${BEFORE_VALUE}"`,
      write_planned: false, writes_performed: false, finished_at: new Date().toISOString() };
    const fp = writeEvidence(`apply-${ts()}.json`, ev);
    console.error(`STOP: ${ev.reason}. Evidence: ${fp}`);
    process.exit(5);
  }

  // Single-field write via update().
  await ref.update({ [FIELD]: AFTER_VALUE });

  // Verification re-read.
  const verSnap = await ref.get();
  const verData = verSnap.data() || {};
  if (verData.display_name !== AFTER_VALUE) {
    const ev = { ...planBase, result: "STOP",
      reason: `post-apply verification failed: display_name is ${JSON.stringify(verData.display_name)}, expected "${AFTER_VALUE}"`,
      write_planned: true, writes_performed: true,
      doc_snapshot_after: verData,
      finished_at: new Date().toISOString() };
    const fp = writeEvidence(`apply-${ts()}.json`, ev);
    console.error(`STOP: ${ev.reason}. Evidence: ${fp}`);
    process.exit(6);
  }

  // Also confirm no other field changed (compare keys + values).
  const beforeKeys = Object.keys(beforeData).sort();
  const afterKeys = Object.keys(verData).sort();
  const otherChanged = [];
  for (const k of new Set([...beforeKeys, ...afterKeys])) {
    if (k === FIELD) continue;
    const a = JSON.stringify(beforeData[k]);
    const b = JSON.stringify(verData[k]);
    if (a !== b) otherChanged.push({ field: k, before: beforeData[k], after: verData[k] });
  }
  if (otherChanged.length) {
    const ev = { ...planBase, result: "STOP",
      reason: "post-apply integrity failure: other field(s) changed",
      other_fields_changed: otherChanged,
      write_planned: true, writes_performed: true,
      doc_snapshot_after: verData,
      finished_at: new Date().toISOString() };
    const fp = writeEvidence(`apply-${ts()}.json`, ev);
    console.error(`STOP: ${ev.reason}. Evidence: ${fp}`);
    process.exit(7);
  }

  // Audit log entry.
  let auditId = null;
  let auditError = null;
  try {
    const auditRef = await db.collection("audit_log").add({
      actor_user_id: ACTOR,
      event_type: "brand_registry_display_name_update",
      tally: TALLY_ID,
      doc_id: DOC_ID,
      collection: COLLECTION,
      field: FIELD,
      before: BEFORE_VALUE,
      after: AFTER_VALUE,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    auditId = auditRef.id;
  } catch (e) {
    auditError = String(e && e.message ? e.message : e);
  }

  const ev = {
    ...planBase,
    result: auditError ? "STOP" : "apply-ok",
    reason: auditError ? `audit_log write failed: ${auditError}` : undefined,
    write_planned: true,
    writes_performed: true,
    audit_log_id: auditId,
    audit_log_error: auditError,
    doc_snapshot_after: verData,
    verification: {
      display_name_after: verData.display_name,
      matches_target: verData.display_name === AFTER_VALUE,
      other_fields_changed: otherChanged,
    },
    finished_at: new Date().toISOString(),
  };
  const fp = writeEvidence(`apply-${ts()}.json`, ev);
  if (auditError) {
    console.error(`STOP: audit_log write failed. Doc updated. Evidence: ${fp}`);
    process.exit(8);
  }
  console.log(`Apply OK. ${COLLECTION}/${DOC_ID}.${FIELD} -> "${AFTER_VALUE}". audit_log_id=${auditId}. Evidence: ${fp}`);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(99);
});
