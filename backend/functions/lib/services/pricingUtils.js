"use strict";
/**
 * Pricing utility functions — TALLY-101
 * .99 rounding and price validation helpers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasValidValue = hasValidValue;
exports.apply99Rounding = apply99Rounding;
/**
 * has_valid_value — rejects null, undefined, empty string, and zero.
 * $0 means "not set," not a real price (Section 19.7).
 */
function hasValidValue(val) {
    if (val === null || val === undefined || val === "")
        return false;
    if (typeof val === "number" && val === 0)
        return false;
    return true;
}
/**
 * apply99Rounding — TALLY-101
 * Always rounds DOWN so exported price never exceeds approved amount.
 * Algorithm: Math.floor(price) - 0.01
 * Applied at export payload build time, NOT at buyer approval time.
 */
function apply99Rounding(calculatedPrice) {
    // Already ends in .99 — no change
    if (Math.round((calculatedPrice % 1) * 100) === 99) {
        return calculatedPrice;
    }
    // Always round DOWN — never up
    return Math.floor(calculatedPrice) - 0.01;
}
//# sourceMappingURL=pricingUtils.js.map