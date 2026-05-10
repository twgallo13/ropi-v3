/**
 * TALLY-D2B-SMOKE-INJECT — positive validation via temp data injection.
 * Injects test primary_user_id + support_user_ids on 2 docs, runs queries,
 * reports counts, then reverts to pre-injection state.
 */
import * as admin from "firebase-admin";
import * as fs from "fs";

const saKey = process.env.GCP_SA_KEY_DEV;
if (!saKey) throw new Error("GCP_SA_KEY_DEV env var required");
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(saKey)),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const ALEX_UID = "uhD2yj4LK5XDgU2IUjmpYtbGmYd2";
const HEATHER_UID = "luIV6eMbZZRWYv7mJqg3F7UJ8Hl1";
const TEST_MPN_A = "487471 007"; // primary test
const TEST_MPN_B = "211193-90H"; // support test

async function snapshotDoc(mpn: string) {
  const doc = await db.collection("cadence_assignments").doc(mpn).get();
  return doc.exists ? doc.data() : null;
}

async function queryByPrimary(uid: string) {
  const snap = await db.collection("cadence_assignments")
    .where("primary_user_id", "==", uid)
    .where("in_cadence_review_queue", "==", true).get();
  return { count: snap.size, mpns: snap.docs.map(d => d.data().mpn) };
}

async function queryBySupport(uid: string) {
  const snap = await db.collection("cadence_assignments")
    .where("support_user_ids", "array-contains", uid)
    .where("in_cadence_review_queue", "==", true).get();
  return { count: snap.size, mpns: snap.docs.map(d => d.data().mpn) };
}

async function main() {
  const out: any = { meta: { tally: "TALLY-D2B-SMOKE-INJECT", probed_at: new Date().toISOString() } };

  // Snapshot pre-inject state
  console.log("[INJECT] capturing pre-inject snapshots...");
  const preA = await snapshotDoc(TEST_MPN_A);
  const preB = await snapshotDoc(TEST_MPN_B);
  out.pre_inject = { [TEST_MPN_A]: preA, [TEST_MPN_B]: preB };
  fs.writeFileSync("evidence/tally-d2b/pre-inject-state.json", JSON.stringify(out.pre_inject, null, 2));

  // Pre-inject queries (baseline)
  out.pre_inject_alex_primary = await queryByPrimary(ALEX_UID);
  out.pre_inject_heather_support = await queryBySupport(HEATHER_UID);
  console.log(`  Pre-inject: alex.primary=${out.pre_inject_alex_primary.count}, heather.support=${out.pre_inject_heather_support.count}`);

  // INJECT
  console.log("[INJECT] writing test primary on TEST_MPN_A, support on TEST_MPN_B...");
  await db.collection("cadence_assignments").doc(TEST_MPN_A).set({
    primary_user_id: ALEX_UID,
    in_cadence_review_queue: true,
    cadence_state: "assigned",
    last_evaluated_at: FieldValue.serverTimestamp(),
  }, { merge: true });
  await db.collection("cadence_assignments").doc(TEST_MPN_B).set({
    support_user_ids: [HEATHER_UID],
    in_cadence_review_queue: true,
    cadence_state: "assigned",
    last_evaluated_at: FieldValue.serverTimestamp(),
  }, { merge: true });

  // Post-inject queries (positive validation)
  out.post_inject_alex_primary = await queryByPrimary(ALEX_UID);
  out.post_inject_heather_support = await queryBySupport(HEATHER_UID);
  console.log(`  Post-inject: alex.primary=${out.post_inject_alex_primary.count}, heather.support=${out.post_inject_heather_support.count}`);

  // REVERT — critical, must succeed
  // Use update() (not set()) so explicit null values are written correctly without
  // needing FieldValue.delete(), which set() rejects outside of merge:true.
  console.log("[INJECT] reverting...");
  if (preA) {
    await db.collection("cadence_assignments").doc(TEST_MPN_A).update({
      primary_user_id: preA.primary_user_id ?? null,
      in_cadence_review_queue: preA.in_cadence_review_queue ?? false,
      cadence_state: preA.cadence_state ?? "unassigned",
    });
  } else {
    await db.collection("cadence_assignments").doc(TEST_MPN_A).delete();
  }
  if (preB) {
    await db.collection("cadence_assignments").doc(TEST_MPN_B).update({
      support_user_ids: preB.support_user_ids ?? [],
      in_cadence_review_queue: preB.in_cadence_review_queue ?? false,
      cadence_state: preB.cadence_state ?? "unassigned",
    });
  } else {
    await db.collection("cadence_assignments").doc(TEST_MPN_B).delete();
  }

  // Post-revert sanity check
  out.post_revert_alex_primary = await queryByPrimary(ALEX_UID);
  out.post_revert_heather_support = await queryBySupport(HEATHER_UID);
  console.log(`  Post-revert: alex.primary=${out.post_revert_alex_primary.count}, heather.support=${out.post_revert_heather_support.count}`);

  fs.writeFileSync(`evidence/tally-d2b/inject-${Date.now()}.json`, JSON.stringify(out, null, 2));
  console.log("[INJECT] complete.");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
