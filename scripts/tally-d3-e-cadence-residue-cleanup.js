/**
 * TALLY-D3-E-CADENCE-RESIDUE — orphan cadence_assignments cleanup (dev only).
 *
 * Strategy A (PO ruling 3): delete cadence_assignments where doc_id is NOT
 * present in the products collection.
 *
 * Default: DRY-RUN. --apply required for any deletes.
 *
 * Hard guards:
 *   - Project must be ropi-aoss-dev.
 *   - No writes to products. Ever.
 *   - No updates to non-orphan cadence_assignments.
 *   - No cadence engine code changes (this is a one-shot cleanup script).
 *   - MPN matching is NOT used for the delete decision (PO ruling).
 *   - Default safety cap: 900 deletes. Override with --max-delete N.
 *   - --apply re-reads both collections immediately before deleting and
 *     aborts if the recomputed orphan set differs from the dry-run set.
 *   - Batches deletes in chunks of 400.
 *   - Emits ONE summary audit_log entry per --apply run (not per doc).
 *
 * Usage:
 *   GCP_SA_KEY_DEV='<sa json>' node scripts/tally-d3-e-cadence-residue-cleanup.js
 *   GCP_SA_KEY_DEV='<sa json>' node scripts/tally-d3-e-cadence-residue-cleanup.js --apply --max-delete 900
 */

const admin = require("firebase-admin");
const fs = require("fs");
const crypto = require("crypto");

const PROJECT_ID = "ropi-aoss-dev";
const TALLY_ID = "TALLY-D3-E-CADENCE-RESIDUE";
const ACTOR = "system:tally-d3-e-cadence-residue";
const EVIDENCE_DIR = "evidence/tally-d3-e-cadence-residue";
const DEFAULT_MAX_DELETE = 900;
const BATCH_SIZE = 400;

// ---------------------------------------------------------------- arg parsing
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
let MAX_DELETE = DEFAULT_MAX_DELETE;
const maxIdx = args.indexOf("--max-delete");
if (maxIdx >= 0 && args[maxIdx + 1]) {
  const v = parseInt(args[maxIdx + 1], 10);
  if (!Number.isFinite(v) || v <= 0) {
    console.error(`❌ Invalid --max-delete value: ${args[maxIdx + 1]}`);
    process.exit(1);
  }
  MAX_DELETE = v;
}
const MODE = APPLY ? "apply" : "dry-run";

// ---------------------------------------------------------------- auth
let saJson = process.env.GCP_SA_KEY_DEV || process.env.SERVICE_ACCOUNT_JSON;
if (!saJson && fs.existsSync("/tmp/sa-dev.json")) {
  saJson = fs.readFileSync("/tmp/sa-dev.json", "utf8");
}
if (!saJson) {
  console.error("❌ GCP_SA_KEY_DEV not set");
  process.exit(1);
}
const sa = JSON.parse(saJson);
if (sa.project_id !== PROJECT_ID) {
  console.error(`❌ Project guard failed: SA project_id=${sa.project_id}, expected ${PROJECT_ID}`);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(sa),
  projectId: PROJECT_ID,
});
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// ---------------------------------------------------------------- helpers
function tsToIso(v) {
  if (!v) return null;
  if (typeof v.toMillis === "function") return new Date(v.toMillis()).toISOString();
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  return null;
}

function sha256(strs) {
  const h = crypto.createHash("sha256");
  for (const s of strs) h.update(s + "\n");
  return h.digest("hex");
}

async function classify() {
  const productsSnap = await db.collection("products").get();
  const cadenceSnap = await db.collection("cadence_assignments").get();
  const productIds = new Set(productsSnap.docs.map((d) => d.id));

  const orphans = []; // {doc_id, mpn, cadence_state, primary_user_id, ...}
  const retained = [];
  let staleAssignedNullPrimary = 0;
  let activePrimaryOnOrphan = 0;

  for (const d of cadenceSnap.docs) {
    const data = d.data();
    const isAssignedNullPrimary =
      data.cadence_state === "assigned" &&
      (data.primary_user_id == null || data.primary_user_id === "");
    if (isAssignedNullPrimary) staleAssignedNullPrimary++;

    if (productIds.has(d.id)) {
      retained.push({ doc_id: d.id, mpn: data.mpn || null, cadence_state: data.cadence_state || null });
    } else {
      // NOTE: raw primary_user_id / assigned_user_id intentionally redacted from
      // committed evidence — emit booleans only. See TALLY-D3-E user-id redaction.
      const hasPrimary = !!(data.primary_user_id);
      const hasAssigned = !!(data.assigned_user_id);
      const row = {
        doc_id: d.id,
        mpn: data.mpn || null,
        product_id: data.product_id || null,
        cadence_state: data.cadence_state || null,
        primary_user_present: hasPrimary,
        assigned_user_present: hasAssigned,
        unassigned_reason: data.unassigned_reason || null,
        in_cadence_review_queue: data.in_cadence_review_queue === true,
        manual_assignment: data.manual_assignment === true,
        created_at: tsToIso(data.created_at),
        updated_at: tsToIso(data.updated_at) || tsToIso(data.last_evaluated_at),
      };
      if (hasPrimary || hasAssigned) activePrimaryOnOrphan++;
      orphans.push(row);
    }
  }
  return {
    productCount: productsSnap.size,
    cadenceCount: cadenceSnap.size,
    orphans,
    retained,
    staleAssignedNullPrimary,
    activePrimaryOnOrphan,
  };
}

