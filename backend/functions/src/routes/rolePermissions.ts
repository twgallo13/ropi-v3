/**
 * Role Permissions — read-only canonical role matrix
 * (TALLY-SETTINGS-UX Phase 3 / A.3 PR3).
 *
 *   GET /api/v1/admin/role-permissions
 *     → 200 { roles: CANONICAL_ROLES }   (admin/owner only)
 *     → 401 if no auth
 *     → 403 if non-admin/owner
 *
 * Read-only matrix per A.3 ruling — NO POST/PUT/DELETE.
 * Source of truth: backend/functions/src/lib/rolePermissions.ts
 */
import { Router, Response } from "express";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { CANONICAL_ROLES } from "../lib/rolePermissions";

const rolePermissionsRouter = Router();

rolePermissionsRouter.get(
  "/",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      res.json({ roles: CANONICAL_ROLES });
    } catch (err: any) {
      console.error("GET /admin/role-permissions error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default rolePermissionsRouter;
