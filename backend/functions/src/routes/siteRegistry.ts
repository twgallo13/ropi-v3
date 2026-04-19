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
 * Relocates GET /api/v1/imports/site-verification/sites which previously
 * returned a different shape ({ site_id, domain, label }). The old endpoint
 * remains in place for back-compat until Pass 2 completes consumer migration.
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";

const router = Router();

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

export default router;
