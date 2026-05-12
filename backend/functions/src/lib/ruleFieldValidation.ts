/**
 * TALLY-146B — Rule Field Validator Tightening.
 *
 * Hard-rejects the two legacy display-string fields that TALLY-146A
 * cleaned out of active rule data:
 *   - "brand"      → must use "brand_key"
 *   - "department" → must use "department_key"
 *
 * Used by:
 *   - backend/functions/src/routes/adminSmartRules.ts  (validateRuleBody)
 *   - backend/functions/src/routes/cadenceRules.ts     (validateRule)
 *
 * Per PO ruling: smallest safe blocklist. All other field strings
 * (canonical keys, source-input fields, dotted paths) are preserved
 * unchanged so working non-brand/department rules are not affected.
 */

export const LEGACY_RULE_FIELD_REPLACEMENTS: Record<string, string> = {
  brand: "brand_key",
  department: "department_key",
};

/**
 * Returns a 400-style error message when `field` is one of the
 * blocked legacy display-string fields, or null otherwise.
 *
 * @param field   The field string from the rule payload (any type).
 * @param context Caller context label, e.g. "condition.field" or
 *                "target_filters[].field". Used to build the message.
 */
export function rejectLegacyRuleField(
  field: unknown,
  context: string
): string | null {
  if (typeof field !== "string") return null;
  const replacement = LEGACY_RULE_FIELD_REPLACEMENTS[field];
  if (replacement) {
    return `${context} "${field}" is not canonical; use "${replacement}"`;
  }
  return null;
}
