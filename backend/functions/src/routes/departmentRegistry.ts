/**
 * Department Registry — TALLY-DEPARTMENT-REGISTRY canonical endpoint.
 *
 *   GET /api/v1/department-registry                  → all entries
 *   GET /api/v1/department-registry?activeOnly=true  → is_active === true only
 *   GET /api/v1/department-registry/:key             → single entry by key
 *
 * Response shape:
 *   { departments: [{ key, display_name, aliases, is_active, priority, po_confirmed }] }
 *   { department:   { key, display_name, aliases, is_active, priority, po_confirmed } }
 *
 * Sorted by priority ascending, then key.
 *
 * Mirrors backend/functions/src/routes/siteRegistry.ts (Phase 4.4 §3.1).
 *
 * PO Ruling A (2026-04-23): department_registry mirrors brand_registry +
 * site_registry pattern exactly. PO Ruling G (soft deactivation) +
 * Ruling H (no hard-delete) apply: this tally exposes READS only.
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";

const COLLECTION = "department_registry";
const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

async function writeDepartmentAudit(
  action: string,
  entityId: string,
  actorUid: string,
  details: Record<string, any>
): Promise<void> {
  try {
    await db().collection("audit_log").add({
      action,
      entity_type: "department_registry",
      entity_id: entityId,
      actor_uid: actorUid,
      details,
      timestamp: ts(),
    });
  } catch (err: any) {
    console.error("audit_log write failed:", err.message);
  }
}

export interface DepartmentRegistryEntry {
  key: string;
  display_name: string;
  aliases: string[];
  is_active: boolean;
  priority: number;
  po_confirmed: boolean;
}

/** Shape a Firestore doc payload into a DepartmentRegistryEntry. Pure. */
export function shapeDepartmentEntry(
  data: any,
  fallbackId: string
): DepartmentRegistryEntry {
  const d = data || {};
  return {
    key: typeof d.key === "string" && d.key ? d.key : fallbackId,
    display_name:
      typeof d.display_name === "string" && d.display_name
        ? d.display_name
        : fallbackId,
    aliases: Array.isArray(d.aliases) ? (d.aliases as string[]) : [],
    is_active: d.is_active === true,
    priority: typeof d.priority === "number" ? d.priority : 999,
    po_confirmed: !!d.po_confirmed,
  };
}

export function normalizeDepartment(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase();
}

/** Sort comparator: priority asc, then key asc. Pure. */
export function compareDepartmentEntries(
  a: DepartmentRegistryEntry,
  b: DepartmentRegistryEntry
): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.key.localeCompare(b.key);
}

/** Filter entries by activeOnly flag. Pure. */
export function filterDepartmentEntries(
  entries: DepartmentRegistryEntry[],
  activeOnly: boolean
): DepartmentRegistryEntry[] {
  return entries.filter((e) => (activeOnly ? e.is_active : true));
}

/**
 * Build a lowercase Set of all values that count as a match for an ACTIVE
 * registry entry: key, display_name, and each alias. Used by validation.
 * Inactive entries (PO Ruling G — soft deactivation) are excluded; their
 * values reject NEW writes but do not retroactively invalidate existing
 * product attribute_values.
 */
export function resolveAllowedDepartmentValues(
  entries: DepartmentRegistryEntry[]
): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    if (!e.is_active) continue;
    const k = normalizeDepartment(e.key);
    if (k) out.add(k);
    const dn = normalizeDepartment(e.display_name);
    if (dn) out.add(dn);
    for (const a of e.aliases) {
      const na = normalizeDepartment(a);
      if (na) out.add(na);
    }
  }
  return out;
}

/**
 * Validate a candidate value against the active-entries allowlist.
 * Case-insensitive, whitespace-trimmed. Pure.
 */
export function isDepartmentValueAllowed(
  value: unknown,
  entries: DepartmentRegistryEntry[]
): boolean {
  if (value === null || value === undefined) return false;
  const v = normalizeDepartment(String(value));
  if (!v) return false;
  return resolveAllowedDepartmentValues(entries).has(v);
}

/** Load all department_registry docs from Firestore. */
export async function loadDepartmentRegistry(): Promise<DepartmentRegistryEntry[]> {
  const snap = await admin.firestore().collection(COLLECTION).get();
  return snap.docs.map((d) => shapeDepartmentEntry(d.data(), d.id));
}

const router = Router();

