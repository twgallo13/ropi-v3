#!/usr/bin/env node
/**
 * Seed: ai_workflow_routing — 9 workflows
 *
 * TALLY-SETTINGS-UX Phase 3 / A.1
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ MIGRATION ORDER WARNING (S.4)                                    │
 * │                                                                  │
 * │ For environments that already had legacy admin_settings keys     │
 * │ (active_ai_provider / active_ai_model), the migration script     │
 * │ scripts/migrate-ai-plane.js must run BEFORE this seed so the     │
 * │ legacy values can be promoted into per-workflow routing docs     │
 * │ (R.5 override-with-legacy). Running this seed first will plant   │
 * │ defaults (anthropic + claude-opus-4-7) and the migration's       │
 * │ "create-if-missing" branch will then NOT overwrite them — the    │
 * │ legacy preference is silently lost.                              │
 * │                                                                  │
 * │ Correct order on existing dev/prod:                              │
 * │   1. node scripts/seed/seed-ai-provider-registry.js              │
 * │   2. node scripts/migrate-ai-plane.js --dry-run                  │
 * │   3. node scripts/migrate-ai-plane.js  (after PO greenlight)     │
 * │   4. node scripts/seed/seed-ai-workflow-routing.js  (fills gaps) │
 * │                                                                  │
 * │ For a fresh environment with no legacy keys, run this seed       │
 * │ alongside seed-ai-provider-registry.js in any order.             │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Idempotency: set-with-merge; preserves created_at on existing docs.
 *
 * Usage:
 *   GCP_SA_KEY_DEV='...' node scripts/seed/seed-ai-workflow-routing.js
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "ai_workflow_routing";

const WORKFLOWS = [
  {
    workflow_key: "content_generation",
    display_name: "Content Generation",
    description:
      "AI Describe Engine — generates product descriptions from attributes (TALLY-042)",
  },
  {
    workflow_key: "content_review_regeneration",
    display_name: "Content Review / Regeneration",
    description:
      "Regenerate action on Full Review; re-runs content generation with critique context (TALLY-046)",
  },
  {
    workflow_key: "ai_assistant_chat",
    display_name: "AI Assistant — Chat",
    description: "Conversational helper in Product Editor (text-only)",
  },
  {
    workflow_key: "ai_assistant_vision",
    display_name: "AI Assistant — Vision",
    description:
      "Product photo analysis in Product Editor (image input) (TALLY-049)",
  },
  {
    workflow_key: "smart_rule_inference",
    display_name: "Smart Rule Inference",
    description:
      "Type 2 pattern-based attribute inference from product context (TALLY-047). Pre-provisioned; no consumer at A.1 ship.",
  },
  {
    workflow_key: "weekly_advisory_report",
    display_name: "Weekly Advisory Report",
    description:
      "AI Portfolio Health Advisory — weekly buyer + global rollup reports (TALLY-092)",
  },
  {
    workflow_key: "anomaly_detection",
    display_name: "Anomaly Detection",
    description:
      "Outlier pricing / inventory anomaly identification (TALLY-092). Pre-provisioned; no consumer at A.1 ship.",
  },
  {
    workflow_key: "ai_enrichment_name",
    display_name: "AI Enrichment — Product Name",
    description:
      "AI-enriched product name suggestions (POST /api/v1/ai-enrich/name/:mpn)",
  },
  {
    workflow_key: "ai_enrichment_color",
    display_name: "AI Enrichment — Descriptive Color",
    description:
      "AI-enriched product color suggestions (POST /api/v1/ai-enrich/color/:mpn)",
  },
];

const DEFAULT_PROVIDER_KEY = "anthropic";
const DEFAULT_MODEL_KEY = "claude-opus-4-7";

async function main() {
  initApp();
  const db = admin.firestore();
  const ts = () => admin.firestore.FieldValue.serverTimestamp();

  let created = 0;
  let updated = 0;

  for (const w of WORKFLOWS) {
    const ref = db.collection(COLLECTION).doc(w.workflow_key);
    const snap = await ref.get();
    const payload = {
      workflow_key: w.workflow_key,
      display_name: w.display_name,
      description: w.description,
      provider_key: DEFAULT_PROVIDER_KEY,
      model_key: DEFAULT_MODEL_KEY,
      fallback_provider_key: null,
      fallback_model_key: null,
      is_active: true,
      updated_at: ts(),
    };
    if (snap.exists) {
      // Preserve provider_key/model_key on existing docs (don't clobber
      // an admin-tuned routing). Only fill missing fields.
      const existing = snap.data() || {};
      const merged = {
        workflow_key: w.workflow_key,
        display_name: w.display_name, // seed wins for display metadata; D.11 fix
        description: w.description, // seed wins for display metadata; D.11 fix
        provider_key: existing.provider_key || DEFAULT_PROVIDER_KEY,
        model_key: existing.model_key || DEFAULT_MODEL_KEY,
        fallback_provider_key:
          existing.fallback_provider_key === undefined
            ? null
            : existing.fallback_provider_key,
        fallback_model_key:
          existing.fallback_model_key === undefined
            ? null
            : existing.fallback_model_key,
        is_active: existing.is_active === undefined ? true : existing.is_active,
        updated_at: ts(),
      };
      await ref.set(merged, { merge: true });
      console.log(`  · updated ${w.workflow_key}`);
      updated++;
    } else {
      await ref.set({ ...payload, created_at: ts() });
      console.log(`  + created ${w.workflow_key}`);
      created++;
    }
  }

  console.log(`\nDone. created=${created} updated=${updated}`);
}

main().catch((err) => {
  console.error("seed-ai-workflow-routing failed:", err);
  process.exit(1);
});
