#!/usr/bin/env node
/**
 * TALLY-144-2F — Soft-retire legacy `attribute_registry/department` registry doc.
 *
 * PO locked rulings (2026-05-16):
 *   1. Do not hard-delete legacy attribute_values/department docs.
 *   2. Do not hard-delete attribute_registry/department.
 *   3. Soft-retire attribute_registry/department so it is hidden/superseded
 *      and not admin-editable.
 *   4. Keep attribute_registry/department_key as the canonical Department field.
 *  10. Verify Unassigned count does not fluctuate during the soft-retire.
 *
 * Mode:
 *   Dry-run by default. Writes only with --apply.
 *
 * Writes (apply only):
 *   attribute_registry/department <- {
 *     active: false,
 *     status: "superseded",
 *     is_editable: false,
 *     superseded_by: "department_key",
 *     hidden_reason: "Superseded by department_key",
 *     updated_at: <server ts>,
 *     updated_by: "system:tally-144-2f-soft-retire-department-registry",
 *   }
 *   audit_log/<auto>  <- {
 *     action: "registry.soft_retire",
 *     entity_type: "attribute_registry",
 *     entity_id: "department",
 *     actor_uid: "system:tally-144-2f",
 *     details: { tally, superseded_by, unassigned_before, unassigned_after },
 *     timestamp: <server ts>,
 *   }
 *
 * STOP conditions:
 *   - attribute_registry/department missing
 *   - attribute_registry/department_key missing
 *   - GCP_SA_KEY_DEV missing / project guard fails
 *   - Unassigned count differs before vs. after apply
 *
 * Usage:
 *   GCP_SA_KEY_DEV=... node scripts/tally-144-2f-soft-retire-department-registry.js
 *   GCP_SA_KEY_DEV=... node scripts/tally-144-2f-soft-retire-department-registry.js --apply
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const TALLY = "TALLY-144-2F";
const ACTOR = "system:tally-144-2f-soft-retire-department-registry";
const EVIDENCE_DIR = path.join(
  __dirname,
  "..",
  "evidence",
  "tally-144-2f-final-department-quarantine"
);

function isoStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function fail(msg, extra) {
  console.error(`[STOP] ${msg}`);
  if (extra !== undefined) console.error(JSON.stringify(extra, null, 2));
  process.exit(2);
}

async function main() {
  const raw = process.env.GCP_SA_KEY_DEV;
  if (!raw) fail("GCP_SA_KEY_DEV not set.");
  let creds;
  try {
    creds = JSON.parse(raw);
  } catch (e) {
    fail("GCP_SA_KEY_DEV is not valid JSON.", { error: e.message });
  }
  if (!creds.project_id) fail("GCP_SA_KEY_DEV missing project_id.");
  if (creds.project_id !== "ropi-aoss-dev") {
    fail(`Project guard: expected ropi-aoss-dev, got ${creds.project_id}.`);
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(creds),
      projectId: creds.project_id,
    });
  }
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  // ── Pre-flight: registry docs must exist ──────────────────────────
  const regDeptRef = db.collection("attribute_registry").doc("department");
  const regDeptKeyRef = db.collection("attribute_registry").doc("department_key");
  const [deptSnap, deptKeySnap] = await Promise.all([
    regDeptRef.get(),
    regDeptKeyRef.get(),
  ]);
  if (!deptSnap.exists) fail("attribute_registry/department missing.");
  if (!deptKeySnap.exists) fail("attribute_registry/department_key missing.");

  const deptBefore = deptSnap.data();
  const deptKeyBefore = deptKeySnap.data();

  // ── Unassigned count baseline ─────────────────────────────────────
  // Header source: products where cadence_state == "unassigned"
  // (matches GET /api/v1/cadence-assignments/unassigned which lists same
  //  records). Count via aggregation; one read.
  async function countUnassigned() {
    const agg = await db
      .collection("products")
      .where("cadence_state", "==", "unassigned")
      .count()
      .get();
    return agg.data().count;
  }
  const unassignedBefore = await countUnassigned();

  // ── Planned write payload ─────────────────────────────────────────
  const writePayload = {
    active: false,
    status: "superseded",
    is_editable: false,
    superseded_by: "department_key",
    hidden_reason: "Superseded by department_key",
    updated_at: FieldValue.serverTimestamp(),
    updated_by: ACTOR,
  };

  const report = {
    tally: TALLY,
    mode: APPLY ? "apply" : "dry-run",
    project_id: creds.project_id,
    timestamp: new Date().toISOString(),
    preconditions: {
      registry_department_exists: true,
      registry_department_key_exists: true,
      registry_department_active_before: deptBefore.active === true,
      registry_department_status_before: deptBefore.status ?? null,
      registry_department_is_editable_before: deptBefore.is_editable ?? null,
      registry_department_key_active: deptKeyBefore.active === true,
      registry_department_key_is_editable: deptKeyBefore.is_editable ?? null,
    },
    planned_write: {
      doc_path: "attribute_registry/department",
      payload_keys: Object.keys(writePayload),
      payload_preview: {
        active: false,
        status: "superseded",
        is_editable: false,
        superseded_by: "department_key",
        hidden_reason: "Superseded by department_key",
        updated_at: "<server ts>",
        updated_by: ACTOR,
      },
    },
    unassigned_before: unassignedBefore,
  };

  if (!APPLY) {
    report.note =
      "DRY-RUN — no writes. Pass --apply to soft-retire attribute_registry/department.";
    const outPath = path.join(
      EVIDENCE_DIR,
      `dry-run-${isoStamp()}.json`
    );
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log(`\nEvidence: ${outPath}`);
    process.exit(0);
  }

  // ── Apply ─────────────────────────────────────────────────────────
  await regDeptRef.set(writePayload, { merge: true });

  // Audit log
  const auditRef = await db.collection("audit_log").add({
    action: "registry.soft_retire",
    entity_type: "attribute_registry",
    entity_id: "department",
    actor_uid: ACTOR,
    details: {
      tally: TALLY,
      superseded_by: "department_key",
      hidden_reason: "Superseded by department_key",
      previous_active: deptBefore.active === true,
      previous_status: deptBefore.status ?? null,
      previous_is_editable: deptBefore.is_editable ?? null,
      unassigned_before: unassignedBefore,
    },
    timestamp: FieldValue.serverTimestamp(),
  });
  report.audit_log_id = auditRef.id;

  // ── Post-apply verification ───────────────────────────────────────
  const postSnap = await regDeptRef.get();
  const postData = postSnap.data() || {};
  const unassignedAfter = await countUnassigned();
  report.post_apply = {
    registry_department_active: postData.active,
    registry_department_status: postData.status,
    registry_department_is_editable: postData.is_editable,
    registry_department_superseded_by: postData.superseded_by,
    registry_department_hidden_reason: postData.hidden_reason,
    registry_department_updated_by: postData.updated_by,
  };
  report.unassigned_after = unassignedAfter;
  report.unassigned_delta = unassignedAfter - unassignedBefore;

  // STOP if Unassigned changed
  if (report.unassigned_delta !== 0) {
    report.status = "STOP_ON_ANOMALY";
    report.anomaly = "Unassigned count changed during soft-retire.";
  } else if (
    postData.active !== false ||
    postData.is_editable !== false ||
    postData.superseded_by !== "department_key"
  ) {
    report.status = "STOP_ON_ANOMALY";
    report.anomaly = "Post-apply doc shape does not match planned write.";
  } else {
    report.status = "OK";
  }

  const outPath = path.join(EVIDENCE_DIR, `apply-${isoStamp()}.json`);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nEvidence: ${outPath}`);

  if (report.status === "STOP_ON_ANOMALY") process.exit(3);
  process.exit(0);
}

main().catch((err) => {
  console.error("[FATAL]", err && err.stack ? err.stack : err);
  process.exit(1);
});
