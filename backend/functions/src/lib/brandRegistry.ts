/**
 * Brand Registry — TALLY-128 §3 governance layer.
 *
 * Brand→Site Owner canonical mapping stored in Firestore (collection:
 * `brand_registry`). Replaces hardcoded brand string lists in backfill
 * scripts. Also exposes a tolerant `deriveSiteTargetKeys()` helper for the
 * Layer 3 (site_targets) derivation per PO ruling R2-Q1 amended.
 */
import admin from "firebase-admin";

export interface BrandRegistryEntry {
  brand_key: string;
  display_name: string;
  aliases: string[];
  default_site_owner: string | null;
  is_active: boolean;
  po_confirmed: boolean;
  notes: string | null;
  logo_url: string | null;
}

/**
 * Normalize a brand string for lookup: trim whitespace + lowercase.
 * Per §3 Matcher Contract.
 */
export function normalizeBrand(input: string | null | undefined): string {
  if (!input || typeof input !== "string") return "";
  return input.trim().toLowerCase();
}

/**
 * Load active Brand Registry into a normalized lookup Map keyed by
 * `brand_key` (already lowercase by convention). Aliases are NOT pre-expanded
 * here; matchBrand() walks them per lookup so registry edits don't require
 * cache invalidation.
 *
 * Only `is_active == true` entries are returned.
 */
export async function loadBrandRegistry(): Promise<Map<string, BrandRegistryEntry>> {
  const snap = await admin
    .firestore()
    .collection("brand_registry")
    .where("is_active", "==", true)
    .get();

  const out = new Map<string, BrandRegistryEntry>();
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const key = normalizeBrand(d.brand_key as string);
    if (!key) continue;
    out.set(key, {
      brand_key: key,
      display_name: (d.display_name as string) || key,
      aliases: Array.isArray(d.aliases) ? (d.aliases as string[]) : [],
      default_site_owner: (d.default_site_owner as string | null) ?? null,
      is_active: d.is_active !== false,
      po_confirmed: !!d.po_confirmed,
      notes: (d.notes as string | null) ?? null,
      logo_url: (d.logo_url as string | null) ?? null,
    });
  }
  return out;
}

/**
 * Match a brand string against the registry per §3 Matcher Contract:
 *   1. normalize input (trim + lowercase)
 *   2. exact key match
 *   3. alias match (each alias normalized at compare time)
 *   4. else null
 *
 * Case-insensitive + whitespace-trimmed on both sides. No destructive
 * normalization of the product catalog.
 */
export function matchBrand(
  inputBrand: string | null | undefined,
  registry: Map<string, BrandRegistryEntry>,
): BrandRegistryEntry | null {
  const normalized = normalizeBrand(inputBrand);
  if (!normalized) return null;

  const direct = registry.get(normalized);
  if (direct) return direct;

  for (const entry of registry.values()) {
    if (!entry.aliases || entry.aliases.length === 0) continue;
    for (const alias of entry.aliases) {
      if (normalizeBrand(alias) === normalized) return entry;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Tolerant site_targets derivation — PO ruling R2-Q1 (amended 2026-04-20)
// ─────────────────────────────────────────────────────────────────────────

export interface ActiveRegistrySite {
  site_key: string;
  domain: string | null;
  is_active: boolean;
}

export interface ActiveRegistryView {
  hasSiteKey(normalizedKey: string): boolean;
  findByDomain(normalizedDomain: string): ActiveRegistrySite | null;
  allSiteKeys(): string[];
}

/**
 * Build a lookup view over the active site_registry for derivation use.
 * Both site_key and domain lookups are case-insensitive (R2-Q4 confirmed
 * lowercase empirically; defensive normalization retained).
 */
export function buildActiveRegistryView(sites: ActiveRegistrySite[]): ActiveRegistryView {
  const byKey = new Map<string, ActiveRegistrySite>();
  const byDomain = new Map<string, ActiveRegistrySite>();
  for (const s of sites) {
    if (!s.is_active) continue;
    const k = (s.site_key || "").trim().toLowerCase();
    if (k) byKey.set(k, s);
    const d = (s.domain || "").trim().toLowerCase();
    if (d) byDomain.set(d, s);
  }
  return {
    hasSiteKey(normalizedKey: string): boolean {
      return byKey.has(normalizedKey);
    },
    findByDomain(normalizedDomain: string): ActiveRegistrySite | null {
      return byDomain.get(normalizedDomain) || null;
    },
    allSiteKeys(): string[] {
      return Array.from(byKey.keys());
    },
  };
}

export interface DeriveSiteTargetsResult {
  /** Site keys present in active registry, derived from product's Active Websites. */
  targetKeys: Set<string>;
  /** Active Websites values that did NOT resolve to any active registry site. */
  nonRegistryValues: string[];
}

/**
 * Tolerant Active Websites → site_targets derivation per R2-Q1 amended.
 *
 *   For each value in product.attribute_values.website (mixed format —
 *   bare site_keys AND full domains observed empirically):
 *     1. normalize (trim + lowercase)
 *     2. if registry.hasSiteKey(normalized) → add normalized
 *     3. else if registry.findByDomain(normalized) → add match.site_key
 *     4. else → record as non-registry value (gap tracking)
 *
 * NOT domain parsing; uses direct equality against stored domain field.
 * Returns Set + non-registry list for caller-side gap reporting.
 */
export function deriveSiteTargetKeys(
  activeWebsiteValues: Array<string | null | undefined> | null | undefined,
  registry: ActiveRegistryView,
): DeriveSiteTargetsResult {
  const targetKeys = new Set<string>();
  const nonRegistryValues: string[] = [];
  if (!Array.isArray(activeWebsiteValues)) {
    return { targetKeys, nonRegistryValues };
  }
  for (const raw of activeWebsiteValues) {
    if (raw === null || raw === undefined) continue;
    const normalized = String(raw).trim().toLowerCase();
    if (!normalized) continue;
    if (registry.hasSiteKey(normalized)) {
      targetKeys.add(normalized);
      continue;
    }
    const byDomain = registry.findByDomain(normalized);
    if (byDomain) {
      const k = (byDomain.site_key || "").trim().toLowerCase();
      if (k) targetKeys.add(k);
      continue;
    }
    nonRegistryValues.push(normalized);
  }
  return { targetKeys, nonRegistryValues };
}

/**
 * Load all brand_registry docs from Firestore.
 * Mirrors loadDepartmentRegistry pattern (returns all entries, route filters).
 */
export async function listBrandRegistry(): Promise<BrandRegistryEntry[]> {
  const snap = await admin.firestore().collection("brand_registry").get();
  return snap.docs.map((doc) => {
    const d = doc.data() || {};
    const key = (typeof d.brand_key === "string" && d.brand_key) ? d.brand_key : doc.id;
    return {
      brand_key: key,
      display_name: (typeof d.display_name === "string" && d.display_name) ? d.display_name : key,
      aliases: Array.isArray(d.aliases) ? (d.aliases as string[]) : [],
      default_site_owner: (d.default_site_owner as string | null) ?? null,
      is_active: d.is_active !== false,
      po_confirmed: !!d.po_confirmed,
      notes: (d.notes as string | null) ?? null,
      logo_url: (d.logo_url as string | null) ?? null,
    };
  });
}
