#!/usr/bin/env node
/**
 * Step 3.2 — local job runner. Invokes writeWeeklySnapshots and
 * computeNeglectedInventory directly (same code as backend). Useful for
 * bootstrapping dashboards before Cloud Scheduler or the next Weekly Ops
 * Import runs.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *   NODE_PATH=/workspaces/ropi-v3/backend/functions/node_modules \
 *   node scripts/run-executive-jobs.js
 */
"use strict";
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.applicationDefault() });

const {
  writeWeeklySnapshots,
  computeNeglectedInventory,
} = require("../backend/functions/lib/services/executiveProjections");

(async () => {
  console.log("Running writeWeeklySnapshots()…");
  const snaps = await writeWeeklySnapshots();
  console.log("  →", snaps);

  console.log("Running computeNeglectedInventory()…");
  const neglect = await computeNeglectedInventory();
  console.log("  →", neglect);

  process.exit(0);
})().catch((err) => {
  console.error("Job run failed:", err);
  process.exit(1);
});
