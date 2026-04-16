#!/usr/bin/env node
/**
 * Seed: pricing-related admin_settings
 * Seeds the 11 pricing/calculation settings from SPEC.md Section 19.7.
 * Idempotent (set-with-merge).
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "admin_settings";

const SETTINGS = [
  { key: "gross_margin_safe_threshold", value: 10, type: "number" },
  { key: "estimated_cost_multiplier", value: 0.50, type: "number" },
  { key: "below_cost_acknowledgment_required", value: true, type: "boolean" },
  { key: "below_cost_reason_min_chars", value: 20, type: "number" },
  { key: "master_veto_window", value: 2, type: "number" },
  { key: "export_price_rounding_enabled", value: true, type: "boolean" },
  { key: "export_price_rounding_mode", value: "floor_minus_one_cent", type: "string" },
  { key: "slow_moving_str_threshold", value: 15, type: "number" },
  { key: "slow_moving_wos_threshold", value: 12, type: "number" },
  { key: "str_calculation_window_days", value: 30, type: "number" },
  { key: "wos_trailing_average_days", value: 30, type: "number" },
];

async function main() {
  const app = initApp();
  const db = admin.firestore(app);
  console.log(`\n🌱  Seeding pricing admin_settings (${SETTINGS.length} docs) …`);

  let count = 0;
  for (const s of SETTINGS) {
    await db.collection(COLLECTION).doc(s.key).set(
      {
        key: s.key,
        value: s.value,
        type: s.type,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log(`  ✔ ${s.key} = ${s.value}`);
    count++;
  }

  console.log(`\n✅  Seeded ${count} pricing admin_settings docs.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
