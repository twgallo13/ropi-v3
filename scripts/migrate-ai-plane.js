#!/usr/bin/env node
/**
 * TALLY-SETTINGS-UX Phase 3 / A.1 — AI Plane migration
 *
 * Promotes legacy admin_settings keys (active_ai_provider /
 * active_ai_model) into per-workflow ai_workflow_routing docs so the
 * existing ROPI behavior is preserved when the new aiConfig helper
 * starts resolving routings.
 *
 * Behavior:
 *   - Reads admin_settings/active_ai_provider + active_ai_model. If
 *     either is missing, falls back to seeded defaults
 *     (anthropic / claude-opus-4-7) for that field and records the
 *     source ("firestore" | "default").
 *   - For each of the 9 workflows, if the routing doc is missing,
 *     creates it with the legacy provider/model override (R.5
 *     override-with-legacy). If the doc already exists, leaves it
 *     alone (admin tuning wins).
 *   - Marks the legacy admin_settings keys deprecated:true (with
 *     deprecated_at / deprecated_by:"system:tally-A1-aiplane") so the
 *     UI projection (admin/settings) can hide or strike them through.
 *   - WARN edge case: if legacy provider==anthropic but the legacy
 *     model is not one of the known anthropic model_keys, we log a
 *     loud WARN in the dry-run summary so the PO can decide whether
 *     to proceed or first add the model to the provider registry.
 *   - Writes a single audit_log entry with pre/post state and the
 *     dry_run flag.
 *
 * Usage:
 *   GCP_SA_KEY_DEV='...' node scripts/migrate-ai-plane.js --dry-run
 *   GCP_SA_KEY_DEV='...' node scripts/migrate-ai-plane.js
 */
"use strict";

const admin = require("firebase-admin");

const TALLY_ID = "tally-A1-aiplane";
const DRY_RUN = process.argv.includes("--dry-run");

const KEY_ENV = process.env.GCP_SA_KEY_DEV || process.env.SERVICE_ACCOUNT_JSON;
if (!KEY_ENV) {
  console.error("❌  GCP_SA_KEY_DEV not set");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(KEY_ENV)),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

// R.1: 9 workflows
const WORKFLOW_KEYS = [
  "content_generation",
  "content_review_regeneration",
  "ai_assistant_chat",
  "ai_assistant_vision",
  "smart_rule_inference",
  "weekly_advisory_report",
  "anomaly_detection",
  "ai_enrichment_name",
  "ai_enrichment_color",
];

const DEFAULT_PROVIDER_KEY = "anthropic";
const DEFAULT_MODEL_KEY = "claude-opus-4-7";

// Used only for the WARN edge-case check.
const KNOWN_ANTHROPIC_MODELS = new Set([
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-sonnet-4-5",
]);

const LEGACY_KEYS = ["active_ai_provider", "active_ai_model"];

async function readSetting(key) {
  const snap = await db.collection("admin_settings").doc(key).get();
  if (!snap.exists) return { value: null, source: "default" };
  const data = snap.data() || {};
  if (data.value === undefined || data.value === null) {
    return { value: null, source: "default" };
  }
  return { value: data.value, source: "firestore" };
}

async function main() {
  console.log(`\n=== migrate-ai-plane.js  (${DRY_RUN ? "DRY RUN" : "LIVE"}) ===\n`);

  const provider = await readSetting("active_ai_provider");
  const model = await readSetting("active_ai_model");

  const legacyProvider = provider.value || DEFAULT_PROVIDER_KEY;
  const legacyModel = model.value || DEFAULT_MODEL_KEY;

  console.log(`Legacy provider: '${legacyProvider}' (source=${provider.source})`);
  console.log(`Legacy model:    '${legacyModel}' (source=${model.source})`);

  // Edge-case WARN
  if (
    legacyProvider === "anthropic" &&
    !KNOWN_ANTHROPIC_MODELS.has(legacyModel)
  ) {
    console.warn(
      `\n⚠️  WARN: legacy model '${legacyModel}' is NOT in the seeded anthropic.models[] set ` +
        `(${[...KNOWN_ANTHROPIC_MODELS].join(", ")}). After migration, getAiConfigForWorkflow() ` +
        `will fall back to SEEDED_DEFAULT until you either (a) add this model to ` +
        `ai_provider_registry/anthropic.models[] or (b) update the workflow routings to a known model.\n`
    );
  }

  const summary = {
    workflows_created: [],
    workflows_skipped_existing: [],
    legacy_keys_marked_deprecated: [],
  };

  // Step 1: per-workflow create-if-missing with legacy override.
  for (const wfKey of WORKFLOW_KEYS) {
    const ref = db.collection("ai_workflow_routing").doc(wfKey);
    const snap = await ref.get();
    if (snap.exists) {
      console.log(`  · ${wfKey}: exists, skipping`);
      summary.workflows_skipped_existing.push(wfKey);
      continue;
    }

    const payload = {
      workflow_key: wfKey,
      display_name: wfKey,
      provider_key: legacyProvider,
      model_key: legacyModel,
      fallback_provider_key: null,
      fallback_model_key: null,
      is_active: true,
      created_at: ts(),
      updated_at: ts(),
      created_by: `system:${TALLY_ID}`,
    };

    if (DRY_RUN) {
      console.log(
        `  + ${wfKey}: WOULD CREATE → ${legacyProvider} / ${legacyModel}`
      );
    } else {
      await ref.set(payload);
      console.log(
        `  + ${wfKey}: created → ${legacyProvider} / ${legacyModel}`
      );
    }
    summary.workflows_created.push(wfKey);
  }

  // Step 2: deprecate legacy admin_settings keys.
  for (const key of LEGACY_KEYS) {
    const ref = db.collection("admin_settings").doc(key);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`  · admin_settings/${key}: missing, skipping deprecation`);
      continue;
    }
    if (snap.data()?.deprecated === true) {
      console.log(`  · admin_settings/${key}: already deprecated`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`  ~ admin_settings/${key}: WOULD MARK deprecated:true`);
    } else {
      await ref.set(
        {
          deprecated: true,
          deprecated_at: ts(),
          deprecated_by: `system:${TALLY_ID}`,
        },
        { merge: true }
      );
      console.log(`  ~ admin_settings/${key}: marked deprecated:true`);
    }
    summary.legacy_keys_marked_deprecated.push(key);
  }

  // Step 3: audit_log.
  const auditEntry = {
    action: "ai_plane.migration",
    entity_type: "ai_workflow_routing",
    entity_id: "*",
    actor_uid: `system:${TALLY_ID}`,
    details: {
      tally_id: TALLY_ID,
      dry_run: DRY_RUN,
      legacy_provider: legacyProvider,
      legacy_provider_source: provider.source,
      legacy_model: legacyModel,
      legacy_model_source: model.source,
      summary,
    },
    timestamp: ts(),
  };
  if (DRY_RUN) {
    console.log("\nWOULD WRITE audit_log entry:");
    console.log(JSON.stringify({ ...auditEntry, timestamp: "<serverTs>" }, null, 2));
  } else {
    await db.collection("audit_log").add(auditEntry);
    console.log("\naudit_log entry written");
  }

  console.log("\n--- summary ---");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nDone. ${DRY_RUN ? "(no writes performed)" : ""}`);
}

main().catch((err) => {
  console.error("migrate-ai-plane failed:", err);
  process.exit(1);
});
