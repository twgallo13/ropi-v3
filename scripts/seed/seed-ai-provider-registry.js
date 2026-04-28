#!/usr/bin/env node
/**
 * Seed: ai_provider_registry — 3 providers
 *
 * TALLY-SETTINGS-UX Phase 3 / A.1
 *
 * Seeds anthropic (active, 4 models including legacy claude-sonnet-4-5),
 * openai (inactive), google (inactive).
 *
 * Idempotency: if the provider doc exists we set-with-merge and preserve
 * created_at; if not, we set with both created_at + updated_at.
 *
 * Usage:
 *   GCP_SA_KEY_DEV='...' node scripts/seed/seed-ai-provider-registry.js
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "ai_provider_registry";

const PROVIDERS = [
  {
    provider_key: "anthropic",
    display_name: "Anthropic",
    api_key_source: "env_var",
    api_key_env_var_name: "ANTHROPIC_API_KEY",
    is_active: true,
    sort_order: 10,
    models: [
      {
        model_key: "claude-opus-4-7",
        display_name: "Claude Opus 4.7",
        is_active: true,
        sort_order: 1,
      },
      {
        model_key: "claude-sonnet-4-6",
        display_name: "Claude Sonnet 4.6",
        is_active: true,
        sort_order: 2,
      },
      {
        // R.5: legacy model retained so existing routings keep resolving
        // through the migration window.
        model_key: "claude-sonnet-4-5",
        display_name: "Claude Sonnet 4.5 (legacy)",
        is_active: true,
        sort_order: 3,
      },
      {
        model_key: "claude-haiku-4-5",
        display_name: "Claude Haiku 4.5",
        is_active: true,
        sort_order: 4,
      },
    ],
  },
  {
    provider_key: "openai",
    display_name: "OpenAI",
    api_key_source: "env_var",
    api_key_env_var_name: "OPENAI_API_KEY",
    is_active: false,
    sort_order: 20,
    models: [],
  },
  {
    provider_key: "google",
    display_name: "Google (Gemini)",
    api_key_source: "env_var",
    api_key_env_var_name: "GOOGLE_API_KEY",
    is_active: false,
    sort_order: 30,
    models: [],
  },
];

async function main() {
  initApp();
  const db = admin.firestore();
  const ts = () => admin.firestore.FieldValue.serverTimestamp();

  let created = 0;
  let updated = 0;

  for (const p of PROVIDERS) {
    const ref = db.collection(COLLECTION).doc(p.provider_key);
    const snap = await ref.get();
    if (snap.exists) {
      // Preserve created_at; refresh updated_at + payload.
      const { provider_key, ...rest } = p;
      await ref.set({ ...rest, provider_key, updated_at: ts() }, { merge: true });
      console.log(`  · updated ${p.provider_key}`);
      updated++;
    } else {
      await ref.set({ ...p, created_at: ts(), updated_at: ts() });
      console.log(`  + created ${p.provider_key}`);
      created++;
    }
  }

  console.log(`\nDone. created=${created} updated=${updated}`);
}

main().catch((err) => {
  console.error("seed-ai-provider-registry failed:", err);
  process.exit(1);
});
