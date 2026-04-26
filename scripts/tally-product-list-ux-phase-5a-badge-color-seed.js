#!/usr/bin/env node
/**
 * TALLY-PRODUCT-LIST-UX Phase 5A — site_registry badge_color seed (Architecture B)
 *
 * PO Ruling 5A.1 (2026-04-25): seed badge_color for the 3 active brand sites;
 * leave the 5 inactive sites' badge_color = null (FE hybrid fallback handles
 * those with neutral gray pills).
 *
 * Brand colors (PO 2026-04-25):
 *   site_registry/shiekh    → #2563eb  (Blue)
 *   site_registry/karmaloop → #16a34a  (Green)
 *   site_registry/mltd      → #1f2937  (Black/near-black)
 *
 * Value-aware idempotent:
 *   - badge_color === null            → write expected hex (first-run path)
 *   - badge_color === expected hex    → no-op (already seeded; safe re-run)
 *   - badge_color !== null && !== exp → STOP and report (drift; needs PO ruling)
 *   - doc missing                     → STOP and report (registry drift)
 *
 * Other site_registry docs are NEVER touched.
 */
"use strict";

const admin = require("firebase-admin");

const COLLECTION = "site_registry";
const EXPECTED_PROJECT = "ropi-aoss-dev";

const TARGETS = {
  shiekh: "#2563eb",
  karmaloop: "#16a34a",
  mltd: "#1f2937",
};

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error("FATAL: GOOGLE_APPLICATION_CREDENTIALS not set.");
    process.exit(1);
  }
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: EXPECTED_PROJECT,
  });
  const db = admin.firestore();
  const projectId = admin.app().options.projectId;
  if (projectId !== EXPECTED_PROJECT) {
    console.error(`FATAL: project mismatch (got '${projectId}', expected '${EXPECTED_PROJECT}')`);
    process.exit(1);
  }
  console.log(`Project: ${projectId}`);
  console.log(`Collection: ${COLLECTION}`);
  console.log(`Targets: ${Object.keys(TARGETS).map((k) => `${k}→${TARGETS[k]}`).join(", ")}`);
  console.log("");

  // ── READ-BEFORE ──
  console.log("=== READ-BEFORE ===");
  const decisions = {}; // id -> "write" | "skip"
  for (const [id, expected] of Object.entries(TARGETS)) {
    const snap = await db.collection(COLLECTION).doc(id).get();
    if (!snap.exists) {
      console.error(`STOP: site_registry/${id} doc missing — registry drift from prior verification.`);
      process.exit(2);
    }
    const cur = snap.data() || {};
    const curBC = cur.badge_color;
    console.log(`${id}: current badge_color=${JSON.stringify(curBC)}`);
    if (curBC === null) {
      decisions[id] = "write";
    } else if (curBC === expected) {
      decisions[id] = "skip";
      console.log(`  already seeded; no-op`);
    } else {
      console.error(`STOP: ${id} badge_color=${JSON.stringify(curBC)} differs from expected ${expected}; needs PO ruling.`);
      process.exit(3);
    }
  }
  console.log("");

  // ── WRITE ──
  console.log("=== WRITE ===");
  const writes = Object.entries(decisions).filter(([, d]) => d === "write");
  if (writes.length === 0) {
    console.log("(no writes — all docs already seeded)");
  } else {
    for (const [id] of writes) {
      const expected = TARGETS[id];
      await db.collection(COLLECTION).doc(id).set({ badge_color: expected }, { merge: true });
      console.log(`${id}: written badge_color=${expected}`);
    }
  }
  console.log("");

  // ── READ-AFTER ──
  console.log("=== READ-AFTER ===");
  let allPass = true;
  for (const id of Object.keys(TARGETS)) {
    const snap = await db.collection(COLLECTION).doc(id).get();
    const d = snap.data() || {};
    const ok = d.badge_color === TARGETS[id];
    if (!ok) allPass = false;
    console.log(`${id}: badge_color=${JSON.stringify(d.badge_color)} expected=${TARGETS[id]} pass=${ok}`);
    console.log(`  full=${JSON.stringify(d)}`);
  }
  console.log("");

  // ── UNTOUCHED CHECK (informational) ──
  console.log("=== UNTOUCHED SITES (badge_color expected null per spec) ===");
  const all = await db.collection(COLLECTION).get();
  all.forEach((doc) => {
    if (TARGETS[doc.id]) return;
    const d = doc.data() || {};
    console.log(`${doc.id}: badge_color=${JSON.stringify(d.badge_color)} is_active=${d.is_active}`);
  });
  console.log("");

  if (!allPass) {
    console.error("FATAL: READ-AFTER assertions failed.");
    process.exit(4);
  }
  console.log("All assertions passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
