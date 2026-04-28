import admin from "firebase-admin";
import { mpnToDocId } from "./mpnUtils";
import { selectTemplate, PromptTemplate } from "./templateMatcher";
import { resolveAdapter, getAiConfigForWorkflow } from "../lib/aiConfig";

const db = admin.firestore;

// ── Adapter pattern relocated to lib/aiConfig.ts (TALLY-SETTINGS-UX
// Phase 3 / A.1). This file now consumes resolveAdapter +
// getAiConfigForWorkflow; AIProviderAdapter / AnthropicAdapter /
// OpenAIAdapter / GeminiAdapter / getActiveAdapter all live there.

const EXCLUDED_FIELDS = [
  "rics_category",
  "rics_color",
  "rics_short_desc",
  "rics_long_desc",
  "source_inputs",
];

export interface AIGenerationResult {
  version_id: string;
  site_owner: string;
  template_name: string;
  tone_profile: string;
  parsed_output: Record<string, string>;
  banned_words_found: string[];
  version_number: number;
}

// ── FAQ JSON-LD Schema (TALLY-118) ──

function extractFaqPairs(faqHtml: string): Array<{ question: string; answer: string }> {
  const pairs: Array<{ question: string; answer: string }> = [];
  // Match <h3>question</h3> followed by <p>answer</p>
  const regex = /<h3[^>]*>(.*?)<\/h3>\s*<p[^>]*>(.*?)<\/p>/gi;
  let match;
  while ((match = regex.exec(faqHtml)) !== null) {
    pairs.push({
      question: match[1].replace(/<[^>]*>/g, "").trim(),
      answer: match[2].trim(),
    });
  }
  return pairs;
}

