import admin from "firebase-admin";

const db = admin.firestore;

export interface ContentSection {
  id: string;
  type: "headline" | "text" | "bullet_list" | "paragraphs" | "spec_list" | "faq";
  enabled: boolean;
  header: string;
  emoji_icon: string;
}

export interface ContentSchema {
  use_emojis: boolean;
  sections: ContentSection[];
}

export interface SeoStrategy {
  primary_keyword_template: string;
  include_faq_schema: boolean;
  keyword_density_target: string;
}

export interface PromptTemplate {
  id: string;
  template_name: string;
  is_active: boolean;
  priority: number;
  match_site_owner: string | null;
  match_department: string | null;
  match_class: string | null;
  match_brand: string | null;
  match_category: string | null;
  match_gender: string | null;
  tone_profile: string;
  tone_description: string;
  output_components: string[];
  content_schema: ContentSchema;
  seo_strategy: SeoStrategy;
  prompt_instructions: string;
  banned_words: string[];
  required_attribute_inclusions: string[];
  created_by: string;
  created_at: admin.firestore.Timestamp;
  updated_at: admin.firestore.Timestamp;
}

export async function selectTemplate(
  product: {
    department?: string;
    class?: string;
    brand?: string;
    category?: string;
    gender?: string;
  },
  siteOwner: string
): Promise<PromptTemplate> {
  const snap = await db()
    .collection("prompt_templates")
    .where("is_active", "==", true)
    .get();

  const templates = snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as PromptTemplate & { template_type?: string }))
    // Exclude advisory templates from product description selection.
    // Templates without an explicit template_type are treated as
    // 'product_description' (legacy product templates pre-date the field).
    .filter((t) => (t as any).template_type !== "advisory");

  const scored = templates
    .filter((t) => templateMatches(t, product, siteOwner))
    .map((t) => ({
      template: t,
      score: countMatchingConditions(t, product, siteOwner),
    }))
    .sort(
      (a, b) =>
        b.score - a.score || b.template.priority - a.template.priority
    );

  if (scored.length > 0) {
    return scored[0].template;
  }

  // Fallback: Shiekh Default
  const fallback = templates.find((t) => t.template_name === "Shiekh Default");
  if (fallback) return fallback;

  throw new Error("No valid template found — contact Admin");
}

function templateMatches(
  template: PromptTemplate,
  product: {
    department?: string;
    class?: string;
    brand?: string;
    category?: string;
    gender?: string;
  },
  siteOwner: string
): boolean {
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

function countMatchingConditions(
  template: PromptTemplate,
  product: {
    department?: string;
    class?: string;
    brand?: string;
    category?: string;
    gender?: string;
  },
  siteOwner: string
): number {
  let score = 0;
  if (template.match_site_owner === siteOwner) score++;
  if (template.match_department === product.department) score++;
  if (template.match_class === product.class) score++;
  if (template.match_brand === product.brand) score++;
  if (template.match_category === product.category) score++;
  if (template.match_gender && template.match_gender === product.gender) score++;
  return score;
}
