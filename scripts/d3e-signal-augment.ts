/**
 * TALLY-D3-E-PATCH-1 — signal augment on 5 test MPNs + create T3a Mens Footwear rule.
 * Phase 1: read rule template and validate shape.
 * Phase 2: dry-run (default) — print planned mutations, exit 0.
 * Phase 3: commit (--commit flag) — audit-log-first, then writes.
 * Auth: cert(JSON.parse(process.env.GCP_SA_KEY_DEV))
 * Engine: backend/functions/node_modules/firebase-admin (same instance as cadenceEngine)
 */

import path from "path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const admin = require(path.join(__dirname, "..", "backend", "functions", "node_modules", "firebase-admin"));

const sa = JSON.parse(process.env.GCP_SA_KEY_DEV || "{}");
if (!sa.project_id) {
  console.error("ERROR: GCP_SA_KEY_DEV not set or missing project_id");
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: "ropi-aoss-dev" });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const COMMIT = process.argv.includes("--commit");

const HEATHER_FOOTWEAR_RULE_ID = "4e624c84-5997-4adf-9cbb-cdc72790c31e";

const TEST_MPNS = [
  "CK9246 101",
  "70867207",
  "414571 102",
  "CQ6639 001",
  "D3D-T4-FIXTURE-001",
];

const SIXTY_DAYS_AGO = admin.firestore.Timestamp.fromDate(
  new Date(Date.now() - 60 * 86400 * 1000)
);

const NEW_ALEX_RULE = {
  rule_name: "Alex — Men's Footwear 45-Day Zero Sales",
  target_filters: [
    { field: "gender",         operator: "equals", value: "Mens",     case_sensitive: true,  logic: "AND" },
    { field: "department_key", operator: "equals", value: "footwear", case_sensitive: true,  logic: "AND" },
  ],
  trigger_conditions: [
    { field: "str_pct",          operator: "less_than",    value: 1,  logic: "AND" },
    { field: "product_age_days", operator: "greater_than", value: 45, logic: "AND" },
  ],
  is_active: true,
  assigned_user_id: null,
  version: 1,
  fixture_tally: "TALLY-D3-E-PATCH-1",
  markdown_steps: [
    { step_number: 1, day_threshold: 20, action_type: "markdown_pct",      markdown_scope: "store_only", value: 20, apply_99_rounding: true },
    { step_number: 2, day_threshold: 20, action_type: "set_in_cart_promo", markdown_scope: "web_only",   value: 20, apply_99_rounding: true },
  ],
};

function sep(label: string) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(label);
  console.log("=".repeat(70));
}

