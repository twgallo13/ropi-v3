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
import { requireRole } from "../middleware/roles";
import { BrandRegistryEntry, normalizeBrand, listBrandRegistry } from "../lib/brandRegistry";

const COLLECTION = "brand_registry";
const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

async function writeBrandAudit(
  action: string,
  entityId: string,
  actorUid: string,
  details: Record<string, any>
): Promise<void> {
  try {
    await db().collection("audit_log").add({
      action,
      entity_type: "brand_registry",
      entity_id: entityId,
      actor_uid: actorUid,
      details,
      timestamp: ts(),
    });
  } catch (err: any) {
    console.error("audit_log write failed:", err.message);
  }
}

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

// ────────────────────────────────────────────────
// POST /api/v1/brand-registry — create new brand
// ────────────────────────────────────────────────
router.post(
  "/",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body || {};
      const {
        brand_key,
        display_name,
        aliases,
        default_site_owner,
        is_active,
        po_confirmed,
        notes,
        logo_url,
      } = body;

      if (typeof brand_key !== "string" || brand_key.trim() === "") {
        res.status(400).json({ error: "brand_key is required (non-empty string)" });
        return;
      }
      if (typeof display_name !== "string" || display_name.trim() === "") {
        res.status(400).json({ error: "display_name is required (non-empty string)" });
        return;
      }

      const normalizedKey = normalizeBrand(brand_key);
      if (!normalizedKey) {
        res.status(400).json({ error: "brand_key normalized to empty string" });
        return;
      }

      const ref = db().collection(COLLECTION).doc(normalizedKey);
      const existing = await ref.get();
      if (existing.exists) {
        res.status(409).json({ error: "brand_key already exists" });
        return;
      }

      // FK check on default_site_owner (E.2): must be active site_registry doc.
      if (default_site_owner !== undefined && default_site_owner !== null) {
        const siteSnap = await db()
          .collection("site_registry")
          .doc(default_site_owner)
          .get();
        if (!siteSnap.exists || siteSnap.get("is_active") !== true) {
          res.status(400).json({
            error: "default_site_owner not found or inactive",
          });
          return;
        }
      }

      // Aliases — normalize + dedupe via Set on normalized values.
      const inputAliases = Array.isArray(aliases) ? aliases : [];
      const normalizedAliases = inputAliases.map((a: string) => normalizeBrand(a));
      const dedupedAliases = Array.from(new Set(normalizedAliases)).filter((a) => a);

      // Alias uniqueness across ACTIVE brands (E.1).
      const activeBrandsSnap = await db()
        .collection(COLLECTION)
        .where("is_active", "==", true)
        .get();
      for (const doc of activeBrandsSnap.docs) {
        if (doc.id === normalizedKey) continue;
        const existingAliases = (doc.get("aliases") ?? []).map((a: string) =>
          normalizeBrand(a)
        );
        for (const inputAlias of dedupedAliases) {
          if (inputAlias === doc.id || existingAliases.includes(inputAlias)) {
            res.status(409).json({
              error: "alias collision",
              brand_key: doc.id,
              alias: inputAlias,
            });
            return;
          }
        }
        if (existingAliases.includes(normalizedKey)) {
          res.status(409).json({
            error: "brand_key collides with existing alias",
            brand_key: doc.id,
          });
          return;
        }
      }

      const payload: Record<string, any> = {
        brand_key: normalizedKey,
        display_name: display_name.trim(),
        aliases: dedupedAliases,
        default_site_owner: default_site_owner ?? null,
        is_active: typeof is_active === "boolean" ? is_active : true,
        po_confirmed: typeof po_confirmed === "boolean" ? po_confirmed : false,
        notes: notes ?? null,
        logo_url: logo_url ?? null,
        created_at: ts(),
        created_by: req.user!.uid,
        updated_at: ts(),
        updated_by: req.user!.uid,
      };
      await ref.set(payload);

      await writeBrandAudit("brand_registry_created", normalizedKey, req.user!.uid, {
        brand_key: normalizedKey,
        display_name: payload.display_name,
      });

      const refetched = (await ref.get()).data();
      res.status(201).json({ brand: refetched });
    } catch (err: any) {
      console.error("POST /brand-registry error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ────────────────────────────────────────────────
// PUT /api/v1/brand-registry/:brand_key — update (key immutable)
// ────────────────────────────────────────────────
router.put(
  "/:brand_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body || {};
      const pathKey = normalizeBrand(req.params.brand_key);

      if (
        body.brand_key !== undefined &&
        normalizeBrand(body.brand_key) !== pathKey
      ) {
        res.status(400).json({ error: "brand_key is immutable" });
        return;
      }

      if (body.display_name !== undefined) {
        if (typeof body.display_name !== "string" || body.display_name.trim() === "") {
          res.status(400).json({ error: "display_name must be a non-empty string" });
          return;
        }
      }

      const ref = db().collection(COLLECTION).doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `brand "${req.params.brand_key}" not found` });
        return;
      }
      const existingData = existing.data() || {};

      // PO-A2-6 FK skip on default_site_owner.
      const dsoProvided = Object.prototype.hasOwnProperty.call(body, "default_site_owner");
      if (dsoProvided) {
        const newDso = body.default_site_owner;
        const skip =
          newDso === existingData.default_site_owner || newDso === null;
        if (!skip) {
          const siteSnap = await db()
            .collection("site_registry")
            .doc(newDso)
            .get();
          if (!siteSnap.exists || siteSnap.get("is_active") !== true) {
            res.status(400).json({
              error: "default_site_owner not found or inactive",
            });
            return;
          }
        }
      }

      // Aliases (if provided): same normalize/dedupe/uniqueness pipeline.
      let dedupedAliases: string[] | undefined;
      if (body.aliases !== undefined) {
        const inputAliases: string[] = Array.isArray(body.aliases) ? body.aliases : [];
        const normalizedAliases: string[] = inputAliases.map((a) => normalizeBrand(a));
        dedupedAliases = Array.from(new Set<string>(normalizedAliases)).filter((a) => a);

        const activeBrandsSnap = await db()
          .collection(COLLECTION)
          .where("is_active", "==", true)
          .get();
        const aliasesForCheck: string[] = dedupedAliases;
        for (const doc of activeBrandsSnap.docs) {
          if (doc.id === pathKey) continue;
          const existingAliases = (doc.get("aliases") ?? []).map((a: string) =>
            normalizeBrand(a)
          );
          for (const inputAlias of aliasesForCheck) {
            if (inputAlias === doc.id || existingAliases.includes(inputAlias)) {
              res.status(409).json({
                error: "alias collision",
                brand_key: doc.id,
                alias: inputAlias,
              });
              return;
            }
          }
        }
      }

      const patch: Record<string, any> = {};
      if (body.display_name !== undefined) patch.display_name = body.display_name.trim();
      if (dedupedAliases !== undefined) patch.aliases = dedupedAliases;
      if (dsoProvided) patch.default_site_owner = body.default_site_owner ?? null;
      if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
      if (typeof body.po_confirmed === "boolean") patch.po_confirmed = body.po_confirmed;
      if (body.notes !== undefined) patch.notes = body.notes;
      if (body.logo_url !== undefined) patch.logo_url = body.logo_url;
      patch.updated_at = ts();
      patch.updated_by = req.user!.uid;

      await ref.set(patch, { merge: true });

      await writeBrandAudit("brand_registry_updated", pathKey, req.user!.uid, {
        patch_keys: Object.keys(patch),
      });

      const refetched = (await ref.get()).data();
      res.status(200).json({ brand: refetched });
    } catch (err: any) {
      console.error("PUT /brand-registry/:brand_key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ────────────────────────────────────────────────
// DELETE /api/v1/brand-registry/:brand_key — soft deactivation
// ────────────────────────────────────────────────
router.delete(
  "/:brand_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pathKey = normalizeBrand(req.params.brand_key);
      const ref = db().collection(COLLECTION).doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `brand "${req.params.brand_key}" not found` });
        return;
      }

      await ref.set(
        {
          is_active: false,
          updated_at: ts(),
          updated_by: req.user!.uid,
        },
        { merge: true }
      );

      await writeBrandAudit("brand_registry_deleted", pathKey, req.user!.uid, {
        brand_key: pathKey,
      });

      const refetched = (await ref.get()).data();
      res.status(200).json({ brand: refetched });
    } catch (err: any) {
      console.error("DELETE /brand-registry/:brand_key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
