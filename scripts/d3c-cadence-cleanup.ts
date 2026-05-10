/**
 * TALLY-D3-C — cadence_rules cleanup per PO ruling 2026-05-10.
 *   A) Hard-delete rules with owner_buyer_id == "step22-verify-bot"
 *   B) Restore department_key=footwear filter on "Heather — Women's Footwear"
 * Dry-run default; --commit to apply.
 * Required env: GCP_SA_KEY_DEV (raw SA JSON).
 */

import admin from "firebase-admin";

const sa = JSON.parse(process.env.GCP_SA_KEY_DEV || "{}");
if (!sa.project_id) {
  console.error("ERROR: GCP_SA_KEY_DEV not set");
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const COMMIT = process.argv.includes("--commit");
const LEAK_OWNER_ID = "step22-verify-bot";
const HEATHER_RULE_NAME = "Heather — Women's Footwear";

async function findStep22Leaks() {
  const snap = await db
    .collection("cadence_rules")
    .where("owner_buyer_id", "==", LEAK_OWNER_ID)
    .get();
  return snap.docs;
}

async function findHeatherRule() {
  const snap = await db
    .collection("cadence_rules")
    .where("rule_name", "==", HEATHER_RULE_NAME)
    .get();
  return snap.docs;
}

async function main() {
  console.log(`MODE: ${COMMIT ? "COMMIT" : "DRY-RUN"}`);
  console.log(`Project: ${sa.project_id}`);
  console.log("");

  // === Operation A: Step22 leak ===
  console.log("=== Operation A: Step22 leak hard-delete ===");
  const leaks = await findStep22Leaks();
  console.log(`Found ${leaks.length} matching rule(s) with owner_buyer_id="${LEAK_OWNER_ID}":`);
  for (const doc of leaks) {
    const d = doc.data();
    console.log(`  - ${doc.id}: "${d.rule_name}" (is_active=${d.is_active}, priority=${d.priority})`);
  }
  if (leaks.length !== 1) {
    console.error(`HALT: expected exactly 1 Step22 leak, found ${leaks.length}. Lisa scope review required.`);
    process.exit(2);
  }

  // === Operation B: Heather rule ===
  console.log("\n=== Operation B: Heather rule filter restore ===");
  const heatherDocs = await findHeatherRule();
  console.log(`Found ${heatherDocs.length} rule(s) named "${HEATHER_RULE_NAME}":`);
  if (heatherDocs.length !== 1) {
    console.error(`HALT: expected exactly 1 Heather rule, found ${heatherDocs.length}. Lisa scope review required.`);
    process.exit(3);
  }
  const heatherDoc = heatherDocs[0];
  const heatherBefore = heatherDoc.data();
  const currentFilters: any[] = Array.isArray(heatherBefore.target_filters) ? heatherBefore.target_filters : [];
  if (currentFilters.length === 0) {
    console.error(`HALT: Heather rule has empty target_filters; cannot infer filter shape. Lisa decision needed.`);
    process.exit(4);
  }
  const shape = currentFilters[0];
  const newFilter = { ...shape, field: "department_key", value: "footwear" };
  const newFilters = [...currentFilters, newFilter];
  const currentVersion = typeof heatherBefore.version === "number" ? heatherBefore.version : 1;
  const newVersion = currentVersion + 1;
  console.log(`  - ${heatherDoc.id}: "${heatherBefore.rule_name}" version ${currentVersion} → ${newVersion}`);
  console.log(`    BEFORE target_filters:`, JSON.stringify(currentFilters));
  console.log(`    AFTER  target_filters:`, JSON.stringify(newFilters));
  console.log(`    Inferred operator shape from existing filter: ${JSON.stringify(shape)}`);

  if (!COMMIT) {
    console.log("\n=== DRY-RUN ONLY — no writes performed. Re-run with --commit to apply. ===");
    process.exit(0);
  }

  console.log("\n=== COMMITTING ===");

  // Operation A commit
  for (const doc of leaks) {
    const before = doc.data();
    await db.collection("audit_log").add({
      event_type: "cadence_rule_deleted",
      acting_user_id: "system:tally-d3-c",
      rule_id: doc.id,
      rule_name: before.rule_name,
      owner_buyer_id: before.owner_buyer_id,
      before,
      tally: "TALLY-D3-C",
      reason: "TALLY-D3-C — Step22 leak hard-delete per PO ruling 2026-05-10",
      created_at: FieldValue.serverTimestamp(),
    });
    await doc.ref.delete();
    console.log(`  ✓ [A] deleted ${doc.id}: "${before.rule_name}"`);
  }

  // Operation B commit
  await db.collection("audit_log").add({
    event_type: "cadence_rule_filter_restored",
    acting_user_id: "system:tally-d3-c",
    rule_id: heatherDoc.id,
    rule_name: heatherBefore.rule_name,
    before: { target_filters: currentFilters, version: currentVersion },
    after: { target_filters: newFilters, version: newVersion },
    tally: "TALLY-D3-C",
    reason: "TALLY-D3-C — restore department_key=footwear filter on Heather rule per PO ruling 2026-05-10 (v5 widening was unintentional)",
    created_at: FieldValue.serverTimestamp(),
  });
  await heatherDoc.ref.set(
    {
      target_filters: newFilters,
      version: newVersion,
      updated_at: FieldValue.serverTimestamp(),
      updated_by: "system:tally-d3-c",
    },
    { merge: true }
  );
  console.log(`  ✓ [B] restored ${heatherDoc.id}: target_filters length ${currentFilters.length} → ${newFilters.length}, version ${currentVersion} → ${newVersion}`);

  console.log("\n=== COMPLETE ===");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
