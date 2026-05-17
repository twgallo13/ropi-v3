/**
 * TALLY-157 — applyStepOverride utility.
 *
 * Scoped, buyer-scoped mutation path for `cadence_assignments.current_step`.
 * Per dispatch: "Do not write direct step mutations to cadence_assignments
 * outside applyStepOverride." All buyer-initiated step changes MUST flow
 * through this helper.
 *
 * Immediate-path only — no scheduling, no cadence lock, no promotion-job
 * wiring (per TALLY-157 build-order item 3 constraints).
 *
 * Behavior:
 *   1. Validates inputs.
 *   2. Loads cadence_assignments/{docId}; requires existence + matched_rule_id.
 *   3. Loads cadence_rules/{matched_rule_id}; verifies target step exists
 *      in markdown_steps[].
 *   4. Writes ONLY the following fields to cadence_assignments/{docId}:
 *        - current_step                = target_step_number
 *        - step_first_matched_at       = serverTimestamp()
 *        - days_at_current_step        = 0
 *        - last_evaluated_at           = serverTimestamp()
 *        - step_override               = { active: true, by_user_id, at,
 *                                          target_step_number,
 *                                          previous_step_number,
 *                                          reason }
 *        - recommendation              = null  (force fresh cadence
 *                                               evaluation to populate;
 *                                               the engine is the only
 *                                               surface that should
 *                                               compute recommendations)
 *        - in_cadence_review_queue     = true   (surface immediately
 *                                                for buyer review)
 *        - last_buyer_action           = "step_override"
 *        - last_buyer_action_at        = serverTimestamp()
 *   5. Writes audit_log entry (event_type "buyer_action_step_override").
 *
 * Does NOT write to the products doc, the buyer_actions collection, or
 * the pricing-export queue. Step override is a cadence-state change,
 * not a price change.
 */
import admin from "firebase-admin";
import { mpnToDocId } from "./mpnUtils";

const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

export type StepOverrideParams = {
  mpn: string;
  target_step_number: number;
  reason?: string | null;
  buyerUserId: string;
};

export type StepOverrideOk = {
  status: "ok";
  http_status: 200;
  mpn: string;
  previous_step: number | null;
  current_step: number;
  matched_rule_id: string;
  matched_rule_version: number | null;
  buyer_action_id: string;
};

export type StepOverrideError = {
  status: "error";
  http_status: number;
  mpn: string;
  error_code:
    | "MISSING_FIELDS"
    | "INVALID_STEP_NUMBER"
    | "NO_CADENCE_ASSIGNMENT"
    | "NO_MATCHED_RULE"
    | "RULE_NOT_FOUND"
    | "INVALID_TARGET_STEP"
    | "INTERNAL_ERROR";
  error_message: string;
};

export type StepOverrideResult = StepOverrideOk | StepOverrideError;

