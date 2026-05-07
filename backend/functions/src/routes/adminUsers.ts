/**
 * adminUsers — Step 4.2 Tab 1
 * Admin CRUD for platform users. Firebase Auth account + Firestore users/{uid}.
 *   GET    /api/v1/admin/users          — list
 *   POST   /api/v1/admin/users          — create (auto temp password)
 *   PUT    /api/v1/admin/users/:uid     — update role / portfolio_… / display_name
 *   DELETE /api/v1/admin/users/:uid     — disable account
 *
 * Phase 3.12 Track 1A — User Portfolio schema:
 *   - Legacy fields `departments` and `site_scope` are HARD-CUTOVER:
 *     POST/PUT bodies containing them return 400.
 *   - New portfolio_* fields validated against authoritative registries
 *     before persistence (see validatePortfolioFields).
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";

// Phase 3.12 Track 1A — portfolio field set + exclusion dimensions.
const PORTFOLIO_FIELDS = [
  "portfolio_brands",
  "portfolio_depts",
  "portfolio_sites",
  "portfolio_age_groups",
  "portfolio_exclusions",
] as const;
const LEGACY_PORTFOLIO_FIELDS = ["departments", "site_scope"] as const;
const EXCLUSION_DIMENSIONS = ["brand", "department", "class", "site", "age_group"] as const;
type ExclusionDimension = (typeof EXCLUSION_DIMENSIONS)[number];

// Authority sources per dimension. Brand/department/site dimensions read
// document IDs from their respective registry collection. Class/age_group
// dimensions read `dropdown_options` from the corresponding
// `attribute_registry` doc (same convention as product attribute editing).
async function loadRegistryAuthority(): Promise<{
  brand: Set<string>;
  department: Set<string>;
  site: Set<string>;
  class: Set<string>;
  age_group: Set<string>;
}> {
  const fs = admin.firestore();
  const [brandSnap, deptSnap, siteSnap, classDoc, ageDoc] = await Promise.all([
    fs.collection("brand_registry").get(),
    fs.collection("department_registry").get(),
    fs.collection("site_registry").get(),
    fs.collection("attribute_registry").doc("class").get(),
    fs.collection("attribute_registry").doc("age_group").get(),
  ]);
  const classOpts = ((classDoc.data() || {}).dropdown_options || []) as string[];
  const ageOpts = ((ageDoc.data() || {}).dropdown_options || []) as string[];
  return {
    brand: new Set(brandSnap.docs.map((d) => d.id)),
    department: new Set(deptSnap.docs.map((d) => d.id)),
    site: new Set(siteSnap.docs.map((d) => d.id)),
    class: new Set(classOpts),
    age_group: new Set(ageOpts),
  };
}

function sample(set: Set<string>, n = 5): string[] {
  return Array.from(set).slice(0, n);
}

/**
 * Phase 3.12 Track 1A — validate portfolio_* fields against authoritative
 * registries. Throws PortfolioValidationError on first failure with structured
 * detail. Caller must translate to a 400 response.
 */
class PortfolioValidationError extends Error {
  detail: Record<string, unknown>;
  constructor(detail: Record<string, unknown>) {
    super(typeof detail.message === "string" ? detail.message : "Invalid portfolio field");
    this.detail = detail;
  }
}

