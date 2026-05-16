/**
 * Step 2.2 — Cadence Review + Assignments routes.
 *  GET  /api/v1/cadence-assignments/unassigned  — unassigned products
 *  POST /api/v1/cadence-assignments/:mpn/assign — manual rule assignment
 *  POST /api/v1/cadence-assignments/:mpn/exclude — exclude product from cadence
 *
 * TALLY-146 PR 1 — GET /cadence-review handler retired (v2.2 narrowed
 * scope). FE caller fetchCadenceReview removed from frontend/src/lib/api.ts.
 * The /cadence-review → /buyer-review redirect in frontend/src/App.tsx
 * remains in place.
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { mpnToDocId } from "../services/mpnUtils";
import { runCadenceEvaluation } from "../services/cadenceEngine";

const router = Router();
const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

const buyerRoles = ["buyer", "head_buyer", "admin"];

// GET /api/v1/cadence-assignments/unassigned
router.get(
  "/cadence-assignments/unassigned",
  requireAuth,
  requireRole(buyerRoles),
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const snap = await db()
        .collection("cadence_assignments")
        .where("cadence_state", "==", "unassigned")
        .get();
      const items: any[] = [];
      for (const d of snap.docs) {
        const a = d.data();
        const pSnap = await db()
          .collection("products")
          .doc(mpnToDocId(a.mpn))
          .get();
        if (!pSnap.exists) continue;
        const p = pSnap.data()!;
        items.push({
          mpn: a.mpn,
          name: p.name || "",
          brand: p.brand || "",
          department: p.department || "",
          class: p.class || "",
          wos: p.wos != null ? Number(p.wos) : null,
          str_pct: p.str_pct != null ? Number(p.str_pct) : null,
          inventory_total:
            (Number(p.inventory_store) || 0) +
            (Number(p.inventory_warehouse) || 0) +
            (Number(p.inventory_whs) || 0),
          last_evaluated_at:
            a.last_evaluated_at?.toDate?.()?.toISOString() || null,
        });
      }
      res.json({ items, total: items.length });
    } catch (err: any) {
      console.error("GET /cadence-assignments/unassigned error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/v1/cadence-assignments/:mpn/assign
router.post(
  "/cadence-assignments/:mpn/assign",
  requireAuth,
  requireRole(buyerRoles),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { mpn } = req.params;
      const { rule_id } = req.body || {};
      if (!rule_id) {
        res.status(400).json({ error: "rule_id is required" });
        return;
      }
      const uid = req.user!.uid;
      const ruleSnap = await db().collection("cadence_rules").doc(rule_id).get();
      if (!ruleSnap.exists) {
        res.status(404).json({ error: "Rule not found" });
        return;
      }
      const ref = db().collection("cadence_assignments").doc(mpnToDocId(mpn));
      await ref.set(
        {
          mpn,
          cadence_state: "assigned",
          matched_rule_id: rule_id,
          matched_rule_version: Number(ruleSnap.data()!.version) || 1,
          manual_assignment: true,
          manual_assigned_by: uid,
          manual_assigned_at: ts(),
          last_evaluated_at: ts(),
        },
        { merge: true }
      );
      await db().collection("audit_log").add({
        event_type: "cadence_manual_assign",
        product_mpn: mpn,
        rule_id,
        acting_user_id: uid,
        created_at: ts(),
      });
      // F5 — trigger full re-eval so primary_user_id, support_user_ids,
      // recommendation, and in_cadence_review_queue are populated against the
      // locked rule. Engine respects manual_assignment:true and skips rule
      // matching; resolver still runs against current portfolios.
      await runCadenceEvaluation([mpn]);
      res.json({ status: "assigned", mpn, rule_id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/v1/cadence-assignments/:mpn/exclude
router.post(
  "/cadence-assignments/:mpn/exclude",
  requireAuth,
  requireRole(buyerRoles),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { mpn } = req.params;
      const { reason } = req.body || {};
      const uid = req.user!.uid;
      await db()
        .collection("cadence_assignments")
        .doc(mpnToDocId(mpn))
        .set(
          {
            mpn,
            cadence_state: "excluded",
            excluded_reason: reason || null,
            excluded_by: uid,
            excluded_at: ts(),
            in_cadence_review_queue: false,
            recommendation: null,
            last_evaluated_at: ts(),
          },
          { merge: true }
        );
      await db().collection("audit_log").add({
        event_type: "cadence_excluded",
        product_mpn: mpn,
        reason: reason || null,
        acting_user_id: uid,
        created_at: ts(),
      });
      res.json({ status: "excluded", mpn });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
