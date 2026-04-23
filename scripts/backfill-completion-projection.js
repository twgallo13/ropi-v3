#!/usr/bin/env node
/**
 * Backfill completion projection fields onto all products.
 *
 * Prerequisites:
 *   cd scripts && npm install  (one-time, per clone)
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
 *
 * Usage:
 *   node scripts/backfill-completion-projection.js [options]
 *
 * Options:
 *   --dry-run       Simulate without writing
 *   --limit N       Process only first N products
 *   --start-after   Resume from MPN (for paginated runs)
 */

const path = require("path");
const admin = require("firebase-admin");

// --- arg parsing -----------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : null;
const startIdx = args.indexOf("--start-after");
const START_AFTER = startIdx >= 0 ? args[startIdx + 1] : null;

// --- firebase init ---------------------------------------------------------
const projectId = process.env.GCLOUD_PROJECT || "ropi-aoss-dev";
admin.initializeApp({ projectId });
const firestore = admin.firestore();

// --- compute service (deployed lib output) --------------------------------
const computePath = path.resolve(
  __dirname,
  "..",
  "backend",
  "functions",
  "lib",
  "services",
  "completionCompute.js"
);
const { computeCompletion, stampCompletionOnProduct } = require(computePath);

// --- main -----------------------------------------------------------------
(async () => {
  console.log(
    `[backfill-completion-projection] project=${projectId} dryRun=${DRY_RUN} limit=${LIMIT || "none"} startAfter=${START_AFTER || "none"}`
  );

  let q = firestore.collection("products").orderBy(admin.firestore.FieldPath.documentId());
  if (START_AFTER) q = q.startAfter(START_AFTER);
  if (LIMIT) q = q.limit(LIMIT);

  const snap = await q.get();
  console.log(`[backfill-completion-projection] fetched ${snap.size} products`);

  let processed = 0;
  let stamped = 0;
  let failed = 0;
  const samples = [];

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const mpn = data.mpn || doc.id;

    try {
      const result = await computeCompletion(mpn);

      if (DRY_RUN) {
        if (samples.length < 5) {
          samples.push({
            mpn,
            completion_percent: result.completion_percent,
            blocker_count: result.blocker_count,
            ai_blocker_count: result.ai_blocker_count,
            next_action_hint: result.next_action_hint,
          });
        }
      } else {
        await stampCompletionOnProduct(doc.ref, result);
        stamped++;
      }
    } catch (err) {
      failed++;
      console.warn(
        `[backfill-completion-projection] FAIL mpn=${mpn} err=${err && err.message}`
      );
    }

    processed++;
    if (processed % 100 === 0) {
      console.log(
        `[backfill-completion-projection] progress processed=${processed} stamped=${stamped} failed=${failed}`
      );
    }
  }

  console.log(
    `[backfill-completion-projection] DONE processed=${processed} stamped=${stamped} failed=${failed} dryRun=${DRY_RUN}`
  );

  if (DRY_RUN && samples.length > 0) {
    console.log("[backfill-completion-projection] sample computed values:");
    for (const s of samples) console.log("  ", JSON.stringify(s));
  }

  process.exit(failed > 0 && !DRY_RUN ? 1 : 0);
})().catch((err) => {
  console.error("[backfill-completion-projection] FATAL", err);
  process.exit(2);
});
