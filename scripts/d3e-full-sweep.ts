/**
 * TALLY-D3-E Stop 3 — full cadence sweep over all products on ropi-aoss-dev.
 * Auth: cert(JSON.parse(process.env.GCP_SA_KEY_DEV))
 * Engine: compiled backend/functions/lib/services/cadenceEngine.js
 * Run: GCP_SA_KEY_DEV='<JSON>' npx tsx scripts/d3e-full-sweep.ts
 *
 * NO dry-run flag — the sweep IS the mutation. Phase 2 pre-snapshot is the rollback reference.
 */

import path from "path";
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
  { tier: "T1",  mpn: "CK9246 101",         expected_uid: "JIevp8ZsEySXxL7NJelrS9LevZJ3", expected_name: "Shiekh"  },
  { tier: "T2",  mpn: "70867207",            expected_uid: "njIY4yyVSIUhchVe78g7BVN0Bx72", expected_name: "Mike"    },
  { tier: "T3a", mpn: "414571 102",          expected_uid: "uhD2yj4LK5XDgU2IUjmpYtbGmYd2", expected_name: "Alex"    },
  { tier: "T3b", mpn: "CQ6639 001",          expected_uid: "luIV6eMbZZRWYv7mJqg3F7UJ8Hl1", expected_name: "Heather" },
  { tier: "T4",  mpn: "D3D-T4-FIXTURE-001",  expected_uid: "H745g994Q5cT28uX1upzPReHjGh1", expected_name: "Alana"   },
];

const TEST_MPN_SET = new Set(TEST_MPNS.map(t => t.mpn));
const UID_TO_NAME: Record<string, string> = Object.fromEntries(
  TEST_MPNS.map(t => [t.expected_uid, t.expected_name])
);

function sep(label: string) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(label);
  console.log("=".repeat(70));
}

type Snapshot = {
  total: number;
  byState: Record<string, number>;
  byUser: Record<string, number>;
};

async function snapshotAssignments(): Promise<Snapshot> {
  const snap = await db.collection("cadence_assignments").get();
  const byState: Record<string, number> = {};
  const byUser: Record<string, number> = {};
  snap.forEach((doc: any) => {
    const d = doc.data() || {};
    const state = d.cadence_state ?? "<null>";
    const uid = d.primary_user_id ?? "(null)";
    byState[state] = (byState[state] ?? 0) + 1;
    byUser[uid] = (byUser[uid] ?? 0) + 1;
  });
  return { total: snap.size, byState, byUser };
}

function printSnapshot(label: string, s: Snapshot) {
  console.log(`  ${label}`);
  console.log(`  Total cadence_assignments docs: ${s.total}`);
  console.log(`  By cadence_state:`);
  for (const [k, v] of Object.entries(s.byState).sort()) {
    console.log(`    ${k.padEnd(20)} ${v}`);
  }
  console.log(`  By primary_user_id:`);
  for (const [uid, v] of Object.entries(s.byUser).sort((a, b) => b[1] - a[1])) {
    const name = UID_TO_NAME[uid] ? ` (${UID_TO_NAME[uid]})` : "";
    console.log(`    ${uid}${name}: ${v}`);
  }
}

function diffSnapshots(pre: Snapshot, post: Snapshot) {
  console.log(`  Total docs: ${pre.total} → ${post.total} (Δ ${post.total - pre.total >= 0 ? "+" : ""}${post.total - pre.total})`);
  const allStates = new Set([...Object.keys(pre.byState), ...Object.keys(post.byState)]);
  console.log(`  By cadence_state diff:`);
  for (const s of [...allStates].sort()) {
    const a = pre.byState[s] ?? 0;
    const b = post.byState[s] ?? 0;
    const d = b - a;
    console.log(`    ${s.padEnd(20)} ${a} → ${b} (Δ ${d >= 0 ? "+" : ""}${d})`);
  }
  const allUsers = new Set([...Object.keys(pre.byUser), ...Object.keys(post.byUser)]);
  console.log(`  By primary_user_id diff:`);
  for (const u of [...allUsers].sort()) {
    const a = pre.byUser[u] ?? 0;
    const b = post.byUser[u] ?? 0;
    const d = b - a;
    if (d === 0 && a === 0) continue;
    const name = UID_TO_NAME[u] ? ` (${UID_TO_NAME[u]})` : "";
    console.log(`    ${u}${name}: ${a} → ${b} (Δ ${d >= 0 ? "+" : ""}${d})`);
  }
}

