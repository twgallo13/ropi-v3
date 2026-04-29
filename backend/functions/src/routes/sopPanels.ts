/**
 * SOP Panels — TALLY-SETTINGS-UX Phase 3 / A.3 PR2.
 *
 * Admin CRUD for the `sop_panels` collection. Doc-id is `panel_key`.
 * `hub` enum reuses the 5 values locked in D.1 (matches guided_tours).
 *
 *   GET    /api/v1/admin/sop-panels
 *   GET    /api/v1/admin/sop-panels/:key
 *   POST   /api/v1/admin/sop-panels
 *   PUT    /api/v1/admin/sop-panels/:key
 *   DELETE /api/v1/admin/sop-panels/:key   (soft deactivation)
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

const ALLOWED_HUBS = [
  "import_hub",
  "completion_queue",
  "cadence_review",
  "launch_admin",
  "export_center",
] as const;

async function writeSopPanelAudit(
  action: string,
  entityId: string,
  actorUid: string,
  details: Record<string, any>
): Promise<void> {
  try {
    await db().collection("audit_log").add({
      action,
      entity_type: "sop_panels",
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
      const snap = await db().collection("sop_panels").get();
      const panels = snap.docs.map((d) => d.data());
      res.json({ panels });
    } catch (err: any) {
      console.error("GET /admin/sop-panels error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  "/:panel_key",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pathKey = req.params.panel_key;
      const snap = await db().collection("sop_panels").doc(pathKey).get();
      if (!snap.exists) {
        res.status(404).json({ error: `panel "${pathKey}" not found` });
        return;
      }
      res.json({ panel: snap.data() });
    } catch (err: any) {
      console.error("GET /admin/sop-panels/:key error:", err);
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
      const { panel_key, hub, title, content_md, sort_order } = body;

      if (typeof panel_key !== "string" || panel_key.trim() === "") {
        res.status(400).json({ error: "panel_key is required (non-empty string)" });
        return;
      }
      if (!ALLOWED_HUBS.includes(hub)) {
        res.status(400).json({ error: `hub must be one of: ${ALLOWED_HUBS.join(", ")}` });
        return;
      }
      if (typeof title !== "string" || title.trim() === "") {
        res.status(400).json({ error: "title is required (non-empty string)" });
        return;
      }
      if (typeof content_md !== "string") {
        res.status(400).json({ error: "content_md is required (string)" });
        return;
      }
      if (typeof sort_order !== "number") {
        res.status(400).json({ error: "sort_order is required (number)" });
        return;
      }

      const key = panel_key.trim();
      const ref = db().collection("sop_panels").doc(key);
      const existing = await ref.get();
      if (existing.exists) {
        res.status(409).json({ error: "panel_key already exists" });
        return;
      }

      const payload: Record<string, any> = {
        panel_key: key,
        hub,
        title: title.trim(),
        content_md,
        sort_order,
        is_active: typeof body.is_active === "boolean" ? body.is_active : true,
        created_at: ts(),
        created_by: req.user!.uid,
        updated_at: ts(),
        updated_by: req.user!.uid,
      };
      await ref.set(payload);

      await writeSopPanelAudit("sop_panel_created", key, req.user!.uid, {
        before: null,
        after: payload,
      });

      const refetched = (await ref.get()).data();
      res.status(201).json({ panel: refetched });
    } catch (err: any) {
      console.error("POST /admin/sop-panels error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.put(
  "/:panel_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body || {};
      const pathKey = req.params.panel_key;

      if (body.panel_key !== undefined && body.panel_key !== pathKey) {
        res.status(400).json({ error: "panel_key is immutable" });
        return;
      }
      if (body.hub !== undefined && !ALLOWED_HUBS.includes(body.hub)) {
        res.status(400).json({ error: `hub must be one of: ${ALLOWED_HUBS.join(", ")}` });
        return;
      }
      if (body.title !== undefined) {
        if (typeof body.title !== "string" || body.title.trim() === "") {
          res.status(400).json({ error: "title must be a non-empty string" });
          return;
        }
      }
      if (body.content_md !== undefined && typeof body.content_md !== "string") {
        res.status(400).json({ error: "content_md must be a string" });
        return;
      }
      if (body.sort_order !== undefined && typeof body.sort_order !== "number") {
        res.status(400).json({ error: "sort_order must be a number" });
        return;
      }

      const ref = db().collection("sop_panels").doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `panel "${pathKey}" not found` });
        return;
      }
      const beforeData = existing.data() || {};

      const patch: Record<string, any> = {};
      if (body.hub !== undefined) patch.hub = body.hub;
      if (body.title !== undefined) patch.title = body.title.trim();
      if (body.content_md !== undefined) patch.content_md = body.content_md;
      if (body.sort_order !== undefined) patch.sort_order = body.sort_order;
      if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
      patch.updated_at = ts();
      patch.updated_by = req.user!.uid;

      await ref.set(patch, { merge: true });

      const refetched = (await ref.get()).data();
      await writeSopPanelAudit("sop_panel_updated", pathKey, req.user!.uid, {
        before: beforeData,
        after: refetched,
        patch_keys: Object.keys(patch),
      });

      res.status(200).json({ panel: refetched });
    } catch (err: any) {
      console.error("PUT /admin/sop-panels/:key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.delete(
  "/:panel_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pathKey = req.params.panel_key;
      const ref = db().collection("sop_panels").doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `panel "${pathKey}" not found` });
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
      await writeSopPanelAudit("sop_panel_deleted", pathKey, req.user!.uid, {
        before: beforeData,
        after: refetched,
      });

      res.status(200).json({ panel: refetched });
    } catch (err: any) {
      console.error("DELETE /admin/sop-panels/:key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
