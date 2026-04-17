#!/usr/bin/env node
/**
 * Seed: prompt_templates — 3 default templates
 * Shiekh Default, Karmaloop Streetwear, MLTD Contemporary
 * Idempotent (set-with-merge). Existing created_at is preserved.
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "prompt_templates";

const TEMPLATES = [
  {
    template_name: "Shiekh Default",
    is_active: true,
    priority: 1,
    match_site_owner: "shiekh",
    match_department: null,
    match_class: null,
    match_brand: null,
    match_category: null,
    tone_profile: "standard_retail",
    tone_description:
      "Clear, informative, broad-audience footwear and apparel voice",
    output_components: [
      "description",
      "meta_name",
      "meta_description",
      "keywords",
    ],
    prompt_instructions: `You are a product copywriter for Shiekh Shoes. Write compelling product content for the following product.

Tone: Clear, informative, and product-focused. Broad retail audience.

Product details:
- Name: {{name}}
- Brand: {{brand}}
- Department: {{department}}
- Class: {{class}}
- Category: {{category}}
- Primary Color: {{primary_color}}
- Gender/Age Group: {{gender}}

Generate:
1. Description: 2-3 paragraph HTML description using only <p> tags. 
   First paragraph: opening hook about the product.
   Second paragraph: key features, materials, and style details.
   Third paragraph: lifestyle positioning or call to action.
   No <h1>, <h2>, <div>, or any tags other than <p>.
2. Meta Name: SEO-optimized title under 60 characters
3. Meta Description: Compelling meta description under 160 characters
4. Keywords: 8-10 comma-separated keywords

Respond in JSON format: {"description": "<p>...</p><p>...</p>", "meta_name": "", "meta_description": "", "keywords": ""}`,
    banned_words: [],
    required_attribute_inclusions: ["brand", "primary_color"],
  },
  {
    template_name: "Karmaloop Streetwear",
    is_active: true,
    priority: 1,
    match_site_owner: "karmaloop",
    match_department: null,
    match_class: null,
    match_brand: null,
    match_category: null,
    tone_profile: "streetwear",
    tone_description:
      "Cultural, slang-aware, hype-sensitive. Speaks to core Karmaloop customer who knows brands and culture.",
    output_components: [
      "description",
      "meta_name",
      "meta_description",
      "keywords",
    ],
    prompt_instructions: `You are writing product copy for Karmaloop — a streetwear retailer known for authentic street culture. Your voice is confident, culturally aware, and brand-literate.

Tone: Streetwear. Use culturally relevant language. Be hype-aware. Speak to the customer who lives this culture.

Product details:
- Name: {{name}}
- Brand: {{brand}}
- Department: {{department}}
- Primary Color: {{primary_color}}

Generate:
1. Description: 2-3 paragraph HTML description using only <p> tags. 
   First paragraph: opening hook about the product.
   Second paragraph: key features, materials, and style details.
   Third paragraph: lifestyle positioning or call to action.
   No <h1>, <h2>, <div>, or any tags other than <p>.
2. Meta Name: Bold, brand-forward title under 60 characters
3. Meta Description: Streetwear-voiced meta under 160 characters
4. Keywords: 8-10 keywords with streetwear and brand terms

Respond in JSON format: {"description": "<p>...</p><p>...</p>", "meta_name": "", "meta_description": "", "keywords": ""}`,
    banned_words: [],
    required_attribute_inclusions: ["brand"],
  },
  {
    template_name: "MLTD Contemporary",
    is_active: true,
    priority: 1,
    match_site_owner: "mltd",
    match_department: null,
    match_class: null,
    match_brand: null,
    match_category: null,
    tone_profile: "contemporary",
    tone_description:
      "Elevated, style-forward menswear tone. More editorial than street, focused on fit and aesthetic.",
    output_components: [
      "description",
      "meta_name",
      "meta_description",
      "keywords",
    ],
    prompt_instructions: `You are writing product copy for MLTD — an elevated contemporary menswear retailer. Your voice is refined, style-conscious, and editorial.

Tone: Contemporary. Elevated vocabulary, aesthetic-focused. Speak to a customer who values fit, fabric, and design.

Product details:
- Name: {{name}}
- Brand: {{brand}}
- Department: {{department}}
- Class: {{class}}
- Category: {{category}}
- Primary Color: {{primary_color}}
- Gender/Age Group: {{gender}}

Generate:
1. Description: 2-3 paragraph HTML description using only <p> tags. 
   First paragraph: opening hook about the product.
   Second paragraph: key features, materials, and style details.
   Third paragraph: lifestyle positioning or call to action.
   No <h1>, <h2>, <div>, or any tags other than <p>.
2. Meta Name: Style-forward title under 60 characters
3. Meta Description: Editorial-toned meta under 160 characters
4. Keywords: 8-10 keywords with contemporary and brand terms

Respond in JSON format: {"description": "<p>...</p><p>...</p>", "meta_name": "", "meta_description": "", "keywords": ""}`,
    banned_words: [],
    required_attribute_inclusions: ["brand", "primary_color"],
  },
];

async function main() {
  const app = initApp();
  const db = admin.firestore(app);

  console.log(
    `\n🌱  Seeding "${COLLECTION}" (${TEMPLATES.length} templates) …`
  );

  let created = 0,
    updated = 0;

  for (const template of TEMPLATES) {
    // Use template_name as doc ID (slugified)
    const docId = template.template_name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    const ref = db.collection(COLLECTION).doc(docId);
    const snap = await ref.get();

    if (snap.exists) {
      await ref.set(
        {
          ...template,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      updated++;
    } else {
      await ref.set({
        ...template,
        created_by: "seed-script",
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      created++;
    }
    console.log(`  ✅  ${template.template_name}`);
  }

  console.log(
    `\n✅  Done — ${created} created, ${updated} updated (${TEMPLATES.length} total)\n`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("❌  Seed failed:", err);
  process.exit(1);
});