async function main() {
  console.log("MODE: COMMIT (full sweep writes cadence_assignments across all products)");
  console.log(`Project: ${sa.project_id}`);

  // ── Phase 1: Preflight ──
  sep("Phase 1: Preflight");
  const enginePath = path.join(__dirname, "..", "backend", "functions", "lib", "services", "cadenceEngine.js");
  console.log(`  Engine module: ${enginePath}`);
  console.log(`  Engine build: OK (require resolved)`);
  console.log(`  firebase-admin init: OK`);

  // ── Phase 2: Pre-sweep distribution snapshot ──
  sep("Phase 2: Pre-sweep snapshot");
  const pre = await snapshotAssignments();
  printSnapshot("(pre)", pre);

  // ── Phase 3: Enumerate all product MPNs ──
  sep("Phase 3: Product enumeration");
  const productsSnap = await db.collection("products").get();
  const allMpns: string[] = [];
  productsSnap.forEach((doc: any) => allMpns.push(doc.id));
  console.log(`  Total products: ${allMpns.length}`);
  if (allMpns.length !== 115) {
    console.log(`  WARNING: expected 115 products; got ${allMpns.length} (proceeding)`);
  }

  // ── Phase 4: Engine invocation on full corpus ──
  sep("Phase 4: Engine invocation");
  console.log(`  Calling runCadenceEvaluation(<${allMpns.length} MPNs>)...`);
  const t0 = Date.now();
  let engineResult: any;
  try {
    engineResult = await runCadenceEvaluation(allMpns);
  } catch (e: any) {
    console.error("ENGINE THREW:", e?.message ?? e);
    console.error(e?.stack ?? "");
    process.exit(1);
  }
  const durationMs = Date.now() - t0;
  console.log(`  Duration: ${(durationMs / 1000).toFixed(2)}s (${durationMs}ms)`);
  console.log(`  Result: ${JSON.stringify(engineResult)}`);
  if (durationMs > 60_000) {
    console.log(`  NOTE: wall-clock > 60s — surfacing but not halting per spec.`);
  }
  if ((engineResult?.conflicts ?? 0) > 0) {
    console.error(`HALT: conflicts=${engineResult.conflicts} — should be 0 post-D2A pickPrimary hierarchy.`);
    process.exit(1);
  }

  // ── Phase 5: Post-sweep distribution snapshot + diff ──
  sep("Phase 5: Post-sweep snapshot");
  const post = await snapshotAssignments();
  printSnapshot("(post)", post);
  console.log("");
  console.log("  --- DIFF (pre → post) ---");
  diffSnapshots(pre, post);
  if (post.total !== allMpns.length) {
    console.log(`  WARNING: post-sweep total (${post.total}) != product count (${allMpns.length}); flag for investigation.`);
  }

  // ── Phase 6: Idempotency check on 5 test MPNs ──
  sep("Phase 6: Idempotency check (5 test MPNs)");
  let passed = 0;
  const failures: { tier: string; mpn: string; expected_uid: string; actual_uid: string | null; expected_name: string }[] = [];
  for (const { tier, mpn, expected_uid, expected_name } of TEST_MPNS) {
    const doc = await db.collection("cadence_assignments").doc(mpn).get();
    const actual_uid = doc.exists ? (doc.data()?.primary_user_id ?? null) : null;
    const pass = actual_uid === expected_uid;
    if (pass) passed++;
    else failures.push({ tier, mpn, expected_uid, actual_uid, expected_name });
    const status = pass ? "PASS ✓" : "FAIL ✗";
    console.log(`  ${tier.padEnd(4)} ${mpn.padEnd(22)} → ${expected_name.padEnd(8)} ${status}`);
    if (!pass) {
      console.log(`         expected: ${expected_uid}`);
      console.log(`         actual:   ${actual_uid ?? "<null>"}`);
    }
  }
  console.log(`  Idempotency: ${passed}/5 PASS`);

  // ── Phase 7: Newly-assigned non-test products audit ──
  sep("Phase 7: Newly-assigned non-test products");
  const postAssignedSnap = await db.collection("cadence_assignments")
    .where("cadence_state", "==", "assigned")
    .get();
  const nonTestAssigned: { mpn: string; primary_user_id: string | null; matched_rule_id: string | null }[] = [];
  postAssignedSnap.forEach((doc: any) => {
    const mpn = doc.id;
    if (TEST_MPN_SET.has(mpn)) return;
    const d = doc.data() || {};
    nonTestAssigned.push({
      mpn,
      primary_user_id: d.primary_user_id ?? null,
      matched_rule_id: d.matched_rule_id ?? d.rule_id ?? null,
    });
  });
  if (nonTestAssigned.length === 0) {
    console.log(`  (none)`);
  } else {
    console.log(`  Found ${nonTestAssigned.length} non-test assigned product(s):`);
    for (const r of nonTestAssigned) {
      console.log(`    ${r.mpn}: primary_user_id=${r.primary_user_id ?? "<null>"} matched_rule_id=${r.matched_rule_id ?? "<null>"}`);
    }
  }

  // ── Final summary ──
  sep("COMPLETE");
  console.log(`  Engine result: ${JSON.stringify(engineResult)}`);
  console.log(`  Wall-clock: ${(durationMs / 1000).toFixed(2)}s`);
  console.log(`  Pre-sweep total docs: ${pre.total}`);
  console.log(`  Post-sweep total docs: ${post.total}`);
  console.log(`  Idempotency: ${passed}/5 PASS`);
  console.log(`  Non-test assigned: ${nonTestAssigned.length}`);

  if (passed < 5) {
    console.error(`\nHALT: idempotency ${passed}/5 — awaiting Lisa diagnosis.`);
    process.exit(1);
  }
  console.log(`\n=== full sweep complete: ${engineResult.evaluated} evaluated, ${engineResult.assigned} assigned, ${engineResult.unassigned} unassigned ===`);
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e?.message ?? e);
  console.error(e?.stack ?? "");
  process.exit(1);
});
