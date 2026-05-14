#!/usr/bin/env node
/**
 * TALLY-144-2C.0 — Seed `attribute_registry/department_key` so future
 * importer writes (TALLY-144-2C.1) and 2C backfill (PR #135) can land
 * canonical `attribute_values/department_key` docs against a real
 * registry entry.
 *
 * Mode: dry-run by default. Pass `--apply` to perform writes.
 *
 * Source doc:  attribute_registry/department    (must exist; never modified)
 * Target doc:  attribute_registry/department_key
 *
 * Behavior:
 *   - Project-guarded to ropi-aoss-dev via GCP_SA_KEY_DEV.
 *   - Source must exist; otherwise STOP.
 *   - If target already exists:
 *       * dry-run: report no-op (with current shape echoed).
 *       * apply:  no-op + audit_log records created=false. Will NOT
 *                 overwrite. If the existing target's field_key is
 *                 present and != "department_key", STOP-on-conflict.
 *   - Mirror source fields where safe (per dispatch list).
 *   - Force overrides:
 *       field_key            = "department_key"
 *       display_name         = "Department"          (also keep display_label)
 *       enum_source          = "department_registry"
 *       dropdown_source      = "department_registry" (mirror of enum_source)
 *       is_editable          = false                  (canonical key — system-derived)
 *       created_at/updated_at = serverTimestamp
 *       created_by/updated_by = ACTOR
 *
 * NEVER touches:
 *   - attribute_registry/department (source) — read-only
 *   - department_registry            — not read or written
 *   - any product / attribute_values  — not read or written
 *   - smart_rules / cadence_rules / cadence_assignments
 *   - importer code
 */

const fs = require("fs");
const path = require("path");
const admin = require("/workspaces/ropi-v3/backend/functions/node_modules/firebase-admin");

const TALLY = "TALLY-144-2C.0";
const ACTOR = "system:tally-144-2c0-seed-department-key-registry";
const SOURCE_DOC = "department";
const TARGET_DOC = "department_key";
const EVIDENCE_DIR = path.join(
  __dirname,
  "..",
  "evidence",
  "tally-144-2c0-seed-department-key-registry"
);

const APPLY = process.argv.includes("--apply");

// Fields that, if present on the source doc, should be copied through
// without modification onto the target. (Per dispatch §"Target shape".)
const PRESERVE_KEYS = [
  "field_type",
  "severity",
  "depends_on",
  "tab_group_order",
  "why_it_matters",
  "display_order",
  "required_for_completion",
  // Additional schema fields that exist on the source and have no reason
  // to differ on the canonical-key registry entry. None of these encode
  // a "department vs department_key" distinction.
  "data_type",
  "destination_tab",
  "group",
  "display_group",
  "is_searchable",
  "is_filterable",
  "include_in_cadence_targeting",
  "include_in_ai_prompt",
  "full_width",
  "is_ai_generated",
  "is_required",
  "active",
  "status",
  "default_value",
  "allowed_values",
  "dropdown_options",
  "export_enabled",
  "sort_order",
  "label",
];

// Force overrides applied AFTER the preserve copy. These are the canonical
// key's identity fields and provenance.
function buildForceOverrides() {
  return {
    field_key: TARGET_DOC,
    display_name: "Department",
    display_label: "Department",
    enum_source: "department_registry",
    dropdown_source: "department_registry",
    is_editable: false,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    created_by: ACTOR,
    updated_by: ACTOR,
  };
}

function tsTag() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureEvidenceDir() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

function projectGuard() {
  const raw = process.env.GCP_SA_KEY_DEV;
  if (!raw) {
    console.error("FATAL: GCP_SA_KEY_DEV not set");
    process.exit(2);
  }
  const sa = JSON.parse(raw);
  if (sa.project_id !== "ropi-aoss-dev") {
    console.error(
      `FATAL: project guard — expected ropi-aoss-dev, got ${sa.project_id}`
    );
    process.exit(2);
  }
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: "ropi-aoss-dev",
  });
  return sa.project_id;
}

function sourceSnapshotSummary(srcData) {
  return {
    keys: Object.keys(srcData).sort(),
    field_type: srcData.field_type ?? null,
    enum_source: srcData.enum_source ?? null,
    dropdown_source: srcData.dropdown_source ?? null,
    display_label: srcData.display_label ?? null,
    is_editable: srcData.is_editable ?? null,
    required_for_completion: srcData.required_for_completion ?? null,
    severity: srcData.severity ?? null,
    depends_on: srcData.depends_on ?? null,
    tab_group_order: srcData.tab_group_order ?? null,
    display_order: srcData.display_order ?? null,
    active: srcData.active ?? null,
    status: srcData.status ?? null,
  };
}