async function validatePortfolioFields(payload: Record<string, unknown>): Promise<void> {
  // Only load registries if any portfolio_* field is being changed.
  const touched = PORTFOLIO_FIELDS.filter((k) => payload[k] !== undefined);
  if (touched.length === 0) return;

  const auth = await loadRegistryAuthority();

  const checkArray = (
    fieldName: string,
    dimension: ExclusionDimension,
    value: unknown,
    registryName: string
  ) => {
    if (value === null) return; // explicit null clears the field
    if (!Array.isArray(value)) {
      throw new PortfolioValidationError({
        field: fieldName,
        message: `${fieldName} must be an array`,
        received_type: typeof value,
      });
    }
    const allowed = auth[dimension];
    for (const v of value) {
      if (typeof v !== "string" || !allowed.has(v)) {
        throw new PortfolioValidationError({
          field: fieldName,
          invalid_value: v,
          registry_consulted: registryName,
          sample_valid_values: sample(allowed),
          message: `Invalid value '${v}' for ${fieldName}; not present in ${registryName}.`,
        });
      }
    }
  };

  if (payload.portfolio_brands !== undefined) {
    checkArray("portfolio_brands", "brand", payload.portfolio_brands, "brand_registry");
  }
  if (payload.portfolio_depts !== undefined) {
    checkArray("portfolio_depts", "department", payload.portfolio_depts, "department_registry");
  }
  if (payload.portfolio_sites !== undefined) {
    checkArray("portfolio_sites", "site", payload.portfolio_sites, "site_registry");
  }
  if (payload.portfolio_age_groups !== undefined) {
    checkArray(
      "portfolio_age_groups",
      "age_group",
      payload.portfolio_age_groups,
      "attribute_registry/age_group.dropdown_options"
    );
  }
  if (payload.portfolio_exclusions !== undefined) {
    const excl = payload.portfolio_exclusions;
    if (excl === null) return;
    if (typeof excl !== "object" || Array.isArray(excl)) {
      throw new PortfolioValidationError({
        field: "portfolio_exclusions",
        message: "portfolio_exclusions must be a map of { dimension: string[] }",
        received_type: Array.isArray(excl) ? "array" : typeof excl,
      });
    }
    for (const [dim, vals] of Object.entries(excl as Record<string, unknown>)) {
      if (!(EXCLUSION_DIMENSIONS as readonly string[]).includes(dim)) {
        throw new PortfolioValidationError({
          field: "portfolio_exclusions",
          invalid_dimension: dim,
          allowed_dimensions: [...EXCLUSION_DIMENSIONS],
          message: `Invalid exclusion dimension '${dim}'.`,
        });
      }
      const dimension = dim as ExclusionDimension;
      const registryName =
        dimension === "brand"
          ? "brand_registry"
          : dimension === "department"
          ? "department_registry"
          : dimension === "site"
          ? "site_registry"
          : dimension === "class"
          ? "attribute_registry/class.dropdown_options"
          : "attribute_registry/age_group.dropdown_options";
      if (!Array.isArray(vals)) {
        throw new PortfolioValidationError({
          field: `portfolio_exclusions.${dim}`,
          message: `portfolio_exclusions.${dim} must be an array`,
          received_type: typeof vals,
        });
      }
      const allowed = auth[dimension];
      for (const v of vals) {
        if (typeof v !== "string" || !allowed.has(v)) {
          throw new PortfolioValidationError({
            field: `portfolio_exclusions.${dim}`,
            invalid_value: v,
            registry_consulted: registryName,
            sample_valid_values: sample(allowed),
            message: `Invalid exclusion value '${v}' for dimension '${dim}'.`,
          });
        }
      }
    }
  }
}

function rejectLegacyPortfolioFields(body: Record<string, unknown>): { ok: true } | { ok: false; error: string; field: string } {
  for (const f of LEGACY_PORTFOLIO_FIELDS) {
    if (f in body) {
      const replacement = f === "departments" ? "portfolio_depts" : "portfolio_sites";
      return {
        ok: false,
        field: f,
        error: `Field '${f}' is deprecated; use '${replacement}' instead. See Phase 3.12 schema migration.`,
      };
    }
  }
  return { ok: true };
}

const router = Router();

// A.4 Tier 1 (Ruling C.3): expanded from 8 → 10 to surface content_manager
// and launch_lead in the Admin Users UI. Exported so the role-options
// endpoint (and any future shared consumer) can import the canonical list.
export const ALLOWED_ROLES = [
  "buyer",
  "head_buyer",
  "product_ops",
  "map_analyst",
  "completion_specialist",
  "operations_operator",
  "admin",
  "owner",
  "content_manager",
  "launch_lead",
] as const;

// Title-case humanizer for role values: "head_buyer" → "Head Buyer"
function humanizeRole(value: string): string {
  return value
    .split("_")
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
}

// A.4 PR 3 — audit emission helper (file-local, NOT a shared module per
// PO Interpretation 1). New shape variant for user-mutation writes:
// `target_user_id` replaces `product_mpn` (target axis swap; same
// cardinality as dominant convention from B-pass Area A).
//
// NEVER include temp_password in the payload.
type UserAuditEventType =
  | "user_created"
  | "user_role_changed"
  | "user_disabled"
  | "user_reenabled"
  | "user_password_reset"
  | "user_profile_updated";

