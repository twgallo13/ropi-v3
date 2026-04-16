/**
 * Step 2.1 — MAP State utility.
 * Reads real MAP state from the product document (populated by MAP Policy Import).
 * Replaces the Phase 1 hardcoded default in importWeeklyOperations.ts.
 */
import admin from "firebase-admin";
import { mpnToDocId } from "./mpnUtils";
import type { MapState } from "./pricingResolution";

export async function getMapState(mpn: string): Promise<MapState> {
  const db = admin.firestore();
  const doc = await db.collection("products").doc(mpnToDocId(mpn)).get();
  const p = doc.data() || {};

  if (!p.is_map_protected) {
    return {
      is_active: false,
      map_price: 0,
      promo_price: null,
      promo_start: null,
      promo_end: null,
    };
  }

  const today = new Date().toISOString().split("T")[0];
  const isAlwaysOn = p.map_is_always_on === true;
  const startDate = p.map_start_date || null;
  const endDate = p.map_end_date || null;
  const isDateBound = !!(startDate && endDate);
  const isInWindow = isDateBound && today >= startDate && today <= endDate;
  const isActive = isAlwaysOn || isInWindow;

  // Promo price wins during an active date window (Section 14.4)
  const effectiveMapPrice =
    isInWindow && p.map_promo_price
      ? Number(p.map_promo_price)
      : Number(p.map_price) || 0;

  return {
    is_active: !!isActive,
    map_price: effectiveMapPrice || 0,
    promo_price: p.map_promo_price != null ? Number(p.map_promo_price) : null,
    promo_start: startDate ? new Date(startDate) : null,
    promo_end: endDate ? new Date(endDate) : null,
  };
}
