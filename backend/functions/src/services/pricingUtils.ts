/**
 * Pricing utility functions — TALLY-101
 * .99 rounding and price validation helpers.
 */

/**
 * has_valid_value — rejects null, undefined, empty string, and zero.
 * $0 means "not set," not a real price (Section 19.7).
 */
export function hasValidValue(val: unknown): boolean {
  if (val === null || val === undefined || val === "") return false;
  if (typeof val === "number" && val === 0) return false;
  return true;
}

/**
 * apply99Rounding — TALLY-101
 * Always rounds DOWN so exported price never exceeds approved amount.
 * Algorithm: Math.floor(price) - 0.01
 * Applied at export payload build time, NOT at buyer approval time.
 */
export function apply99Rounding(calculatedPrice: number): number {
  // Already ends in .99 — no change
  if (Math.round((calculatedPrice % 1) * 100) === 99) {
    return calculatedPrice;
  }
  // Always round DOWN — never up
  return Math.floor(calculatedPrice) - 0.01;
}