router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const activeOnly =
        String(req.query.activeOnly || "").toLowerCase() === "true";
      const entries = await loadDepartmentRegistry();
      const departments = filterDepartmentEntries(entries, activeOnly).sort(
        compareDepartmentEntries
      );
      res.json({ departments });
    } catch (err: any) {
      console.error("GET /department-registry error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  "/:key",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const key = normalizeDepartment(req.params.key);
      if (!key) {
        res.status(400).json({ error: "key is required" });
        return;
      }
      const ref = admin.firestore().collection(COLLECTION).doc(key);
      const snap = await ref.get();
      if (!snap.exists) {
        res
          .status(404)
          .json({ error: `Department "${req.params.key}" not found` });
        return;
      }
      res.json({ department: shapeDepartmentEntry(snap.data(), snap.id) });
    } catch (err: any) {
      console.error("GET /department-registry/:key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ────────────────────────────────────────────────
// POST /api/v1/department-registry — create new department
// ────────────────────────────────────────────────
router.post(
  "/",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body || {};
      const { key, display_name, aliases, is_active, priority, po_confirmed } = body;

      if (typeof key !== "string" || key.trim() === "") {
        res.status(400).json({ error: "key is required (non-empty string)" });
        return;
      }
      if (typeof display_name !== "string" || display_name.trim() === "") {
        res.status(400).json({ error: "display_name is required (non-empty string)" });
        return;
      }

      const normalizedKey = normalizeDepartment(key);
      if (!normalizedKey) {
        res.status(400).json({ error: "key normalized to empty string" });
        return;
      }

      const ref = db().collection(COLLECTION).doc(normalizedKey);
      const existing = await ref.get();
      if (existing.exists) {
        res.status(409).json({ error: "key already exists" });
        return;
      }

      const inputAliases = Array.isArray(aliases) ? aliases : [];
      const normalizedAliases = inputAliases.map((a: string) => normalizeDepartment(a));
      const dedupedAliases = Array.from(new Set(normalizedAliases)).filter((a) => a);

      // Alias uniqueness across ACTIVE departments (E.1).
      const activeDeptsSnap = await db()
        .collection(COLLECTION)
        .where("is_active", "==", true)
        .get();
      for (const doc of activeDeptsSnap.docs) {
        if (doc.id === normalizedKey) continue;
        const existingAliases = (doc.get("aliases") ?? []).map((a: string) =>
          normalizeDepartment(a)
        );
        for (const inputAlias of dedupedAliases) {
          if (inputAlias === doc.id || existingAliases.includes(inputAlias)) {
            res.status(409).json({
              error: "alias collision",
              key: doc.id,
              alias: inputAlias,
            });
            return;
          }
        }
        if (existingAliases.includes(normalizedKey)) {
          res.status(409).json({
            error: "key collides with existing alias",
            key: doc.id,
          });
          return;
        }
      }

      const payload: Record<string, any> = {
        key: normalizedKey,
        display_name: display_name.trim(),
        aliases: dedupedAliases,
        is_active: typeof is_active === "boolean" ? is_active : true,
        priority: typeof priority === "number" ? priority : 0,
        po_confirmed: typeof po_confirmed === "boolean" ? po_confirmed : false,
        created_at: ts(),
        created_by: req.user!.uid,
        updated_at: ts(),
        updated_by: req.user!.uid,
      };
      await ref.set(payload);

      await writeDepartmentAudit(
        "department_registry_created",
        normalizedKey,
        req.user!.uid,
        { key: normalizedKey, display_name: payload.display_name }
      );

      const refetched = (await ref.get()).data();
      res.status(201).json({ department: refetched });
    } catch (err: any) {
      console.error("POST /department-registry error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ────────────────────────────────────────────────
// PUT /api/v1/department-registry/:key — update (key immutable)
// ────────────────────────────────────────────────
router.put(
  "/:key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body || {};
      const pathKey = normalizeDepartment(req.params.key);

      if (body.key !== undefined && normalizeDepartment(body.key) !== pathKey) {
        res.status(400).json({ error: "key is immutable" });
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
        res.status(404).json({ error: `department "${req.params.key}" not found` });
        return;
      }

      let dedupedAliases: string[] | undefined;
      if (body.aliases !== undefined) {
        const inputAliases: string[] = Array.isArray(body.aliases) ? body.aliases : [];
        const normalizedAliases: string[] = inputAliases.map((a) => normalizeDepartment(a));
        dedupedAliases = Array.from(new Set<string>(normalizedAliases)).filter((a) => a);

        const activeDeptsSnap = await db()
          .collection(COLLECTION)
          .where("is_active", "==", true)
          .get();
        const aliasesForCheck: string[] = dedupedAliases;
        for (const doc of activeDeptsSnap.docs) {
          if (doc.id === pathKey) continue;
          const existingAliases = (doc.get("aliases") ?? []).map((a: string) =>
            normalizeDepartment(a)
          );
          for (const inputAlias of aliasesForCheck) {
            if (inputAlias === doc.id || existingAliases.includes(inputAlias)) {
              res.status(409).json({
                error: "alias collision",
                key: doc.id,
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
      if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
      if (typeof body.priority === "number") patch.priority = body.priority;
      if (typeof body.po_confirmed === "boolean") patch.po_confirmed = body.po_confirmed;
      patch.updated_at = ts();
      patch.updated_by = req.user!.uid;

      await ref.set(patch, { merge: true });

      await writeDepartmentAudit(
        "department_registry_updated",
        pathKey,
        req.user!.uid,
        { patch_keys: Object.keys(patch) }
      );

      const refetched = (await ref.get()).data();
      res.status(200).json({ department: refetched });
    } catch (err: any) {
      console.error("PUT /department-registry/:key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ────────────────────────────────────────────────
// DELETE /api/v1/department-registry/:key — soft deactivation
// ────────────────────────────────────────────────
router.delete(
  "/:key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pathKey = normalizeDepartment(req.params.key);
      const ref = db().collection(COLLECTION).doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `department "${req.params.key}" not found` });
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

      await writeDepartmentAudit(
        "department_registry_deleted",
        pathKey,
        req.user!.uid,
        { key: pathKey }
      );

      const refetched = (await ref.get()).data();
      res.status(200).json({ department: refetched });
    } catch (err: any) {
      console.error("DELETE /department-registry/:key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
