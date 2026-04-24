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

const COLLECTION = "department_registry";

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

export default router;
