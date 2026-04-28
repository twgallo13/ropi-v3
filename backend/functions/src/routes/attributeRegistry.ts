import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";

const router = Router();
const db = () => admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();

const ALLOWED_TABS = [
  "core_information",
  "product_attributes",
  "descriptions_seo",
  "launch_media",
  "system",
];

async function writeAttributeAudit(
  action: string,
  entityId: string,
  actorUid: string,
  details: Record<string, any>
): Promise<void> {
  try {
    await db().collection("audit_log").add({
      action,
      entity_type: "attribute_registry",
      entity_id: entityId,
      actor_uid: actorUid,
      details,
      timestamp: ts(),
    });
  } catch (err: any) {
    console.error("audit_log write failed:", err.message);
  }
}

// GET /api/v1/attribute_registry
// Returns all attribute definitions including destination_tab for UI grouping.
// Query params (E.4): admin=true bypasses is_editable + system-tab filters;
// includeInactive=true bypasses active-only filter. Defaults preserve legacy.
router.get("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminMode = req.query.admin === "true";
    const includeInactive = req.query.includeInactive === "true";
    const firestore = admin.firestore();
    const snap = await firestore.collection("attribute_registry").get();

    const attributes = snap.docs
      .filter((d) => {
        const data = d.data();
        if (!includeInactive && data.active !== true) return false;
        if (!adminMode && data.destination_tab === "system") return false;
        if (!adminMode && data.is_editable === false) return false;
        return true;
      })
      .map((d) => ({
      field_key: d.id,
      display_label: d.data().display_label || d.id,
      field_type: d.data().field_type || "text",
      destination_tab: d.data().destination_tab ?? null,
      display_group: d.data().display_group || "",
      display_order: d.data().display_order ?? 99,
      tab_group_order: d.data().tab_group_order ?? 99,
      required_for_completion: d.data().required_for_completion ?? false,
      include_in_ai_prompt: d.data().include_in_ai_prompt ?? false,
      active: d.data().active ?? true,
      export_enabled: d.data().export_enabled ?? true,
      dropdown_options: d.data().dropdown_options || [],
      dropdown_source: d.data().dropdown_source || null,
      full_width: d.data().full_width ?? false,
      is_editable: d.data().is_editable ?? true,
      depends_on: d.data().depends_on || null,
    }));

    res.status(200).json({ attributes });
  } catch (err: any) {
    console.error("GET /attribute_registry error:", err);
    res.status(500).json({ error: "Failed to fetch attribute registry." });
  }
});

