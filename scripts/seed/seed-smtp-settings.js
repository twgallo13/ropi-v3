#!/usr/bin/env node
/**
 * Seed: admin_settings — Step 4.2 Amendment A SMTP keys
 * Idempotent — does not overwrite existing values, only seeds defaults
 * for keys that do not yet exist.
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

const ROWS = [
  {
    key: "email_provider",
    value: "sendgrid",
    type: "string",
    category: "smtp",
    label: "Email Provider (sendgrid | custom_smtp)",
  },
  {
    key: "smtp_host",
    value: "",
    type: "string",
    category: "smtp",
    label: "Custom SMTP Host",
  },
  {
    key: "smtp_port",
    value: 587,
    type: "number",
    category: "smtp",
    label: "Custom SMTP Port",
  },
  {
    key: "smtp_username",
    value: "",
    type: "string",
    category: "smtp",
    label: "Custom SMTP Username",
  },
  {
    key: "smtp_from_address",
    value: "noreply@shiekhshoes.com",
    type: "string",
    category: "smtp",
    label: "From Email Address",
  },
  {
    key: "smtp_from_name",
    value: "ROPI Operations",
    type: "string",
    category: "smtp",
    label: "From Name",
  },
  // Notification toggles (if not already present)
  {
    key: "notify_launch_enabled",
    value: true,
    type: "boolean",
    category: "notifications",
    label: "Launch notifications enabled",
  },
  {
    key: "notify_map_conflict_enabled",
    value: true,
    type: "boolean",
    category: "notifications",
    label: "MAP conflict alerts enabled",
  },
  {
    key: "notify_weekly_advisory_enabled",
    value: true,
    type: "boolean",
    category: "notifications",
    label: "Weekly Advisory emails enabled",
  },
  {
    key: "notify_pricing_discrepancy_enabled",
    value: true,
    type: "boolean",
    category: "notifications",
    label: "Pricing discrepancy alerts enabled",
  },
];

(async () => {
  initApp();
  const db = admin.firestore();
  console.log(`\n🌱  Seeding ${ROWS.length} SMTP/notification admin_settings …\n`);
  let created = 0;
  let kept = 0;
  for (const r of ROWS) {
    const ref = db.collection("admin_settings").doc(r.key);
    const snap = await ref.get();
    if (snap.exists) {
      // Only update label/category/type to keep in sync, never overwrite value
      await ref.set(
        {
          type: r.type,
          category: r.category,
          label: r.label,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      kept++;
      console.log(`  ⏭  ${r.key}  (kept existing value)`);
    } else {
      await ref.set({
        ...r,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      created++;
      console.log(`  ✅  ${r.key}  (created = ${JSON.stringify(r.value)})`);
    }
  }
  console.log(`\n✅  Done — ${created} created, ${kept} kept\n`);
  process.exit(0);
})().catch((e) => {
  console.error("❌  Seed failed:", e);
  process.exit(1);
});
