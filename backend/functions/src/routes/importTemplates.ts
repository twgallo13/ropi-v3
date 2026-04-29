/**
 * Import Templates — TALLY-SETTINGS-UX Phase 3 / A.3 PR2.
 *
 * Admin CRUD for the `import_templates` collection. Doc-id is `template_key`.
 *
 *   GET    /api/v1/admin/import-templates           → { templates: [...] }
 *   GET    /api/v1/admin/import-templates/:key      → { template: ... }
 *   POST   /api/v1/admin/import-templates           → 201 { template: ... }
 *   PUT    /api/v1/admin/import-templates/:key      → 200 { template: ... }
 *   DELETE /api/v1/admin/import-templates/:key      → 200 { template: ... } (soft deactivation)
 *
 * Mirrors the A.2 siteRegistry.ts canonical CRUD pattern. Audit writes use
 * the canonical D.10 shape with `{before, after}` details.
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";

const router = Router();
const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

async function writeImportTemplateAudit(
  action: string,
  entityId: string,
  actorUid: string,
  details: Record<string, any>
): Promise<void> {
  try {
    await db().collection("audit_log").add({
      action,
      entity_type: "import_templates",
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
      const snap = await db().collection("import_templates").get();
      const templates = snap.docs.map((d) => d.data());
      res.json({ templates });
    } catch (err: any) {
      console.error("GET /admin/import-templates error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  "/:template_key",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pathKey = req.params.template_key;
      const snap = await db().collection("import_templates").doc(pathKey).get();
      if (!snap.exists) {
        res.status(404).json({ error: `template "${pathKey}" not found` });
        return;
      }
      res.json({ template: snap.data() });
    } catch (err: any) {
      console.error("GET /admin/import-templates/:key error:", err);
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
      const { template_key, display_label, description, target_collection, schema_json } = body;

      if (typeof template_key !== "string" || template_key.trim() === "") {
        res.status(400).json({ error: "template_key is required (non-empty string)" });
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
      if (typeof target_collection !== "string" || target_collection.trim() === "") {
        res.status(400).json({ error: "target_collection is required (non-empty string)" });
        return;
      }
      if (schema_json === null || typeof schema_json !== "object" || Array.isArray(schema_json)) {
        res.status(400).json({ error: "schema_json is required (object)" });
        return;
      }

      const key = template_key.trim();
      const ref = db().collection("import_templates").doc(key);
      const existing = await ref.get();
      if (existing.exists) {
        res.status(409).json({ error: "template_key already exists" });
        return;
      }

      const payload: Record<string, any> = {
        template_key: key,
        display_label: display_label.trim(),
        description,
        target_collection: target_collection.trim(),
        schema_json,
        is_active: typeof body.is_active === "boolean" ? body.is_active : true,
        created_at: ts(),
        created_by: req.user!.uid,
        updated_at: ts(),
        updated_by: req.user!.uid,
      };
      await ref.set(payload);

      await writeImportTemplateAudit("import_template_created", key, req.user!.uid, {
        before: null,
        after: payload,
      });

      const refetched = (await ref.get()).data();
      res.status(201).json({ template: refetched });
    } catch (err: any) {
      console.error("POST /admin/import-templates error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.put(
  "/:template_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body || {};
      const pathKey = req.params.template_key;

      if (body.template_key !== undefined && body.template_key !== pathKey) {
        res.status(400).json({ error: "template_key is immutable" });
        return;
      }
      if (body.display_label !== undefined) {
        if (typeof body.display_label !== "string" || body.display_label.trim() === "") {
          res.status(400).json({ error: "display_label must be a non-empty string" });
          return;
        }
      }
      if (body.target_collection !== undefined) {
        if (typeof body.target_collection !== "string" || body.target_collection.trim() === "") {
          res.status(400).json({ error: "target_collection must be a non-empty string" });
          return;
        }
      }
      if (body.schema_json !== undefined) {
        if (body.schema_json === null || typeof body.schema_json !== "object" || Array.isArray(body.schema_json)) {
          res.status(400).json({ error: "schema_json must be an object" });
          return;
        }
      }

      const ref = db().collection("import_templates").doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `template "${pathKey}" not found` });
        return;
      }
      const beforeData = existing.data() || {};

      const patch: Record<string, any> = {};
      if (body.display_label !== undefined) patch.display_label = body.display_label.trim();
      if (body.description !== undefined) patch.description = body.description;
      if (body.target_collection !== undefined) patch.target_collection = body.target_collection.trim();
      if (body.schema_json !== undefined) patch.schema_json = body.schema_json;
      if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
      patch.updated_at = ts();
      patch.updated_by = req.user!.uid;

      await ref.set(patch, { merge: true });

      const refetched = (await ref.get()).data();
      await writeImportTemplateAudit("import_template_updated", pathKey, req.user!.uid, {
        before: beforeData,
        after: refetched,
        patch_keys: Object.keys(patch),
      });

      res.status(200).json({ template: refetched });
    } catch (err: any) {
      console.error("PUT /admin/import-templates/:key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.delete(
  "/:template_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pathKey = req.params.template_key;
      const ref = db().collection("import_templates").doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `template "${pathKey}" not found` });
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
      await writeImportTemplateAudit("import_template_deleted", pathKey, req.user!.uid, {
        before: beforeData,
        after: refetched,
      });

      res.status(200).json({ template: refetched });
    } catch (err: any) {
      console.error("DELETE /admin/import-templates/:key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
