#!/usr/bin/env node
/**
 * TALLY-3.8-B.3 — Pascal canonicalization migration for products.pricing_domain_state.
 *
 * Reads every product, and for any document whose pricing_domain_state matches
 * a known snake_case (or legacy "pending") variant, writes the PASCAL canonical
 * equivalent. PASCAL-already values are skipped (idempotent).
 *
 * Mapping table (dispatch-locked):
 *   "pricing_pending"      -> "Pricing Pending"
 *   "pending"              -> "Pricing Pending"   (legacy fallback)
 *   "discrepancy"          -> "Pricing Discrepancy"
 *   "loss_leader_review"   -> "Loss-Leader Review Pending"
 *   "buyer_denied"         -> "Buyer Denied"
 *   "loss_leader_vetoed"   -> "Loss-Leader Vetoed"
 *   "export_ready"         -> "Export Ready"
 *   "scheduled"            -> "Scheduled"
 *   "exported"             -> "Exported"
 *   "pricing_incomplete"   -> "Pricing Incomplete"
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     node scripts/migrate/pascal-canonicalize-pricing-domain-state.js
 *
 * Idempotent: re-running on already-PASCAL data is a no-op (zero writes).
 */
"use strict";
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}
const db = admin.firestore();

const MAPPING = {
  pricing_pending: "Pricing Pending",
  pending: "Pricing Pending",
  discrepancy: "Pricing Discrepancy",
  loss_leader_review: "Loss-Leader Review Pending",
  buyer_denied: "Buyer Denied",
  loss_leader_vetoed: "Loss-Leader Vetoed",
  export_ready: "Export Ready",
  scheduled: "Scheduled",
  exported: "Exported",
  pricing_incomplete: "Pricing Incomplete",
};

(async () => {
  console.log("[pascal-canonicalize] Scanning products collection…");
  const snap = await db.collection("products").get();
  console.log(`[pascal-canonicalize] Total products scanned: ${snap.size}`);

  let migrated = 0;
  let skipped = 0;
  let nullState = 0;
  const perStateCounts = {};

  for (const doc of snap.docs) {
    const data = doc.data();
    const current = data.pricing_domain_state;

    if (current === undefined || current === null || current === "") {
      nullState++;
      continue;
    }

    if (typeof current !== "string") {
      skipped++;
      continue;
    }

    const next = MAPPING[current];
    if (!next) {
      // Already PASCAL or unknown — skip
      skipped++;
      continue;
    }

    await doc.ref.set({ pricing_domain_state: next }, { merge: true });
    perStateCounts[next] = (perStateCounts[next] || 0) + 1;
    console.log(
      `[pascal-canonicalize] ${doc.id}: "${current}" -> "${next}"`
    );
    migrated++;
  }

  console.log("");
  console.log("===== MIGRATION SUMMARY =====");
  console.log(`Total scanned: ${snap.size}`);
  console.log(`Migrated:      ${migrated}`);
  console.log(`Skipped (already PASCAL or unknown): ${skipped}`);
  console.log(`Null/empty state (untouched):        ${nullState}`);
  console.log("Per-state migrated counts:");
  for (const [state, count] of Object.entries(perStateCounts)) {
    console.log(`  "${state}": ${count}`);
  }
  console.log("=============================");

  process.exit(0);
})().catch((e) => {
  console.error("[pascal-canonicalize] FAILED:", e);
  process.exit(1);
});