function buildFaqSchema(faqHtml: string): string {
  const questions = extractFaqPairs(faqHtml);
  if (questions.length === 0) return "";

  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map((qa) => ({
      "@type": "Question",
      name: qa.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: qa.answer.replace(/<[^>]*>/g, ""),
      },
    })),
  };

  return `\n<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
}

// ── Schema-Driven Prompt Builder (TALLY-118) ──

function buildPrompt(
  template: PromptTemplate,
  productData: Record<string, string>,
  observationsNote?: string
): string {
  // Templates with prompt_instructions use the legacy placeholder approach
  // The prompt_instructions already contain the full prompt with {{placeholders}}
  let prompt = template.prompt_instructions;
  const seo = template.seo_strategy;

  // Calculate SEO keywords
  const primaryKeyword = seo
    ? seo.primary_keyword_template
        .replace("{{brand}}", productData.brand || "")
        .replace("{{gender}}", productData.gender || "")
        .replace("{{category}}", productData.category || "")
        .trim()
    : "";

  const secondaryKeywords = [
    productData.brand ? `${productData.brand} shoes` : "",
    productData.department
      ? `${productData.gender || ""} ${productData.department}`.trim()
      : "",
    productData.category ? `${productData.category} shoes` : "",
    productData.primary_color
      ? `${productData.primary_color} ${productData.department || ""}`.trim()
      : "",
  ].filter(Boolean);

  // Replace all {{placeholders}}
  const replacements: Record<string, string> = {
    ...productData,
    observations: observationsNote || "No specialist observations provided.",
    primary_keyword: primaryKeyword,
    secondary_keywords: secondaryKeywords.join(", "),
  };

  for (const [key, value] of Object.entries(replacements)) {
    prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value || "");
  }

  return prompt;
}

// ── Assemble Description from Sections (TALLY-118) ──

function assembleDescription(
  template: PromptTemplate,
  parsedOutput: Record<string, string>
): string {
  const schema = template.content_schema;
  if (!schema || !schema.sections) {
    // Legacy: return description as-is
    return parsedOutput.description || "";
  }

  const enabledSections = schema.sections.filter((s) => s.enabled);
  const parts = enabledSections
    .map((s) => parsedOutput[s.id] || "")
    .filter(Boolean);

  let html = parts.join("\n");

  // Append FAQ JSON-LD if enabled
  if (
    template.seo_strategy?.include_faq_schema &&
    parsedOutput.faq
  ) {
    html += buildFaqSchema(parsedOutput.faq);
  }

  return html;
}

export async function generateContent(
  workflow_key: string,
  mpn: string,
  siteOwner: string,
  operatorUserId: string,
  observationsNote?: string,
  critiqueContext?: { previousOutput?: string; critique?: string }
): Promise<AIGenerationResult> {
  const docId = mpnToDocId(mpn);
  const productRef = db().collection("products").doc(docId);
  const productDoc = await productRef.get();
  const product = productDoc.data();

  if (!product) throw new Error(`Product not found: ${mpn}`);

  // Load Human-Verified or RO-Import attributes ONLY (Section 13.1 rule)
  const attrSnap = await productRef.collection("attribute_values").get();
  const attrs: Record<string, string> = {};

  attrSnap.forEach((a) => {
    const d = a.data();
    if (EXCLUDED_FIELDS.includes(a.id)) return;
    if (
      d.verification_state === "Human-Verified" ||
      d.origin_type === "RO-Import"
    ) {
      attrs[a.id] = d.value;
    }
  });

  const gender = attrs["gender"] || attrs["age_group"] || "";

  // Select template — now includes gender matching
  const template = await selectTemplate(
    {
      department: attrs["department"],
      class: attrs["class"],
      brand: product?.brand,
      category: attrs["category"],
      gender,
    },
    siteOwner
  );

  // Build product data for prompt
  const productData: Record<string, string> = {
    name: product?.name || attrs["product_name"] || "",
    brand: product?.brand || attrs["brand"] || "",
    department: attrs["department"] || "",
    class: attrs["class"] || "",
    category: attrs["category"] || "",
    primary_color: attrs["primary_color"] || "",
    gender,
    material: attrs["material"] || "",
    fit: attrs["fit"] || "",
  };

  // Build prompt using template's prompt_instructions
  let prompt = buildPrompt(template, productData, observationsNote);

  // Append critique context if regenerating with critique
  if (critiqueContext?.critique && critiqueContext?.previousOutput) {
    prompt += `\n\nPREVIOUS VERSION (improve on this):\n${critiqueContext.previousOutput}\n\nCRITIQUE FROM SPECIALIST: ${critiqueContext.critique}\nAddress the critique specifically in your new version.`;
  }

  // Call AI via aiConfig helper (TALLY-SETTINGS-UX Phase 3 / A.1)
  const config = await getAiConfigForWorkflow(workflow_key);
  const adapter = await resolveAdapter(
    config.provider_key,
    config.model_key,
    config.api_key_env_var_name
  );
  const systemPrompt =
    "You are a world-class SEO copywriter for a retail footwear and apparel brand. Always respond with ONLY valid JSON. No markdown fences, no explanation, no extra text.";
  const rawText = await adapter.complete(prompt, systemPrompt);

  // Parse JSON response
  let parsed: Record<string, string> = {};
  try {
    parsed = JSON.parse(rawText.trim());
  } catch {
    try {
      // Extract JSON from markdown code block
      const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        parsed = JSON.parse(match[1].trim());
      } else {
        // Find first { to last }
        const start = rawText.indexOf("{");
        const end = rawText.lastIndexOf("}");
        if (start !== -1 && end > start) {
          parsed = JSON.parse(rawText.substring(start, end + 1));
        } else {
          throw new Error("No JSON found");
        }
      }
    } catch {
      parsed = {
        description: rawText,
        meta_name: "",
        meta_description: "",
        keywords: "",
      };
    }
  }

  // Check banned words
  const fullText = Object.values(parsed).join(" ").toLowerCase();
  const foundBanned = (template.banned_words || []).filter((w: string) =>
    fullText.includes(w.toLowerCase())
  );

  // Assemble description from sections (TALLY-118)
  if (template.content_schema?.sections) {
    parsed.description = assembleDescription(template, parsed);
  }

  // Count existing versions for this site
  const existingVersions = await productRef
    .collection("content_versions")
    .where("site_owner", "==", siteOwner)
    .get();
  const versionNumber = existingVersions.size + 1;

  // Write content_versions document (append-only history)
  // Firestore rejects undefined — coerce every optional template-sourced
  // field to null so missing template properties never blow up the write.
  const versionRef = await productRef.collection("content_versions").add({
    site_owner: siteOwner,
    template_id: template.id ?? null,
    template_name: template.template_name ?? null,
    tone_profile: template.tone_profile ?? null,
    match_gender: (template as any).match_gender ?? null,
    generated_at: db.FieldValue.serverTimestamp(),
    generated_by: operatorUserId ?? null,
    inputs_used: attrs ?? {},
    raw_output: rawText ?? "",
    parsed_output: parsed ?? {},
    banned_words_found: foundBanned ?? [],
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
    template_id: template.id ?? null,
    template_name: template.template_name ?? null,
    version_number: versionNumber,
    generated_by: operatorUserId ?? null,
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
