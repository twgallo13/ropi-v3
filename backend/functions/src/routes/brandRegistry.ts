/**
 * Brand Registry — TALLY-BRAND-REGISTRY canonical endpoint.
 *
 *   GET /api/v1/brand-registry                  → all entries
 *   GET /api/v1/brand-registry?activeOnly=true  → is_active === true only
 *   GET /api/v1/brand-registry/:key             → single entry by key
 *
 * Response shape:
 *   { brands: [{ brand_key, display_name, aliases, default_site_owner, is_active, po_confirmed, notes, logo_url }] }
 *   { brand:   { brand_key, display_name, aliases, default_site_owner, is_active, po_confirmed, notes, logo_url } }
 *
 * Sorted by brand_key asc.
 *
 * Mirrors backend/functions/src/routes/departmentRegistry.ts.
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { BrandRegistryEntry, normalizeBrand, listBrandRegistry } from "../lib/brandRegistry";

const COLLECTION = "brand_registry";

/** Shape a Firestore doc payload into a BrandRegistryEntry. Pure. */
export function shapeBrandEntry(
  data: any,
  fallbackId: string
): BrandRegistryEntry {
  const d = data || {};
  const key = typeof d.brand_key === "string" && d.brand_key ? d.brand_key : fallbackId;
  return {
    brand_key: key,
    display_name: typeof d.display_name === "string" && d.display_name ? d.display_name : key,
    aliases: Array.isArray(d.aliases) ? (d.aliases as string[]) : [],
    default_site_owner: (d.default_site_owner as string | null) ?? null,
    is_active: d.is_active !== false,
    po_confirmed: !!d.po_confirmed,
    notes: (d.notes as string | null) ?? null,
    logo_url: (d.logo_url as string | null) ?? null,
  };
}

/** Sort comparator: brand_key asc. Pure. */
export function compareBrandEntries(
  a: BrandRegistryEntry,
  b: BrandRegistryEntry
): number {
  return a.brand_key.localeCompare(b.brand_key);
}

/** Filter entries by activeOnly flag. Pure. */
export function filterBrandEntries(
  entries: BrandRegistryEntry[],
  activeOnly: boolean
): BrandRegistryEntry[] {
  return entries.filter((e) => (activeOnly ? e.is_active : true));
}

const router = Router();

router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const activeOnly =
        String(req.query.activeOnly || "").toLowerCase() === "true";
      const entries = await listBrandRegistry();
      const brands = filterBrandEntries(entries, activeOnly).sort(
        compareBrandEntries
      );
      res.json({ brands });
    } catch (err: any) {
      console.error("GET /brand-registry error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  "/:key",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const key = normalizeBrand(req.params.key);
      if (!key) {
        res.status(400).json({ error: "key is required" });
        return;
      }
      const ref = admin.firestore().collection(COLLECTION).doc(key);
      const snap = await ref.get();
      if (!snap.exists) {
        res
          .status(404)
          .json({ error: `Brand "${req.params.key}" not found` });
        return;
      }
      res.json({ brand: shapeBrandEntry(snap.data(), snap.id) });
    } catch (err: any) {
      console.error("GET /brand-registry/:key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
