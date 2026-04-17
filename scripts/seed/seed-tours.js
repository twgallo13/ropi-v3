#!/usr/bin/env node
/**
 * Seed: admin_tours — Step 3.5 Guided Tours
 * Seeds default tours for 5 hubs. Idempotent (upsert by tour_id).
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "admin_tours";

const TOURS = [
  {
    tour_id: "tour_import_hub",
    hub: "import_hub",
    title: "Import Hub Tour",
    steps: [
      {
        target_selector: '[data-tour="full-product-import"]',
        title: "Full Product Import",
        position: "bottom",
        content:
          "Upload your RO export CSV here. The system validates, runs Smart Rules, and queues products for completion.",
      },
      {
        target_selector: '[data-tour="weekly-ops-import"]',
        title: "Weekly Operations Import",
        position: "bottom",
        content:
          "Run this every week after your RetailOps export. Updates pricing, STR%, WOS, and triggers cadence evaluation.",
      },
      {
        target_selector: '[data-tour="map-policy-import"]',
        title: "MAP Policy Import",
        position: "top",
        content:
          "Upload vendor MAP files here. Column mapping handles any vendor format.",
      },
      {
        target_selector: '[data-tour="site-verification-import"]',
        title: "Site Verification Import",
        position: "top",
        content:
          "Upload your site verification feed. Maps link and image_link columns to verify products are live.",
      },
    ],
    is_active: true,
  },
  {
    tour_id: "tour_completion_queue",
    hub: "completion_queue",
    title: "Completion Queue Tour",
    steps: [
      {
        target_selector: '[data-tour="density-toggle"]',
        title: "Grid Density",
        position: "left",
        content:
          "Toggle between comfortable and compact rows. Your preference persists across sessions.",
      },
      {
        target_selector: '[data-tour="completion-table"]',
        title: "Completion Queue",
        position: "top",
        content:
          "Products needing attribute enrichment appear here. Click an MPN to open the detail page and finish completion. High-priority launches are badged 🚀.",
      },
    ],
    is_active: true,
  },
  {
    tour_id: "tour_cadence_review",
    hub: "cadence_review",
    title: "Cadence Review Tour",
    steps: [
      {
        target_selector: '[data-tour="cadence-list"]',
        title: "Cadence Review Queue",
        position: "top",
        content:
          "Products flagged by your cadence rules (e.g. 45-day zero sales). Act, Hold, Save for Season, or Postpone each card.",
      },
    ],
    is_active: true,
  },
  {
    tour_id: "tour_launch_admin",
    hub: "launch_admin",
    title: "Launch Admin Tour",
    steps: [
      {
        target_selector: "h1",
        title: "Launch Admin",
        position: "bottom",
        content:
          "Manage upcoming product launches here. Each launch gets a dedicated countdown and priority rollup on the Dashboard.",
      },
    ],
    is_active: true,
  },
  {
    tour_id: "tour_export_center",
    hub: "export_center",
    title: "Export Center Tour",
    steps: [
      {
        target_selector: "h1",
        title: "Export Center",
        position: "bottom",
        content:
          "Trigger scheduled exports and download the latest generated files here. Pricing export is the primary downstream feed for RetailOps.",
      },
    ],
    is_active: true,
  },
];

(async () => {
  const app = initApp();
  const db = admin.firestore();
  console.log(`\n🌱  Seeding ${TOURS.length} guided tours …\n`);
  let created = 0,
    updated = 0;
  for (const t of TOURS) {
    const ref = db.collection(COLLECTION).doc(t.tour_id);
    const snap = await ref.get();
    const payload = {
      ...t,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (!snap.exists) {
      payload.created_at = admin.firestore.FieldValue.serverTimestamp();
      await ref.set(payload);
      created++;
      console.log(`  ✅  ${t.tour_id}  (created)`);
    } else {
      await ref.set(payload, { merge: true });
      updated++;
      console.log(`  ✅  ${t.tour_id}  (updated)`);
    }
  }
  console.log(
    `\n✅  Done — ${created} created, ${updated} updated (${TOURS.length} total)\n`
  );
  process.exit(0);
})().catch((e) => {
  console.error("❌  Seed failed:", e);
  process.exit(1);
});
