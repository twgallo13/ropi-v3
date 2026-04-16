/**
 * Export Payload Serializer — Step 1.7 Part 2
 * Produces one JSON object per MPN with all required export fields.
 * Section 19.9 field definitions. All data type notes mandatory.
 */
import admin from "firebase-admin";
import { mpnToDocId } from "./mpnUtils";
import { apply99Rounding } from "./pricingUtils";

const db = () => admin.firestore();

export interface ExportRow {
  mpn: string;
  sku: string | null;
  brand: string | null;
  name: string;
  hierarchy: {
    department: string | null;
    class: string | null;
    category: string | null;
  };
  colors: {
    primary: string | null;
    descriptive: string | null;
  };
  pricing: {
    scom: number;
    scomSale: number | null;
    export_rics_offer: number;
    is_map_constrained: boolean;
    is_loss_leader: boolean;
    cost_is_estimated: boolean;
  };
  product_is_active: boolean;
  promo_flags: {
    promo: boolean;
    web_discount_cap: string;
  };
  seo: {
    meta_name: string;
    meta_description: string;
    keywords: string;
  };
  site_targets: string[];
  push_list_ids: string[];
}

/**
 * Serialize a single product for export.
 * Reads the product doc, attribute_values subcollection, pricing_snapshots,
 * site_targets, and the latest approved buyer_action.
 */
export async function serializeProduct(mpn: string): Promise<ExportRow> {
  const docId = mpnToDocId(mpn);
  const productRef = db().collection("products").doc(docId);
  const doc = await productRef.get();

  if (!doc.exists) {
    throw new Error(`Product ${mpn} not found`);
  }

  const p = doc.data()!;

  // Fetch attribute_values for fields not on the product document
  const attrSnap = await productRef.collection("attribute_values").get();
  const attrs: Record<string, any> = {};
  attrSnap.forEach((a) => {
    if (a.id !== "source_inputs") attrs[a.id] = a.data().value;
  });

  // Fetch latest pricing snapshot for is_map_constrained, is_loss_leader, cost_is_estimated
  const snapshotSnap = await productRef
    .collection("pricing_snapshots")
    .orderBy("resolved_at", "desc")
    .limit(1)
    .get();
  const snapshot = snapshotSnap.docs[0]?.data() || {};

  // scomSale: $0 or missing = null (AC8 — never export 0.0)
  const scomSale = p.scom_sale && p.scom_sale > 0 ? p.scom_sale : null;

  // promo: map "Allowed"/"Disallowed" string to Boolean (AC7)
  const promoRaw = attrs["promo"];
  const promo = promoRaw === "Allowed" ? true : false;

  // web_discount_cap: validate against allowed enum, default to "NO" (TALLY-084)
  const WEB_DISCOUNT_CAP_ENUM = ["NO", "5", "10", "15", "20", "25", "30"];
  const rawCap = attrs["web_discount_cap"];
  const webDiscountCap = rawCap && WEB_DISCOUNT_CAP_ENUM.includes(String(rawCap))
    ? String(rawCap)
    : "NO";

  // site_targets: domains where product is export-eligible
  const siteSnap = await productRef.collection("site_targets").get();
  const siteTargets = siteSnap.docs
    .map((s) => s.data().domain)
    .filter(Boolean) as string[];

  // push_list_ids: always export as array, never omit (AC4)
  // Phase 1: Push Lists not yet implemented — always []
  const pushListIds: string[] = [];

  // Apply .99 rounding to export prices (TALLY-101)
  // Find the latest approved buyer_action for this product
  let exportRicsOffer: number;
  try {
    const actionSnap = await db()
      .collection("buyer_actions")
      .where("mpn", "==", mpn)
      .where("action_type", "==", "approve")
      .orderBy("created_at", "desc")
      .limit(1)
      .get();

    exportRicsOffer = actionSnap.docs[0]?.data().export_rics_offer
      || apply99Rounding(p.rics_offer || 0);
  } catch {
    // Fallback if composite index not yet built
    exportRicsOffer = apply99Rounding(p.rics_offer || 0);
  }

  // Price cap: export price must never exceed scom (regular selling price)
  const scom = p.scom || 0;
  if (scom > 0 && exportRicsOffer > scom) {
    exportRicsOffer = apply99Rounding(scom);
  }

  return {
    mpn: p.mpn || mpn,
    sku: p.sku || null,
    brand: p.brand || null,
    name: p.name,
    hierarchy: {
      department: attrs["department"] || null,
      class: attrs["class"] || null,
      category: attrs["category"] || null,
    },
    colors: {
      primary: attrs["primary_color"] || null,
      descriptive: attrs["descriptive_color"] || null,
    },
    pricing: {
      scom: p.scom || 0,
      scomSale,
      export_rics_offer: exportRicsOffer,
      is_map_constrained: snapshot.is_map_constrained || false,
      is_loss_leader: snapshot.is_loss_leader || false,
      cost_is_estimated:
        snapshot.cost_is_estimated !== undefined
          ? snapshot.cost_is_estimated
          : true,
    },
    product_is_active: p.product_is_active || false,
    promo_flags: {
      promo,
      web_discount_cap: webDiscountCap,
    },
    seo: {
      meta_name: attrs["meta_name"] || "",
      meta_description: attrs["meta_description"] || "",
      keywords: attrs["keywords"] || "",
    },
    site_targets: siteTargets,
    push_list_ids: pushListIds,
  };
}