async function main() {
  console.log(`MODE: ${COMMIT ? "COMMIT" : "DRY-RUN"}`);
  console.log(`Project: ${sa.project_id}`);

  // ── Phase 1: Validate rule template shape ──
  sep("PHASE 1 — Rule template validation");
  const templateSnap = await db.collection("cadence_rules").doc(HEATHER_FOOTWEAR_RULE_ID).get();
  if (!templateSnap.exists) {
    console.error(`HALT: template rule ${HEATHER_FOOTWEAR_RULE_ID} not found in cadence_rules`);
    process.exit(1);
  }
  const template = templateSnap.data() || {};
  console.log("Template rule doc (verbatim):");
  console.log(JSON.stringify(template, null, 2));

  // Validate expected shape: 2 trigger_conditions [str_pct<1, product_age_days>15]
  const tc = template.trigger_conditions || [];
  const hasStrPct = tc.some((c: any) => c.field === "str_pct" && c.operator === "less_than" && Number(c.value) === 1);
  const hasAgeDays = tc.some((c: any) => c.field === "product_age_days" && c.operator === "greater_than");
  if (!hasStrPct || !hasAgeDays) {
    console.error(`HALT: template rule shape unexpected. Expected trigger_conditions with str_pct<1 AND product_age_days>N.`);
    console.error(`Actual trigger_conditions: ${JSON.stringify(tc)}`);
    process.exit(1);
  }
  console.log(`\n  ✓ Template shape validated: str_pct<1 + product_age_days>${tc.find((c: any) => c.field === "product_age_days")?.value} triggers confirmed`);

  // ── Phase 2: Dry-run plan ──
  sep("PHASE 2 — Planned mutations (DRY-RUN)");

  console.log("\n  5 product signal augments:");
  for (const mpn of TEST_MPNS) {
    const snap = await db.collection("products").doc(mpn).get();
    if (!snap.exists) {
      console.log(`  [WARN] ${mpn}: doc not found — would SKIP`);
      continue;
    }
    const d = snap.data() || {};
    console.log(`  ${mpn}:`);
    console.log(`    BEFORE: str_pct=${d.str_pct ?? "null"}, first_received_at=${d.first_received_at?._seconds ? new Date(d.first_received_at._seconds * 1000).toISOString() : "null"}`);
    console.log(`    AFTER:  str_pct=0, first_received_at=60d ago (${SIXTY_DAYS_AGO.toDate().toISOString()})`);
  }

  console.log("\n  New Alex rule to create:");
  console.log(`    ${JSON.stringify(NEW_ALEX_RULE, null, 4)}`);
  console.log(`    system fields: owner_buyer_id=uhD2yj4LK5XDgU2IUjmpYtbGmYd2, created_at=serverTimestamp, updated_at=serverTimestamp, priority=10`);

  if (!COMMIT) {
    console.log("\n=== DRY-RUN ONLY — no writes performed. Re-run with --commit to apply. ===");
    process.exit(0);
  }

  // ── Phase 3: Commit ──
  sep("PHASE 3 — COMMITTING (audit-log-first)");

  // Step 3a: Write audit entries FIRST before any mutations
  console.log("\n  Writing 6 audit log entries (audit-log-first)...");
  for (const mpn of TEST_MPNS) {
    await db.collection("audit_log").add({
      event_type: "signal_fixture_applied",
      acting_user_id: "system:tally-d3-e-patch-1",
      product_mpn: mpn,
      fields_set: { str_pct: 0, first_received_at: "60d_ago" },
      tally: "TALLY-D3-E-PATCH-1",
      reason: "Smoke (b) signal augment — str_pct=0 + first_received_at=60d to satisfy trigger conditions for D3-E tier verification",
      created_at: FieldValue.serverTimestamp(),
    });
    console.log(`    ✓ audit: signal_fixture_applied for ${mpn}`);
  }
  await db.collection("audit_log").add({
    event_type: "cadence_rule_created",
    acting_user_id: "system:tally-d3-e-patch-1",
    rule_name: NEW_ALEX_RULE.rule_name,
    target_filters: NEW_ALEX_RULE.target_filters,
    trigger_conditions: NEW_ALEX_RULE.trigger_conditions,
    tally: "TALLY-D3-E-PATCH-1",
    reason: "T3a smoke fixture — Mens Footwear rule missing from cadence_rules; Alex (uhD2yj4LK5XDgU2IUjmpYtbGmYd2) covers this portfolio",
    created_at: FieldValue.serverTimestamp(),
  });
  console.log(`    ✓ audit: cadence_rule_created for ${NEW_ALEX_RULE.rule_name}`);

  // Step 3b: Update 5 product docs
  console.log("\n  Applying product signal augments...");
  for (const mpn of TEST_MPNS) {
    const ref = db.collection("products").doc(mpn);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`  [WARN] ${mpn}: doc not found — SKIPPED`);
      continue;
    }
    await ref.update({
      str_pct: 0,
      first_received_at: SIXTY_DAYS_AGO,
      updated_at: FieldValue.serverTimestamp(),
    });
    console.log(`    ✓ ${mpn}: str_pct=0, first_received_at=60d ago`);
  }

  // Step 3c: Create new Alex rule
  console.log("\n  Creating new cadence rule...");
  const newRuleRef = await db.collection("cadence_rules").add({
    ...NEW_ALEX_RULE,
    owner_buyer_id: "uhD2yj4LK5XDgU2IUjmpYtbGmYd2",
    priority: 10,
    created_by: "system:tally-d3-e-patch-1",
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
  console.log(`    ✓ New rule created: id=${newRuleRef.id}`);

  console.log("\n=== COMPLETE — 5 signals augmented, 1 rule created ===");
  console.log(`  New rule id: ${newRuleRef.id}`);
  console.log(`  fixture_tally: TALLY-D3-E-PATCH-1`);
  console.log(`  MPNs augmented: ${TEST_MPNS.join(", ")}`);
}

main().catch((e) => {
  console.error("FATAL:", e?.message ?? e);
  console.error(e?.stack ?? "");
  process.exit(1);
});
