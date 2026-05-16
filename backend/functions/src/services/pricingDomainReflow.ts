/**
 * TALLY-146 PR 1 — Pricing Domain State Reflow service.
 *
 * Extracted from the per-MPN reflow closure originally defined inline at
 * products.ts:1113 (TALLY-3.8-DEFECT-1, FA11 / FA11.7). Two surfaces:
 *
 *   - reflowPricingDomainStateForMpn(mpn, userId, batchTag?) — per-MPN
 *     reflow used by the existing manual-edit single-product paths
 *     (scom/scom_sale edit, MAP auto-populate). Behavior identical to
 *     the original closure: fresh productRef read, resolvePricing,
 *     writePricingSnapshot, conditional payload clear on
 *     "Pricing Current". Fire-and-forget — failures NEVER throw.
 *
 *   - reflowPricingDomainStateBatch({ mpns, userId, batchTag }) — bulk
 *     wrapper for the TALLY-146 bulk endpoints. Issues ONE reflow per
 *     unique MPN after the bulk write loop completes. Emits two
 *     grep-able Cloud Run log lines ("[reflowPricingDomainState] batch
 *     start" + "complete") so the per-request invocation count can be
 *     verified from logs. Per-item errors are absorbed + counted; they
 *     do NOT short-circuit the batch.
 */
import admin from "firebase-admin";
import { mpnToDocId } from "./mpnUtils";
import {
  resolvePricing,
  writePricingSnapshot,
  type PricingInputs,
} from "./pricingResolution";
import { getMapState } from "./mapState";
import { getAdminSettings } from "./adminSettings";

const db = () => admin.firestore();

export async function reflowPricingDomainStateForMpn(
  mpn: string,
  userId: string,
  batchTag: string = "manual_edit"
): Promise<void> {
  try {
    const productRef = db().collection("products").doc(mpnToDocId(mpn));
    const batchId = `${batchTag}_${userId}_${Date.now()}`;
    const freshSnap = await productRef.get();
    if (!freshSnap.exists) return;
    const pdata = freshSnap.data() || {};
    const pricingInputs: PricingInputs = {
      rics_retail: Number(pdata.rics_retail) || 0,
      rics_offer: Number(pdata.rics_offer) || 0,
      scom: Number(pdata.scom) || 0,
      scom_sale: Number(pdata.scom_sale) || 0,
      actual_cost: pdata.actual_cost ?? null,
    };
    const [mapState, adminSettings] = await Promise.all([
      getMapState(mpn),
      getAdminSettings(),
    ]);
    const result = await resolvePricing(
      mpn,
      pricingInputs,
      mapState,
      adminSettings
    );
    // Option D resolution (Lisa-asserted reconciliation): match
    // importWeeklyOperations.ts:328 canonical pattern — writes the
    // snapshot UNCONDITIONALLY. writePricingSnapshot is the canonical
    // writer for the projection booleans (is_loss_leader,
    // is_map_constrained, map_conflict_active, is_store_sale_web_full,
    // is_web_sale_store_full) and refreshes them atomically inside a
    // single productRef.set merge.
    await writePricingSnapshot(mpn, batchId, result);
    if (result.status === "Pricing Current") {
      // FA11.7 caveat: writePricingSnapshot does NOT clear the four
      // payload fields written by routeToLossLeaderReview /
      // routeToPricingDiscrepancy. Without this explicit clear,
      // executiveProjections.ts:388-397 reads stale values and shows
      // the product as still flagged despite is_loss_leader=false.
      await productRef.set(
        {
          loss_leader_payload: null,
          loss_leader_flagged_at: null,
          discrepancy_reasons: null,
          discrepancy_flagged_at: null,
        },
        { merge: true }
      );
    }
    // "Loss-Leader Review Pending" / "Pricing Discrepancy" branches:
    // routeToLossLeaderReview / routeToPricingDiscrepancy inside
    // resolvePricing already wrote pricing_domain_state and the
    // relevant payload fields. No caller-side action needed.
  } catch (rerr: any) {
    console.error(
      `resolvePricing reflow (${batchTag}) failed for mpn=${mpn}:`,
      rerr
    );
  }
}

export async function reflowPricingDomainStateBatch(opts: {
  mpns: string[];
  userId: string;
  batchTag: string;
}): Promise<{ ok: number; error: number }> {
  const { mpns, userId, batchTag } = opts;
  const unique = Array.from(new Set(mpns.filter((m) => !!m)));
  console.log(
    `[reflowPricingDomainState] batch start tag=${batchTag} mpns=${unique.length}`
  );
  let ok = 0;
  let error = 0;
  for (const mpn of unique) {
    try {
      await reflowPricingDomainStateForMpn(mpn, userId, batchTag);
      ok++;
    } catch (err: any) {
      // reflowPricingDomainStateForMpn already swallows its own
      // errors; this catch is a defensive backstop only.
      console.error(
        `[reflowPricingDomainState] unexpected throw for mpn=${mpn}:`,
        err
      );
      error++;
    }
  }
  console.log(
    `[reflowPricingDomainState] batch complete tag=${batchTag} ok=${ok} error=${error}`
  );
  return { ok, error };
}
