/**
 * AI Plane routes — TALLY-SETTINGS-UX Phase 3 / A.1
 *
 * Mounted at /api/v1/admin/ai (BEFORE /api/v1/admin in index.ts to win
 * Express first-match).
 *
 *   GET    /providers                    — list all providers
 *   GET    /providers/:provider_key      — single provider
 *   POST   /providers                    — create provider (409 on collision)
 *   PUT    /providers/:provider_key      — patch (models[] flat-replace)
 *   DELETE /providers/:provider_key      — deactivate (is_active=false)
 *
 *   GET    /workflows                    — list all workflow routings
 *   GET    /workflows/:workflow_key      — single workflow routing
 *   PUT    /workflows/:workflow_key      — patch with FK validation
 *
 *   POST   /test                         — XOR ping: provider_key OR workflow_key
 *
 * All endpoints require auth + admin/owner role. Every mutation writes
 * an audit_log entry via writeAiPlaneAudit.
 *
 * Return convention (per A.2 precedent): two statements —
 *   res.status(...).json(...);
 *   return;
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import {
  resolveAdapter,
  getAiConfigForWorkflow,
  DEFAULT_API_KEY_ENV_VAR,
} from "../lib/aiConfig";

const router = Router();
const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

const VALID_API_KEY_SOURCES = ["env_var", "admin_settings", "vault"];

// ── Audit helper ───────────────────────────────────────────────────────
async function writeAiPlaneAudit(
  uid: string,
  action: string,
  entity_type: string,
  entity_key: string,
  before: any,
  after: any
): Promise<void> {
  try {
    await db().collection("audit_log").add({
      action,
      entity_type,
      entity_id: entity_key,
      actor_uid: uid || "unknown",
      details: { before, after },
      timestamp: ts(),
    });
  } catch (err: any) {
    console.error("[aiPlane] audit_log write failed:", err.message);
  }
}

// ── Validation helpers ─────────────────────────────────────────────────
function validateProviderModel(m: any): string | null {
  if (!m || typeof m !== "object") return "model entry must be an object";
  if (typeof m.model_key !== "string" || !m.model_key)
    return "model.model_key required";
  if (typeof m.display_name !== "string" || !m.display_name)
    return "model.display_name required";
  if (m.is_active !== undefined && typeof m.is_active !== "boolean")
    return "model.is_active must be boolean";
  if (m.sort_order !== undefined && typeof m.sort_order !== "number")
    return "model.sort_order must be number";
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// PROVIDERS
// ────────────────────────────────────────────────────────────────────────

router.get(
  "/providers",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const snap = await db()
        .collection("ai_provider_registry")
        .orderBy("sort_order", "asc")
        .get();
      const providers = snap.docs.map((d) => ({
        provider_key: d.id,
        ...(d.data() || {}),
      }));
      res.status(200).json({ providers });
      return;
    } catch (err: any) {
      console.error("GET /admin/ai/providers error:", err);
      res.status(500).json({ error: err.message });
      return;
    }
  }
);

router.get(
  "/providers/:provider_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { provider_key } = req.params;
      const snap = await db()
        .collection("ai_provider_registry")
        .doc(provider_key)
        .get();
      if (!snap.exists) {
        res.status(404).json({ error: "Provider not found" });
        return;
      }
      res
        .status(200)
        .json({ provider: { provider_key, ...(snap.data() || {}) } });
      return;
    } catch (err: any) {
      console.error("GET /admin/ai/providers/:k error:", err);
      res.status(500).json({ error: err.message });
      return;
    }
  }
);

router.post(
  "/providers",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const body = req.body || {};
      const {
        provider_key,
        display_name,
        api_key_source,
        api_key_env_var_name,
        is_active,
        sort_order,
        models,
      } = body;

      if (typeof provider_key !== "string" || !provider_key) {
        res.status(400).json({ error: "provider_key required" });
        return;
      }
      if (typeof display_name !== "string" || !display_name) {
        res.status(400).json({ error: "display_name required" });
        return;
      }
      if (!VALID_API_KEY_SOURCES.includes(api_key_source)) {
        res.status(400).json({
          error: `api_key_source must be one of ${VALID_API_KEY_SOURCES.join(", ")}`,
        });
        return;
      }
      if (
        api_key_source === "env_var" &&
        (typeof api_key_env_var_name !== "string" || !api_key_env_var_name)
      ) {
        res.status(400).json({
          error:
            "api_key_env_var_name required when api_key_source='env_var'",
        });
        return;
      }
      if (models !== undefined) {
        if (!Array.isArray(models)) {
          res.status(400).json({ error: "models must be an array" });
          return;
        }
        for (const m of models) {
          const e = validateProviderModel(m);
          if (e) {
            res.status(400).json({ error: e });
            return;
          }
        }
      }

      const ref = db().collection("ai_provider_registry").doc(provider_key);
      const existing = await ref.get();
      if (existing.exists) {
        res.status(409).json({ error: "provider_key already exists" });
        return;
      }

      const doc: any = {
        provider_key,
        display_name,
        api_key_source,
        api_key_env_var_name: api_key_env_var_name || null,
        is_active: is_active === undefined ? true : Boolean(is_active),
        sort_order: typeof sort_order === "number" ? sort_order : 999,
        models: Array.isArray(models) ? models : [],
        created_at: ts(),
        updated_at: ts(),
      };
      await ref.set(doc);
      await writeAiPlaneAudit(
        req.user?.uid || "unknown",
        "ai_provider.create",
        "ai_provider_registry",
        provider_key,
        null,
        doc
      );
      res.status(201).json({ provider: { ...doc, provider_key } });
      return;
    } catch (err: any) {
      console.error("POST /admin/ai/providers error:", err);
      res.status(500).json({ error: err.message });
      return;
    }
  }
);

router.put(
  "/providers/:provider_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { provider_key } = req.params;
      const ref = db().collection("ai_provider_registry").doc(provider_key);
      const before = await ref.get();
      if (!before.exists) {
        res.status(404).json({ error: "Provider not found" });
        return;
      }
      const patch: any = req.body || {};
      const update: any = { updated_at: ts() };

      if (patch.display_name !== undefined) {
        if (typeof patch.display_name !== "string" || !patch.display_name) {
          res.status(400).json({ error: "display_name must be non-empty" });
          return;
        }
        update.display_name = patch.display_name;
      }
      if (patch.api_key_source !== undefined) {
        if (!VALID_API_KEY_SOURCES.includes(patch.api_key_source)) {
          res.status(400).json({
            error: `api_key_source must be one of ${VALID_API_KEY_SOURCES.join(", ")}`,
          });
          return;
        }
        update.api_key_source = patch.api_key_source;
      }
      if (patch.api_key_env_var_name !== undefined) {
        update.api_key_env_var_name = patch.api_key_env_var_name || null;
      }
      if (patch.is_active !== undefined) {
        update.is_active = Boolean(patch.is_active);
      }
      if (patch.sort_order !== undefined) {
        if (typeof patch.sort_order !== "number") {
          res.status(400).json({ error: "sort_order must be a number" });
          return;
        }
        update.sort_order = patch.sort_order;
      }
      // Per Frink §F.4: models[] is flat-replaced, not merged.
      if (patch.models !== undefined) {
        if (!Array.isArray(patch.models)) {
          res.status(400).json({ error: "models must be an array" });
          return;
        }
        for (const m of patch.models) {
          const e = validateProviderModel(m);
          if (e) {
            res.status(400).json({ error: e });
            return;
          }
        }
        update.models = patch.models;
      }

      await ref.set(update, { merge: true });
      const after = await ref.get();
      await writeAiPlaneAudit(
        req.user?.uid || "unknown",
        "ai_provider.update",
        "ai_provider_registry",
        provider_key,
        before.data() || null,
        after.data() || null
      );
      res
        .status(200)
        .json({ provider: { provider_key, ...(after.data() || {}) } });
      return;
    } catch (err: any) {
      console.error("PUT /admin/ai/providers/:k error:", err);
      res.status(500).json({ error: err.message });
      return;
    }
  }
);

// DELETE — deactivate-only (is_active=false). Never hard-delete.
router.delete(
  "/providers/:provider_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { provider_key } = req.params;
      const ref = db().collection("ai_provider_registry").doc(provider_key);
      const before = await ref.get();
      if (!before.exists) {
        res.status(404).json({ error: "Provider not found" });
        return;
      }
      await ref.set(
        { is_active: false, updated_at: ts() },
        { merge: true }
      );
      const after = await ref.get();
      await writeAiPlaneAudit(
        req.user?.uid || "unknown",
        "ai_provider.deactivate",
        "ai_provider_registry",
        provider_key,
        before.data() || null,
        after.data() || null
      );
      res.status(200).json({ ok: true, provider_key, is_active: false });
      return;
    } catch (err: any) {
      console.error("DELETE /admin/ai/providers/:k error:", err);
      res.status(500).json({ error: err.message });
      return;
    }
  }
);

// ────────────────────────────────────────────────────────────────────────
// WORKFLOWS
// ────────────────────────────────────────────────────────────────────────

router.get(
  "/workflows",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const snap = await db().collection("ai_workflow_routing").get();
      const workflows = snap.docs
        .map((d) => ({ workflow_key: d.id, ...(d.data() || {}) }))
        .sort((a: any, b: any) =>
          String(a.display_name || a.workflow_key).localeCompare(
            String(b.display_name || b.workflow_key)
          )
        );
      res.status(200).json({ workflows });
      return;
    } catch (err: any) {
      console.error("GET /admin/ai/workflows error:", err);
      res.status(500).json({ error: err.message });
      return;
    }
  }
);

router.get(
  "/workflows/:workflow_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { workflow_key } = req.params;
      const snap = await db()
        .collection("ai_workflow_routing")
        .doc(workflow_key)
        .get();
      if (!snap.exists) {
        res.status(404).json({ error: "Workflow not found" });
        return;
      }
      res
        .status(200)
        .json({ workflow: { workflow_key, ...(snap.data() || {}) } });
      return;
    } catch (err: any) {
      console.error("GET /admin/ai/workflows/:k error:", err);
      res.status(500).json({ error: err.message });
      return;
    }
  }
);

router.put(
  "/workflows/:workflow_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { workflow_key } = req.params;
      const ref = db().collection("ai_workflow_routing").doc(workflow_key);
      const before = await ref.get();
      if (!before.exists) {
        res.status(404).json({ error: "Workflow not found" });
        return;
      }
      const patch: any = req.body || {};
      const update: any = { updated_at: ts() };

      if (patch.display_name !== undefined) {
        if (typeof patch.display_name !== "string" || !patch.display_name) {
          res.status(400).json({ error: "display_name must be non-empty" });
          return;
        }
        update.display_name = patch.display_name;
      }
      if (patch.is_active !== undefined) {
        update.is_active = Boolean(patch.is_active);
      }
      if (patch.fallback_provider_key !== undefined) {
        update.fallback_provider_key = patch.fallback_provider_key || null;
      }
      if (patch.fallback_model_key !== undefined) {
        update.fallback_model_key = patch.fallback_model_key || null;
      }
      if (patch.provider_key !== undefined) {
        update.provider_key = patch.provider_key;
      }
      if (patch.model_key !== undefined) {
        update.model_key = patch.model_key;
      }

      // FK validation: provider exists+active, model in models[]+active.
      // Use effectiveProviderKey = patch.provider_key || before.provider_key.
      const beforeData: any = before.data() || {};
      const effectiveProviderKey: string =
        patch.provider_key !== undefined
          ? patch.provider_key
          : beforeData.provider_key;
      const effectiveModelKey: string =
        patch.model_key !== undefined ? patch.model_key : beforeData.model_key;

      if (effectiveProviderKey && effectiveModelKey) {
        const provSnap = await db()
          .collection("ai_provider_registry")
          .doc(effectiveProviderKey)
          .get();
        if (!provSnap.exists) {
          res
            .status(400)
            .json({ error: `provider_key '${effectiveProviderKey}' not found` });
          return;
        }
        const provData: any = provSnap.data() || {};
        if (provData.is_active === false) {
          res.status(400).json({
            error: `provider_key '${effectiveProviderKey}' is inactive`,
          });
          return;
        }
        const models: any[] = Array.isArray(provData.models)
          ? provData.models
          : [];
        const m = models.find((x) => x && x.model_key === effectiveModelKey);
        if (!m) {
          res.status(400).json({
            error: `model_key '${effectiveModelKey}' not found in provider '${effectiveProviderKey}'.models[]`,
          });
          return;
        }
        if (m.is_active === false) {
          res.status(400).json({
            error: `model_key '${effectiveModelKey}' is inactive in provider '${effectiveProviderKey}'`,
          });
          return;
        }
      }

      await ref.set(update, { merge: true });
      const after = await ref.get();
      await writeAiPlaneAudit(
        req.user?.uid || "unknown",
        "ai_workflow.update",
        "ai_workflow_routing",
        workflow_key,
        before.data() || null,
        after.data() || null
      );
      res
        .status(200)
        .json({ workflow: { workflow_key, ...(after.data() || {}) } });
      return;
    } catch (err: any) {
      console.error("PUT /admin/ai/workflows/:k error:", err);
      res.status(500).json({ error: err.message });
      return;
    }
  }
);

// ────────────────────────────────────────────────────────────────────────
// POST /test — R.3 XOR (provider_key XOR workflow_key)
// ────────────────────────────────────────────────────────────────────────
router.post(
  "/test",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const body = req.body || {};
      const provider_key: string | undefined = body.provider_key;
      const workflow_key: string | undefined = body.workflow_key;

      if (provider_key && workflow_key) {
        res.status(400).json({
          error:
            "Provide exactly one of provider_key or workflow_key (XOR), not both",
        });
        return;
      }
      if (!provider_key && !workflow_key) {
        res.status(400).json({
          error: "Provide one of provider_key or workflow_key",
        });
        return;
      }

      let resolvedProvider = "";
      let resolvedModel = "";
      let resolvedEnvVar = DEFAULT_API_KEY_ENV_VAR;

      if (provider_key) {
        const provSnap = await db()
          .collection("ai_provider_registry")
          .doc(provider_key)
          .get();
        if (!provSnap.exists) {
          res
            .status(200)
            .json({ ok: false, error: `provider '${provider_key}' not found` });
          return;
        }
        const provData: any = provSnap.data() || {};
        const models: any[] = Array.isArray(provData.models)
          ? provData.models
          : [];
        const firstActive = models.find((m) => m && m.is_active !== false);
        if (!firstActive) {
          res.status(200).json({
            ok: false,
            provider_key,
            error: "no active model in provider.models[]",
          });
          return;
        }
        resolvedProvider = provider_key;
        resolvedModel = firstActive.model_key;
        resolvedEnvVar =
          provData.api_key_env_var_name || DEFAULT_API_KEY_ENV_VAR;
      } else if (workflow_key) {
        const cfg = await getAiConfigForWorkflow(workflow_key);
        resolvedProvider = cfg.provider_key;
        resolvedModel = cfg.model_key;
        resolvedEnvVar = cfg.api_key_env_var_name;
      }

      if (resolvedProvider !== "anthropic") {
        res.status(200).json({
          ok: false,
          provider: resolvedProvider,
          model: resolvedModel,
          error: `Provider '${resolvedProvider}' test not implemented`,
        });
        return;
      }

      const apiKey = process.env[resolvedEnvVar] || "";
      if (!apiKey) {
        res.status(200).json({
          ok: false,
          provider: resolvedProvider,
          model: resolvedModel,
          error: `env var '${resolvedEnvVar}' not configured`,
        });
        return;
      }

      const adapter = await resolveAdapter(
        resolvedProvider,
        resolvedModel,
        resolvedEnvVar
      );
      try {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: resolvedModel,
            max_tokens: 8,
            messages: [{ role: "user", content: "ping" }],
          }),
        });
        if (!r.ok) {
          const text = await r.text();
          res.status(200).json({
            ok: false,
            provider: resolvedProvider,
            model: resolvedModel,
            error: `HTTP ${r.status}: ${text.slice(0, 200)}`,
          });
          return;
        }
        // Touch adapter to keep it referenced (verifies it constructed).
        void adapter;
        res
          .status(200)
          .json({ ok: true, provider: resolvedProvider, model: resolvedModel });
        return;
      } catch (e: any) {
        res.status(200).json({
          ok: false,
          provider: resolvedProvider,
          model: resolvedModel,
          error: e?.message || String(e),
        });
        return;
      }
    } catch (err: any) {
      console.error("POST /admin/ai/test error:", err);
      res.status(500).json({ error: err.message });
      return;
    }
  }
);

export default router;
