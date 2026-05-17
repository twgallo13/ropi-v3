/**
 * TALLY-146 PR 1 — Buyer Markdown Action service.
 *
 * Per-MPN buyer-markdown logic extracted from
 * routes/buyerActions.ts POST /markdown handler so that the bulk
 * endpoint (POST /api/v1/products/bulk/markdown) and the
 * single-product endpoint share one canonical code path.
 *
 * Behavior is preserved verbatim: body validation, MAP-conflict gate
 * (deny + match-MAP exception), eligible-state gate, deny branch
 * (audit + state="Buyer Denied"), approve/off_sale/adjust branch
 * (price compute via apply99Rounding, queueForPricingExport,
 * Scheduled vs Export Ready state).
 *
 * This helper does NOT call refreshBuyerPerformanceMatrix (the route
 * handler is responsible for the fire-and-forget refresh — the bulk
 * endpoint also fires it ONCE per request, not per item).
 *
 * This helper does NOT call any pricing-domain-reflow function — the
 * single handler never did, and the bulk handler issues exactly ONE
 * reflowPricingDomainStateBatch call at end-of-batch (see
 * routes/products.ts /bulk/markdown).
 *
 * Returns a discriminated union so the bulk handler can map per-item
 * errors into the batch response envelope without re-deriving HTTP
 * status codes.
 */
import admin from "firebase-admin";
import { apply99Rounding } from "./pricingUtils";
import { mpnToDocId } from "./mpnUtils";
import { queueForPricingExport } from "./pricingExportQueue";

const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

export type BuyerMarkdownActionType =
  | "approve"
  | "deny"
  | "adjust"
  | "off_sale";

export type BuyerMarkdownAdjustment = {
  type?: "pct" | "dollar" | "price";
  value?: number;
  effective_date?: string | null;
} | null | undefined;

export type BuyerMarkdownActionParams = {
  mpn: string;
  action_type: BuyerMarkdownActionType;
  adjustment?: BuyerMarkdownAdjustment;
  buyerUserId: string;
};

export type BuyerMarkdownActionOk = {
  status: "ok";
  http_status: 200;
  mpn: string;
  action_type: BuyerMarkdownActionType;
  pricing_domain_state: string;
  new_rics_offer: number | null;
  export_rics_offer: number | null;
  buyer_action_id: string;
  effective_date: string | null;
};

export type BuyerMarkdownActionError = {
  status: "error";
  http_status: number;
  mpn: string;
  error_code:
    | "MISSING_FIELDS"
    | "INVALID_ACTION_TYPE"
    | "NOT_FOUND"
    | "MAP_CONFLICT_BLOCKED"
    | "INELIGIBLE_STATE"
    | "MISSING_ADJUSTMENT"
    | "INVALID_ADJUSTMENT_TYPE"
    | "INTERNAL_ERROR";
  error_message: string;
};

export type BuyerMarkdownActionResult =
  | BuyerMarkdownActionOk
  | BuyerMarkdownActionError;

