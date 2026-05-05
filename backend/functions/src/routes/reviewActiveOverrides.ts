/**
 * TALLY-SHIPPING-OVERRIDE-CLEANUP PR 1.6 — Active Override Review
 *
 *   GET /api/v1/review/active-overrides
 *
 * Returns products that currently have a non-null standard_shipping_override
 * OR expedited_shipping_override, hydrated for Ropi-side editorial review.
 * Path B query approach (per v2.5/v2.6 dispatch §1.6): two `.where(field, "!=", null)`
 * Firestore queries (backed by composite indexes 99 + 100), deduped via Map keyed
 * by doc id. Indexes have `mpn ASC` tie-breaker for future cursor pagination.
 *
 * In-memory hydration adds:
 *   - brand registry lookup (display_name → brand_display_name, logo_url → brand_logo_url)
 *   - site_verification map-field read keyed by product.site_owner
 *     (per v2.6 anomaly-C ground truth: site_verification is a MAP FIELD on the
 *     product doc, not a subcollection — verified via grep on buyerReview.ts +
 *     siteVerificationReview.ts; see dispatch §1.6 aggregation rule)
 *   - sales_total = web_sales_30d + store_sales_30d
 *   - inventory_total = inventory_store + inventory_warehouse + inventory_whs
 *
 * Office Rule filters (4, all in-memory after Firestore fetch — Frink F4):
 *   - days_min       (default 30)  drop if days_since_verified < days_min OR null
 *   - sales_max      (default 1)   drop if sales_total >= sales_max
 *   - inventory_min  (default 1)   drop if inventory_total <= inventory_min
 *   - brand_key      (no default)  drop if row.brand_key !== brand_key (when set)
 *
 * Sort enum (8 literals, default last_verified_at_asc — most-stale first):
 *   last_verified_at_asc | last_verified_at_desc | mpn_asc | brand_asc |
 *   sales_asc | inventory_desc | std_shipping_desc | exp_shipping_desc
 * Unknown sort values fall through to no-reorder (return 0).
 *
 * Response envelope: { items: ActiveOverrideCandidate[], total: number }
 *
 * Auth: requireAuth + requireRole(["buyer","head_buyer","admin"]) per
 * cadenceReview.ts:18 closest-peer convention.
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { loadBrandRegistry, BrandRegistryEntry } from "../lib/brandRegistry";

const router = Router();
const db = () => admin.firestore();

const reviewRoles = ["buyer", "head_buyer", "admin"];

// ── Row + sort enum exports (per dispatch §1.6 v2.5/v2.6) ──

export interface ActiveOverrideCandidate {
  mpn: string;
  name: string | null;
  brand_key: string | null;
  brand_display_name: string | null;
  brand_logo_url: string | null;
  primary_image_url: string | null;
  site_owner: string | null;
  last_verified_at: string | null;        // ISO-8601 (Frink F8)
  days_since_verified: number | null;     // computed
  product_url: string | null;
  web_sales_30d: number;
  store_sales_30d: number;
  sales_total: number;                    // computed
  inventory_store: number;
  inventory_warehouse: number;
  inventory_whs: number;
  inventory_total: number;                // computed
  standard_shipping_override: number | null;
  expedited_shipping_override: number | null;
  pricing_domain_state: string | null;
}

export type ActiveOverrideSortBy =
  | "last_verified_at_asc"   // default; oldest verified date first (most stale)
  | "last_verified_at_desc"  // newest verified date first
  | "mpn_asc"                // alphanumeric A→Z
  | "brand_asc"              // brand display name A→Z
  | "sales_asc"              // lowest sales_total first
  | "inventory_desc"         // highest inventory_total first
  | "std_shipping_desc"      // highest standard override first; null sorts last
  | "exp_shipping_desc";     // highest expedited override first; null sorts last

// ── GET /api/v1/review/active-overrides ──
router.get(
  "/",
  requireAuth,
  requireRole(reviewRoles),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Parse query params with documented defaults.
      const daysMin = Number.isFinite(parseInt((req.query.days_min as string) ?? "", 10))
        ? parseInt(req.query.days_min as string, 10)
        : 0;
      const salesMax = Number.isFinite(parseFloat((req.query.sales_max as string) ?? ""))
        ? parseFloat(req.query.sales_max as string)
        : 9999999;
      const inventoryMin = Number.isFinite(parseInt((req.query.inventory_min as string) ?? "", 10))
        ? parseInt(req.query.inventory_min as string, 10)
        : -1;
      const brandFilter =
        typeof req.query.brand_key === "string" && req.query.brand_key.trim()
          ? req.query.brand_key.trim()
          : null;
      const sortBy = ((req.query.sort_by as string) || "last_verified_at_asc") as ActiveOverrideSortBy;

      // Path B: two .where(field, "!=", null) queries deduped via Map.
      // Backed by composite indexes 99 + 100 (firebase/firestore.indexes.json).
      const [stdSnap, expSnap] = await Promise.all([
        db().collection("products").where("standard_shipping_override", "!=", null).get(),
        db().collection("products").where("expedited_shipping_override", "!=", null).get(),
      ]);

      const productMap = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
      for (const d of stdSnap.docs) productMap.set(d.id, d);
      for (const d of expSnap.docs) if (!productMap.has(d.id)) productMap.set(d.id, d);

      // Pre-fetch brand registry once (Frink F3 registry-resolved naming).
      const brandRegistry = await loadBrandRegistry();

      const now = Date.now();
      const rows: ActiveOverrideCandidate[] = [];

      for (const docSnap of productMap.values()) {
        const p = docSnap.data() as any;

        // site_verification map field keyed by site_owner (v2.6 anomaly-C
        // ground truth: map on product doc, NOT subcollection).
        const siteOwner: string | null =
          typeof p.site_owner === "string" && p.site_owner.trim() ? p.site_owner.trim() : null;
        const siteVerification: any =
          siteOwner && p.site_verification && typeof p.site_verification === "object"
            ? p.site_verification[siteOwner] ?? {}
            : {};
        const lastVerifiedAt: string | null =
          siteVerification.last_verified_at?.toDate?.()?.toISOString?.() ?? null;
        const daysSinceVerified: number | null = lastVerifiedAt
          ? Math.floor((now - new Date(lastVerifiedAt).getTime()) / 86_400_000)
          : null;

        // Brand registry lookup (renames per dispatch §1.6 hydration).
        const brandKey: string | null =
          typeof p.brand_key === "string" && p.brand_key.trim() ? p.brand_key.trim() : null;
        const brandEntry: BrandRegistryEntry | null = brandKey
          ? brandRegistry.get(brandKey) ?? null
          : null;

        // Sales / inventory aggregates.
        const webSales = Number(p.web_sales_30d) || 0;
        const storeSales = Number(p.store_sales_30d) || 0;
        const salesTotal = webSales + storeSales;

        const invStore = Number(p.inventory_store) || 0;
        const invWarehouse = Number(p.inventory_warehouse) || 0;
        const invWhs = Number(p.inventory_whs) || 0;
        const invTotal = invStore + invWarehouse + invWhs;

        const stdOverride =
          typeof p.standard_shipping_override === "number" ? p.standard_shipping_override : null;
        const expOverride =
          typeof p.expedited_shipping_override === "number" ? p.expedited_shipping_override : null;

        rows.push({
          mpn: typeof p.mpn === "string" ? p.mpn : docSnap.id,
          name: typeof p.name === "string" ? p.name : null,
          brand_key: brandKey,
          brand_display_name: brandEntry?.display_name ?? null,
          brand_logo_url: brandEntry?.logo_url ?? null,
          primary_image_url:
            typeof p.primary_image_url === "string" ? p.primary_image_url : null,
          site_owner: siteOwner,
          last_verified_at: lastVerifiedAt,
          days_since_verified: daysSinceVerified,
          product_url: typeof p.product_url === "string" ? p.product_url : null,
          web_sales_30d: webSales,
          store_sales_30d: storeSales,
          sales_total: salesTotal,
          inventory_store: invStore,
          inventory_warehouse: invWarehouse,
          inventory_whs: invWhs,
          inventory_total: invTotal,
          standard_shipping_override: stdOverride,
          expedited_shipping_override: expOverride,
          pricing_domain_state:
            typeof p.pricing_domain_state === "string" ? p.pricing_domain_state : null,
        });
      }

      // Office Rule filters — all in-memory after fetch.
      const filtered = rows.filter((r) => {
        // PO 2026-05-08 (Track 1B): conditional null-handling.
        // - daysMin=0 (no-op default): nulls admitted alongside non-nulls.
        // - daysMin>0 (user-set filter): nulls dropped — user is hunting
        //   for old verified products, so unverified candidates are excluded.
        if (daysMin > 0 && r.days_since_verified === null) return false;
        if (r.days_since_verified !== null && r.days_since_verified < daysMin) return false;
        // sales_max: drop if sales_total >= sales_max
        if (r.sales_total >= salesMax) return false;
        // inventory_min: drop if inventory_total <= inventory_min
        if (r.inventory_total <= inventoryMin) return false;
        // brand_key: drop if row.brand_key !== brandFilter (only when filter set)
        if (brandFilter && r.brand_key !== brandFilter) return false;
        return true;
      });

      // Sort enum dispatch (in-memory). For shipping-override-desc sorts,
      // null values sort last per dispatch §1.6.
      filtered.sort((a, b) => {
        switch (sortBy) {
          case "last_verified_at_asc":
            return (a.last_verified_at ?? "").localeCompare(b.last_verified_at ?? "");
          case "last_verified_at_desc":
            return (b.last_verified_at ?? "").localeCompare(a.last_verified_at ?? "");
          case "mpn_asc":
            return a.mpn.localeCompare(b.mpn);
          case "brand_asc":
            return (a.brand_display_name ?? "").localeCompare(b.brand_display_name ?? "");
          case "sales_asc":
            return a.sales_total - b.sales_total;
          case "inventory_desc":
            return b.inventory_total - a.inventory_total;
          case "std_shipping_desc": {
            const av = a.standard_shipping_override;
            const bv = b.standard_shipping_override;
            if (av === null && bv === null) return 0;
            if (av === null) return 1;
            if (bv === null) return -1;
            return bv - av;
          }
          case "exp_shipping_desc": {
            const av = a.expedited_shipping_override;
            const bv = b.expedited_shipping_override;
            if (av === null && bv === null) return 0;
            if (av === null) return 1;
            if (bv === null) return -1;
            return bv - av;
          }
          default:
            return 0;
        }
      });

      res.json({ items: filtered, total: filtered.length });
    } catch (err: any) {
      console.error("GET /api/v1/review/active-overrides error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
