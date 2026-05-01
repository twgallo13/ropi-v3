#!/usr/bin/env node
/**
 * Seed: sop_panels — 5 starter operator-hub SOPs (one per hub)
 *
 * TALLY-SETTINGS-UX Phase 3.1 / PR #9
 *
 * Seeds one starter SOP panel per operator hub: import_hub,
 * completion_queue, cadence_review, launch_admin, export_center.
 * Content is intentionally generic; PO refines via the SOP Panels
 * admin editor post-seed.
 *
 * Idempotency: if the panel doc exists we set-with-merge and preserve
 * created_at; if not, we set with both created_at + updated_at.
 *
 * Usage:
 *   GCP_SA_KEY_DEV='...' node scripts/seed/seed-sop-panels.js
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "sop_panels";

const SOP_PANELS = [
  {
    panel_key: "import_hub_overview",
    hub: "import_hub",
    title: "Import Hub Overview",
    sort_order: 10,
    is_active: true,
    content_md: `## Welcome to the Import Hub

This is where new product imports from RICS and other sources land for review and triage. Use the table to browse imports, check their status, and route them to the next step in the pipeline.

*Refine this guidance as your team's import workflow matures. Edit via the SOP Panels admin page.*`,
  },
  {
    panel_key: "completion_queue_overview",
    hub: "completion_queue",
    title: "Completion Queue Overview",
    sort_order: 10,
    is_active: true,
    content_md: `## The Completion Queue

Products that need attribute completion, content review, or buyer markdown decisions land here. Filter by your team or area of responsibility, then work the queue from highest priority to lowest.

*Refine this guidance as your team's completion workflow matures. Edit via the SOP Panels admin page.*`,
  },
  {
    panel_key: "cadence_review_overview",
    hub: "cadence_review",
    title: "Cadence Review Overview",
    sort_order: 10,
    is_active: true,
    content_md: `## Cadence Review

Review and adjust pricing cadences, markdown schedules, and seasonal cycles. The cadence engine surfaces decisions that need a human eye before automation triggers.

*Refine this guidance as your team's cadence review workflow matures. Edit via the SOP Panels admin page.*`,
  },
  {
    panel_key: "launch_admin_overview",
    hub: "launch_admin",
    title: "Launch Admin Overview",
    sort_order: 10,
    is_active: true,
    content_md: `## Launch Admin

Coordinate product launches across sites and timelines. Set launch dates, review readiness checks, and approve final go-live decisions.

*Refine this guidance as your team's launch admin workflow matures. Edit via the SOP Panels admin page.*`,
  },
  {
    panel_key: "export_center_overview",
    hub: "export_center",
    title: "Export Center Overview",
    sort_order: 10,
    is_active: true,
    content_md: `## Export Center

Manage product exports to marketplaces, content channels, and downstream systems. Monitor export status, review failures, and re-trigger exports as needed.

*Refine this guidance as your team's export workflow matures. Edit via the SOP Panels admin page.*`,
  },
];

async function main() {
  initApp();
  const db = admin.firestore();
  const ts = () => admin.firestore.FieldValue.serverTimestamp();

  let created = 0;
  let updated = 0;

  for (const p of SOP_PANELS) {
    const ref = db.collection(COLLECTION).doc(p.panel_key);
    const snap = await ref.get();
    if (snap.exists) {
      // Preserve created_at; refresh updated_at + payload.
      const { panel_key, ...rest } = p;
      await ref.set({ ...rest, panel_key, updated_at: ts() }, { merge: true });
      console.log(`  · updated ${p.panel_key}`);
      updated++;
    } else {
      await ref.set({ ...p, created_at: ts(), updated_at: ts() });
      console.log(`  + created ${p.panel_key}`);
      created++;
    }
  }

  console.log(`\nDone. created=${created} updated=${updated}`);
}

main().catch((err) => {
  console.error("seed-sop-panels failed:", err);
  process.exit(1);
});