export async function applyStepOverride(
  params: StepOverrideParams
): Promise<StepOverrideResult> {
  const { mpn, target_step_number, reason, buyerUserId } = params;

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

    if (
      typeof target_step_number !== "number" ||
      !Number.isInteger(target_step_number) ||
      target_step_number < 1
    ) {
      return {
        status: "error",
        http_status: 400,
        mpn,
        error_code: "INVALID_STEP_NUMBER",
        error_message: "target_step_number must be a positive integer",
      };
    }

    const docId = mpnToDocId(mpn);
    const assignRef = db().collection("cadence_assignments").doc(docId);
    const assignSnap = await assignRef.get();

    if (!assignSnap.exists) {
      return {
        status: "error",
        http_status: 404,
        mpn,
        error_code: "NO_CADENCE_ASSIGNMENT",
        error_message: "No cadence_assignments doc exists for this mpn",
      };
    }

    const assign = assignSnap.data()!;
    const matchedRuleId: string | null = assign.matched_rule_id || null;
    if (!matchedRuleId) {
      return {
        status: "error",
        http_status: 400,
        mpn,
        error_code: "NO_MATCHED_RULE",
        error_message:
          "cadence_assignments doc has no matched_rule_id — cannot validate target step",
      };
    }

    const ruleSnap = await db()
      .collection("cadence_rules")
      .doc(matchedRuleId)
      .get();
    if (!ruleSnap.exists) {
      return {
        status: "error",
        http_status: 404,
        mpn,
        error_code: "RULE_NOT_FOUND",
        error_message: `matched_rule_id "${matchedRuleId}" not found in cadence_rules`,
      };
    }

    const rule = ruleSnap.data()!;
    const matchedRuleVersion: number | null =
      typeof rule.version === "number" ? rule.version : null;
    const steps: any[] = Array.isArray(rule.markdown_steps)
      ? rule.markdown_steps
      : [];
    const targetExists = steps.some(
      (s) => typeof s?.step_number === "number" && s.step_number === target_step_number
    );
    if (!targetExists) {
      return {
        status: "error",
        http_status: 400,
        mpn,
        error_code: "INVALID_TARGET_STEP",
        error_message: `target_step_number ${target_step_number} is not a defined step on rule "${matchedRuleId}"`,
      };
    }

    const previousStep: number | null =
      typeof assign.current_step === "number" ? assign.current_step : null;

    const updates: Record<string, any> = {
      current_step: target_step_number,
      step_first_matched_at: ts(),
      days_at_current_step: 0,
      last_evaluated_at: ts(),
      // Force fresh cadence engine recommendation on next evaluation.
      // Per dispatch constraints, this utility never re-computes
      // recommendations — only the cadence engine does.
      recommendation: null,
      in_cadence_review_queue: true,
      last_buyer_action: "step_override",
      last_buyer_action_at: ts(),
      step_override: {
        active: true,
        by_user_id: buyerUserId,
        at: ts(),
        target_step_number,
        previous_step_number: previousStep,
        reason: reason || null,
      },
    };

    await assignRef.set(updates, { merge: true });

    // Lineage read: pricing_domain_state from products doc (best-effort).
    // Step override does NOT change pricing_domain_state, so before == after.
    // Null if products doc is absent.
    let pricingDomainState: string | null = null;
    try {
      const productSnap = await db().collection("products").doc(docId).get();
      if (productSnap.exists) {
        const p = productSnap.data() || {};
        pricingDomainState =
          typeof p.pricing_domain_state === "string"
            ? p.pricing_domain_state
            : null;
      }
    } catch (perr: any) {
      console.error(
        `applyStepOverride: pricing_domain_state read failed mpn=${mpn}:`,
        perr
      );
    }

    // TALLY-157 R3 ruling — buyer_actions lineage write for step override.
    // action_type="buyer_step_override" (NOT "buyer_price_override", NOT
    // any cadence markdown action_type). Lineage-only: no pricing fields,
    // no export queue, no scheduling. effective_date null (immediate).
    const actionRef = await db().collection("buyer_actions").add({
      mpn,
      buyer_user_id: buyerUserId,
      action_type: "buyer_step_override",
      previous_step: previousStep,
      target_step: target_step_number,
      matched_rule_id: matchedRuleId,
      matched_rule_version: matchedRuleVersion,
      reason: reason || null,
      pricing_domain_state_before: pricingDomainState,
      pricing_domain_state_after: pricingDomainState,
      effective_date: null,
      created_at: ts(),
    });

    await db().collection("audit_log").add({
      product_mpn: mpn,
      event_type: "buyer_action_step_override",
      matched_rule_id: matchedRuleId,
      matched_rule_version: matchedRuleVersion,
      previous_step_number: previousStep,
      target_step_number,
      reason: reason || null,
      acting_user_id: buyerUserId,
      buyer_action_id: actionRef.id,
      created_at: ts(),
    });

    return {
      status: "ok",
      http_status: 200,
      mpn,
      previous_step: previousStep,
      current_step: target_step_number,
      matched_rule_id: matchedRuleId,
      matched_rule_version: matchedRuleVersion,
      buyer_action_id: actionRef.id,
    };
  } catch (err: any) {
    console.error(
      `applyStepOverride error mpn=${mpn} target=${target_step_number}:`,
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