async function emitUserAudit(params: {
  event_type: UserAuditEventType;
  target_user_id: string;
  acting_user_id: string | null;
  extra?: Record<string, unknown>;
}): Promise<void> {
  await admin
    .firestore()
    .collection("audit_log")
    .add({
      event_type: params.event_type,
      target_user_id: params.target_user_id,
      acting_user_id: params.acting_user_id,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      ...(params.extra || {}),
    });
}

function arrayLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

// A.4 Tier 1 (§1.2): canonical role-options endpoint for FE dropdowns.
// Mounted via existing adminUsersRouter at /api/v1/admin/users (index.ts:133),
// so the public URL is GET /api/v1/admin/users/role-options.
// (Spec §1.2 names /api/v1/admin/role-options; reconciled to existing-router
// mount per dispatch STOP trigger "no new mount line in server.ts.")
router.get(
  "/role-options",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (_req: AuthenticatedRequest, res: Response) => {
    const role_options = ALLOWED_ROLES.map((value) => ({
      value,
      label: humanizeRole(value),
    }));
    res.json({ role_options });
  }
);

router.get(
  "/",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const snap = await admin.firestore().collection("users").get();
      const users = snap.docs.map((d) => {
        const data = d.data() || {};
        return {
          uid: d.id,
          email: data.email || null,
          display_name: data.display_name || data.name || null,
          role: data.role || null,
          // Phase 3.12 Track 1A — portfolio_* fields. Legacy `departments`
          // and `site_scope` intentionally absent from response shape.
          portfolio_brands: data.portfolio_brands ?? [],
          portfolio_depts: data.portfolio_depts ?? [],
          portfolio_sites: data.portfolio_sites ?? [],
          portfolio_age_groups: data.portfolio_age_groups ?? [],
          portfolio_exclusions: data.portfolio_exclusions ?? {},
          disabled: data.disabled === true,
          created_at: data.created_at?.toDate?.().toISOString() || null,
        };
      });
      res.json({ users });
    } catch (err: any) {
      console.error("GET /admin/users error:", err);
      res.status(500).json({ error: err.message || "Failed to load users" });
    }
  }
);

router.post(
  "/",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Phase 3.12 Track 1A — hard cutover on legacy field names.
      const legacy = rejectLegacyPortfolioFields(req.body || {});
      if (legacy.ok === false) {
        res.status(400).json({ error: legacy.error, field: legacy.field });
        return;
      }
      const {
        email,
        display_name,
        role,
        portfolio_brands,
        portfolio_depts,
        portfolio_sites,
        portfolio_age_groups,
        portfolio_exclusions,
      } = req.body || {};
      if (!email || !display_name || !role) {
        res
          .status(400)
          .json({ error: "email, display_name and role are required." });
        return;
      }
      if (!ALLOWED_ROLES.includes(role)) {
        res.status(400).json({
          error: `Invalid role. Allowed: ${ALLOWED_ROLES.join(", ")}`,
        });
        return;
      }
      // Phase 3.12 Track 1A — validate portfolio_* against authoritative
      // registries before persistence. 400 on first failure.
      try {
        await validatePortfolioFields(req.body || {});
      } catch (vErr: any) {
        if (vErr instanceof PortfolioValidationError) {
          res.status(400).json({ error: vErr.message, ...vErr.detail });
          return;
        }
        throw vErr;
      }
      const rand = Math.floor(1000 + Math.random() * 9000);
      const tempPassword = `${String(display_name).replace(/\s+/g, "")}${rand}@Ropi`;

      const authUser = await admin.auth().createUser({
        email,
        displayName: display_name,
        password: tempPassword,
      });
      await admin.auth().setCustomUserClaims(authUser.uid, { role });
      await admin
        .firestore()
        .collection("users")
        .doc(authUser.uid)
        .set({
          uid: authUser.uid,
          email,
          display_name,
          role,
          // Phase 3.12 Track 1A — initialize portfolio_* on create. Defaults
          // to empty container if caller did not provide.
          portfolio_brands: portfolio_brands ?? [],
          portfolio_depts: portfolio_depts ?? [],
          portfolio_sites: portfolio_sites ?? [],
          portfolio_age_groups: portfolio_age_groups ?? [],
          portfolio_exclusions: portfolio_exclusions ?? {},
          requires_review: false,
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          created_by: req.user?.uid || null,
        });
      // A.4 PR 3 — audit emission. Temp password is intentionally NOT included.
      await emitUserAudit({
        event_type: "user_created",
        target_user_id: authUser.uid,
        acting_user_id: req.user?.uid || null,
        extra: {
          role,
          portfolio_brands_count: arrayLen(portfolio_brands),
          portfolio_depts_count: arrayLen(portfolio_depts),
          portfolio_sites_count: arrayLen(portfolio_sites),
          portfolio_age_groups_count: arrayLen(portfolio_age_groups),
          portfolio_exclusions_dimensions:
            portfolio_exclusions && typeof portfolio_exclusions === "object"
              ? Object.keys(portfolio_exclusions)
              : [],
        },
      });
      res.json({ uid: authUser.uid, temp_password: tempPassword });
    } catch (err: any) {
      console.error("POST /admin/users error:", err);
      res.status(500).json({ error: err.message || "Failed to create user" });
    }
  }
);

