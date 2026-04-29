/**
 * Canonical role inventory for ROPI V3.
 *
 * Source-of-truth for the role_permissions admin UI (read-only matrix).
 * Hand-maintained per A.3 ruling R.2 (codegen DROPPED — see D.3 Frink correction).
 *
 * 8 roles surfaced via direct requireRole(...) calls.
 * 2 roles surfaced ONLY via LAUNCH_EDITOR_ROLES indirection.
 * Total unique: 10.
 *
 * KNOWN GAP (deferred to A.4 User Management track per Ruling C.3):
 *   `content_manager` and `launch_lead` are not present in adminUsers.ts
 *   ALLOWED_ROLES (lines 16-24). Users can be granted these roles via direct
 *   Firebase custom-claim manipulation but NOT through the Admin Users UI.
 *   A.4 should add both to ALLOWED_ROLES to close the gap.
 */
export const CANONICAL_ROLES = [
  // Direct requireRole(...) callers:
  { role: "admin",                 source: "direct",        representative_ref: "adminUsers.ts:30" },
  { role: "owner",                 source: "direct",        representative_ref: "adminUsers.ts:30" },
  { role: "buyer",                 source: "direct",        representative_ref: "cadenceRules.ts:18" },
  { role: "head_buyer",            source: "direct",        representative_ref: "mapReview.ts:19" },
  { role: "map_analyst",           source: "direct",        representative_ref: "mapImport.ts:110" },
  { role: "operations_operator",   source: "direct",        representative_ref: "pricingDiscrepancy.ts:22" },
  { role: "product_ops",           source: "direct",        representative_ref: "siteVerificationReview.ts:38" },
  { role: "completion_specialist", source: "direct",        representative_ref: "aiContent.ts:21" },
  // LAUNCH_EDITOR_ROLES indirection (no direct requireRole(...) at root):
  { role: "content_manager",       source: "launch_editor", representative_ref: "launches.ts:45" },
  { role: "launch_lead",           source: "launch_editor", representative_ref: "launches.ts:45" },
] as const;

export type CanonicalRole = (typeof CANONICAL_ROLES)[number]["role"];
