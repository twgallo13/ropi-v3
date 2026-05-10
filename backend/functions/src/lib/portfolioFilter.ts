/**
 * Track 3 — Shared portfolio filtering predicate.
 *
 * Mirrors cadenceEngine.resolveBuyerForProduct steps 1+2 (exclusions veto +
 * AND-match across portfolio dimensions) without the tie-breaker logic.
 * Used by the Cockpit aggregator (buyerReview.ts) and by buyer-scoped filter
 * paths in mapReview.ts and pricingDiscrepancy.ts.
 *
 * Convention: brand and department compare on `_key` form (lowercase registry
 * keys); site/class/age_group/gender compare on display form. Mirrors the
 * Track 2 amendment logic in cadenceEngine.ts:111–143 exactly.
 */
import admin from "firebase-admin";
import { BuyerPortfolio, PortfolioAttributes } from "../types/cadence";

export type { BuyerPortfolio } from "../types/cadence";

export function buildBuyerPortfolio(uid: string, data: any): BuyerPortfolio {
  const exc = data.portfolio_exclusions || {};
  const rawAttrs =
    data.portfolio_attributes && typeof data.portfolio_attributes === "object"
      ? data.portfolio_attributes
      : {};
  const portfolio_attributes: PortfolioAttributes = Object.fromEntries(
    Object.entries(rawAttrs).filter(([, v]) => typeof v === "boolean")
  ) as PortfolioAttributes;
  return {
    uid,
    role: data.role as "buyer" | "head_buyer" | "owner",
    portfolio_brands: new Set<string>(data.portfolio_brands || []),
    portfolio_depts: new Set<string>(data.portfolio_depts || []),
    portfolio_sites: new Set<string>(data.portfolio_sites || []),
    portfolio_age_groups: new Set<string>(data.portfolio_age_groups || []),
    portfolio_gender: new Set<string>(data.portfolio_gender || []),
    portfolio_attributes,
    portfolio_exclusions: {
      brand: new Set<string>(exc.brand || []),
      department: new Set<string>(exc.department || []),
      class: new Set<string>(exc.class || []),
      site: new Set<string>(exc.site || []),
      age_group: new Set<string>(exc.age_group || []),
      gender: new Set<string>(exc.gender || []),
    },
  };
}

export function productMatchesBuyerPortfolio(
  product: any,
  buyer: BuyerPortfolio
): boolean {
  const productBrandKey = String(product.brand_key || "");
  const productDeptKey = String(product.department_key || "");
  const productSite = String(product.site_owner || "");
  const productClass = String(product.class || "");
  const productAge = String(product.age_group || "");
  const productGender = String(product.gender || "");

  // Step 1 — exclusions veto (6 dimensions)
  if (productBrandKey && buyer.portfolio_exclusions.brand.has(productBrandKey)) return false;
  if (productDeptKey && buyer.portfolio_exclusions.department.has(productDeptKey)) return false;
  if (productClass && buyer.portfolio_exclusions.class.has(productClass)) return false;
  if (productSite && buyer.portfolio_exclusions.site.has(productSite)) return false;
  if (productAge && buyer.portfolio_exclusions.age_group.has(productAge)) return false;
  if (productGender && buyer.portfolio_exclusions.gender.has(productGender)) return false;

  // Step 2 — AND-match across 6 portfolio dimensions (5 existing + portfolio_attributes)
  // Empty buyer set on a dim = wildcard for that dim.
  if (buyer.portfolio_brands.size > 0 && !buyer.portfolio_brands.has(productBrandKey)) return false;
  if (buyer.portfolio_depts.size > 0 && !buyer.portfolio_depts.has(productDeptKey)) return false;
  if (buyer.portfolio_sites.size > 0 && !buyer.portfolio_sites.has(productSite)) return false;
  if (buyer.portfolio_age_groups.size > 0 && !buyer.portfolio_age_groups.has(productAge)) return false;
  if (buyer.portfolio_gender.size > 0 && !buyer.portfolio_gender.has(productGender)) return false;

  // 6th dim — portfolio_attributes (boolean AND-match against root or attributes bag).
  // Mirrors cadenceEngine.productMatchesBuyerPortfolio exactly.
  const attrKeys = Object.keys(buyer.portfolio_attributes);
  if (attrKeys.length > 0) {
    for (const key of attrKeys) {
      const expected = buyer.portfolio_attributes[key];
      const fromBag = product?.attributes?.[key];
      const fromRoot = product?.[key];
      const got = fromBag !== undefined ? fromBag : fromRoot;
      if (Boolean(got) !== Boolean(expected)) return false;
    }
  }

  return true;
}

/**
 * Loads a buyer's portfolio from Firestore. Returns null if user not found.
 */
export async function loadBuyerPortfolio(uid: string): Promise<BuyerPortfolio | null> {
  const doc = await admin.firestore().collection("users").doc(uid).get();
  if (!doc.exists) return null;
  return buildBuyerPortfolio(uid, doc.data() || {});
}
