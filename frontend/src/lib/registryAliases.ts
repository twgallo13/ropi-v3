// TALLY-D2D — alias-walk helpers extracted from QuickEditPanel.tsx (L80-91, L93-104)
// so both QuickEditPanel and AttributeField can resolve raw display strings
// (e.g. "New Era") stored in attribute_values back to their canonical keys
// (e.g. "new_era") used by registry-driven dropdowns.
//
// Function bodies are verbatim moves from the originals (TALLY-149 era).

import type { BrandRegistryEntry, DepartmentRegistryEntry } from "./api";

// TALLY-149 — alias walk for legacy AV entries that store an alias value
// (e.g. pre-PR-#101 imports). Without this, alias-valued AV entries fall
// through to raw display and render "(inactive)" in QuickEdit.
export function displayToBrandKey(displayName: string, registry: BrandRegistryEntry[]): string {
  if (!displayName) return "";
  const norm = displayName.trim().toLowerCase();
  const match = registry.find(
    (b) =>
      b.brand_key.toLowerCase() === norm ||
      b.display_name.toLowerCase() === norm ||
      (Array.isArray(b.aliases) &&
        b.aliases.some((a: string) => typeof a === "string" && a.toLowerCase() === norm))
  );
  return match?.brand_key || displayName;
}

// TALLY-149 — alias walk; same rationale as displayToBrandKey.
export function displayToDeptKey(displayName: string, registry: DepartmentRegistryEntry[]): string {
  if (!displayName) return "";
  const norm = displayName.trim().toLowerCase();
  const match = registry.find(
    (d) =>
      d.key.toLowerCase() === norm ||
      d.display_name.toLowerCase() === norm ||
      (Array.isArray(d.aliases) &&
        d.aliases.some((a: string) => typeof a === "string" && a.toLowerCase() === norm))
  );
  return match?.key || displayName;
}
