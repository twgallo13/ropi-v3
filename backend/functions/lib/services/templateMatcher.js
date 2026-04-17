"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectTemplate = selectTemplate;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const db = firebase_admin_1.default.firestore;
async function selectTemplate(product, siteOwner) {
    const snap = await db()
        .collection("prompt_templates")
        .where("is_active", "==", true)
        .get();
    const templates = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const scored = templates
        .filter((t) => templateMatches(t, product, siteOwner))
        .map((t) => ({
        template: t,
        score: countMatchingConditions(t, product, siteOwner),
    }))
        .sort((a, b) => b.score - a.score || b.template.priority - a.template.priority);
    if (scored.length > 0) {
        return scored[0].template;
    }
    // Fallback: Shiekh Default
    const fallback = templates.find((t) => t.template_name === "Shiekh Default");
    if (fallback)
        return fallback;
    throw new Error("No valid template found — contact Admin");
}
function templateMatches(template, product, siteOwner) {
    if (template.match_site_owner && template.match_site_owner !== siteOwner)
        return false;
    if (template.match_department && template.match_department !== product.department)
        return false;
    if (template.match_class && template.match_class !== product.class)
        return false;
    if (template.match_brand && template.match_brand !== product.brand)
        return false;
    if (template.match_category && template.match_category !== product.category)
        return false;
    if (template.match_gender && template.match_gender !== product.gender)
        return false;
    return true;
}
function countMatchingConditions(template, product, siteOwner) {
    let score = 0;
    if (template.match_site_owner === siteOwner)
        score++;
    if (template.match_department === product.department)
        score++;
    if (template.match_class === product.class)
        score++;
    if (template.match_brand === product.brand)
        score++;
    if (template.match_category === product.category)
        score++;
    if (template.match_gender && template.match_gender === product.gender)
        score++;
    return score;
}
//# sourceMappingURL=templateMatcher.js.map