/**
 * TALLY-157 — Buyer Custom-Price Override service.
 *
 * Governed, buyer-set immediate pricing override. Distinct from
 * buyerMarkdownAction.ts: this service writes
 *   buyer_actions doc.action_type = "buyer_price_override"
 * and is the only path that should be used for the
 * POST /api/v1/buyer-actions/custom-price endpoint.
 *
 * Per dispatch constraints:
 *   - Do NOT reuse "custom_price" for buyer_actions.action_type.
 *   - Do NOT extend the existing markdown action family with
 *     buyer_price_override or scom_sale carriage.
 *   - Do NOT implement scheduling, promotion-job wiring, or
 *     cadence lock behavior. Immediate path only.
 *
 * Gates mirror buyerMarkdownAction:
 *   - MAP_CONFLICT_BLOCKED unless adjustment exactly matches map_floor.
 *   - INELIGIBLE_STATE unless pricing_domain_state ∈
 *     {"Pricing Current", "Loss-Leader Review Pending"}.
 *
 * Writes:
 *   - buyer_actions/{auto} doc (action_type: "buyer_price_override",
 *     pricing_domain_state_after: "Export Ready", effective_date: null)
 *   - products/{docId} set merge (rics_offer, export_rics_offer,
 *     optionally scom_sale, pricing_domain_state, buyer_action_taken_at,
 *     last_buyer_action_id)
 *   - audit_log entry (event_type: "buyer_action",
 *     action_type: "buyer_price_override")
 *   - queueForPricingExport (source: "buyer_price_override")
 */
import admin from "firebase-admin";
import { apply99Rounding } from "./pricingUtils";
import { mpnToDocId } from "./mpnUtils";
import { queueForPricingExport } from "./pricingExportQueue";

const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

export type BuyerPriceOverrideParams = {
  mpn: string;
  /** New RICS offer price (USD, > 0). Must be a positive number. */
  value: number;
  /** Optional new scom_sale price. Must be > 0 if provided. */
  scom_sale?: number | null;
  /** Optional governance note. */
  reason?: string | null;
  buyerUserId: string;
};

export type BuyerPriceOverrideOk = {
  status: "ok";
  http_status: 200;
  mpn: string;
  action_type: "buyer_price_override";
  pricing_domain_state: "Export Ready";
  new_rics_offer: number;
  export_rics_offer: number;
  scom_sale: number | null;
  buyer_action_id: string;
  effective_date: null;
};

export type BuyerPriceOverrideError = {
  status: "error";
  http_status: number;
  mpn: string;
  error_code:
    | "MISSING_FIELDS"
    | "INVALID_VALUE"
    | "INVALID_SCOM_SALE"
    | "NOT_FOUND"
    | "MAP_CONFLICT_BLOCKED"
    | "INELIGIBLE_STATE"
    | "INTERNAL_ERROR";
  error_message: string;
};

export type BuyerPriceOverrideResult =
  | BuyerPriceOverrideOk
  | BuyerPriceOverrideError;

