// TALLY-PRODUCT-EDITOR-MEDIA-CLEANUP — one-time admin script.
//
// Purpose: delete the two phantom attribute_registry docs that survive
// in live Firestore (Architecture B). Re-running is safe — read-after
// guard reports both as missing and exits 0.
//
// Auth (per Phase 2A precedent — memory rule):
//   echo "$GCP_SA_KEY_DEV" > /tmp/gcp-sa-key.json
//   export GOOGLE_APPLICATION_CREDENTIALS=/tmp/gcp-sa-key.json
//   export GCLOUD_PROJECT=ropi-aoss-dev
//
// Behavior (in order):
//   1. Init firebase-admin against ropi-aoss-dev. If detected project
//      ID !== "ropi-aoss-dev" -> exit 1.
//   2. READ-BEFORE both docs. If either does not exist -> exit 1
//      (premise wrong; PO must re-rule).
//   3. DELETE both docs.
//   4. READ-AFTER both docs. Each must report exists === false.
//   5. Exit 0.

const admin = require("firebase-admin");

const EXPECTED_PROJECT = "ropi-aoss-dev";
const COLLECTION = "attribute_registry";
const DOC_IDS = ["video_url", "thumbnail_url"];

async function main() {
  admin.initializeApp();
  const projectId =
    admin.app().options.projectId ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    "(unknown)";
  console.log(`[init] firebase-admin project: ${projectId}`);

  if (projectId !== EXPECTED_PROJECT) {
    console.error(
      `[abort] expected project "${EXPECTED_PROJECT}", got "${projectId}"`
    );
    process.exit(1);
  }

  const db = admin.firestore();

  // ── READ-BEFORE ────────────────────────────────────────────────────
  console.log("\n[read-before]");
  const before = {};
  for (const id of DOC_IDS) {
    const ref = db.collection(COLLECTION).doc(id);
    const snap = await ref.get();
    before[id] = snap.exists;
    console.log(`  ${COLLECTION}/${id}: exists=${snap.exists}`);
    if (snap.exists) {
      console.log(`    data=${JSON.stringify(snap.data())}`);
    }
  }

  const missing = DOC_IDS.filter((id) => !before[id]);
  if (missing.length > 0) {
    console.error(
      `\n[abort] expected docs not found: ${missing.join(", ")}. ` +
        `Architecture B premise is wrong; PO must re-rule.`
    );
    process.exit(1);
  }

  // ── DELETE ─────────────────────────────────────────────────────────
  console.log("\n[delete]");
  for (const id of DOC_IDS) {
    await db.collection(COLLECTION).doc(id).delete();
    console.log(`  ${COLLECTION}/${id}: delete() returned`);
  }

  // ── READ-AFTER ─────────────────────────────────────────────────────
  console.log("\n[read-after]");
  let allGone = true;
  for (const id of DOC_IDS) {
    const snap = await db.collection(COLLECTION).doc(id).get();
    console.log(`  ${COLLECTION}/${id}: exists=${snap.exists}`);
    if (snap.exists) allGone = false;
  }

  if (!allGone) {
    console.error("\n[abort] one or more docs still present after delete");
    process.exit(1);
  }

  console.log("\n[done] both phantom docs purged.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