router.put(
  "/:uid",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { uid } = req.params;
      // Phase 3.12 Track 1A — hard cutover on legacy field names.
      const legacy = rejectLegacyPortfolioFields(req.body || {});
      if (legacy.ok === false) {
        res.status(400).json({ error: legacy.error, field: legacy.field });
        return;
      }
      const {
        display_name,
        role,
        portfolio_brands,
        portfolio_depts,
        portfolio_sites,
        portfolio_age_groups,
        portfolio_exclusions,
      } = req.body || {};

      // A.4 PR 3 — read current doc to diff for audit emission.
      const oldSnap = await admin.firestore().collection("users").doc(uid).get();
      const oldData = oldSnap.data() || {};

      // Phase 3.12 Track 1A — validate portfolio_* against authoritative
      // registries before persistence. 400 on first failure.
      try {
        await validatePortfolioFields(req.body || {});
      } catch (vErr: any) {
        if (vErr instanceof PortfolioValidationError) {
          res.status(400).json({ error: vErr.message, ...vErr.detail });
          return;
        }
        throw vErr;
      }

      const update: Record<string, any> = {
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_by: req.user?.uid || null,
      };
      if (display_name !== undefined) update.display_name = display_name;
      if (role !== undefined) {
        if (!ALLOWED_ROLES.includes(role)) {
          res.status(400).json({ error: "Invalid role" });
          return;
        }
        update.role = role;
        await admin.auth().setCustomUserClaims(uid, { role });
      }
      // Phase 3.12 Track 1A — write portfolio_* fields when present.
      if (portfolio_brands !== undefined) update.portfolio_brands = portfolio_brands;
      if (portfolio_depts !== undefined) update.portfolio_depts = portfolio_depts;
      if (portfolio_sites !== undefined) update.portfolio_sites = portfolio_sites;
      if (portfolio_age_groups !== undefined) update.portfolio_age_groups = portfolio_age_groups;
      if (portfolio_exclusions !== undefined) update.portfolio_exclusions = portfolio_exclusions;
      if (display_name !== undefined) {
        await admin.auth().updateUser(uid, { displayName: display_name });
      }
      await admin.firestore().collection("users").doc(uid).set(update, {
        merge: true,
      });

      // A.4 PR 3 — audit emission. Diff old vs new per axis. May emit BOTH
      // user_role_changed and user_profile_updated in a single request.
      // Emit nothing if no actual diff.
      const acting = req.user?.uid || null;
      const roleChanged =
        role !== undefined && role !== oldData.role;
      if (roleChanged) {
        await emitUserAudit({
          event_type: "user_role_changed",
          target_user_id: uid,
          acting_user_id: acting,
          extra: {
            old_role: oldData.role ?? null,
            new_role: role,
          },
        });
      }
      const fieldsChanged: string[] = [];
      if (
        display_name !== undefined &&
        display_name !== oldData.display_name
      ) {
        fieldsChanged.push("display_name");
      }
      // Phase 3.12 Track 1A — diff detection for portfolio_* fields.
      for (const f of PORTFOLIO_FIELDS) {
        const incoming = (req.body || {})[f];
        if (incoming === undefined) continue;
        if (JSON.stringify(incoming ?? null) !== JSON.stringify(oldData[f] ?? null)) {
          fieldsChanged.push(f);
        }
      }
      if (fieldsChanged.length > 0) {
        await emitUserAudit({
          event_type: "user_profile_updated",
          target_user_id: uid,
          acting_user_id: acting,
          extra: { fields_changed: fieldsChanged },
        });
      }

      res.json({ ok: true, uid });
    } catch (err: any) {
      console.error("PUT /admin/users/:uid error:", err);
      res.status(500).json({ error: err.message || "Failed to update user" });
    }
  }
);

