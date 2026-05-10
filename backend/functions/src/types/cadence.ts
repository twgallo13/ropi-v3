/**
 * TALLY-D2A — shared cadence types.
 * Single source of truth for cadence_state values, BuyerResolution shape,
 * and BuyerPortfolio interface used by both cadenceEngine.ts and portfolioFilter.ts.
 */

export type CadenceState =
  | "assigned"
  | "unassigned"
  | "rule_conflict"
  | "excluded";

export type UnassignedReason = "no_rule_match" | "no_buyer_match";

export interface PortfolioAttributes {
  [field_key: string]: boolean;
}

export interface PortfolioExclusions {
  brand: Set<string>;
  department: Set<string>;
  class: Set<string>;
  site: Set<string>;
  age_group: Set<string>;
  gender: Set<string>;
}

export interface BuyerPortfolio {
  uid: string;
  role: "buyer" | "head_buyer" | "owner";
  portfolio_brands: Set<string>;
  portfolio_depts: Set<string>;
  portfolio_sites: Set<string>;
  portfolio_age_groups: Set<string>;
  portfolio_gender: Set<string>;
  portfolio_attributes: PortfolioAttributes;
  portfolio_exclusions: PortfolioExclusions;
}

export type BuyerResolution =
  | { result: "matched"; primary_user_id: string; support_user_ids: string[] }
  | { result: "no_buyer_match" };