// ────────────────────────────────────────────────
// POST /api/v1/attribute_registry — create new attribute
// ────────────────────────────────────────────────
router.post(
  "/",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body || {};
      const { field_key, display_label, field_type, destination_tab } = body;

      if (typeof field_key !== "string" || field_key.trim() === "") {
        res.status(400).json({ error: "field_key is required (non-empty string)" });
        return;
      }
      if (typeof display_label !== "string" || display_label.trim() === "") {
        res.status(400).json({ error: "display_label is required (non-empty string)" });
        return;
      }
      if (typeof field_type !== "string" || field_type.trim() === "") {
        res.status(400).json({ error: "field_type is required (non-empty string)" });
        return;
      }
      if (typeof destination_tab !== "string" || destination_tab.trim() === "") {
        res.status(400).json({ error: "destination_tab is required (non-empty string)" });
        return;
      }
      if (!ALLOWED_TABS.includes(destination_tab.trim())) {
        res.status(400).json({
          error: `destination_tab must be one of: ${ALLOWED_TABS.join(", ")}`,
        });
        return;
      }

      const key = field_key.trim();
      const ref = db().collection("attribute_registry").doc(key);
      const existing = await ref.get();
      if (existing.exists) {
        res.status(409).json({ error: "field_key already exists" });
        return;
      }

      const payload: Record<string, any> = {
        field_key: key,
        display_label: display_label.trim(),
        field_type: field_type.trim(),
        destination_tab: destination_tab.trim(),
        display_group: body.display_group ?? null,
        display_order: typeof body.display_order === "number" ? body.display_order : 0,
        tab_group_order: typeof body.tab_group_order === "number" ? body.tab_group_order : 0,
        required_for_completion:
          typeof body.required_for_completion === "boolean" ? body.required_for_completion : false,
        include_in_ai_prompt:
          typeof body.include_in_ai_prompt === "boolean" ? body.include_in_ai_prompt : false,
        active: typeof body.active === "boolean" ? body.active : true,
        export_enabled: typeof body.export_enabled === "boolean" ? body.export_enabled : true,
        dropdown_options: Array.isArray(body.dropdown_options) ? body.dropdown_options : [],
        dropdown_source: body.dropdown_source ?? null,
        full_width: typeof body.full_width === "boolean" ? body.full_width : false,
        is_editable: typeof body.is_editable === "boolean" ? body.is_editable : true,
        depends_on: body.depends_on ?? null,
        created_at: ts(),
        created_by: req.user!.uid,
        updated_at: ts(),
        updated_by: req.user!.uid,
      };
      await ref.set(payload);

      await writeAttributeAudit("attribute_registry_created", key, req.user!.uid, {
        field_key: key,
        display_label: payload.display_label,
        destination_tab: payload.destination_tab,
      });

      const refetched = (await ref.get()).data();
      res.status(201).json({ attribute: refetched });
    } catch (err: any) {
      console.error("POST /attribute_registry error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ────────────────────────────────────────────────
// PUT /api/v1/attribute_registry/:field_key — update (key immutable)
// ────────────────────────────────────────────────
router.put(
  "/:field_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body || {};
      const pathKey = req.params.field_key;

      if (body.field_key !== undefined && body.field_key !== pathKey) {
        res.status(400).json({ error: "field_key is immutable" });
        return;
      }

      if (body.display_label !== undefined) {
        if (typeof body.display_label !== "string" || body.display_label.trim() === "") {
          res.status(400).json({ error: "display_label must be a non-empty string" });
          return;
        }
      }
      if (body.field_type !== undefined) {
        if (typeof body.field_type !== "string" || body.field_type.trim() === "") {
          res.status(400).json({ error: "field_type must be a non-empty string" });
          return;
        }
      }
      if (body.destination_tab !== undefined) {
        if (typeof body.destination_tab !== "string" || body.destination_tab.trim() === "") {
          res.status(400).json({ error: "destination_tab must be a non-empty string" });
          return;
        }
        if (!ALLOWED_TABS.includes(body.destination_tab.trim())) {
          res.status(400).json({
            error: `destination_tab must be one of: ${ALLOWED_TABS.join(", ")}`,
          });
          return;
        }
      }

      const ref = db().collection("attribute_registry").doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `attribute "${pathKey}" not found` });
        return;
      }

      const patch: Record<string, any> = {};
      if (body.display_label !== undefined) patch.display_label = body.display_label.trim();
      if (body.field_type !== undefined) patch.field_type = body.field_type.trim();
      if (body.destination_tab !== undefined) patch.destination_tab = body.destination_tab.trim();
      if (body.display_group !== undefined) patch.display_group = body.display_group;
      if (typeof body.display_order === "number") patch.display_order = body.display_order;
      if (typeof body.tab_group_order === "number") patch.tab_group_order = body.tab_group_order;
      if (typeof body.required_for_completion === "boolean")
        patch.required_for_completion = body.required_for_completion;
      if (typeof body.include_in_ai_prompt === "boolean")
        patch.include_in_ai_prompt = body.include_in_ai_prompt;
      if (typeof body.active === "boolean") patch.active = body.active;
      if (typeof body.export_enabled === "boolean") patch.export_enabled = body.export_enabled;
      if (Array.isArray(body.dropdown_options)) patch.dropdown_options = body.dropdown_options;
      if (body.dropdown_source !== undefined) patch.dropdown_source = body.dropdown_source;
      if (typeof body.full_width === "boolean") patch.full_width = body.full_width;
      if (typeof body.is_editable === "boolean") patch.is_editable = body.is_editable;
      if (body.depends_on !== undefined) patch.depends_on = body.depends_on;
      patch.updated_at = ts();
      patch.updated_by = req.user!.uid;

      await ref.set(patch, { merge: true });

      await writeAttributeAudit("attribute_registry_updated", pathKey, req.user!.uid, {
        patch_keys: Object.keys(patch),
      });

      const refetched = (await ref.get()).data();
      res.status(200).json({ attribute: refetched });
    } catch (err: any) {
      console.error("PUT /attribute_registry/:field_key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ────────────────────────────────────────────────
// DELETE /api/v1/attribute_registry/:field_key — soft deactivation
// (Attribute uses `active`, NOT `is_active`.)
// ────────────────────────────────────────────────
router.delete(
  "/:field_key",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pathKey = req.params.field_key;
      const ref = db().collection("attribute_registry").doc(pathKey);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: `attribute "${pathKey}" not found` });
        return;
      }

      await ref.set(
        {
          active: false,
          updated_at: ts(),
          updated_by: req.user!.uid,
        },
        { merge: true }
      );

      await writeAttributeAudit("attribute_registry_deleted", pathKey, req.user!.uid, {
        field_key: pathKey,
      });

      const refetched = (await ref.get()).data();
      res.status(200).json({ attribute: refetched });
    } catch (err: any) {
      console.error("DELETE /attribute_registry/:field_key error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