router.delete(
  "/:uid",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { uid } = req.params;
      await admin.auth().updateUser(uid, { disabled: true });
      await admin
        .firestore()
        .collection("users")
        .doc(uid)
        .set(
          {
            disabled: true,
            disabled_at: admin.firestore.FieldValue.serverTimestamp(),
            disabled_by: req.user?.uid || null,
          },
          { merge: true }
        );
      // A.4 PR 3 — audit emission.
      await emitUserAudit({
        event_type: "user_disabled",
        target_user_id: uid,
        acting_user_id: req.user?.uid || null,
        extra: {},
      });
      res.json({ ok: true, uid });
    } catch (err: any) {
      console.error("DELETE /admin/users/:uid error:", err);
      res.status(500).json({ error: err.message || "Failed to disable user" });
    }
  }
);

// A.4 PR 5 (Tier 2.2) — re-enable a disabled user. Inverse of DELETE.
//   POST /api/v1/admin/users/:uid/enable
router.post(
  "/:uid/enable",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { uid } = req.params;
      const docRef = admin.firestore().collection("users").doc(uid);
      const snap = await docRef.get();
      if (!snap.exists) {
        res.status(404).json({ error: "user_not_found" });
        return;
      }
      const data = snap.data() || {};
      if (data.disabled !== true) {
        res.status(409).json({ error: "user_not_disabled" });
        return;
      }
      await admin.auth().updateUser(uid, { disabled: false });
      await docRef.set(
        {
          disabled: false,
          disabled_at: null,
          disabled_by: null,
          reenabled_at: admin.firestore.FieldValue.serverTimestamp(),
          reenabled_by: req.user?.uid || null,
        },
        { merge: true }
      );
      await emitUserAudit({
        event_type: "user_reenabled",
        target_user_id: uid,
        acting_user_id: req.user?.uid || null,
        extra: {},
      });
      res.json({ uid, disabled: false });
    } catch (err: any) {
      console.error("POST /admin/users/:uid/enable error:", err);
      res
        .status(500)
        .json({ error: err.message || "Failed to re-enable user" });
    }
  }
);

// A.4 PR 6 (Tier 2.3) — admin-initiated password reset. Generates a one-shot
// temp password using the SAME generator as POST create handler:
//   `${displayNameNoSpaces}${4DigitRandom}@Ropi`
// The temp password is returned to the caller exactly once and is NEVER
// included in the audit_log payload.
//   POST /api/v1/admin/users/:uid/reset-password
router.post(
  "/:uid/reset-password",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { uid } = req.params;
      const docRef = admin.firestore().collection("users").doc(uid);
      const snap = await docRef.get();
      if (!snap.exists) {
        res.status(404).json({ error: "user_not_found" });
        return;
      }
      const data = snap.data() || {};
      const displayName = data.display_name || data.name || "User";

      const rand = Math.floor(1000 + Math.random() * 9000);
      const tempPassword = `${String(displayName).replace(/\s+/g, "")}${rand}@Ropi`;

      await admin.auth().updateUser(uid, { password: tempPassword });
      await docRef.set(
        {
          password_reset_at: admin.firestore.FieldValue.serverTimestamp(),
          password_reset_by: req.user?.uid || null,
        },
        { merge: true }
      );

      // A.4 PR 3/PR 6 — audit emission. Temp password intentionally OMITTED.
      await emitUserAudit({
        event_type: "user_password_reset",
        target_user_id: uid,
        acting_user_id: req.user?.uid || null,
        extra: {},
      });

      res.json({ uid, temp_password: tempPassword });
    } catch (err: any) {
      console.error("POST /admin/users/:uid/reset-password error:", err);
      res
        .status(500)
        .json({ error: err.message || "Failed to reset password" });
    }
  }
);

export default router;
