/**
 * Active registry authority — shared lib lift from adminUsers.ts.
 * Mirrors lib/brandRegistry.ts pattern. Used by:
 *   - admin user portfolio validator (adminUsers.ts)
 *   - future engine consumers (Track 2+)
 */
import admin from "firebase-admin";

export interface ActiveRegistryAuthority {
  brand: Set<string>;
  department: Set<string>;
  site: Set<string>;
  class: Set<string>;
  age_group: Set<string>;
  gender: Set<string>;
}

export async function loadRegistryAuthority(): Promise<ActiveRegistryAuthority> {
  const fs = admin.firestore();
  const [brandSnap, deptSnap, siteSnap, classDoc, ageDoc, genderDoc] = await Promise.all([
    fs.collection("brand_registry").where("is_active", "==", true).get(),
    fs.collection("department_registry").where("is_active", "==", true).get(),
    fs.collection("site_registry").where("is_active", "==", true).get(),
    fs.collection("attribute_registry").doc("class").get(),
    fs.collection("attribute_registry").doc("age_group").get(),
    fs.collection("attribute_registry").doc("gender").get(),
  ]);
  const classOpts = ((classDoc.data() || {}).dropdown_options || []) as string[];
  const ageOpts = ((ageDoc.data() || {}).dropdown_options || []) as string[];
  const genderOpts = ((genderDoc.data() || {}).dropdown_options || []) as string[];
  return {
    brand: new Set(brandSnap.docs.map((d) => d.id)),
    department: new Set(deptSnap.docs.map((d) => d.id)),
    site: new Set(siteSnap.docs.map((d) => d.id)),
    class: new Set(classOpts),
    age_group: new Set(ageOpts),
    gender: new Set(genderOpts),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue #1 — Import canonicalization helpers.
//
// Walk active registry entries to resolve raw CSV strings to canonical
// `_key` + display. Match priority: lowercase key → case-insensitive
// display_name → case-insensitive alias walk. Inactive entries are NOT
// resolved against (PO ruling 4 — deactivation cascade deferred).
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalRegistryMatch {
  key: string;
  display: string;
  matchedBy: "key" | "display" | "alias";
}

export type Canonicalizer = (raw: string | null | undefined) => CanonicalRegistryMatch | null;

async function buildCanonicalizerFromCollection(
  collectionName: string,
  keyField: string = "key"
): Promise<Canonicalizer> {
  const snap = await admin
    .firestore()
    .collection(collectionName)
    .where("is_active", "==", true)
    .get();

  const byKey = new Map<string, { key: string; display: string }>();
  const byDisplay = new Map<string, { key: string; display: string }>();
  const byAlias = new Map<string, { key: string; display: string }>();

  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>;
    // TALLY-149 — brand_registry stores `brand_key` (not `key`). Without
    // parameterization, fallback to doc.id produced root.brand_key drift
    // for docs where doc.id !== brand_key (e.g. "field grade" vs "field_grade").
    const key = String(d[keyField] || doc.id).toLowerCase().trim();
    const display = String(d.display_name || d.name || doc.id);
    const entry = { key, display };

    byKey.set(key, entry);
    if (display) {
      byDisplay.set(display.toLowerCase().trim(), entry);
    }

    const aliases: string[] = Array.isArray(d.aliases) ? (d.aliases as string[]) : [];
    for (const alias of aliases) {
      if (alias && typeof alias === "string") {
        byAlias.set(alias.toLowerCase().trim(), entry);
      }
    }
  }

  return function canonicalize(raw: string | null | undefined): CanonicalRegistryMatch | null {
    if (raw == null) return null;
    const trimmed = String(raw).trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();

    const byKeyHit = byKey.get(lower);
    if (byKeyHit) return { key: byKeyHit.key, display: byKeyHit.display, matchedBy: "key" };

    const byDisplayHit = byDisplay.get(lower);
    if (byDisplayHit) return { key: byDisplayHit.key, display: byDisplayHit.display, matchedBy: "display" };

    const byAliasHit = byAlias.get(lower);
    if (byAliasHit) return { key: byAliasHit.key, display: byAliasHit.display, matchedBy: "alias" };

    return null;
  };
}

export async function buildBrandCanonicalizer(): Promise<Canonicalizer> {
  return buildCanonicalizerFromCollection("brand_registry", "brand_key");
}

export async function buildDepartmentCanonicalizer(): Promise<Canonicalizer> {
  return buildCanonicalizerFromCollection("department_registry", "key");
}

/**
 * Site owner canonicalizer — matches raw CSV Website-column domain values
 * against the site_registry. Primary match is by domain field (site docs
 * store a single `domain` string). Fallbacks: site_key, then display_name.
 * site_registry has no `aliases` field; domain is the natural alias layer.
 */
export async function buildSiteOwnerCanonicalizer(): Promise<Canonicalizer> {
  const snap = await admin
    .firestore()
    .collection("site_registry")
    .where("is_active", "==", true)
    .get();

  const byDomain = new Map<string, { key: string; display: string }>();
  const byKey = new Map<string, { key: string; display: string }>();
  const byDisplay = new Map<string, { key: string; display: string }>();

  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const key = String(d.site_key || doc.id).toLowerCase().trim();
    const display = String(d.display_name || d.name || doc.id);
    const entry = { key, display };

    byKey.set(key, entry);
    if (display) byDisplay.set(display.toLowerCase().trim(), entry);

    const domain = d.domain;
    if (domain && typeof domain === "string") {
      byDomain.set(domain.toLowerCase().trim(), entry);
    }
  }

  return function canonicalize(raw: string | null | undefined): CanonicalRegistryMatch | null {
    if (raw == null) return null;
    const trimmed = String(raw).trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();

    // Domain match is primary: CSV Website values are domain strings.
    const domainHit = byDomain.get(lower);
    if (domainHit) return { key: domainHit.key, display: domainHit.display, matchedBy: "key" };

    const keyHit = byKey.get(lower);
    if (keyHit) return { key: keyHit.key, display: keyHit.display, matchedBy: "key" };

    const displayHit = byDisplay.get(lower);
    if (displayHit) return { key: displayHit.key, display: displayHit.display, matchedBy: "display" };

    return null;
  };
}

/**
 * TALLY-D2C — Build brand_key → default_site_owner Map from active brand_registry.
 * Used by import pipeline to override CSV-derived site_owner with brand defaults.
 * Map values are canonical site_keys (e.g., "shiekh", "mltd", "karmaloop") or null
 * if the brand has no default. Cost: 1 collection read per import batch.
 */
export async function buildBrandDefaultSiteOwnerMap(
  db: admin.firestore.Firestore
): Promise<Map<string, string | null>> {
  const snap = await db.collection("brand_registry").where("is_active", "==", true).get();
  const out = new Map<string, string | null>();
  for (const doc of snap.docs) {
    const d = doc.data();
    const key = String(d.brand_key || "").toLowerCase().trim();
    if (key) out.set(key, (d.default_site_owner as string | null) ?? null);
  }
  return out;
}
