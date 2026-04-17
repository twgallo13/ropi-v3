"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const roles_1 = require("../middleware/roles");
const router = (0, express_1.Router)();
const db = firebase_admin_1.default.firestore;
// GET /api/v1/admin/prompt-templates
router.get("/", auth_1.requireAuth, (0, roles_1.requireRole)(["admin"]), async (_req, res) => {
    try {
        const snap = await db()
            .collection("prompt_templates")
            .where("is_active", "==", true)
            .get();
        const templates = snap.docs
            .map((d) => ({ template_id: d.id, ...d.data() }))
            .sort((a, b) => (b.priority || 0) - (a.priority || 0));
        res.json({ templates });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
        return;
    }
});
// GET /api/v1/admin/prompt-templates/:template_id
router.get("/:template_id", auth_1.requireAuth, (0, roles_1.requireRole)(["admin"]), async (req, res) => {
    try {
        const doc = await db()
            .collection("prompt_templates")
            .doc(req.params.template_id)
            .get();
        if (!doc.exists) {
            res.status(404).json({ error: "Template not found" });
            return;
        }
        res.json({ template_id: doc.id, ...doc.data() });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
        return;
    }
});
// POST /api/v1/admin/prompt-templates
router.post("/", auth_1.requireAuth, (0, roles_1.requireRole)(["admin"]), async (req, res) => {
    try {
        const { template_name, priority, match_site_owner, match_department, match_class, match_brand, match_category, tone_profile, tone_description, output_components, prompt_instructions, banned_words, required_attribute_inclusions, } = req.body;
        if (!template_name || !prompt_instructions) {
            res.status(400).json({ error: "template_name and prompt_instructions are required" });
            return;
        }
        const ref = await db().collection("prompt_templates").add({
            template_name,
            is_active: true,
            priority: priority || 1,
            match_site_owner: match_site_owner || null,
            match_department: match_department || null,
            match_class: match_class || null,
            match_brand: match_brand || null,
            match_category: match_category || null,
            tone_profile: tone_profile || "standard_retail",
            tone_description: tone_description || "",
            output_components: output_components || [
                "description",
                "meta_name",
                "meta_description",
                "keywords",
            ],
            prompt_instructions,
            banned_words: banned_words || [],
            required_attribute_inclusions: required_attribute_inclusions || [],
            created_by: req.user?.uid || "unknown",
            created_at: db.FieldValue.serverTimestamp(),
            updated_at: db.FieldValue.serverTimestamp(),
        });
        res.status(201).json({ template_id: ref.id, message: "Template created" });
        return;
    }
    catch (err) {
        res.status(500).json({ error: err.message });
        return;
    }
});
// PUT /api/v1/admin/prompt-templates/:template_id
router.put("/:template_id", auth_1.requireAuth, (0, roles_1.requireRole)(["admin"]), async (req, res) => {
    try {
        const ref = db()
            .collection("prompt_templates")
            .doc(req.params.template_id);
        const doc = await ref.get();
        if (!doc.exists) {
            res.status(404).json({ error: "Template not found" });
            return;
        }
        const allowedFields = [
            "template_name",
            "priority",
            "match_site_owner",
            "match_department",
            "match_class",
            "match_brand",
            "match_category",
            "tone_profile",
            "tone_description",
            "output_components",
            "prompt_instructions",
            "banned_words",
            "required_attribute_inclusions",
        ];
        const updates = {};
        for (const key of allowedFields) {
            if (req.body[key] !== undefined) {
                updates[key] = req.body[key];
            }
        }
        updates.updated_at = db.FieldValue.serverTimestamp();
        await ref.update(updates);
        res.json({ message: "Template updated" });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
        return;
    }
});
// DELETE /api/v1/admin/prompt-templates/:template_id (soft delete — sets is_active: false)
router.delete("/:template_id", auth_1.requireAuth, (0, roles_1.requireRole)(["admin"]), async (req, res) => {
    try {
        const ref = db()
            .collection("prompt_templates")
            .doc(req.params.template_id);
        const doc = await ref.get();
        if (!doc.exists) {
            res.status(404).json({ error: "Template not found" });
            return;
        }
        await ref.update({
            is_active: false,
            updated_at: db.FieldValue.serverTimestamp(),
        });
        res.json({ message: "Template deactivated" });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
        return;
    }
});
exports.default = router;
//# sourceMappingURL=promptTemplates.js.map