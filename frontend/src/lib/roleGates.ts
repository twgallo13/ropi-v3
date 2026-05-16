/**
 * TALLY-146 PR 2 v2.5 — FE per-component role gates that mirror the BE
 * `requireRole` / `requireAuth` gates for cockpit bulk + single-item actions.
 *
 * Source of truth for each helper (verbatim BE references):
 *
 *   canCallBulkMarkdown     → POST /api/v1/products/bulk/markdown
 *     backend/functions/src/routes/products.ts:1803–1807
 *     requireRole(["admin","owner","buyer","head_buyer"])  // PR 3 (670e8ce)
 *
 *   canCallBulkAssignSupport → POST /api/v1/products/bulk/assign-support
 *     backend/functions/src/routes/products.ts:1907
 *     requireRole(["admin","owner"])
 *
 *   canCallBuyerAction      → POST /api/v1/buyer-actions/markdown
 *     backend/functions/src/routes/buyerActions.ts:28
 *     requireAuth ONLY — no requireRole. All 4 cockpit roles allowed.
 *
 *   canCallBuyerHold        → POST /api/v1/buyer-actions/hold
 *     backend/functions/src/routes/buyerActions.ts:77
 *     requireAuth ONLY — no requireRole. All 4 cockpit roles allowed.
 *
 * `role` is sourced from `useAuth().role` (frontend/src/contexts/AuthContext.tsx:14)
 * which is `string | null`. A null/unknown role is treated as no-access (false).
 */

const COCKPIT_ROLES = ["admin", "owner", "buyer", "head_buyer"] as const;

export function canCallBulkMarkdown(role: string | null | undefined): boolean {
  if (!role) return false;
  return ["admin", "owner", "buyer", "head_buyer"].includes(role);
}

export function canCallBulkAssignSupport(role: string | null | undefined): boolean {
  if (!role) return false;
  return ["admin", "owner"].includes(role);
}

export function canCallBuyerAction(role: string | null | undefined): boolean {
  if (!role) return false;
  // BE: requireAuth only (buyerActions.ts:28). All 4 cockpit roles allowed.
  return (COCKPIT_ROLES as readonly string[]).includes(role);
}

export function canCallBuyerHold(role: string | null | undefined): boolean {
  if (!role) return false;
  // BE: requireAuth only (buyerActions.ts:77). All 4 cockpit roles allowed.
  return (COCKPIT_ROLES as readonly string[]).includes(role);
}
