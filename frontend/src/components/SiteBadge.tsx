import type { JSX } from "react";
import { type SiteRegistryEntry } from "../lib/api";

// TALLY-PRODUCT-LIST-UX Phase 5A — Domain badge for product list cells.
//
// PO Ruling 5A.1 (2026-04-25): Architecture B — colors live in
// site_registry/<site_key>.badge_color. Active sites (shiekh / karmaloop /
// mltd) are seeded; the 5 inactive sites stay null and fall through to
// neutral gray here (hybrid runtime fallback).
//
// Two-state visual treatment is intentional:
//   * entry found AND badge_color non-null → solid color pill, white text
//   * entry not found OR badge_color null  → gray pill, dark text
// This makes "no color set yet" visible without being an error.
//
// SiteRegistryEntry uses `site_key` as the doc id (Phase 4.4 §3.1). Match
// on that — the dispatch reference snippet's `e.id` was an inadvertent
// drift from the live interface; the dispatch text instructed matching
// "by siteKey (matches the doc ID — shiekh, karmaloop, etc.)".
export function SiteBadge({
  siteKey,
  registry,
}: {
  siteKey: string;
  registry: SiteRegistryEntry[] | null;
}): JSX.Element {
  const entry = registry?.find((e) => e.site_key === siteKey);
  if (entry?.badge_color) {
    return (
      <span
        className="inline-block px-2 py-0.5 rounded text-xs font-medium text-white"
        style={{ backgroundColor: entry.badge_color }}
      >
        {entry.display_name ?? siteKey}
      </span>
    );
  }
  return (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
      {entry?.display_name ?? siteKey}
    </span>
  );
}