function writeEvidence(name, payload) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const path = `${EVIDENCE_DIR}/${name}`;
  fs.writeFileSync(path, JSON.stringify(payload, null, 2));
  return path;
}

// ---------------------------------------------------------------- main
async function main() {
  const startedAt = new Date().toISOString();
  const tsForFile = startedAt.replace(/[:.]/g, "-");
  console.log("=".repeat(72));
  console.log(`${TALLY_ID} — orphan cadence_assignments cleanup`);
  console.log("=".repeat(72));
  console.log(`Started:     ${startedAt}`);
  console.log(`Project:     ${PROJECT_ID}`);
  console.log(`Mode:        ${MODE.toUpperCase()}`);
  console.log(`Safety cap:  ${MAX_DELETE} deletes`);
  console.log("");

  // PHASE 1 — initial classification
  console.log("─ PHASE 1: classify cadence_assignments vs products ─");
  const phase1 = await classify();
  console.log(`  products:                       ${phase1.productCount}`);
  console.log(`  cadence_assignments:            ${phase1.cadenceCount}`);
  console.log(`  retained (doc_id in products):  ${phase1.retained.length}`);
  console.log(`  ORPHANS (doc_id NOT in products): ${phase1.orphans.length}`);
  console.log(`  stale assigned + null primary:  ${phase1.staleAssignedNullPrimary}`);
  console.log(`  orphans w/ active primary/assigned: ${phase1.activePrimaryOnOrphan}`);

  // Sanity invariants
  if (phase1.productCount === 0) {
    console.error("❌ STOP: products collection is empty. Catalog wipe in progress.");
    process.exit(2);
  }
  if (phase1.retained.length !== phase1.productCount) {
    // Not strictly fatal — products without a cadence doc are possible — but Frink
    // baseline expects retained == productCount. Warn but continue (no writes yet).
    console.warn(
      `⚠ retained (${phase1.retained.length}) != productCount (${phase1.productCount}). ` +
      `Some products have no cadence_assignment doc — informational, not a blocker for orphan delete.`
    );
  }
  if (phase1.orphans.length > MAX_DELETE) {
    console.error(
      `❌ STOP: orphan_count=${phase1.orphans.length} exceeds safety cap ${MAX_DELETE}. ` +
      `Re-run with --max-delete ${phase1.orphans.length} if intentional.`
    );
    // still write dry-run evidence before exiting
    const cappedEvidencePath = writeEvidence(`dry-run-CAPPED-${tsForFile}.json`, {
      tally: TALLY_ID,
      mode: MODE,
      timestamp: startedAt,
      project: PROJECT_ID,
      product_count: phase1.productCount,
      cadence_assignment_count: phase1.cadenceCount,
      orphan_count: phase1.orphans.length,
      retained_count: phase1.retained.length,
      delete_count: 0,
      safety_cap: MAX_DELETE,
      stop_reason: "orphan_count_exceeds_safety_cap",
      stale_assigned_null_primary_count: phase1.staleAssignedNullPrimary,
      active_primary_on_orphan_count: phase1.activePrimaryOnOrphan,
      sample_orphans: phase1.orphans.slice(0, 25),
      sample_retained: phase1.retained.slice(0, 25),
    });
    console.log(`Wrote: ${cappedEvidencePath}`);
    process.exit(3);
  }

  const orphanIdsSorted = phase1.orphans.map((o) => o.doc_id).sort();
  const orphanHash = sha256(orphanIdsSorted);
  console.log(`  orphan-set sha256: ${orphanHash}`);

  // ──────────────────────────────────────────────────────── DRY RUN
  if (!APPLY) {
    const path = writeEvidence(`dry-run-${tsForFile}.json`, {
      tally: TALLY_ID,
      mode: "dry-run",
      timestamp: startedAt,
      project: PROJECT_ID,
      product_count: phase1.productCount,
      cadence_assignment_count: phase1.cadenceCount,
      orphan_count: phase1.orphans.length,
      retained_count: phase1.retained.length,
      delete_count: phase1.orphans.length, // would be deleted on apply
      safety_cap: MAX_DELETE,
      stale_assigned_null_primary_count: phase1.staleAssignedNullPrimary,
      active_primary_on_orphan_count: phase1.activePrimaryOnOrphan,
      orphan_set_sha256: orphanHash,
      sample_orphans: phase1.orphans.slice(0, 25),
      sample_retained: phase1.retained.slice(0, 25),
      doc_ids_to_delete: orphanIdsSorted,
    });
    console.log("");
    console.log(`=== DRY-RUN COMPLETE — zero writes performed ===`);
    console.log(`Evidence: ${path}`);
    process.exit(0);
  }

  // ──────────────────────────────────────────────────────── APPLY
  console.log("");
  console.log("─ PHASE 2: apply — re-reading collections immediately before delete ─");
  const phase2 = await classify();
  const orphanIdsSorted2 = phase2.orphans.map((o) => o.doc_id).sort();
  const orphanHash2 = sha256(orphanIdsSorted2);
  console.log(`  products (re-read):            ${phase2.productCount}`);
  console.log(`  cadence_assignments (re-read): ${phase2.cadenceCount}`);
  console.log(`  orphans (re-read):             ${phase2.orphans.length}`);
  console.log(`  orphan-set sha256 (re-read):   ${orphanHash2}`);

  if (orphanHash2 !== orphanHash) {
    console.error(
      `❌ STOP: orphan set drifted between dry-run and apply re-read. ` +
      `Refusing to proceed; concurrent writes likely.`
    );
    process.exit(4);
  }
  if (phase2.orphans.length > MAX_DELETE) {
    console.error(`❌ STOP: re-read orphan_count=${phase2.orphans.length} > safety cap ${MAX_DELETE}`);
    process.exit(5);
  }
  if (phase2.productCount === 0) {
    console.error("❌ STOP: products collection now empty.");
    process.exit(6);
  }

  console.log("");
  console.log("─ FINAL CONFIRMATION SUMMARY ─");
  console.log(`  About to delete ${phase2.orphans.length} cadence_assignments docs`);
  console.log(`  Cap: ${MAX_DELETE}`);
  console.log(`  Project: ${PROJECT_ID}`);
  console.log(`  Audit: 1 summary entry will be written to audit_log`);
  console.log("");

  // Batched delete
  const deleted = [];
  const ids = orphanIdsSorted2;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const id of chunk) {
      batch.delete(db.collection("cadence_assignments").doc(id));
    }
    await batch.commit();
    deleted.push(...chunk);
    console.log(`  chunk ${Math.floor(i / BATCH_SIZE) + 1}: deleted ${chunk.length} (total ${deleted.length}/${ids.length})`);
  }

  // Re-read after-state
  console.log("");
  console.log("─ PHASE 3: re-read after-state ─");
  const phase3 = await classify();
  console.log(`  products:            ${phase3.productCount}`);
  console.log(`  cadence_assignments: ${phase3.cadenceCount}`);
  console.log(`  remaining orphans:   ${phase3.orphans.length}`);
  const cleanupComplete = phase3.orphans.length === 0;
  if (!cleanupComplete) {
    console.error(`❌ Incomplete cleanup: ${phase3.orphans.length} orphan(s) remain after apply.`);
  }

  // Audit log — single summary entry
  const auditRef = db.collection("audit_log").doc();
  await auditRef.set({
    actor_user_id: ACTOR,
    event_type: "cadence_residue_cleanup",
    tally: TALLY_ID,
    mode: "apply",
    product_count_before: phase2.productCount,
    cadence_assignment_count_before: phase2.cadenceCount,
    orphan_count_before: phase2.orphans.length,
    deleted_count: deleted.length,
    cadence_assignment_count_after: phase3.cadenceCount,
    orphan_count_after: phase3.orphans.length,
    sample_deleted_doc_ids: deleted.slice(0, 25),
    orphan_set_sha256: orphanHash2,
    safety_cap: MAX_DELETE,
    project_id: PROJECT_ID,
    created_at: FieldValue.serverTimestamp(),
  });
  console.log(`  audit_log entry id: ${auditRef.id}`);

  const completedAt = new Date().toISOString();
  const path = writeEvidence(`apply-${tsForFile}.json`, {
    tally: TALLY_ID,
    mode: "apply",
    timestamp: startedAt,
    completed_at: completedAt,
    project: PROJECT_ID,
    safety_cap: MAX_DELETE,
    before: {
      product_count: phase2.productCount,
      cadence_assignment_count: phase2.cadenceCount,
      orphan_count: phase2.orphans.length,
      retained_count: phase2.retained.length,
      stale_assigned_null_primary_count: phase2.staleAssignedNullPrimary,
      active_primary_on_orphan_count: phase2.activePrimaryOnOrphan,
      orphan_set_sha256: orphanHash2,
    },
    after: {
      product_count: phase3.productCount,
      cadence_assignment_count: phase3.cadenceCount,
      orphan_count: phase3.orphans.length,
      retained_count: phase3.retained.length,
    },
    deleted_count: deleted.length,
    cleanup_complete: cleanupComplete,
    audit_log_entry_id: auditRef.id,
    sample_deleted_doc_ids: deleted.slice(0, 25),
    doc_ids_deleted: deleted,
  });
  console.log("");
  console.log(`=== APPLY COMPLETE ===`);
  console.log(`Deleted: ${deleted.length}`);
  console.log(`Evidence: ${path}`);
  console.log(`Audit log: audit_log/${auditRef.id}`);
  process.exit(cleanupComplete ? 0 : 7);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(99);
});
