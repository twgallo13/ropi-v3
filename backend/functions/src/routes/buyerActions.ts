import { Router, Response } from "express";
import admin from "firebase-admin";
import { apply99Rounding } from "../services/pricingUtils";
import { getAdminSettings } from "../services/adminSettings";
import { mpnToDocId } from "../services/mpnUtils";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { queueForPricingExport } from "../services/pricingExportQueue";
import { computeBuyerPerformanceMatrix } from "../services/buyerPerformanceMatrix";

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
router.post("/markdown", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mpn, action_type, adjustment } = req.body;

    if (!mpn || !action_type) {
      res.status(400).json({ error: "mpn and action_type are required" });
      return;
    }

    if (!["approve", "deny", "adjust", "off_sale"].includes(action_type)) {
      res.status(400).json({ error: "action_type must be approve, deny, adjust, or off_sale" });
      return;
    }

    const docId = mpnToDocId(mpn);
    const productRef = db().collection("products").doc(docId);
    const doc = await productRef.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const product = doc.data()!;

    // Step 2.1 Part 3 — buyer cannot approve a markdown on a MAP-conflicted product
    if (product.map_conflict_active === true) {
      res.status(400).json({
        error: "MAP conflict must be resolved before markdown",
      });
      return;
    }

    // Validate product is in buyer-review-eligible state
    const eligibleStates = ["Pricing Current", "Loss-Leader Review Pending"];
    if (!eligibleStates.includes(product.pricing_domain_state)) {
      res.status(400).json({
        error: `Product pricing_domain_state is "${product.pricing_domain_state}" — must be in ${eligibleStates.join(" or ")} for buyer action`,
      });
      return;
    }

    const ricsRetail = product.rics_retail || 0;
    const currentOffer = product.rics_offer || 0;
    const buyerUserId = req.user?.uid;
    if (!buyerUserId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    if (action_type === "deny") {
      // Deny — no price calculation needed
      const actionRef = await db().collection("buyer_actions").add({
        mpn,
        buyer_user_id: buyerUserId,
        action_type: "deny",
        original_rics_offer: currentOffer,
        new_rics_offer: null,
        export_rics_offer: null,
        effective_date: null,
        pricing_domain_state_after: "buyer_denied",
        created_at: ts(),
      });

      await productRef.set(
        {
          pricing_domain_state: "buyer_denied",
          buyer_action_taken_at: ts(),
          last_buyer_action_id: actionRef.id,
        },
        { merge: true }
      );

      await db().collection("audit_log").add({
        product_mpn: mpn,
        event_type: "buyer_action",
        action_type: "deny",
        acting_user_id: buyerUserId,
        created_at: ts(),
      });

      res.json({
        status: "success",
        mpn,
        action_type: "deny",
        pricing_domain_state: "buyer_denied",
      });
      refreshBuyerPerformanceMatrix();
      return;
    }

    // Approve or Adjust — calculate prices
    let newRicsOffer: number;

    if (action_type === "approve") {
      // 15% default markdown
      newRicsOffer = Math.round(ricsRetail * 0.85 * 100) / 100;
    } else if (action_type === "off_sale") {
      // Section 14.7 — revert rics_offer to rics_retail
      newRicsOffer = Math.round(ricsRetail * 100) / 100;
    } else {
      // adjust
      if (!adjustment) {
        res.status(400).json({ error: "adjustment object required for adjust action" });
        return;
      }

      if (adjustment.type === "pct") {
        newRicsOffer = Math.round(ricsRetail * (1 - adjustment.value / 100) * 100) / 100;
      } else if (adjustment.type === "dollar") {
        newRicsOffer = Math.round((ricsRetail - adjustment.value) * 100) / 100;
      } else if (adjustment.type === "price") {
        newRicsOffer = Math.round(adjustment.value * 100) / 100;
      } else {
        res.status(400).json({ error: "adjustment.type must be pct, dollar, or price" });
        return;
      }
    }

    const exportPrice = apply99Rounding(newRicsOffer);
    const effectiveDate = adjustment?.effective_date || null;
    const stateAfter = effectiveDate ? "scheduled" : "export_ready";

    const actionRef = await db().collection("buyer_actions").add({
      mpn,
      buyer_user_id: buyerUserId,
      action_type,
      original_rics_offer: currentOffer,
      new_rics_offer: newRicsOffer,
      export_rics_offer: exportPrice,
      effective_date: effectiveDate,
      pricing_domain_state_after: stateAfter,
      created_at: ts(),
    });

    await productRef.set(
      {
        pricing_domain_state: stateAfter,
        buyer_action_taken_at: ts(),
        last_buyer_action_id: actionRef.id,
      },
      { merge: true }
    );

    await db().collection("audit_log").add({
      product_mpn: mpn,
      event_type: "buyer_action",
      action_type,
      new_rics_offer: newRicsOffer,
      export_rics_offer: exportPrice,
      effective_date: effectiveDate,
      acting_user_id: buyerUserId,
      created_at: ts(),
    });

    // Step 2.1 / TALLY-112 — buyer markdown feeds the RICS Pricing Export queue
    try {
      await queueForPricingExport(mpn, "buyer_markdown", buyerUserId, effectiveDate);
    } catch (qerr: any) {
      console.error("queueForPricingExport (buyer_markdown) failed:", qerr);
    }

    res.json({
      status: "success",
      mpn,
      action_type,
      new_rics_offer: newRicsOffer,
      export_rics_offer: exportPrice,
      pricing_domain_state: stateAfter,
      buyer_action_id: actionRef.id,
    });
    refreshBuyerPerformanceMatrix();
  } catch (err: any) {
    console.error("POST /buyer-actions/markdown error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/v1/buyer-actions/loss-leader-acknowledge ──
router.post("/loss-leader-acknowledge", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mpn, reason } = req.body;
    if (!mpn || !reason) {
      res.status(400).json({ error: "mpn and reason are required" });
      return;
    }

    const settings = await getAdminSettings();
    if (reason.length < settings.below_cost_reason_min_chars) {
      res.status(400).json({
        error: `Reason must be at least ${settings.below_cost_reason_min_chars} characters — explain why this below-cost price is necessary`,
      });
      return;
    }

    const docId = mpnToDocId(mpn);
    const productRef = db().collection("products").doc(docId);
    const doc = await productRef.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const product = doc.data()!;
    if (product.pricing_domain_state !== "Loss-Leader Review Pending") {
      res.status(400).json({
        error: `Product must be in "Loss-Leader Review Pending" state, currently "${product.pricing_domain_state}"`,
      });
      return;
    }

    const buyerUserId = req.user?.uid;
    if (!buyerUserId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const vetoWindowHours = settings.master_veto_window * 24;
    const vetoExpiresAt = new Date(Date.now() + vetoWindowHours * 60 * 60 * 1000);

    await productRef.set(
      {
        loss_leader_acknowledged: true,
        loss_leader_reason: reason,
        loss_leader_acknowledged_at: ts(),
        loss_leader_acknowledged_by: buyerUserId,
        pricing_domain_state: "Loss-Leader Acknowledged",
        veto_window_expires_at: vetoExpiresAt,
      },
      { merge: true }
    );

    await db().collection("audit_log").add({
      product_mpn: mpn,
      event_type: "loss_leader_acknowledged",
      reason,
      acting_user_id: buyerUserId,
      veto_expires_at: vetoExpiresAt,
      created_at: ts(),
    });

    res.json({
      status: "success",
      mpn,
      veto_window_hours: vetoWindowHours,
      veto_expires_at: vetoExpiresAt.toISOString(),
    });
    refreshBuyerPerformanceMatrix();
  } catch (err: any) {
    console.error("POST /buyer-actions/loss-leader-acknowledge error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/v1/buyer-actions/loss-leader-veto ──
router.post("/loss-leader-veto", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mpn, veto_reason } = req.body;
    if (!mpn || !veto_reason) {
      res.status(400).json({ error: "mpn and veto_reason are required" });
      return;
    }

    const docId = mpnToDocId(mpn);
    const productRef = db().collection("products").doc(docId);
    const doc = await productRef.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const buyerUserId = req.user?.uid;
    if (!buyerUserId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    await productRef.set(
      {
        pricing_domain_state: "loss_leader_vetoed",
        veto_reason,
        vetoed_by: buyerUserId,
        vetoed_at: ts(),
      },
      { merge: true }
    );

    await db().collection("audit_log").add({
      product_mpn: mpn,
      event_type: "loss_leader_vetoed",
      veto_reason,
      acting_user_id: buyerUserId,
      created_at: ts(),
    });

    res.json({
      status: "success",
      mpn,
      pricing_domain_state: "loss_leader_vetoed",
    });
    refreshBuyerPerformanceMatrix();
  } catch (err: any) {
    console.error("POST /buyer-actions/loss-leader-veto error:", err);
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
          in_buyer_queue: false,
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
          in_buyer_queue: false,
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
          in_buyer_queue: false,
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

export default router;