export async function performBuyerPriceOverride(
  params: BuyerPriceOverrideParams
): Promise<BuyerPriceOverrideResult> {
  const { mpn, value, scom_sale, reason, buyerUserId } = params;

  try {
    if (!mpn || !buyerUserId) {
      return {
        status: "error",
        http_status: 400,
        mpn: mpn || "",
        error_code: "MISSING_FIELDS",
        error_message: "mpn and buyerUserId are required",
      };
    }

    if (typeof value !== "number" || !isFinite(value) || value <= 0) {
      return {
        status: "error",
        http_status: 400,
        mpn,
        error_code: "INVALID_VALUE",
        error_message: "value must be a positive number",
      };
    }

    if (
      scom_sale !== undefined &&
      scom_sale !== null &&
      (typeof scom_sale !== "number" || !isFinite(scom_sale) || scom_sale <= 0)
    ) {
      return {
        status: "error",
        http_status: 400,
        mpn,
        error_code: "INVALID_SCOM_SALE",
        error_message: "scom_sale must be a positive number when provided",
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

    // MAP gate — mirrors buyerMarkdownAction's adjust+match-MAP exception.
    // For a price override, "match" means the new value exactly equals
    // the map floor. Any other override on a MAP-conflicted product is
    // blocked.
    const mapFloorRaw: number | null =
      product.map_price ?? product.map_state?.map_price ?? null;
    const newRicsOffer = Math.round(value * 100) / 100;
    const isMatchMap = mapFloorRaw !== null && newRicsOffer === mapFloorRaw;
    const isMapItem =
      typeof mapFloorRaw === "number" && mapFloorRaw > 0;

    if (product.map_conflict_active === true && !isMatchMap) {
      return {
        status: "error",
        http_status: 400,
        mpn,
        error_code: "MAP_CONFLICT_BLOCKED",
        error_message:
          "MAP conflict must be resolved before buyer price override",
      };
    }

    // TALLY-157 R3 ruling (PO clarification, binding):
    //   "If item is MAP, WEB pricing is locked."
    // scom_sale is the WEB sale price. On any MAP item (map_price > 0),
    // a scom_sale override is illegal and must hard-fail — not silently
    // ignored, not deferred. This blocks the entire write so cadence
    // cannot later overwrite an illegal scom_sale value.
    if (
      isMapItem &&
      scom_sale !== undefined &&
      scom_sale !== null
    ) {
      return {
        status: "error",
        http_status: 400,
        mpn,
        error_code: "MAP_CONFLICT_BLOCKED",
        error_message:
          "scom_sale (WEB price) cannot be set on a MAP item — WEB pricing is locked when MAP applies",
      };
    }

    const eligibleStates = ["Pricing Current", "Loss-Leader Review Pending"];
    if (!eligibleStates.includes(product.pricing_domain_state)) {
      return {
        status: "error",
        http_status: 400,
        mpn,
        error_code: "INELIGIBLE_STATE",
        error_message: `Product pricing_domain_state is "${product.pricing_domain_state}" — must be in ${eligibleStates.join(
          " or "
        )} for buyer price override`,
      };
    }

    const currentOffer = product.rics_offer || 0;
    const exportPrice = apply99Rounding(newRicsOffer);
    const normalizedScomSale: number | null =
      typeof scom_sale === "number"
        ? Math.round(scom_sale * 100) / 100
        : null;

    // Immediate path only (per dispatch). No effective_date, no
    // Scheduled state, no promotion-job wiring.
    const stateAfter: "Export Ready" = "Export Ready";

    const actionRef = await db().collection("buyer_actions").add({
      mpn,
      buyer_user_id: buyerUserId,
      action_type: "buyer_price_override",
      original_rics_offer: currentOffer,
      new_rics_offer: newRicsOffer,
      export_rics_offer: exportPrice,
      scom_sale: normalizedScomSale,
      reason: reason || null,
      effective_date: null,
      pricing_domain_state_after: stateAfter,
      created_at: ts(),
    });

    const productUpdates: Record<string, any> = {
      rics_offer: newRicsOffer,
      export_rics_offer: exportPrice,
      pricing_domain_state: stateAfter,
      buyer_action_taken_at: ts(),
      last_buyer_action_id: actionRef.id,
    };
    if (normalizedScomSale !== null) {
      productUpdates.scom_sale = normalizedScomSale;
    }
    await productRef.set(productUpdates, { merge: true });

    await db().collection("audit_log").add({
      product_mpn: mpn,
      event_type: "buyer_action",
      action_type: "buyer_price_override",
      original_rics_offer: currentOffer,
      new_rics_offer: newRicsOffer,
      export_rics_offer: exportPrice,
      scom_sale: normalizedScomSale,
      reason: reason || null,
      acting_user_id: buyerUserId,
      created_at: ts(),
    });

    try {
      await queueForPricingExport(
        mpn,
        "buyer_price_override",
        buyerUserId,
        null
      );
    } catch (qerr: any) {
      console.error(
        "queueForPricingExport (buyer_price_override) failed:",
        qerr
      );
    }

    return {
      status: "ok",
      http_status: 200,
      mpn,
      action_type: "buyer_price_override",
      pricing_domain_state: stateAfter,
      new_rics_offer: newRicsOffer,
      export_rics_offer: exportPrice,
      scom_sale: normalizedScomSale,
      buyer_action_id: actionRef.id,
      effective_date: null,
    };
  } catch (err: any) {
    console.error(
      `performBuyerPriceOverride error mpn=${mpn} value=${value}:`,
      err
    );
    return {
      status: "error",
      http_status: 500,
      mpn: mpn || "",
      error_code: "INTERNAL_ERROR",
      error_message: err?.message || "internal error",
    };
  }
}
