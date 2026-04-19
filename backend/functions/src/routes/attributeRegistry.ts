import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";

const router = Router();

// GET /api/v1/attribute_registry
// Returns all attribute definitions including destination_tab for UI grouping.
router.get("/", requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const firestore = admin.firestore();
    const snap = await firestore.collection("attribute_registry").get();

    const attributes = snap.docs.map((d) => ({
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

export default router;