export async function performBuyerMarkdownAction(
  params: BuyerMarkdownActionParams
): Promise<BuyerMarkdownActionResult> {
  const { mpn, action_type, adjustment, buyerUserId } = params;

  try {
    if (!mpn || !action_type) {
      return {
        status: "error",
        http_status: 400,
        mpn: mpn || "",
        error_code: "MISSING_FIELDS",
        error_message: "mpn and action_type are required",
      };
    }

    if (!["approve", "deny", "adjust", "off_sale"].includes(action_type)) {
      return {
        status: "error",
        http_status: 400,
        mpn,
        error_code: "INVALID_ACTION_TYPE",
        error_message:
          "action_type must be approve, deny, adjust, or off_sale",
      };
    }

    const docId = mpnToDocId(mpn);
    const productRef = db().collection("products").doc(docId);
    const doc = await productRef.get();

    if (!doc.exists) {
      return {
        status: "error",
        http_status: 404,
        mpn,
        error_code: "NOT_FOUND",
        error_message: "Product not found",
      };
    }

    const product = doc.data()!;

    // Step 2.1 Part 3 — buyer cannot approve a markdown on a MAP-conflicted product.
    // TALLY-PHASE-3.9 Track 2A — Deny bypasses MAP gate per PO 2026-05-07 (Q1=1A).
    // Phase 3.10 Track 2C — D2 surgical exception: allow adjust when buyer explicitly
    // matches MAP floor (adjust.type==="price" && adjust.value===map_floor).
    const mapFloorRaw: number | null =
      product.map_price ?? product.map_state?.map_price ?? null;
    const isMatchMap =
      action_type === "adjust" &&
      adjustment?.type === "price" &&
      mapFloorRaw !== null &&
      adjustment?.value === mapFloorRaw;

    if (
      product.map_conflict_active === true &&
      action_type !== "deny" &&
      !isMatchMap
    ) {
      return {
        status: "error",
        http_status: 400,
        mpn,
        error_code: "MAP_CONFLICT_BLOCKED",
        error_message: "MAP conflict must be resolved before markdown",
      };
    }

    // TALLY-158 Phase 1 — include "Exported" as an eligible steady-state for
    // buyer markdown actions. The cadence engine re-surfaces already-exported
    // products in the Buyer Cockpit Cadence queue whenever a new markdown step
    // matches (next cycle in the markdown ladder). Approve/Deny on those queue
    // items previously returned 400 INELIGIBLE_STATE because the gate omitted
    // "Exported", even though the engine intentionally surfaces them and the
    // intended behavior is to re-queue the new price for the next daily export.
    const eligibleStates = [
      "Pricing Current",
      "Loss-Leader Review Pending",
      "Exported",
      "Buyer Denied",
    ];
    if (!eligibleStates.includes(product.pricing_domain_state)) {
      return {
        status: "error",
        http_status: 400,
        mpn,
        error_code: "INELIGIBLE_STATE",
        error_message: `Product pricing_domain_state is "${product.pricing_domain_state}" — must be in ${eligibleStates.join(
          " or "
        )} for buyer action`,
      };
    }

    const ricsRetail = product.rics_retail || 0;
    const currentOffer = product.rics_offer || 0;

    if (action_type === "deny") {
      const actionRef = await db().collection("buyer_actions").add({
        mpn,
        buyer_user_id: buyerUserId,
        action_type: "deny",
        original_rics_offer: currentOffer,
        new_rics_offer: null,
        export_rics_offer: null,
        effective_date: null,
        pricing_domain_state_after: "Buyer Denied",
        created_at: ts(),
      });

      await productRef.set(
        {
          pricing_domain_state: "Buyer Denied",
          buyer_action_taken_at: ts(),
          last_buyer_action_id: actionRef.id,
        },
        { merge: true }
      );

      // TALLY-159 — clear cadence queue flag at the canonical buyer-action
      // transition point so processed items do not leave stale
      // in_cadence_review_queue=true residue on cadence_assignments.
      // Mirrors the pattern used by routes/buyerActions.ts (hold /
      // save-for-season / postpone-review) which writes the same trio.
      await db()
        .collection("cadence_assignments")
        .doc(docId)
        .set(
          {
            in_cadence_review_queue: false,
            last_buyer_action: "deny",
            last_buyer_action_at: ts(),
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

      return {
        status: "ok",
        http_status: 200,
        mpn,
        action_type: "deny",
        pricing_domain_state: "Buyer Denied",
        new_rics_offer: null,
        export_rics_offer: null,
        buyer_action_id: actionRef.id,
        effective_date: null,
      };
    }

    // Approve / off_sale / adjust — calculate prices
    let newRicsOffer: number;

    if (action_type === "approve") {
      newRicsOffer = Math.round(ricsRetail * 0.85 * 100) / 100;
    } else if (action_type === "off_sale") {
      newRicsOffer = Math.round(ricsRetail * 100) / 100;
    } else {
      if (!adjustment) {
        return {
          status: "error",
          http_status: 400,
          mpn,
          error_code: "MISSING_ADJUSTMENT",
          error_message: "adjustment object required for adjust action",
        };
      }
      if (adjustment.type === "pct") {
        newRicsOffer =
          Math.round(ricsRetail * (1 - (adjustment.value || 0) / 100) * 100) /
          100;
      } else if (adjustment.type === "dollar") {
        newRicsOffer =
          Math.round((ricsRetail - (adjustment.value || 0)) * 100) / 100;
      } else if (adjustment.type === "price") {
        newRicsOffer = Math.round((adjustment.value || 0) * 100) / 100;
      } else {
        return {
          status: "error",
          http_status: 400,
          mpn,
          error_code: "INVALID_ADJUSTMENT_TYPE",
          error_message: "adjustment.type must be pct, dollar, or price",
        };
      }
    }

    const exportPrice = apply99Rounding(newRicsOffer);
    const effectiveDate = adjustment?.effective_date || null;
    const stateAfter = effectiveDate ? "Scheduled" : "Export Ready";

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

    // TALLY-159 — clear cadence queue flag at the canonical buyer-action
    // transition point. stateAfter is always one of {"Export Ready",
    // "Scheduled"} in this branch, both of which are terminal /
    // non-actionable for the Cadence queue. Mirrors the pattern used
    // by routes/buyerActions.ts.
    await db()
      .collection("cadence_assignments")
      .doc(docId)
      .set(
        {
          in_cadence_review_queue: false,
          last_buyer_action: action_type,
          last_buyer_action_at: ts(),
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
      await queueForPricingExport(
        mpn,
        "buyer_markdown",
        buyerUserId,
        effectiveDate
      );
    } catch (qerr: any) {
      console.error("queueForPricingExport (buyer_markdown) failed:", qerr);
    }

    return {
      status: "ok",
      http_status: 200,
      mpn,
      action_type,
      pricing_domain_state: stateAfter,
      new_rics_offer: newRicsOffer,
      export_rics_offer: exportPrice,
      buyer_action_id: actionRef.id,
      effective_date: effectiveDate,
    };
  } catch (err: any) {
    console.error(
      `performBuyerMarkdownAction error mpn=${mpn} action=${action_type}:`,
      err
    );
    return {
      status: "error",
      http_status: 500,
      mpn,
      error_code: "INTERNAL_ERROR",
      error_message: err?.message || "internal error",
    };
  }
}
