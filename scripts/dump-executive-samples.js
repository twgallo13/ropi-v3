#!/usr/bin/env node
/**
 * Emits the three deliverables asked for in Step 3.2's "Bring me" list
 * (plus the neglected projection summary). Safe to re-run.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *   NODE_PATH=/workspaces/ropi-v3/backend/functions/node_modules \
 *   node scripts/dump-executive-samples.js
 */
"use strict";
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.applicationDefault() });
const {
  buildExecutiveHealth,
} = require("../backend/functions/lib/services/executiveProjections");

(async () => {
  const db = admin.firestore();

  const pickOne = async (metricKey, dimensionType) => {
    const snap = await db
      .collection("metric_snapshots")
      .where("metric_key", "==", metricKey)
      .where("dimension_type", "==", dimensionType)
      .limit(1)
      .get();
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  };

  const [catalogGm, deptStr, productsAdded] = await Promise.all([
    pickOne("weighted_gm_pct", "catalog"),
    pickOne("avg_str_pct", "department"),
    pickOne("products_added", "catalog"),
  ]);

  console.log("=== Sample metric_snapshots (Step 3.2 deliverable) ===");
  console.log("catalog GM%       :", JSON.stringify(catalogGm, null, 2));
  console.log("department STR%   :", JSON.stringify(deptStr, null, 2));
  console.log("products_added    :", JSON.stringify(productsAdded, null, 2));

  console.log("\n=== GET /api/v1/executive/health (composed JSON) ===");
  const health = await buildExecutiveHealth();
  console.log(JSON.stringify(health, null, 2));

  console.log("\n=== executive_projections/neglected_inventory (summary) ===");
  const neg = await db
    .collection("executive_projections")
    .doc("neglected_inventory")
    .get();
  const d = neg.data() || {};
  console.log(
    JSON.stringify(
      {
        total_count: d.total_count ?? 0,
        thresholds: d.thresholds ?? null,
        sample_items: (d.items || []).slice(0, 3),
      },
      null,
      2
    )
  );

  process.exit(0);
})().catch((err) => {
  console.error("dump failed:", err);
  process.exit(1);
});
