#!/usr/bin/env node
/**
 * TALLY-144-2C — Backfill leaked product `attribute_values/department` into
 * canonical `attribute_values/department_key` and quarantine the stale
 * `attribute_values/department` doc.
 *
 * Mode: dry-run by default. Pass `--apply` to perform writes.
 *
 * Source of truth: product root `department_key` (NEVER inferred from the
 * leaked display-string value). If root `department_key` is missing, the
 * product is skipped and reported.
 *
 * Eligible products (all conditions must hold):
 *   - root `department_key` is a non-empty string
 *   - `attribute_values/department` doc exists
 *   - either `attribute_values/department_key` is missing, OR it exists and
 *     its `value` matches the root `department_key`
 *
 * Per eligible product the script will (in apply mode):
 *   1. Create / merge `attribute_values/department_key` with shape mirroring
 *      the existing `attribute_values/department` doc:
 *        {
 *          value: <root.department_key>,
 *          verification_state: "Rule-Verified",
 *          origin_type:        "Backfill",
 *          origin_detail:      "TALLY-144-2C: backfilled from product root department_key",
 *          origin_rule:        "TALLY-144-2C",
 *          field_name:         "department_key",
 *          written_at:         <serverTimestamp>,
 *          updated_at:         <serverTimestamp>,
 *        }
 *   2. Quarantine the stale `attribute_values/department` doc by MERGING:
 *        {
 *          quarantined:           true,
 *          quarantined_at:        <serverTimestamp>,
 *          quarantined_by:        "system:tally-144-2c-department-attribute-values-backfill",
 *          quarantined_reason:    "TALLY-144-2C: legacy display-string field; superseded by attribute_values/department_key",
 *          superseded_by_field:   "department_key",
 *          tally:                 "TALLY-144-2C",
 *        }
 *      No fields removed. Original `value`, `verification_state`,
 *      `origin_*`, `written_at`, `updated_at`, `field_name` are preserved.
 *
 * NEVER touches:
 *   - smart_rules / cadence_rules / cadence_assignments
 *   - rule engines or any backend code
 *   - product root fields (only the two attribute_values docs above)
 *   - any other attribute_values doc
 *
 * Project guard: requires GCP_SA_KEY_DEV with project_id === "ropi-aoss-dev".
 *
 * STOP gates BEFORE apply:
 *   - any conflict (existing av department_key.value !== root.department_key)
 *   - any eligible product where root.department_key is missing (the
 *     candidate flow already excludes these; reported as `skipped_missing_root`)
 *   - PO ruling: if --apply is invoked without --quarantine-shape-approved,
 *     the script STOPs with the proposed shape printed and an exit code 5.
 */

const fs = require("fs");
const path = require("path");
const admin = require("/workspaces/ropi-v3/backend/functions/node_modules/firebase-admin");

const TALLY = "TALLY-144-2C";
const ACTOR = "system:tally-144-2c-department-attribute-values-backfill";
const EVIDENCE_DIR = path.join(
  __dirname,
  "..",
  "evidence",
  "tally-144-2c-department-attribute-values-backfill"
);

const APPLY = process.argv.includes("--apply");
const QUARANTINE_APPROVED = process.argv.includes("--quarantine-shape-approved");

const QUARANTINE_SHAPE = {
  quarantined: true,
  quarantined_by: ACTOR,
  quarantined_reason:
    "TALLY-144-2C: legacy display-string field; superseded by attribute_values/department_key",
  superseded_by_field: "department_key",
  tally: TALLY,
  // quarantined_at is added at write time as a serverTimestamp.
};

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
    console.error(`FATAL: project guard — expected ropi-aoss-dev, got ${sa.project_id}`);
    process.exit(2);
  }
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: "ropi-aoss-dev",
  });
  return sa.project_id;
}

