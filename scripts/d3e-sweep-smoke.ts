/**
 * TALLY-D3-E — targeted cadence smoke on 5 tier-test MPNs.
 * Auth: cert(JSON.parse(process.env.GCP_SA_KEY_DEV))
 * Engine: compiled backend/functions/lib/services/cadenceEngine.js
 * Run: GCP_SA_KEY_DEV='<JSON>' npx tsx scripts/d3e-sweep-smoke.ts
 */

import path from "path";
// Use firebase-admin from backend/functions/node_modules — same instance as cadenceEngine
// eslint-disable-next-line @typescript-eslint/no-var-requires
const admin = require(path.join(__dirname, "..", "backend", "functions", "node_modules", "firebase-admin"));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runCadenceEvaluation } = require(path.join(__dirname, "..", "backend", "functions", "lib", "services", "cadenceEngine.js"));

const sa = JSON.parse(process.env.GCP_SA_KEY_DEV || "{}");
if (!sa.project_id) {
  console.error("ERROR: GCP_SA_KEY_DEV not set or missing project_id");
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: "ropi-aoss-dev" });
const db = admin.firestore();

const TEST_MPNS = [
  { tier: "T1",  mpn: "CK9246 101",         expected_uid: "JIevp8ZsEySXxL7NJelrS9LevZJ3", expected_name: "Shiekh" },
  { tier: "T2",  mpn: "70867207",            expected_uid: "njIY4yyVSIUhchVe78g7BVN0Bx72", expected_name: "Mike" },
  { tier: "T3a", mpn: "414571 102",          expected_uid: "uhD2yj4LK5XDgU2IUjmpYtbGmYd2", expected_name: "Alex" },
  { tier: "T3b", mpn: "CQ6639 001",          expected_uid: "luIV6eMbZZRWYv7mJqg3F7UJ8Hl1", expected_name: "Heather" },
  { tier: "T4",  mpn: "D3D-T4-FIXTURE-001",  expected_uid: "H745g994Q5cT28uX1upzPReHjGh1", expected_name: "Alana" },
];

function sep(label: string) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(label);
  console.log("=".repeat(70));
}

async function readAssignment(mpn: string) {
  const doc = await db.collection("cadence_assignments").doc(mpn).get();
  if (!doc.exists) return null;
  const d = doc.data() || {};
  return {
    primary_user_id: d.primary_user_id ?? null,
    cadence_state: d.cadence_state ?? null,
    selection_score: d.selection_score ?? null,
    selection_reason: d.selection_reason ?? null,
  };
}

async function main() {
  console.log("TALLY-D3-E targeted cadence smoke");
  console.log(`Project: ${sa.project_id}`);
  console.log(`Test MPNs: ${TEST_MPNS.map(t => t.mpn).join(", ")}`);

  // 1. Pre-sweep snapshot
  sep("PRE-SWEEP SNAPSHOT");
  const preSnap: Record<string, ReturnType<typeof readAssignment> extends Promise<infer T> ? T : never> = {} as any;
  for (const { tier, mpn } of TEST_MPNS) {
    const row = await readAssignment(mpn);
    preSnap[mpn] = row as any;
    console.log(`  [${tier}] ${mpn}: ${row ? JSON.stringify(row) : "<no prior assignment>"}`);
  }

  // 2. Engine invocation
  sep("ENGINE INVOCATION");
  const mpnList = TEST_MPNS.map(t => t.mpn);
  console.log(`  runCadenceEvaluation(${JSON.stringify(mpnList)})`);
  let engineResult: any;
  try {
    engineResult = await runCadenceEvaluation(mpnList);
  } catch (e: any) {
    console.error("ENGINE THREW:", e?.message ?? e);
    console.error(e?.stack ?? "");
    process.exit(1);
  }
  console.log(`  result: ${JSON.stringify(engineResult)}`);
  if ((engineResult?.skipped_mid_cadence ?? 0) > 0) {
    console.log(`  NOTE: skipped_mid_cadence=${engineResult.skipped_mid_cadence} (non-halting; see assignment docs for reason)`);
  }

  // 3. Post-sweep verification
  sep("POST-SWEEP VERIFICATION");
  const results: { tier: string; mpn: string; expected_name: string; expected_uid: string; actual_uid: string | null; pass: boolean }[] = [];
  for (const { tier, mpn, expected_uid, expected_name } of TEST_MPNS) {
    const row = await readAssignment(mpn);
    const actual_uid = row?.primary_user_id ?? null;
    const pass = actual_uid === expected_uid;
    results.push({ tier, mpn, expected_name, expected_uid, actual_uid, pass });
    const status = pass ? "PASS" : "FAIL";
    console.log(`  [${tier}] ${mpn}: ${status}`);
    console.log(`    expected: ${expected_uid} (${expected_name})`);
    console.log(`    actual:   ${actual_uid ?? "<null>"}`);
    if (!pass) {
      console.log(`    cadence_state: ${row?.cadence_state ?? "<null>"}`);
      console.log(`    selection_reason: ${row?.selection_reason ?? "<null>"}`);
    }
  }

  // 4. Summary
  sep("SUMMARY");
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass);
  console.log(`  ${passed}/5 PASS`);
  if (failed.length > 0) {
    console.log("  FAILURES:");
    for (const f of failed) {
      console.log(`    [${f.tier}] ${f.mpn}: actual=${f.actual_uid ?? "<null>"} expected=${f.expected_uid} (${f.expected_name})`);
    }
  }
  console.log(`  Engine result: ${JSON.stringify(engineResult)}`);

  if (failed.length > 0) {
    console.error(`\nHALT: ${failed.length} MPN(s) failed tier resolution. Awaiting Lisa diagnosis.`);
    process.exit(1);
  }
  console.log("\n=== SMOKE COMPLETE — 5/5 PASS. Awaiting PO greenlight before PR merge. ===");
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e?.message ?? e);
  console.error(e?.stack ?? "");
  process.exit(1);
});
