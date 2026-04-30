/**
 * adminUsers — Step 4.2 Tab 1
 * Admin CRUD for platform users. Firebase Auth account + Firestore users/{uid}.
 *   GET    /api/v1/admin/users          — list
 *   POST   /api/v1/admin/users          — create (auto temp password)
 *   PUT    /api/v1/admin/users/:uid     — update role/departments/site_scope/display_name
 *   DELETE /api/v1/admin/users/:uid     — disable account
 */
import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";

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
          departments: data.departments || null,
          site_scope: data.site_scope || null,
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
      const { email, display_name, role, departments, site_scope } =
        req.body || {};
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
          departments: departments || null,
          site_scope: site_scope || null,
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
          departments_count: arrayLen(departments),
          site_scope_count: arrayLen(site_scope),
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
      const { display_name, role, departments, site_scope } = req.body || {};

      // A.4 PR 3 — read current doc to diff for audit emission.
      const oldSnap = await admin.firestore().collection("users").doc(uid).get();
      const oldData = oldSnap.data() || {};

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
      if (departments !== undefined) update.departments = departments;
      if (site_scope !== undefined) update.site_scope = site_scope;
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
      if (
        departments !== undefined &&
        JSON.stringify(departments ?? null) !==
          JSON.stringify(oldData.departments ?? null)
      ) {
        fieldsChanged.push("departments");
      }
      if (
        site_scope !== undefined &&
        JSON.stringify(site_scope ?? null) !==
          JSON.stringify(oldData.site_scope ?? null)
      ) {
        fieldsChanged.push("site_scope");
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

export default router;
