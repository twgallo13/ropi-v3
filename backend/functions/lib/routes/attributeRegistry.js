"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// GET /api/v1/attribute_registry
// Returns all attribute definitions including destination_tab for UI grouping.
router.get("/", auth_1.requireAuth, async (_req, res) => {
    try {
        const firestore = firebase_admin_1.default.firestore();
        const snap = await firestore.collection("attribute_registry").get();
        const attributes = snap.docs
            .filter((d) => {
            const data = d.data();
            if (data.active !== true)
                return false;
            if (data.destination_tab === "system")
                return false;
            if (data.is_editable === false)
                return false;
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
    }
    catch (err) {
        console.error("GET /attribute_registry error:", err);
        res.status(500).json({ error: "Failed to fetch attribute registry." });
    }
});
exports.default = router;
//# sourceMappingURL=attributeRegistry.js.map