/**
 * Feature Toggles — TALLY-SETTINGS-UX Phase 3 / A.3 PR2.
 *
 * Admin CRUD for the `feature_toggles` collection. Doc-id is `toggle_key`.
 *
 * E.4: schema does NOT include a redundant `last_modified_by` field. The
 * canonical A.2 `updated_by` is the single "who last modified" field.
 *
 * Cache: every successful write (POST/PUT/DELETE) calls
 * `clearFeatureToggleCache()` from PR 1's lib module so admin UI changes
 * propagate within < 60s ceiling rather than waiting for TTL expiry.
 * Reads from THIS admin router go through Firestore directly (admin path);
 * runtime callers use `isFeatureEnabled()` from PR 1's lib module.
 *
 *   GET    /api/v1/admin/feature-toggles
 *   GET    /api/v1/admin/feature-toggles/:key
 *   POST   /api/v1/admin/feature-toggles
 *   PUT    /api/v1/admin/feature-toggles/:key
 *   DELETE /api/v1/admin/feature-toggles/:key   (soft disable: is_enabled=false)
 *
 * Mirrors the A.2 siteRegistry.ts canonical CRUD pattern.
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { clearFeatureToggleCache } from "../lib/featureToggleCache";

const router = Router();
const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

async function writeFeatureToggleAudit(
  action: string,
  entityId: string,
  actorUid: string,
  details: Record<string, any>
): Promise<void> {
  try {
    await db().collection("audit_log").add({
      action,
      entity_type: "feature_toggles",
      entity_id: entityId,
      actor_uid: actorUid,
      details,
      timestamp: ts(),
    });
  } catch (err: any) {
    console.error("audit_log write failed:", err.message);
  }
}

router.get(
  "/",
  requireAuth,
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const snap = await db().collection("feature_toggles").get();
      const toggles = snap.docs.map((d) => d.data());
      res.json({ toggles });
    } catch (err: any) {
      console.error("GET /admin/feature-toggles error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  "/:toggle_key",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pathKey = req.params.toggle_key;
      const snap = await db().collection("feature_toggles").doc(pathKey).get();
      if (!snap.exists) {
        res.status(404).json({ error: `toggle "${pathKey}" not found` });
        return;
      }
      res.json({ toggle: snap.data() });
    } catch (err: any) {
      console.error("GET /admin/feature-toggles/:key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.post(
  "/",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body || {};
      const { toggle_key, display_label, is_enabled, description } = body;

      if (typeof toggle_key !== "string" || toggle_key.trim() === "") {
        res.status(400).json({ error: "toggle_key is required (non-empty string)" });
        return;
      }
      if (typeof display_label !== "string" || display_label.trim() === "") {
        res.status(400).json({ error: "display_label is required (non-empty string)" });
        return;
      }
      if (typeof is_enabled !== "boolean") {
        res.status(400).json({ error: "is_enabled is required (boolean)" });
        return;
      }
      if (typeof description !== "string") {
        res.status(400).json({ error: "description is required (string)" });
        return;
      }

      const key = toggle_key.trim();
      const ref = db().collection("feature_toggles").doc(key);
      const existing = await ref.get();
      if (existing.exists) {
        res.status(409).json({ error: "toggle_key already exists" });
        return;
      }

      const payload: Record<string, any> = {
        toggle_key: key,
        display_label: display_label.trim(),
        is_enabled,
        description,
        created_at: ts(),
        created_by: req.user!.uid,
        updated_at: ts(),
        updated_by: req.user!.uid,
      };
      await ref.set(payload);

      // Invalidate the 60s TTL cache so runtime isFeatureEnabled() picks
      // up the new toggle on next read.
      clearFeatureToggleCache();

      await writeFeatureToggleAudit("feature_toggle_created", key, req.user!.uid, {
        before: null,
        after: payload,
      });

      const refetched = (await ref.get()).data();
      res.status(201).json({ toggle: refetched });
    } catch (err: any) {
      console.error("POST /admin/feature-toggles error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.put(
  "/:toggle_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body || {};
      const pathKey = req.params.toggle_key;

      if (body.toggle_key !== undefined && body.toggle_key !== pathKey) {
        res.status(400).json({ error: "toggle_key is immutable" });
        return;
      }
      if (body.display_label !== undefined) {
        if (typeof body.display_label !== "string" || body.display_label.trim() === "") {
          res.status(400).json({ error: "display_label must be a non-empty string" });
          return;
        }
      }
      if (body.is_enabled !== undefined && typeof body.is_enabled !== "boolean") {
        res.status(400).json({ error: "is_enabled must be a boolean" });
        return;
      }
      if (body.description !== undefined && typeof body.description !== "string") {
        res.status(400).json({ error: "description must be a string" });
        return;
      }

      const ref = db().collection("feature_toggles").doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `toggle "${pathKey}" not found` });
        return;
      }
      const beforeData = existing.data() || {};

      const patch: Record<string, any> = {};
      if (body.display_label !== undefined) patch.display_label = body.display_label.trim();
      if (body.is_enabled !== undefined) patch.is_enabled = body.is_enabled;
      if (body.description !== undefined) patch.description = body.description;
      patch.updated_at = ts();
      patch.updated_by = req.user!.uid;

      await ref.set(patch, { merge: true });

      clearFeatureToggleCache();

      const refetched = (await ref.get()).data();
      await writeFeatureToggleAudit("feature_toggle_updated", pathKey, req.user!.uid, {
        before: beforeData,
        after: refetched,
        patch_keys: Object.keys(patch),
      });

      res.status(200).json({ toggle: refetched });
    } catch (err: any) {
      console.error("PUT /admin/feature-toggles/:key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.delete(
  "/:toggle_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pathKey = req.params.toggle_key;
      const ref = db().collection("feature_toggles").doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `toggle "${pathKey}" not found` });
        return;
      }
      const beforeData = existing.data() || {};

      // Soft disable — set is_enabled=false (no is_active field on this schema).
      await ref.set(
        {
          is_enabled: false,
          updated_at: ts(),
          updated_by: req.user!.uid,
        },
        { merge: true }
      );

      clearFeatureToggleCache();

      const refetched = (await ref.get()).data();
      await writeFeatureToggleAudit("feature_toggle_deleted", pathKey, req.user!.uid, {
        before: beforeData,
        after: refetched,
      });

      res.status(200).json({ toggle: refetched });
    } catch (err: any) {
      console.error("DELETE /admin/feature-toggles/:key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
