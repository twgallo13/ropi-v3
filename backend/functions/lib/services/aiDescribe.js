"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateContent = generateContent;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const mpnUtils_1 = require("./mpnUtils");
const templateMatcher_1 = require("./templateMatcher");
const db = firebase_admin_1.default.firestore;
const EXCLUDED_FIELDS = [
    "rics_category",
    "rics_color",
    "rics_short_desc",
    "rics_long_desc",
    "source_inputs",
];
function buildPrompt(template, values) {
    let prompt = template;
    for (const [key, value] of Object.entries(values)) {
        prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }
    return prompt;
}
async function generateContent(mpn, siteOwner, operatorUserId, observationsNote) {
    const docId = (0, mpnUtils_1.mpnToDocId)(mpn);
    const productRef = db().collection("products").doc(docId);
    const productDoc = await productRef.get();
    const product = productDoc.data();
    if (!product)
        throw new Error(`Product not found: ${mpn}`);
    // Load Human-Verified or RO-Import attributes ONLY (Section 13.1 rule)
    const attrSnap = await productRef.collection("attribute_values").get();
    const attrs = {};
    attrSnap.forEach((a) => {
        const d = a.data();
        // Explicitly exclude raw RICS fields and source_inputs
        if (EXCLUDED_FIELDS.includes(a.id))
            return;
        // Only include Human-Verified or RO-Import — never System-Applied
        if (d.verification_state === "Human-Verified" ||
            d.origin_type === "RO-Import") {
            attrs[a.id] = d.value;
        }
    });
    // Select template
    const template = await (0, templateMatcher_1.selectTemplate)({
        department: attrs["department"],
        class: attrs["class"],
        brand: product?.brand,
        category: attrs["category"],
    }, siteOwner);
    // Build prompt by replacing {{placeholders}} with actual values
    const prompt = buildPrompt(template.prompt_instructions, {
        name: product?.name || attrs["product_name"] || "",
        brand: product?.brand || attrs["brand"] || "",
        department: attrs["department"] || "",
        class: attrs["class"] || "",
        category: attrs["category"] || "",
        primary_color: attrs["primary_color"] || "",
        gender: attrs["gender"] || attrs["age_group"] || "",
        observations: observationsNote || "",
    });
    // Call Anthropic API
    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1024,
            messages: [{ role: "user", content: prompt }],
        }),
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.status} — ${JSON.stringify(data)}`);
    }
    const rawText = data.content[0].text;
    // Parse JSON response
    let parsed = {};
    try {
        const clean = rawText.replace(/```json|```/g, "").trim();
        parsed = JSON.parse(clean);
    }
    catch {
        parsed = {
            description: rawText,
            meta_name: "",
            meta_description: "",
            keywords: "",
        };
    }
    // Check banned words
    const fullText = Object.values(parsed).join(" ").toLowerCase();
    const foundBanned = (template.banned_words || []).filter((w) => fullText.includes(w.toLowerCase()));
    // Count existing versions for this site
    const existingVersions = await productRef
        .collection("content_versions")
        .where("site_owner", "==", siteOwner)
        .get();
    const versionNumber = existingVersions.size + 1;
    // Write content_versions document (append-only history)
    const versionRef = await productRef.collection("content_versions").add({
        site_owner: siteOwner,
        template_id: template.id,
        template_name: template.template_name,
        tone_profile: template.tone_profile,
        generated_at: db.FieldValue.serverTimestamp(),
        generated_by: operatorUserId,
        inputs_used: attrs,
        raw_output: rawText,
        parsed_output: parsed,
        banned_words_found: foundBanned,
        approval_state: "pending",
        approved_by: null,
        approved_at: null,
        version_number: versionNumber,
    });
    // Write audit_log
    await db().collection("audit_log").add({
        product_mpn: mpn,
        event_type: "ai_describe_generated",
        site_owner: siteOwner,
        template_id: template.id,
        template_name: template.template_name,
        version_number: versionNumber,
        generated_by: operatorUserId,
        created_at: db.FieldValue.serverTimestamp(),
    });
    return {
        version_id: versionRef.id,
        site_owner: siteOwner,
        template_name: template.template_name,
        tone_profile: template.tone_profile,
        parsed_output: parsed,
        banned_words_found: foundBanned,
        version_number: versionNumber,
    };
}
//# sourceMappingURL=aiDescribe.js.map