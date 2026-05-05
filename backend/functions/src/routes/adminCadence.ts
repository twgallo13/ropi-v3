/**
 * Admin Cadence Trigger — Phase 3.10 Track 3 (Part B)
 * POST /api/v1/admin/cadence/run-evaluation
 *
 * Manually triggers cadence evaluation for a given list of MPNs, or for ALL
 * active products if `mpns` is omitted. Admin-only.
 *
 * Request body (optional):
 *   { "mpns": ["1004438", "210521-1FT", ...] }
 *
 * Response:
 *   { evaluated, assigned, unassigned, conflicts, skipped_mid_cadence, duration_ms, mpn_count }
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { runCadenceEvaluation } from "../services/cadenceEngine";
import { docIdToMpn } from "../services/mpnUtils";

const router = Router();
const db = admin.firestore;

// POST /api/v1/admin/cadence/run-evaluation
router.post(
  "/run-evaluation",
  requireAuth,
  requireRole(["admin"]),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startedAt = Date.now();
    try {
      let mpns: string[];

      if (Array.isArray(req.body?.mpns) && req.body.mpns.length > 0) {
        // Scoped: caller-supplied list
        mpns = req.body.mpns.map((m: unknown) => String(m));
      } else {
        // Global: fetch all product doc IDs and derive MPNs
        const snap = await db().collection("products").select().get();
        mpns = snap.docs.map((d) => docIdToMpn(d.id));
      }

      const result = await runCadenceEvaluation(mpns);
      const duration_ms = Date.now() - startedAt;

      res.json({ ...result, duration_ms, mpn_count: mpns.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
