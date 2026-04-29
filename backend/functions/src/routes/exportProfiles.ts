/**
 * Export Profiles — TALLY-SETTINGS-UX Phase 3 / A.3 PR2.
 *
 * Admin CRUD for the `export_profiles` collection. Doc-id is `profile_key`.
 * Seeded fresh per ruling R.2.
 *
 *   GET    /api/v1/admin/export-profiles
 *   GET    /api/v1/admin/export-profiles/:key
 *   POST   /api/v1/admin/export-profiles
 *   PUT    /api/v1/admin/export-profiles/:key
 *   DELETE /api/v1/admin/export-profiles/:key   (soft deactivation)
 *
 * Mirrors the A.2 siteRegistry.ts canonical CRUD pattern.
 *
 * ⚠️ E.5: filter_query is metadata only in A.3; NOT evaluated as Firestore
 * query string. A.4+ replace with structured query object.
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";

const router = Router();
const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

const ALLOWED_FORMATS = ["csv", "json", "xml"] as const;
type ExportFormat = (typeof ALLOWED_FORMATS)[number];

function validateFieldMap(fm: any): string | null {
  if (!Array.isArray(fm)) return "field_map must be an array";
  for (let i = 0; i < fm.length; i++) {
    const entry = fm[i];
    if (!entry || typeof entry !== "object") {
      return `field_map[${i}] must be an object`;
    }
    if (typeof entry.source_field !== "string" || entry.source_field.trim() === "") {
      return `field_map[${i}].source_field must be a non-empty string`;
    }
    if (typeof entry.target_field !== "string" || entry.target_field.trim() === "") {
      return `field_map[${i}].target_field must be a non-empty string`;
    }
    if (entry.transform !== undefined && typeof entry.transform !== "string") {
      return `field_map[${i}].transform must be a string when present`;
    }
  }
  return null;
}

async function writeExportProfileAudit(
  action: string,
  entityId: string,
  actorUid: string,
  details: Record<string, any>
): Promise<void> {
  try {
    await db().collection("audit_log").add({
      action,
      entity_type: "export_profiles",
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
      const snap = await db().collection("export_profiles").get();
      const profiles = snap.docs.map((d) => d.data());
      res.json({ profiles });
    } catch (err: any) {
      console.error("GET /admin/export-profiles error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  "/:profile_key",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pathKey = req.params.profile_key;
      const snap = await db().collection("export_profiles").doc(pathKey).get();
      if (!snap.exists) {
        res.status(404).json({ error: `profile "${pathKey}" not found` });
        return;
      }
      res.json({ profile: snap.data() });
    } catch (err: any) {
      console.error("GET /admin/export-profiles/:key error:", err);
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
      const { profile_key, display_label, description, target_format, field_map, filter_query } = body;

      if (typeof profile_key !== "string" || profile_key.trim() === "") {
        res.status(400).json({ error: "profile_key is required (non-empty string)" });
        return;
      }
      if (typeof display_label !== "string" || display_label.trim() === "") {
        res.status(400).json({ error: "display_label is required (non-empty string)" });
        return;
      }
      if (typeof description !== "string") {
        res.status(400).json({ error: "description is required (string)" });
        return;
      }
      if (!ALLOWED_FORMATS.includes(target_format as ExportFormat)) {
        res.status(400).json({ error: `target_format must be one of: ${ALLOWED_FORMATS.join(", ")}` });
        return;
      }
      const fmErr = validateFieldMap(field_map);
      if (fmErr) {
        res.status(400).json({ error: fmErr });
        return;
      }
      // filter_query is metadata only in A.3; NOT evaluated as Firestore query string.
      // A.4+ replace with structured query object before any execution path is added.
      if (typeof filter_query !== "string") {
        res.status(400).json({ error: "filter_query is required (string)" });
        return;
      }

      const key = profile_key.trim();
      const ref = db().collection("export_profiles").doc(key);
      const existing = await ref.get();
      if (existing.exists) {
        res.status(409).json({ error: "profile_key already exists" });
        return;
      }

      const payload: Record<string, any> = {
        profile_key: key,
        display_label: display_label.trim(),
        description,
        target_format,
        field_map,
        filter_query,
        is_active: typeof body.is_active === "boolean" ? body.is_active : true,
        created_at: ts(),
        created_by: req.user!.uid,
        updated_at: ts(),
        updated_by: req.user!.uid,
      };
      await ref.set(payload);

      await writeExportProfileAudit("export_profile_created", key, req.user!.uid, {
        before: null,
        after: payload,
      });

      const refetched = (await ref.get()).data();
      res.status(201).json({ profile: refetched });
    } catch (err: any) {
      console.error("POST /admin/export-profiles error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.put(
  "/:profile_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body || {};
      const pathKey = req.params.profile_key;

      if (body.profile_key !== undefined && body.profile_key !== pathKey) {
        res.status(400).json({ error: "profile_key is immutable" });
        return;
      }
      if (body.display_label !== undefined) {
        if (typeof body.display_label !== "string" || body.display_label.trim() === "") {
          res.status(400).json({ error: "display_label must be a non-empty string" });
          return;
        }
      }
      if (body.description !== undefined && typeof body.description !== "string") {
        res.status(400).json({ error: "description must be a string" });
        return;
      }
      if (body.target_format !== undefined && !ALLOWED_FORMATS.includes(body.target_format)) {
        res.status(400).json({ error: `target_format must be one of: ${ALLOWED_FORMATS.join(", ")}` });
        return;
      }
      if (body.field_map !== undefined) {
        const fmErr = validateFieldMap(body.field_map);
        if (fmErr) {
          res.status(400).json({ error: fmErr });
          return;
        }
      }
      // filter_query is metadata only in A.3; NOT evaluated as Firestore query string.
      if (body.filter_query !== undefined && typeof body.filter_query !== "string") {
        res.status(400).json({ error: "filter_query must be a string" });
        return;
      }

      const ref = db().collection("export_profiles").doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `profile "${pathKey}" not found` });
        return;
      }
      const beforeData = existing.data() || {};

      const patch: Record<string, any> = {};
      if (body.display_label !== undefined) patch.display_label = body.display_label.trim();
      if (body.description !== undefined) patch.description = body.description;
      if (body.target_format !== undefined) patch.target_format = body.target_format;
      if (body.field_map !== undefined) patch.field_map = body.field_map;
      if (body.filter_query !== undefined) patch.filter_query = body.filter_query;
      if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
      patch.updated_at = ts();
      patch.updated_by = req.user!.uid;

      await ref.set(patch, { merge: true });

      const refetched = (await ref.get()).data();
      await writeExportProfileAudit("export_profile_updated", pathKey, req.user!.uid, {
        before: beforeData,
        after: refetched,
        patch_keys: Object.keys(patch),
      });

      res.status(200).json({ profile: refetched });
    } catch (err: any) {
      console.error("PUT /admin/export-profiles/:key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.delete(
  "/:profile_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pathKey = req.params.profile_key;
      const ref = db().collection("export_profiles").doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `profile "${pathKey}" not found` });
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
      await writeExportProfileAudit("export_profile_deleted", pathKey, req.user!.uid, {
        before: beforeData,
        after: refetched,
      });

      res.status(200).json({ profile: refetched });
    } catch (err: any) {
      console.error("DELETE /admin/export-profiles/:key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
