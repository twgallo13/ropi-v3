/**
 * Guided Tours — Step 3.5
 *   GET /api/v1/tours/:hub   — fetch active tour for a hub
 *
 * Reads from `guided_tours` collection. Seeded via scripts/seed/seed-guided-tours.js.
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";

const router = Router();
const db = () => admin.firestore();

router.get(
  "/:hub",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const hub = req.params.hub;
      const snap = await db()
        .collection("guided_tours")
        .where("hub", "==", hub)
        .where("is_active", "==", true)
        .limit(1)
        .get();
      if (snap.empty) {
        res.json({ tour: null });
        return;
      }
      const doc = snap.docs[0];
      res.json({ tour: { tour_id: doc.id, ...doc.data() } });
    } catch (err: any) {
      console.error("GET /tours/:hub error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