function buildDepartmentKeyDoc(rootDk) {
  return {
    value: rootDk,
    verification_state: "Rule-Verified",
    origin_type: "Backfill",
    origin_detail:
      "TALLY-144-2C: backfilled from product root department_key",
    origin_rule: "TALLY-144-2C",
    field_name: "department_key",
    written_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function main() {
  ensureEvidenceDir();
  const projectId = projectGuard();
  const db = admin.firestore();

  const ps = await db.collection("products").get();

  const eligible = [];
  const conflicts = [];
  const skipped_missing_root_with_av_dept = [];
  let scanned = 0;
  let withAvDept = 0;
  let withAvDk = 0;
  let already_clean = 0; // no av/department doc at all

  for (const p of ps.docs) {
    scanned++;
    const root = p.data().department_key || null;
    const [dDept, dDk] = await Promise.all([
      p.ref.collection("attribute_values").doc("department").get(),
      p.ref.collection("attribute_values").doc("department_key").get(),
    ]);
    const hasDept = dDept.exists;
    const hasDk = dDk.exists;
    if (hasDept) withAvDept++;
    if (hasDk) withAvDk++;
    if (!hasDept) {
      already_clean++;
      continue;
    }
    if (!root) {
      skipped_missing_root_with_av_dept.push({
        product_id: p.id,
        av_department_value: dDept.data()?.value ?? null,
      });
      continue;
    }
    if (hasDk) {
      const dkVal = dDk.data()?.value;
      if (dkVal !== root) {
        conflicts.push({
          product_id: p.id,
          root_department_key: root,
          av_department_key_value: dkVal,
          av_department_value: dDept.data()?.value ?? null,
        });
        continue;
      }
    }
    eligible.push({
      product_id: p.id,
      root_department_key: root,
      av_department_before: dDept.data() || null,
      av_department_key_present: hasDk,
      av_department_key_before: hasDk ? dDk.data() || null : null,
      planned_av_department_key: {
        value: root,
        verification_state: "Rule-Verified",
        origin_type: "Backfill",
        origin_detail:
          "TALLY-144-2C: backfilled from product root department_key",
        origin_rule: "TALLY-144-2C",
        field_name: "department_key",
        written_at: "<serverTimestamp>",
        updated_at: "<serverTimestamp>",
      },
      planned_av_department_quarantine_merge: {
        ...QUARANTINE_SHAPE,
        quarantined_at: "<serverTimestamp>",
      },
    });
  }

  const summary = {
    tally: TALLY,
    mode: APPLY ? "apply" : "dry-run",
    project_id: projectId,
    timestamp: new Date().toISOString(),
    products_scanned: scanned,
    with_av_department: withAvDept,
    with_av_department_key: withAvDk,
    eligible_count: eligible.length,
    skipped_missing_root_with_av_dept_count: skipped_missing_root_with_av_dept.length,
    skipped_missing_root_with_av_dept,
    conflicts_count: conflicts.length,
    conflicts,
    already_clean_no_av_department: already_clean,
    quarantine_shape_proposal: {
      ...QUARANTINE_SHAPE,
      quarantined_at: "<serverTimestamp at apply time>",
    },
    fields_touched_per_product: {
      "attribute_values/department_key (created or merged)": [
        "value",
        "verification_state",
        "origin_type",
        "origin_detail",
        "origin_rule",
        "field_name",
        "written_at",
        "updated_at",
      ],
      "attribute_values/department (merged, never deleted)": Object.keys({
        ...QUARANTINE_SHAPE,
        quarantined_at: 1,
      }),
    },
    eligible_samples: eligible.slice(0, 5),
    eligible_product_ids: eligible.map((e) => e.product_id),
    writes_performed: false,
    audit_log_id: null,
    apply_quarantine_shape_approved: QUARANTINE_APPROVED,
  };

  // STOP gates BEFORE apply
  if (APPLY) {
    if (conflicts.length > 0) {
      console.error("STOP: conflicts present — aborting apply");
      const stopFile = path.join(EVIDENCE_DIR, `stop-conflicts-${tsTag()}.json`);
      fs.writeFileSync(stopFile, JSON.stringify(summary, null, 2));
      console.error("Wrote", stopFile);
      await admin.app().delete();
      process.exit(3);
    }
    if (!QUARANTINE_APPROVED) {
      console.error(
        "STOP: --apply invoked without --quarantine-shape-approved. " +
          "PO ruling required on the proposed quarantine shape before apply."
      );
      const stopFile = path.join(
        EVIDENCE_DIR,
        `stop-quarantine-shape-pending-${tsTag()}.json`
      );
      fs.writeFileSync(stopFile, JSON.stringify(summary, null, 2));
      console.error("Wrote", stopFile);
      await admin.app().delete();
      process.exit(5);
    }
    if (eligible.length === 0) {
      const verifyFile = path.join(EVIDENCE_DIR, `apply-noop-${tsTag()}.json`);
      fs.writeFileSync(verifyFile, JSON.stringify(summary, null, 2));
      console.log("APPLY no-op (no eligible). Wrote", verifyFile);
      await admin.app().delete();
      return;
    }

    const applied = [];
    let products_updated = 0;
    let dept_docs_quarantined = 0;
    for (const e of eligible) {
      const productRef = db.collection("products").doc(e.product_id);
      // Re-read live state and re-validate immediately before write.
      const [liveProd, liveDept, liveDk] = await Promise.all([
        productRef.get(),
        productRef.collection("attribute_values").doc("department").get(),
        productRef.collection("attribute_values").doc("department_key").get(),
      ]);
      if (!liveProd.exists) {
        applied.push({ product_id: e.product_id, status: "vanished" });
        continue;
      }
      const liveRoot = liveProd.data()?.department_key || null;
      if (!liveRoot) {
        applied.push({ product_id: e.product_id, status: "lost-root-dk" });
        continue;
      }
      if (liveDk.exists && liveDk.data()?.value !== liveRoot) {
        console.error("STOP: re-validation conflict on", e.product_id);
        await admin.app().delete();
        process.exit(3);
      }
      const batch = db.batch();
      batch.set(
        productRef.collection("attribute_values").doc("department_key"),
        buildDepartmentKeyDoc(liveRoot),
        { merge: true }
      );
      if (liveDept.exists) {
        batch.set(
          productRef.collection("attribute_values").doc("department"),
          {
            ...QUARANTINE_SHAPE,
            quarantined_at: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        dept_docs_quarantined++;
      }
      await batch.commit();
      products_updated++;
      applied.push({
        product_id: e.product_id,
        root_department_key: liveRoot,
        wrote_av_department_key: true,
        quarantined_av_department: liveDept.exists,
      });
    }

    const auditRef = await db.collection("audit_log").add({
      event_type: "attribute_values_department_key_backfill",
      tally: TALLY,
      actor_user_id: ACTOR,
      products_scanned: scanned,
      products_updated,
      department_docs_quarantined: dept_docs_quarantined,
      conflicts: conflicts.length,
      product_ids: applied.map((a) => a.product_id),
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    summary.writes_performed = true;
    summary.audit_log_id = auditRef.id;
    summary.products_updated = products_updated;
    summary.department_docs_quarantined = dept_docs_quarantined;
    summary.applied = applied;

    // Post-apply verification
    const verSnap = await db.collection("products").get();
    let post_remaining_unquarantined_dept = 0;
    let post_with_av_dk = 0;
    let post_with_av_dept_quarantined = 0;
    for (const p of verSnap.docs) {
      const [d, k] = await Promise.all([
        p.ref.collection("attribute_values").doc("department").get(),
        p.ref.collection("attribute_values").doc("department_key").get(),
      ]);
      if (d.exists) {
        if (d.data()?.quarantined === true) post_with_av_dept_quarantined++;
        else post_remaining_unquarantined_dept++;
      }
      if (k.exists) post_with_av_dk++;
    }
    summary.post_apply_remaining_unquarantined_av_department =
      post_remaining_unquarantined_dept;
    summary.post_apply_with_av_department_key = post_with_av_dk;
    summary.post_apply_with_av_department_quarantined =
      post_with_av_dept_quarantined;

    const applyFile = path.join(EVIDENCE_DIR, `apply-${tsTag()}.json`);
    fs.writeFileSync(applyFile, JSON.stringify(summary, null, 2));
    console.log(
      `APPLY complete. products_updated=${products_updated} ` +
        `quarantined=${dept_docs_quarantined} ` +
        `audit_log_id=${summary.audit_log_id} ` +
        `post_remaining_unquarantined=${post_remaining_unquarantined_dept}`
    );
    console.log("Wrote", applyFile);

    if (post_remaining_unquarantined_dept > 0) {
      console.error("STOP: post-apply verification failed");
      await admin.app().delete();
      process.exit(4);
    }
  } else {
    const dryFile = path.join(EVIDENCE_DIR, `dry-run-${tsTag()}.json`);
    fs.writeFileSync(dryFile, JSON.stringify(summary, null, 2));
    console.log(
      `DRY-RUN: scanned=${scanned} eligible=${eligible.length} ` +
        `conflicts=${conflicts.length} ` +
        `skipped_missing_root=${skipped_missing_root_with_av_dept.length} ` +
        `already_clean=${already_clean}`
    );
    console.log("Wrote", dryFile);
    if (!QUARANTINE_APPROVED) {
      console.log(
        "NOTE: no prior quarantine convention exists in the codebase. " +
          "Proposed quarantine shape is recorded under " +
          "`quarantine_shape_proposal` in the dry-run JSON. " +
          "Apply will refuse without --quarantine-shape-approved (PO ruling)."
      );
    }
  }

  await admin.app().delete();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