function buildProposedTarget(srcData) {
  const proposed = {};
  const preserved = [];
  for (const k of PRESERVE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(srcData, k)) {
      proposed[k] = srcData[k];
      preserved.push(k);
    }
  }
  const overrides = buildForceOverrides();
  // For evidence display we substitute the serverTimestamp sentinel with a
  // string marker. The actual write uses the real sentinel.
  const overrideEvidence = {
    ...overrides,
    created_at: "<serverTimestamp>",
    updated_at: "<serverTimestamp>",
  };
  const overridden = Object.keys(overrides);
  for (const [k, v] of Object.entries(overrideEvidence)) {
    proposed[k] = v;
  }
  return { proposed, preserved, overridden };
}

async function main() {
  ensureEvidenceDir();
  const projectId = projectGuard();
  const db = admin.firestore();

  const srcRef = db.collection("attribute_registry").doc(SOURCE_DOC);
  const tgtRef = db.collection("attribute_registry").doc(TARGET_DOC);

  const [srcSnap, tgtSnap] = await Promise.all([srcRef.get(), tgtRef.get()]);

  if (!srcSnap.exists) {
    console.error(
      `STOP: source doc attribute_registry/${SOURCE_DOC} does not exist`
    );
    const stopFile = path.join(EVIDENCE_DIR, `stop-source-missing-${tsTag()}.json`);
    fs.writeFileSync(
      stopFile,
      JSON.stringify(
        {
          tally: TALLY,
          mode: APPLY ? "apply" : "dry-run",
          project_id: projectId,
          stop_reason: "source_missing",
          source_doc: `attribute_registry/${SOURCE_DOC}`,
          target_doc: `attribute_registry/${TARGET_DOC}`,
        },
        null,
        2
      )
    );
    console.error("Wrote", stopFile);
    await admin.app().delete();
    process.exit(3);
  }

  const srcData = srcSnap.data() || {};
  const tgtExisted = tgtSnap.exists;
  const tgtData = tgtExisted ? tgtSnap.data() || {} : null;

  // Conflict gate: if target exists with a field_key that contradicts the
  // canonical name we want, STOP — never overwrite.
  if (
    tgtExisted &&
    typeof tgtData.field_key === "string" &&
    tgtData.field_key !== TARGET_DOC
  ) {
    console.error(
      `STOP: target attribute_registry/${TARGET_DOC} exists with conflicting field_key="${tgtData.field_key}"`
    );
    const stopFile = path.join(
      EVIDENCE_DIR,
      `stop-target-conflict-${tsTag()}.json`
    );
    fs.writeFileSync(
      stopFile,
      JSON.stringify(
        {
          tally: TALLY,
          mode: APPLY ? "apply" : "dry-run",
          project_id: projectId,
          stop_reason: "target_field_key_conflict",
          target_doc: `attribute_registry/${TARGET_DOC}`,
          existing_field_key: tgtData.field_key,
          expected_field_key: TARGET_DOC,
        },
        null,
        2
      )
    );
    console.error("Wrote", stopFile);
    await admin.app().delete();
    process.exit(3);
  }

  const { proposed, preserved, overridden } = buildProposedTarget(srcData);

  const summary = {
    tally: TALLY,
    mode: APPLY ? "apply" : "dry-run",
    project_id: projectId,
    timestamp: new Date().toISOString(),
    source_doc: `attribute_registry/${SOURCE_DOC}`,
    target_doc: `attribute_registry/${TARGET_DOC}`,
    source_doc_snapshot_summary: sourceSnapshotSummary(srcData),
    target_already_exists: tgtExisted,
    target_existing_data: tgtData,
    proposed_target_doc: proposed,
    fields_preserved_from_source: preserved,
    fields_overridden: overridden,
    writes_performed: false,
    audit_log_id: null,
    created: false,
    noop_reason: null,
  };

  if (APPLY) {
    if (tgtExisted) {
      summary.created = false;
      summary.noop_reason = "target_already_exists";
      const auditRef = await db.collection("audit_log").add({
        actor_user_id: ACTOR,
        event_type: "attribute_registry_department_key_seed",
        tally: TALLY,
        source_doc: `attribute_registry/${SOURCE_DOC}`,
        target_doc: `attribute_registry/${TARGET_DOC}`,
        created: false,
        noop_reason: "target_already_exists",
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      summary.audit_log_id = auditRef.id;
      summary.writes_performed = true; // audit_log only
      const applyFile = path.join(EVIDENCE_DIR, `apply-noop-${tsTag()}.json`);
      fs.writeFileSync(applyFile, JSON.stringify(summary, null, 2));
      console.log(
        `APPLY no-op (target already exists). audit_log_id=${summary.audit_log_id}`
      );
      console.log("Wrote", applyFile);
    } else {
      const writeDoc = {};
      for (const k of preserved) writeDoc[k] = srcData[k];
      Object.assign(writeDoc, buildForceOverrides());
      // Defensive: never write a `field_key` other than TARGET_DOC.
      writeDoc.field_key = TARGET_DOC;
      await tgtRef.set(writeDoc, { merge: false });
      summary.created = true;
      summary.writes_performed = true;
      const auditRef = await db.collection("audit_log").add({
        actor_user_id: ACTOR,
        event_type: "attribute_registry_department_key_seed",
        tally: TALLY,
        source_doc: `attribute_registry/${SOURCE_DOC}`,
        target_doc: `attribute_registry/${TARGET_DOC}`,
        created: true,
        fields_preserved_from_source: preserved,
        fields_overridden: overridden,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      summary.audit_log_id = auditRef.id;

      // Post-apply verification
      const verSnap = await tgtRef.get();
      const verData = verSnap.data() || {};
      summary.post_apply_target_exists = verSnap.exists;
      summary.post_apply_field_key = verData.field_key ?? null;
      summary.post_apply_enum_source = verData.enum_source ?? null;
      summary.post_apply_display_label = verData.display_label ?? null;
      summary.post_apply_is_editable = verData.is_editable ?? null;
      summary.post_apply_created_by = verData.created_by ?? null;

      const applyFile = path.join(EVIDENCE_DIR, `apply-${tsTag()}.json`);
      fs.writeFileSync(applyFile, JSON.stringify(summary, null, 2));
      console.log(
        `APPLY complete. created=true field_key=${summary.post_apply_field_key} ` +
          `enum_source=${summary.post_apply_enum_source} ` +
          `audit_log_id=${summary.audit_log_id}`
      );
      console.log("Wrote", applyFile);

      if (
        !verSnap.exists ||
        verData.field_key !== TARGET_DOC ||
        verData.enum_source !== "department_registry"
      ) {
        console.error("STOP: post-apply verification failed");
        await admin.app().delete();
        process.exit(4);
      }

      // Also write a post-apply-verify file (mirror of 2B/2C convention).
      const verFile = path.join(
        EVIDENCE_DIR,
        `post-apply-verify-${tsTag()}.json`
      );
      fs.writeFileSync(
        verFile,
        JSON.stringify(
          {
            tally: TALLY,
            project_id: projectId,
            target_doc: `attribute_registry/${TARGET_DOC}`,
            exists: verSnap.exists,
            field_key: verData.field_key ?? null,
            enum_source: verData.enum_source ?? null,
            display_label: verData.display_label ?? null,
            display_name: verData.display_name ?? null,
            dropdown_source: verData.dropdown_source ?? null,
            is_editable: verData.is_editable ?? null,
            required_for_completion: verData.required_for_completion ?? null,
            created_by: verData.created_by ?? null,
            audit_log_id: summary.audit_log_id,
            timestamp: new Date().toISOString(),
          },
          null,
          2
        )
      );
      console.log("Wrote", verFile);
    }
  } else {
    summary.noop_reason = tgtExisted ? "target_already_exists" : null;
    const dryFile = path.join(EVIDENCE_DIR, `dry-run-${tsTag()}.json`);
    fs.writeFileSync(dryFile, JSON.stringify(summary, null, 2));
    if (tgtExisted) {
      console.log(
        `DRY-RUN: target attribute_registry/${TARGET_DOC} ALREADY EXISTS — apply would record no-op audit_log entry only.`
      );
    } else {
      console.log(
        `DRY-RUN: target attribute_registry/${TARGET_DOC} MISSING. ` +
          `Apply will create with ${preserved.length} preserved + ${overridden.length} overridden fields. ` +
          `field_key=${TARGET_DOC} enum_source=department_registry is_editable=false`
      );
    }
    console.log("Wrote", dryFile);
  }

  await admin.app().delete();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
