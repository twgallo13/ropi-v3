#!/usr/bin/env node
/**
 * Seed: admin_settings — 21 docs
 * Platform-wide configuration for the ROPI AOSS V3 system.
 * Idempotent (set-with-merge).
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "admin_settings";

const SETTINGS = [
  // ── Platform (1–3) ──
  {
    id: "platform_info",
    category: "platform",
    label: "Platform Info",
    value: {
      app_name: "ropi-aoss",
      version: "3.0.0",
      environment: "dev",
      project_id: "ropi-aoss-dev",
      support_email: "support@ropi.io",
    },
  },
  {
    id: "maintenance_mode",
    category: "platform",
    label: "Maintenance Mode",
    value: { enabled: false, message: "", allowed_ips: [] },
  },
  {
    id: "feature_flags",
    category: "platform",
    label: "Feature Flags",
    value: {
      enable_ai_descriptions: true,
      enable_smart_rules: true,
      enable_dynamic_pricing: false,
      enable_multi_currency: false,
      enable_analytics_dashboard: true,
      enable_feed_export: true,
      enable_bulk_import: true,
    },
  },

  // ── AI / LLM (4–7) ──
  {
    id: "active_ai_provider",
    category: "ai",
    label: "Active AI Provider",
    value: "anthropic",
    type: "string",
  },
  {
    id: "ai_model_config",
    category: "ai",
    label: "AI Model Configuration",
    value: {
      default_model: "gpt-4o",
      fallback_model: "gpt-4o-mini",
      max_tokens_per_request: 4096,
      default_temperature: 0.7,
      rate_limit_rpm: 60,
    },
  },
  {
    id: "ai_content_moderation",
    category: "ai",
    label: "AI Content Moderation",
    value: {
      enabled: true,
      block_profanity: true,
      block_competitor_mentions: true,
      competitor_list: [],
      require_human_review_threshold: 0.6,
    },
  },
  {
    id: "ai_enrichment_schedule",
    category: "ai",
    label: "AI Enrichment Schedule",
    value: {
      enabled: true,
      schedule_cron: "0 3 * * *",
      batch_size: 100,
      max_daily_enrichments: 5000,
      retry_failed_after_hours: 24,
    },
  },
  {
    id: "ai_prompt_templates",
    category: "ai",
    label: "AI Prompt Templates",
    value: {
      description_template: "Generate a product description for {product_name} by {brand} in the {category} category. Tone: {tone}. Max {max_length} characters.",
      bullets_template: "Generate 5 key selling points for {product_name} by {brand}.",
      seo_title_template: "Generate an SEO-optimized title for {product_name} by {brand}. Max 60 characters.",
      seo_meta_template: "Generate an SEO meta description for {product_name} by {brand}. Max 160 characters.",
    },
  },

  // ── Feed / Export (8–10) ──
  {
    id: "feed_google_shopping",
    category: "feed",
    label: "Google Shopping Feed",
    value: {
      enabled: true,
      format: "xml",
      schedule_cron: "0 */4 * * *",
      include_out_of_stock: false,
      required_fields: ["product_name", "brand", "retail_price", "primary_image_url", "sku"],
    },
  },
  {
    id: "feed_facebook_catalog",
    category: "feed",
    label: "Facebook Catalog Feed",
    value: {
      enabled: true,
      format: "csv",
      schedule_cron: "0 */6 * * *",
      include_out_of_stock: false,
    },
  },
  {
    id: "feed_affiliate",
    category: "feed",
    label: "Affiliate Feed",
    value: {
      enabled: false,
      format: "json",
      schedule_cron: "0 0 * * *",
      commission_field: "price_tier",
    },
  },

  // ── Notifications (11–13) ──
  {
    id: "notification_email",
    category: "notifications",
    label: "Email Notifications",
    value: {
      enabled: true,
      smtp_configured: false,
      recipients: ["admin@ropi.io"],
      on_seed_complete: true,
      on_ai_error: true,
      on_feed_export: true,
    },
  },
  {
    id: "notification_slack",
    category: "notifications",
    label: "Slack Notifications",
    value: {
      enabled: false,
      webhook_url: "",
      channel: "#ropi-alerts",
      on_deploy: true,
      on_error: true,
    },
  },
  {
    id: "notification_in_app",
    category: "notifications",
    label: "In-App Notifications",
    value: {
      enabled: true,
      max_per_user: 50,
      auto_dismiss_after_days: 30,
    },
  },

  // ── Security / Auth (14–16) ──
  {
    id: "auth_config",
    category: "security",
    label: "Authentication Config",
    value: {
      session_timeout_minutes: 60,
      max_sessions_per_user: 5,
      require_mfa: false,
      allowed_domains: ["ropi.io", "shiekh.com"],
    },
  },
  {
    id: "role_definitions",
    category: "security",
    label: "Role Definitions",
    value: {
      superadmin: { permissions: ["*"], description: "Full platform access" },
      admin: { permissions: ["sites:read", "sites:write", "products:*", "orders:*", "analytics:read"], description: "Site-level admin" },
      editor: { permissions: ["products:read", "products:write", "content:*", "analytics:read"], description: "Content manager" },
      viewer: { permissions: ["sites:read", "products:read", "orders:read", "analytics:read"], description: "Read-only access" },
    },
  },
  {
    id: "api_rate_limits",
    category: "security",
    label: "API Rate Limits",
    value: {
      global_rpm: 1000,
      per_user_rpm: 100,
      per_ip_rpm: 200,
      burst_limit: 50,
    },
  },

  // ── Import / Bulk (17–18) ──
  {
    id: "bulk_import_config",
    category: "import",
    label: "Bulk Import Configuration",
    value: {
      max_file_size_mb: 50,
      allowed_formats: ["csv", "xlsx", "json"],
      max_rows_per_batch: 5000,
      duplicate_strategy: "update",
      validate_before_import: true,
    },
  },
  {
    id: "data_mapping_defaults",
    category: "import",
    label: "Data Mapping Defaults",
    value: {
      auto_map_by_header: true,
      case_insensitive_match: true,
      trim_whitespace: true,
      skip_empty_rows: true,
    },
  },

  // ── Analytics (19–20) ──
  {
    id: "analytics_config",
    category: "analytics",
    label: "Analytics Configuration",
    value: {
      enabled: true,
      retention_days: 90,
      track_ai_usage: true,
      track_feed_performance: true,
      dashboard_refresh_minutes: 15,
    },
  },
  {
    id: "analytics_export",
    category: "analytics",
    label: "Analytics Export",
    value: {
      enabled: false,
      destination: "bigquery",
      dataset: "ropi_analytics",
      schedule_cron: "0 1 * * 1",
    },
  },

  // ── System (21) ──
  {
    id: "system_health",
    category: "system",
    label: "System Health Config",
    value: {
      health_check_interval_seconds: 30,
      log_level: "info",
      enable_trace: false,
      max_retry_attempts: 3,
      circuit_breaker_threshold: 5,
    },
  },

  // ── Launch Calendar (Step 2.4 — Section 9.13 / 10.8) ──
  {
    id: "launch_priority_window_days",
    category: "launches",
    label: "Launch Priority Window (days)",
    value: 7,
    type: "number",
    description:
      "Products with an upcoming launch within this many days are flagged High Priority in the Completion Queue.",
  },
  {
    id: "smtp_throttle_hours",
    category: "communications",
    label: "SMTP Notification Throttle Window (hours)",
    value: 24,
    type: "number",
    description:
      "Minimum hours between repeated SMTP notifications for the same launch date change event.",
  },
  {
    id: "launch_past_retention_days",
    category: "launches",
    label: "Past Launch Retention (days)",
    value: 90,
    type: "number",
    description:
      "Past published launches remain visible on the Public Launch Calendar for this many days.",
  },

  // ── Executive (Step 3.2) ──
  {
    id: "neglected_age_threshold_days",
    category: "executive",
    label: "Neglected Inventory: Product Age Threshold (days)",
    value: 60,
    type: "number",
    description:
      "Products older than this (since first_received_at) are candidates for the Neglected Inventory view.",
  },
  {
    id: "neglected_attention_threshold_days",
    category: "executive",
    label: "Neglected Inventory: Days Without Attention Threshold",
    value: 14,
    type: "number",
    description:
      "If last_modified_at is older than this, the aged product is flagged as neglected.",
  },
  {
    id: "gm_target_pct",
    category: "executive",
    label: "Catalog GM% Target",
    value: 40,
    type: "number",
    description:
      "Reference line rendered on the Executive Dashboard GM% trend chart.",
  },

  // ── Buyer Performance Matrix (Step 3.3) ──
  {
    id: "buyer_performance_review_window_days",
    category: "executive",
    label: "Buyer Performance: Review Window (days)",
    value: 30,
    type: "number",
    description:
      "Look-back window for counting buyer actions when calculating the Attention Score.",
  },
  {
    id: "buyer_kpi_weight_margin",
    category: "executive",
    label: "Buyer KPI Weight: Margin Health",
    value: 33,
    type: "number",
    description:
      "Weight (out of 100) for Margin Health in the composite buyer score. Margin + Velocity + Attention should total 100.",
  },
  {
    id: "buyer_kpi_weight_velocity",
    category: "executive",
    label: "Buyer KPI Weight: Inventory Velocity",
    value: 33,
    type: "number",
    description:
      "Weight (out of 100) for Inventory Velocity in the composite buyer score.",
  },
  {
    id: "buyer_kpi_weight_attention",
    category: "executive",
    label: "Buyer KPI Weight: Attention Score",
    value: 34,
    type: "number",
    description:
      "Weight (out of 100) for the Attention Score in the composite buyer score.",
  },
  {
    id: "category_gm_targets",
    category: "executive",
    label: "Category GM% Targets",
    value: {
      Footwear: 40,
      Clothing: 45,
      Accessories: 50,
      "Home & Tech": 45,
    },
    description:
      "Per-department GM% targets used by the buyer performance matrix. Blended weighted-average target is compared to each buyer's GM%.",
  },
];

// Attach timestamps to each
const SETTINGS_WITH_TS = SETTINGS.map(s => ({
  ...s,
  created_at: admin.firestore.FieldValue.serverTimestamp(),
  updated_at: admin.firestore.FieldValue.serverTimestamp(),
}));

async function main() {
  const app = initApp();
  const db = admin.firestore(app);
  console.log(`\n🌱  Seeding "${COLLECTION}" (${SETTINGS_WITH_TS.length} docs) …`);

  let created = 0, updated = 0;
  for (const item of SETTINGS_WITH_TS) {
    const { id, ...data } = item;
    const ref = db.collection(COLLECTION).doc(id);
    const snap = await ref.get();
    if (snap.exists) {
      const { created_at, ...upd } = data;
      await ref.set({ ...upd, updated_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      updated++;
    } else {
      await ref.set(data);
      created++;
    }
  }
  console.log(`   Summary → created: ${created}, updated: ${updated}, total: ${SETTINGS_WITH_TS.length}`);
  console.log(`   ✔  "${COLLECTION}" seed complete.\n`);
}

main().catch(e => { console.error("❌  Seed failed:", e); process.exit(1); });
