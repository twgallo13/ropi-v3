/**
 * Site Registry — Phase 4.4 §3.1 / §8 canonical endpoint.
 *
 *   GET /api/v1/site-registry            → all entries
 *   GET /api/v1/site-registry?active=true → is_active === true only
 *
 * Response shape (per Phase 4.4 §3.1):
 *   { sites: [{ site_key, display_name, domain, is_active, priority,
 *               badge_color, notes }] }
 *
 * Sorted by priority ascending, then site_key.
 *
 * Canonical replacement for the legacy GET /api/v1/imports/site-verification/sites
 * endpoint, which was removed in Phase 5 Pass 2 (TALLY-123 Task 8).
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";

const router = Router();
const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

async function writeSiteAudit(
  action: string,
  entityId: string,
  actorUid: string,
  details: Record<string, any>
): Promise<void> {
  try {
    await db().collection("audit_log").add({
      action,
      entity_type: "site_registry",
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
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const activeOnly = String(req.query.active || "").toLowerCase() === "true";
      const snap = await admin.firestore().collection("site_registry").get();
      const sites = snap.docs
        .map((d) => {
          const data = d.data() || {};
          return {
            site_key: data.site_key || d.id,
            display_name: data.display_name || data.name || d.id,
            domain: data.domain || null,
            is_active: data.is_active === true,
            priority: typeof data.priority === "number" ? data.priority : 999,
            badge_color: data.badge_color ?? null,
            notes: data.notes ?? null,
          };
        })
        .filter((s) => (activeOnly ? s.is_active : true))
        .sort((a, b) => {
          if (a.priority !== b.priority) return a.priority - b.priority;
          return a.site_key.localeCompare(b.site_key);
        });
      res.json({ sites });
    } catch (err: any) {
      console.error("GET /site-registry error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ────────────────────────────────────────────────
// POST /api/v1/site-registry — create new site
// ────────────────────────────────────────────────
router.post(
  "/",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body || {};
      const { site_key, display_name, domain } = body;

      if (typeof site_key !== "string" || site_key.trim() === "") {
        res.status(400).json({ error: "site_key is required (non-empty string)" });
        return;
      }
      if (typeof display_name !== "string" || display_name.trim() === "") {
        res.status(400).json({ error: "display_name is required (non-empty string)" });
        return;
      }
      if (typeof domain !== "string" || domain.trim() === "") {
        res.status(400).json({ error: "domain is required (non-empty string)" });
        return;
      }

      const key = site_key.trim();
      const ref = db().collection("site_registry").doc(key);
      const existing = await ref.get();
      if (existing.exists) {
        res.status(409).json({ error: "site_key already exists" });
        return;
      }

      const payload: Record<string, any> = {
        site_key: key,
        display_name: display_name.trim(),
        domain: domain.trim(),
        is_active: typeof body.is_active === "boolean" ? body.is_active : true,
        priority: typeof body.priority === "number" ? body.priority : 0,
        badge_color: body.badge_color ?? null,
        notes: body.notes ?? null,
        created_at: ts(),
        created_by: req.user!.uid,
        updated_at: ts(),
        updated_by: req.user!.uid,
      };
      await ref.set(payload);

      // TALLY-079 hook — log only, no prompt_templates touch.
      console.warn(
        `[TALLY-079] New site_key added: "${key}". Review prompt_templates.match_site_owner for coverage.`
      );

      await writeSiteAudit("site_registry_created", key, req.user!.uid, {
        site_key: key,
        display_name: payload.display_name,
        domain: payload.domain,
      });

      const refetched = (await ref.get()).data();
      res.status(201).json({ site: refetched });
    } catch (err: any) {
      console.error("POST /site-registry error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ────────────────────────────────────────────────
// PUT /api/v1/site-registry/:site_key — update (key immutable)
// ────────────────────────────────────────────────
router.put(
  "/:site_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body || {};
      const pathKey = req.params.site_key;

      if (body.site_key !== undefined && body.site_key !== pathKey) {
        res.status(400).json({ error: "site_key is immutable" });
        return;
      }

      if (body.display_name !== undefined) {
        if (typeof body.display_name !== "string" || body.display_name.trim() === "") {
          res.status(400).json({ error: "display_name must be a non-empty string" });
          return;
        }
      }
      if (body.domain !== undefined) {
        if (typeof body.domain !== "string" || body.domain.trim() === "") {
          res.status(400).json({ error: "domain must be a non-empty string" });
          return;
        }
      }

      const ref = db().collection("site_registry").doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `site "${pathKey}" not found` });
        return;
      }

      const patch: Record<string, any> = {};
      if (body.display_name !== undefined) patch.display_name = body.display_name.trim();
      if (body.domain !== undefined) patch.domain = body.domain.trim();
      if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
      if (typeof body.priority === "number") patch.priority = body.priority;
      if (body.badge_color !== undefined) patch.badge_color = body.badge_color;
      if (body.notes !== undefined) patch.notes = body.notes;
      patch.updated_at = ts();
      patch.updated_by = req.user!.uid;

      await ref.set(patch, { merge: true });

      await writeSiteAudit("site_registry_updated", pathKey, req.user!.uid, {
        patch_keys: Object.keys(patch),
      });

      const refetched = (await ref.get()).data();
      res.status(200).json({ site: refetched });
    } catch (err: any) {
      console.error("PUT /site-registry/:site_key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ────────────────────────────────────────────────
// DELETE /api/v1/site-registry/:site_key — soft deactivation
// ────────────────────────────────────────────────
router.delete(
  "/:site_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pathKey = req.params.site_key;
      const ref = db().collection("site_registry").doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `site "${pathKey}" not found` });
        return;
      }

      await ref.set(
        {
          is_active: false,
          updated_at: ts(),
          updated_by: req.user!.uid,
        },
        { merge: true }
      );

      await writeSiteAudit("site_registry_deleted", pathKey, req.user!.uid, {
        site_key: pathKey,
      });

      const refetched = (await ref.get()).data();
      res.status(200).json({ site: refetched });
    } catch (err: any) {
      console.error("DELETE /site-registry/:site_key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
