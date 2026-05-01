#!/usr/bin/env node
/**
 * Seed: pricing-related admin_settings
 * Seeds the 12 pricing/calculation settings from SPEC.md Section 19.7.
 * Idempotent (set-with-merge).
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "admin_settings";

const SETTINGS = [
  { key: "gross_margin_safe_threshold",        value: 10,                          type: "number",  label: "Gross Margin Safe Threshold",          category: "pricing" },
  { key: "estimated_cost_multiplier",          value: 0.50,                        type: "number",  label: "Estimated Cost Multiplier",            category: "pricing" },
  { key: "below_cost_acknowledgment_required", value: true,                        type: "boolean", label: "Below-Cost Acknowledgment Required",   category: "pricing" },
  { key: "below_cost_reason_min_chars",        value: 20,                          type: "number",  label: "Below-Cost Reason Minimum Characters", category: "pricing" },
  { key: "master_veto_window",                 value: 2,                           type: "number",  label: "Master Veto Window (hours)",           category: "pricing" },
  { key: "export_price_rounding_enabled",      value: true,                        type: "boolean", label: "Export Price Rounding Enabled",        category: "pricing" },
  { key: "export_price_rounding_mode",         value: "floor_minus_one_cent",      type: "string",  label: "Export Price Rounding Mode",           category: "pricing" },
  { key: "export_site_separator",              value: "|",                         type: "string",  label: "Export Site Separator",                category: "pricing" },
  { key: "slow_moving_str_threshold",          value: 15,                          type: "number",  label: "Slow-Moving STR Threshold",            category: "pricing" },
  { key: "slow_moving_wos_threshold",          value: 12,                          type: "number",  label: "Slow-Moving WoS Threshold",            category: "pricing" },
  { key: "str_calculation_window_days",        value: 30,                          type: "number",  label: "STR Calculation Window (days)",        category: "pricing" },
  { key: "wos_trailing_average_days",          value: 30,                          type: "number",  label: "WoS Trailing Average (days)",          category: "pricing" },
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
        label: s.label,
        category: s.category,
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
