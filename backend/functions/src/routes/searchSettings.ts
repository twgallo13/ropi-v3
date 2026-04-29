/**
 * Search Settings — TALLY-SETTINGS-UX Phase 3 / A.3 PR2.
 *
 * Admin CRUD for the `search_settings` collection. Doc-id is `setting_key`.
 *
 * ⚠️ ADMIN-UI-ONLY METADATA per C.3 / Frink check-item #8:
 * `buildSearchTokens` (BE archaeology §2.4) is NOT modified by this router.
 * All write audit entries include `runtime_effect: "none"` to make the
 * no-runtime-touch contract explicit in the audit_log.
 *
 *   GET    /api/v1/admin/search-settings
 *   GET    /api/v1/admin/search-settings/:key
 *   POST   /api/v1/admin/search-settings
 *   PUT    /api/v1/admin/search-settings/:key
 *   DELETE /api/v1/admin/search-settings/:key   (soft deactivation)
 *
 * Mirrors the A.2 siteRegistry.ts canonical CRUD pattern.
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";

const router = Router();
const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

const ALLOWED_VALUE_TYPES = ["string", "number", "boolean"] as const;
type SearchValueType = (typeof ALLOWED_VALUE_TYPES)[number];

function validateValueAgainstType(value: any, valueType: SearchValueType): string | null {
  if (valueType === "string" && typeof value !== "string") return "value must be a string when value_type=string";
  if (valueType === "number" && typeof value !== "number") return "value must be a number when value_type=number";
  if (valueType === "boolean" && typeof value !== "boolean") return "value must be a boolean when value_type=boolean";
  return null;
}

async function writeSearchSettingAudit(
  action: string,
  entityId: string,
  actorUid: string,
  details: Record<string, any>
): Promise<void> {
  try {
    await db().collection("audit_log").add({
      action,
      entity_type: "search_settings",
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
      const snap = await db().collection("search_settings").get();
      const settings = snap.docs.map((d) => d.data());
      res.json({ settings });
    } catch (err: any) {
      console.error("GET /admin/search-settings error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  "/:setting_key",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pathKey = req.params.setting_key;
      const snap = await db().collection("search_settings").doc(pathKey).get();
      if (!snap.exists) {
        res.status(404).json({ error: `setting "${pathKey}" not found` });
        return;
      }
      res.json({ setting: snap.data() });
    } catch (err: any) {
      console.error("GET /admin/search-settings/:key error:", err);
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
      const { setting_key, display_label, value, value_type, description } = body;

      if (typeof setting_key !== "string" || setting_key.trim() === "") {
        res.status(400).json({ error: "setting_key is required (non-empty string)" });
        return;
      }
      if (typeof display_label !== "string" || display_label.trim() === "") {
        res.status(400).json({ error: "display_label is required (non-empty string)" });
        return;
      }
      if (!ALLOWED_VALUE_TYPES.includes(value_type)) {
        res.status(400).json({ error: `value_type must be one of: ${ALLOWED_VALUE_TYPES.join(", ")}` });
        return;
      }
      const valErr = validateValueAgainstType(value, value_type);
      if (valErr) {
        res.status(400).json({ error: valErr });
        return;
      }
      if (typeof description !== "string") {
        res.status(400).json({ error: "description is required (string)" });
        return;
      }

      const key = setting_key.trim();
      const ref = db().collection("search_settings").doc(key);
      const existing = await ref.get();
      if (existing.exists) {
        res.status(409).json({ error: "setting_key already exists" });
        return;
      }

      const payload: Record<string, any> = {
        setting_key: key,
        display_label: display_label.trim(),
        value,
        value_type,
        description,
        is_active: typeof body.is_active === "boolean" ? body.is_active : true,
        created_at: ts(),
        created_by: req.user!.uid,
        updated_at: ts(),
        updated_by: req.user!.uid,
      };
      await ref.set(payload);

      await writeSearchSettingAudit("search_setting_created", key, req.user!.uid, {
        before: null,
        after: payload,
        runtime_effect: "none",
      });

      const refetched = (await ref.get()).data();
      res.status(201).json({ setting: refetched });
    } catch (err: any) {
      console.error("POST /admin/search-settings error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.put(
  "/:setting_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body || {};
      const pathKey = req.params.setting_key;

      if (body.setting_key !== undefined && body.setting_key !== pathKey) {
        res.status(400).json({ error: "setting_key is immutable" });
        return;
      }

      const ref = db().collection("search_settings").doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `setting "${pathKey}" not found` });
        return;
      }
      const beforeData = existing.data() || {};

      const effectiveValueType: SearchValueType =
        body.value_type !== undefined ? body.value_type : beforeData.value_type;

      if (body.value_type !== undefined && !ALLOWED_VALUE_TYPES.includes(body.value_type)) {
        res.status(400).json({ error: `value_type must be one of: ${ALLOWED_VALUE_TYPES.join(", ")}` });
        return;
      }
      if (body.value !== undefined) {
        const valErr = validateValueAgainstType(body.value, effectiveValueType);
        if (valErr) {
          res.status(400).json({ error: valErr });
          return;
        }
      }
      if (body.display_label !== undefined) {
        if (typeof body.display_label !== "string" || body.display_label.trim() === "") {
          res.status(400).json({ error: "display_label must be a non-empty string" });
          return;
        }
      }

      const patch: Record<string, any> = {};
      if (body.display_label !== undefined) patch.display_label = body.display_label.trim();
      if (body.value !== undefined) patch.value = body.value;
      if (body.value_type !== undefined) patch.value_type = body.value_type;
      if (body.description !== undefined) patch.description = body.description;
      if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
      patch.updated_at = ts();
      patch.updated_by = req.user!.uid;

      await ref.set(patch, { merge: true });

      const refetched = (await ref.get()).data();
      await writeSearchSettingAudit("search_setting_updated", pathKey, req.user!.uid, {
        before: beforeData,
        after: refetched,
        patch_keys: Object.keys(patch),
        runtime_effect: "none",
      });

      res.status(200).json({ setting: refetched });
    } catch (err: any) {
      console.error("PUT /admin/search-settings/:key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.delete(
  "/:setting_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pathKey = req.params.setting_key;
      const ref = db().collection("search_settings").doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `setting "${pathKey}" not found` });
        return;
      }
      const beforeData = existing.data() || {};

      await ref.set(
        {
          is_active: false,
          updated_at: ts(),
          updated_by: req.user!.uid,
        },
        { merge: true }
      );

      const refetched = (await ref.get()).data();
      await writeSearchSettingAudit("search_setting_deleted", pathKey, req.user!.uid, {
        before: beforeData,
        after: refetched,
        runtime_effect: "none",
      });

      res.status(200).json({ setting: refetched });
    } catch (err: any) {
      console.error("DELETE /admin/search-settings/:key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
