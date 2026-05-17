import { Router, Response } from "express";
import admin from "firebase-admin";
import { mpnToDocId } from "../services/mpnUtils";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { computeBuyerPerformanceMatrix } from "../services/buyerPerformanceMatrix";
import {
  performBuyerMarkdownAction,
  type BuyerMarkdownActionType,
} from "../services/buyerMarkdownAction";
import { performBuyerPriceOverride } from "../services/buyerPriceOverride";
import { applyStepOverride } from "../services/applyStepOverride";

const router = Router();
const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

// Step 3.3 — async fire-and-forget refresh after significant buyer actions.
function refreshBuyerPerformanceMatrix(): void {
  computeBuyerPerformanceMatrix().catch((err: any) => {
    console.error("computeBuyerPerformanceMatrix (fire-and-forget) failed:", err?.message || err);
  });
}

// ── POST /api/v1/buyer-actions/markdown ──
// TALLY-146 PR 1 — per-MPN logic extracted to
// services/buyerMarkdownAction.ts so the bulk endpoint
// (POST /api/v1/products/bulk/markdown) and this single-product
// handler share one canonical code path. Response shape is preserved
// for FE compatibility.
router.post("/markdown", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mpn, action_type, adjustment } = req.body || {};
    const buyerUserId = req.user?.uid;
    if (!buyerUserId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const result = await performBuyerMarkdownAction({
      mpn,
      action_type: action_type as BuyerMarkdownActionType,
      adjustment,
      buyerUserId,
    });

    if (result.status === "error") {
      res.status(result.http_status).json({ error: result.error_message });
      return;
    }

    if (result.action_type === "deny") {
      res.json({
        status: "success",
        mpn: result.mpn,
        action_type: "deny",
        pricing_domain_state: result.pricing_domain_state,
      });
    } else {
      res.json({
        status: "success",
        mpn: result.mpn,
        action_type: result.action_type,
        new_rics_offer: result.new_rics_offer,
        export_rics_offer: result.export_rics_offer,
        pricing_domain_state: result.pricing_domain_state,
        buyer_action_id: result.buyer_action_id,
      });
    }
    refreshBuyerPerformanceMatrix();
  } catch (err: any) {
    console.error("POST /buyer-actions/markdown error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Step 2.2 — Cadence buyer actions (Section 14.7) ──

// POST /api/v1/buyer-actions/hold
router.post("/hold", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mpn, hold_reason } = req.body || {};
    if (!mpn) {
      res.status(400).json({ error: "mpn is required" });
      return;
    }
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const docId = mpnToDocId(mpn);
    const productRef = db().collection("products").doc(docId);
    const productDoc = await productRef.get();
    if (!productDoc.exists) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    await productRef.set({ cadence_hold: true, updated_at: ts() }, { merge: true });
    await db()
      .collection("cadence_assignments")
      .doc(docId)
      .set(
        {
          in_cadence_review_queue: false,
          last_buyer_action: "hold",
          last_buyer_action_at: ts(),
        },
        { merge: true }
      );
    await db().collection("audit_log").add({
      product_mpn: mpn,
      event_type: "buyer_action_hold",
      hold_reason: hold_reason || null,
      acting_user_id: uid,
      created_at: ts(),
    });
    res.json({ status: "success", mpn, action: "hold" });
    refreshBuyerPerformanceMatrix();
  } catch (err: any) {
    console.error("POST /buyer-actions/hold error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/buyer-actions/save-for-season
router.post("/save-for-season", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mpn, return_date } = req.body || {};
    if (!mpn || !return_date) {
      res.status(400).json({ error: "mpn and return_date are required" });
      return;
    }
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const docId = mpnToDocId(mpn);
    const productRef = db().collection("products").doc(docId);
    const productDoc = await productRef.get();
    if (!productDoc.exists) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    await productRef.set(
      { cadence_seasonal_return: return_date, updated_at: ts() },
      { merge: true }
    );
    await db()
      .collection("cadence_assignments")
      .doc(docId)
      .set(
        {
          in_cadence_review_queue: false,
          last_buyer_action: "save_for_season",
          last_buyer_action_at: ts(),
        },
        { merge: true }
      );
    await db().collection("audit_log").add({
      product_mpn: mpn,
      event_type: "buyer_action_save_for_season",
      return_date,
      acting_user_id: uid,
      created_at: ts(),
    });
    res.json({ status: "success", mpn, action: "save_for_season", return_date });
  } catch (err: any) {
    console.error("POST /buyer-actions/save-for-season error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/buyer-actions/postpone-review
router.post("/postpone-review", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mpn, snooze_days } = req.body || {};
    if (!mpn || !snooze_days) {
      res.status(400).json({ error: "mpn and snooze_days are required" });
      return;
    }
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const days = Number(snooze_days);
    if (isNaN(days) || days < 1) {
      res.status(400).json({ error: "snooze_days must be a positive number" });
      return;
    }
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const docId = mpnToDocId(mpn);
    const productRef = db().collection("products").doc(docId);
    const productDoc = await productRef.get();
    if (!productDoc.exists) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    await productRef.set(
      { cadence_snooze_until: until, updated_at: ts() },
      { merge: true }
    );
    await db()
      .collection("cadence_assignments")
      .doc(docId)
      .set(
        {
          in_cadence_review_queue: false,
          last_buyer_action: "postpone_review",
          last_buyer_action_at: ts(),
        },
        { merge: true }
      );
    await db().collection("audit_log").add({
      product_mpn: mpn,
      event_type: "buyer_action_postponed",
      snooze_days: days,
      snooze_until: until,
      acting_user_id: uid,
      created_at: ts(),
    });
    res.json({ status: "success", mpn, action: "postpone_review", snooze_until: until });
  } catch (err: any) {
    console.error("POST /buyer-actions/postpone-review error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── TALLY-157 — POST /api/v1/buyer-actions/custom-price ──
// Governed buyer-set custom pricing (immediate path only).
// Delegates to services/buyerPriceOverride.ts; writes a buyer_actions
// doc with action_type="buyer_price_override" (NOT "custom_price" —
// per dispatch constraint, "custom_price" is reserved for cadence
// markdown_steps and must not appear in buyer_actions documents).
router.post(
  "/custom-price",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { mpn, value, scom_sale, reason } = req.body || {};
      const buyerUserId = req.user?.uid;
      if (!buyerUserId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const result = await performBuyerPriceOverride({
        mpn,
        value,
        scom_sale,
        reason,
        buyerUserId,
      });

      if (result.status === "error") {
        res.status(result.http_status).json({
          error: result.error_message,
          error_code: result.error_code,
        });
        return;
      }

      res.json({
        status: "success",
        mpn: result.mpn,
        action_type: result.action_type,
        new_rics_offer: result.new_rics_offer,
        export_rics_offer: result.export_rics_offer,
        scom_sale: result.scom_sale,
        pricing_domain_state: result.pricing_domain_state,
        buyer_action_id: result.buyer_action_id,
        effective_date: result.effective_date,
      });
      refreshBuyerPerformanceMatrix();
    } catch (err: any) {
      console.error("POST /buyer-actions/custom-price error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── TALLY-157 — POST /api/v1/buyer-actions/step-override ──
// Immediate Step Override path (no scheduling, no cadence lock).
// All mutations to cadence_assignments.current_step from buyer-initiated
// flows MUST route through services/applyStepOverride.ts — this handler
// is the only HTTP surface that calls it.
router.post(
  "/step-override",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { mpn, target_step_number, reason } = req.body || {};
      const buyerUserId = req.user?.uid;
      if (!buyerUserId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const result = await applyStepOverride({
        mpn,
        target_step_number,
        reason,
        buyerUserId,
      });

      if (result.status === "error") {
        res.status(result.http_status).json({
          error: result.error_message,
          error_code: result.error_code,
        });
        return;
      }

      res.json({
        status: "success",
        mpn: result.mpn,
        previous_step: result.previous_step,
        current_step: result.current_step,
        matched_rule_id: result.matched_rule_id,
        matched_rule_version: result.matched_rule_version,
        buyer_action_id: result.buyer_action_id,
        action_type: "buyer_step_override",
      });
      refreshBuyerPerformanceMatrix();
    } catch (err: any) {
      console.error("POST /buyer-actions/step-override error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
