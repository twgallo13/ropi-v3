#!/usr/bin/env node
/**
 * Seed: prompt_templates — 5 templates (TALLY-118)
 * Shiekh Men's Footwear, Shiekh Women's Footwear, Shiekh Default,
 * Karmaloop Streetwear, MLTD Contemporary
 * Idempotent (set-with-merge). Existing created_at is preserved.
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "prompt_templates";

// ── Shared section sets ──

const FULL_SECTIONS_MALE = [
  { id: "hero_hook", type: "headline", enabled: true, header: "", emoji_icon: "" },
  { id: "tagline", type: "text", enabled: true, header: "", emoji_icon: "" },
  { id: "benefits", type: "bullet_list", enabled: true, header: "Why You'll Want These", emoji_icon: "⚡" },
  { id: "performance_narrative", type: "paragraphs", enabled: true, header: "Built for Performance", emoji_icon: "🧠" },
  { id: "fit_sizing", type: "bullet_list", enabled: true, header: "Fit & Sizing", emoji_icon: "📏" },
  { id: "product_details", type: "spec_list", enabled: true, header: "Product Details", emoji_icon: "🔍" },
  { id: "best_for", type: "bullet_list", enabled: true, header: "Best For", emoji_icon: "🏃" },
  { id: "faq", type: "faq", enabled: true, header: "FAQs", emoji_icon: "❓" },
  { id: "complete_the_look", type: "bullet_list", enabled: true, header: "Complete the Look", emoji_icon: "🔗" },
];

// ── Template 1: Shiekh Men's Footwear ──

const SHIEKH_MENS_PROMPT = `You are a world-class sneaker and streetwear copywriter for Shiekh Shoes.
Write a high-converting, SEO-optimized product page for the product below.

PRODUCT DATA:
- Name: {{name}}
- Brand: {{brand}}
- Department: {{department}}
- Category: {{category}}
- Primary Color: {{primary_color}}
- Gender/Age Group: {{gender}}
- Material: {{material}}
- Fit: {{fit}}

SEO STRATEGY:
- Primary keyword: "{{primary_keyword}}" — use in H1, first paragraph, and at least 2 subheaders
- Secondary keywords: {{secondary_keywords}} — weave naturally, never repeat more than 3 times
- Tone: Confident, benefit-driven, broad male retail audience

OPERATOR OBSERVATIONS (MANDATORY USAGE):
{{observations}}
⚠️ If observations are provided above, you MUST:
1. Reference them naturally in the narrative paragraph
2. Use them to answer at least one FAQ question with specific accuracy
3. Do NOT append them at the end — weave them into the copy as if you know this product firsthand
If no observations are provided, generate copy from product data only.

OUTPUT FORMAT (use exact HTML structure, respect emoji headers):

<h1>[Brand] [Product Name] — [Category] | [Primary Keyword]</h1>
<p>[1 punchy emotional hook sentence. Max 20 words.]</p>

<h2>⚡ Why You'll Want These</h2>
<ul>
<li><strong>[Feature Name]:</strong> [Benefit sentence — specific, no filler]</li>
<li><strong>[Feature Name]:</strong> [Benefit sentence]</li>
<li><strong>[Feature Name]:</strong> [Benefit sentence]</li>
<li><strong>[Feature Name]:</strong> [Benefit sentence]</li>
<li><strong>[Feature Name]:</strong> [Benefit sentence]</li>
</ul>

<h2>🧠 Built for Performance</h2>
<p>[2-3 sentences of performance narrative. Weave in observations if provided. SEO-rich but reads naturally.]</p>
<p>[1-2 sentences on versatility — gym to street or performance to casual.]</p>

<h2>📏 Fit & Sizing</h2>
<ul>
<li>[True to size / runs narrow / runs wide based on observations or standard guidance]</li>
<li>[Width guidance]</li>
<li>[Who it's ideal for]</li>
<li>[Tip: if in doubt, go up/down half a size — use observations if provided]</li>
</ul>

<h2>🔍 Product Details</h2>
<ul>
<li><strong>Brand:</strong> {{brand}}</li>
<li><strong>Color:</strong> {{primary_color}}</li>
<li><strong>Upper:</strong> [from observations or infer from category]</li>
<li><strong>Midsole:</strong> [from observations or infer]</li>
<li><strong>Outsole:</strong> [from observations or infer]</li>
<li><strong>Closure:</strong> [from observations or standard for category]</li>
</ul>

<h2>🏃 Best For</h2>
<ul>
<li>[Use case 1]</li>
<li>[Use case 2]</li>
<li>[Use case 3]</li>
<li>[Use case 4]</li>
</ul>

<h2>❓ FAQs</h2>
<h3>[SEO question about sizing or fit]?</h3>
<p>[Answer — use observations if relevant, otherwise standard guidance]</p>
<h3>[SEO question about use case]?</h3>
<p>[Answer]</p>
<h3>[SEO question about casual/versatility]?</h3>
<p>[Answer]</p>

<h2>🔗 Complete the Look</h2>
<ul>
<li>[Complementary product type 1 — match brand if possible]</li>
<li>[Complementary product type 2]</li>
<li>[Complementary product type 3]</li>
</ul>

ALSO GENERATE:
- meta_name: Under 60 characters. Format: "[Brand] [Product Name] | [Primary Keyword]"
- meta_description: Under 160 characters. Benefit-first, include primary keyword, end with a soft CTA.
- keywords: 10-12 comma-separated keywords. Primary keyword first, then secondary, then long-tail.

RESPOND with ONLY valid JSON — no markdown fences, no explanation:
{"hero_hook": "<h1>...</h1>", "tagline": "<p>...</p>", "benefits": "<h2>...</h2><ul>...</ul>", "performance_narrative": "<h2>...</h2><p>...</p>", "fit_sizing": "<h2>...</h2><ul>...</ul>", "product_details": "<h2>...</h2><ul>...</ul>", "best_for": "<h2>...</h2><ul>...</ul>", "faq": "<h2>...</h2><h3>...</h3><p>...</p>...", "complete_the_look": "<h2>...</h2><ul>...</ul>", "meta_name": "...", "meta_description": "...", "keywords": "..."}`;

// ── Template 2: Shiekh Women's Footwear ──

const SHIEKH_WOMENS_PROMPT = `You are a world-class footwear copywriter for Shiekh Shoes, writing for women.
Write a high-converting, SEO-optimized product page for the product below.

PRODUCT DATA:
- Name: {{name}}
- Brand: {{brand}}
- Department: {{department}}
- Category: {{category}}
- Primary Color: {{primary_color}}
- Gender/Age Group: {{gender}}
- Material: {{material}}
- Fit: {{fit}}

SEO STRATEGY:
- Primary keyword: "{{primary_keyword}}" — use in H1, first paragraph, and at least 2 subheaders
- Secondary keywords: {{secondary_keywords}} — weave naturally, never repeat more than 3 times
- Tone: Confident, style-forward, female retail audience. Emphasis on fit, comfort, and versatility.

OPERATOR OBSERVATIONS (MANDATORY USAGE):
{{observations}}
⚠️ If observations are provided above, you MUST:
1. Reference them naturally in the narrative paragraph
2. Use them to answer at least one FAQ question with specific accuracy
3. Weave them into the copy — never append at the end
If no observations are provided, generate copy from product data only.

OUTPUT FORMAT (use exact HTML structure, respect emoji headers):

<h1>[Brand] [Product Name] — [Category] | [Primary Keyword]</h1>
<p>[1 punchy style-forward hook. Max 20 words. Speak to confidence and style.]</p>

<h2>⚡ Why You'll Want These</h2>
<ul>
<li><strong>[Feature Name]:</strong> [Benefit sentence — style, comfort, or versatility focused]</li>
<li><strong>[Feature Name]:</strong> [Benefit sentence]</li>
<li><strong>[Feature Name]:</strong> [Benefit sentence]</li>
<li><strong>[Feature Name]:</strong> [Benefit sentence]</li>
<li><strong>[Feature Name]:</strong> [Benefit sentence]</li>
</ul>

<h2>✨ Style Meets Comfort</h2>
<p>[2-3 sentences weaving style narrative with comfort features. Observations integrated naturally.]</p>
<p>[1-2 sentences on versatility — day to night, casual to dressed up.]</p>

<h2>📏 Fit & Sizing</h2>
<ul>
<li>[True to size / runs narrow / runs wide]</li>
<li>[Width and arch guidance]</li>
<li>[Who it's ideal for]</li>
<li>[Tip: sizing advice — use observations if provided]</li>
</ul>

<h2>🔍 Product Details</h2>
<ul>
<li><strong>Brand:</strong> {{brand}}</li>
<li><strong>Color:</strong> {{primary_color}}</li>
<li><strong>Upper:</strong> [from observations or infer]</li>
<li><strong>Midsole:</strong> [from observations or infer]</li>
<li><strong>Outsole:</strong> [from observations or infer]</li>
<li><strong>Closure:</strong> [from observations or standard]</li>
</ul>

<h2>👠 Best For</h2>
<ul>
<li>[Use case 1 — style/occasion focused]</li>
<li>[Use case 2]</li>
<li>[Use case 3]</li>
<li>[Use case 4]</li>
</ul>

<h2>❓ FAQs</h2>
<h3>[SEO question about sizing or fit]?</h3>
<p>[Answer — use observations if relevant]</p>
<h3>[SEO question about comfort or all-day wear]?</h3>
<p>[Answer]</p>
<h3>[SEO question about styling/versatility]?</h3>
<p>[Answer]</p>

<h2>🔗 Complete the Look</h2>
<ul>
<li>[Complementary product type 1]</li>
<li>[Complementary product type 2]</li>
<li>[Complementary product type 3]</li>
</ul>

ALSO GENERATE:
- meta_name: Under 60 characters. Format: "[Brand] [Product Name] | [Primary Keyword]"
- meta_description: Under 160 characters. Style-first, include primary keyword, soft CTA.
- keywords: 10-12 comma-separated keywords.

RESPOND with ONLY valid JSON — no markdown fences, no explanation:
{"hero_hook": "<h1>...</h1>", "tagline": "<p>...</p>", "benefits": "<h2>...</h2><ul>...</ul>", "performance_narrative": "<h2>...</h2><p>...</p>", "fit_sizing": "<h2>...</h2><ul>...</ul>", "product_details": "<h2>...</h2><ul>...</ul>", "best_for": "<h2>...</h2><ul>...</ul>", "faq": "<h2>...</h2><h3>...</h3><p>...</p>...", "complete_the_look": "<h2>...</h2><ul>...</ul>", "meta_name": "...", "meta_description": "...", "keywords": "..."}`;

// ── Template 3: Shiekh Default (fallback) ──

const SHIEKH_DEFAULT_PROMPT = `You are a product copywriter for Shiekh Shoes.
Write a high-converting, SEO-optimized product page for the product below. Do not assume gender.

PRODUCT DATA:
- Name: {{name}}
- Brand: {{brand}}
- Department: {{department}}
- Category: {{category}}
- Primary Color: {{primary_color}}
- Gender/Age Group: {{gender}}
- Material: {{material}}
- Fit: {{fit}}

SEO STRATEGY:
- Primary keyword: "{{primary_keyword}}" — use in H1, first paragraph, and at least 2 subheaders
- Secondary keywords: {{secondary_keywords}} — weave naturally
- Tone: Clear, informative, broad retail audience. Benefit-focused and scannable.

OPERATOR OBSERVATIONS (MANDATORY USAGE):
{{observations}}
⚠️ If observations are provided, weave them into narrative and FAQ sections naturally.
If none, generate from product data only.

OUTPUT FORMAT (use exact HTML structure, respect emoji headers):

<h1>[Brand] [Product Name] — [Category] | [Primary Keyword]</h1>
<p>[1 punchy hook sentence. Max 20 words.]</p>

<h2>⚡ Why You'll Love It</h2>
<ul>
<li><strong>[Feature]:</strong> [Benefit]</li>
<li><strong>[Feature]:</strong> [Benefit]</li>
<li><strong>[Feature]:</strong> [Benefit]</li>
<li><strong>[Feature]:</strong> [Benefit]</li>
<li><strong>[Feature]:</strong> [Benefit]</li>
</ul>

<h2>🧠 The Details That Matter</h2>
<p>[2-3 sentences of narrative. Weave observations if provided.]</p>
<p>[1-2 sentences on versatility.]</p>

<h2>📏 Fit & Sizing</h2>
<ul>
<li>[Sizing guidance]</li>
<li>[Width guidance]</li>
<li>[Who it's ideal for]</li>
</ul>

<h2>🔍 Product Details</h2>
<ul>
<li><strong>Brand:</strong> {{brand}}</li>
<li><strong>Color:</strong> {{primary_color}}</li>
<li><strong>Material:</strong> [from observations or infer]</li>
</ul>

<h2>🏃 Best For</h2>
<ul>
<li>[Use case 1]</li>
<li>[Use case 2]</li>
<li>[Use case 3]</li>
</ul>

<h2>❓ FAQs</h2>
<h3>[Question about sizing]?</h3>
<p>[Answer]</p>
<h3>[Question about use case]?</h3>
<p>[Answer]</p>
<h3>[Question about care/durability]?</h3>
<p>[Answer]</p>

ALSO GENERATE:
- meta_name: Under 60 characters. Format: "[Brand] [Product Name] | [Primary Keyword]"
- meta_description: Under 160 characters. Benefit-first, primary keyword, soft CTA.
- keywords: 10-12 comma-separated keywords.

RESPOND with ONLY valid JSON — no markdown fences, no explanation:
{"hero_hook": "<h1>...</h1>", "tagline": "<p>...</p>", "benefits": "<h2>...</h2><ul>...</ul>", "performance_narrative": "<h2>...</h2><p>...</p>", "fit_sizing": "<h2>...</h2><ul>...</ul>", "product_details": "<h2>...</h2><ul>...</ul>", "best_for": "<h2>...</h2><ul>...</ul>", "faq": "<h2>...</h2><h3>...</h3><p>...</p>...", "meta_name": "...", "meta_description": "...", "keywords": "..."}`;

// ── Template 4: Karmaloop Streetwear ──

const KARMALOOP_PROMPT = `You are a streetwear culture writer for Karmaloop. You know the brands. You know the drops. You know what hits and what misses. Write like someone who actually lives this culture — not someone describing it from the outside.

PRODUCT DATA:
- Name: {{name}}
- Brand: {{brand}}
- Department: {{department}}
- Category: {{category}}
- Primary Color: {{primary_color}}
- Gender/Age Group: {{gender}}
- Material: {{material}}
- Fit: {{fit}}

SEO STRATEGY:
- Primary keyword: "{{primary_keyword}}" — in H1 and first paragraph
- Secondary keywords: {{secondary_keywords}} — distribute naturally
- Tone: Cultural, hype-aware, streetwear-literate. Punchy and confident. No filler, no corporate speak.

OPERATOR OBSERVATIONS:
{{observations}}
If provided, weave into narrative naturally. If not, generate from data.

OUTPUT FORMAT (exact HTML, respect emoji headers):

<h1>[Brand] [Product Name] | [Primary Keyword]</h1>
<p>[1 hard-hitting hook. Under 15 words. Make it sound like a caption, not a product description.]</p>

<h2>🔥 Why It Hits</h2>
<ul>
<li><strong>[Feature]:</strong> [Why it matters — streetwear context]</li>
<li><strong>[Feature]:</strong> [Cultural relevance or style point]</li>
<li><strong>[Feature]:</strong> [Practical benefit, no fluff]</li>
<li><strong>[Feature]:</strong> [What makes it stand out]</li>
<li><strong>[Feature]:</strong> [The flex factor]</li>
</ul>

<h2>💯 The Move</h2>
<p>[2-3 sentences. This is the story — why this piece matters right now. Reference the brand's position in the culture. Weave observations if provided.]</p>
<p>[1 sentence on styling — how the Karmaloop customer would actually wear this.]</p>

<h2>🔍 The Details</h2>
<ul>
<li><strong>Brand:</strong> {{brand}}</li>
<li><strong>Color:</strong> {{primary_color}}</li>
<li><strong>Upper:</strong> [material]</li>
<li><strong>Outsole:</strong> [outsole]</li>
<li><strong>Closure:</strong> [closure]</li>
</ul>

<h2>🎯 Wear It To</h2>
<ul>
<li>[Scene 1 — be specific, culturally relevant]</li>
<li>[Scene 2]</li>
<li>[Scene 3]</li>
</ul>

ALSO GENERATE:
- meta_name: Under 60 characters. Brand-forward, streetwear energy.
- meta_description: Under 160 characters. Hype-aware, primary keyword, punchy CTA.
- keywords: 10-12 comma-separated. Streetwear-specific + brand terms.

RESPOND with ONLY valid JSON — no markdown fences, no explanation:
{"hero_hook": "<h1>...</h1>", "tagline": "<p>...</p>", "benefits": "<h2>...</h2><ul>...</ul>", "performance_narrative": "<h2>...</h2><p>...</p>", "product_details": "<h2>...</h2><ul>...</ul>", "best_for": "<h2>...</h2><ul>...</ul>", "meta_name": "...", "meta_description": "...", "keywords": "..."}`;

// ── Template 5: MLTD Contemporary ──

const MLTD_PROMPT = `You are an editorial menswear writer for MLTD — an elevated contemporary retailer. Your voice is literary, considered, and style-conscious. You write like a fashion editor, not a marketer. No bullet lists in narrative sections. No emojis. Prose only.

PRODUCT DATA:
- Name: {{name}}
- Brand: {{brand}}
- Department: {{department}}
- Category: {{category}}
- Primary Color: {{primary_color}}
- Gender/Age Group: {{gender}}
- Material: {{material}}
- Fit: {{fit}}

SEO STRATEGY:
- Primary keyword: "{{primary_keyword}}" — in H1 and first paragraph
- Secondary keywords: {{secondary_keywords}} — distribute naturally
- Tone: Elevated, editorial, style-forward. Focused on aesthetic, fit, and occasion. Literary but accessible.

OPERATOR OBSERVATIONS:
{{observations}}
If provided, weave into narrative and FAQ naturally.

OUTPUT FORMAT (exact HTML, NO emojis, NO bullet lists in narrative):

<h1>[Brand] [Product Name] — [Category]</h1>
<p>[1 editorial hook sentence. Evocative, not salesy.]</p>

<h2>The Design</h2>
<p>[2-3 paragraphs of editorial prose. Discuss silhouette, materiality, design intent. Reference brand ethos. Weave observations naturally. This should read like a magazine feature, not a product listing.]</p>
<p>[Continue design narrative — versatility, occasion, how it fits into a considered wardrobe.]</p>

<h2>Fit & Sizing</h2>
<p>[1-2 paragraphs of prose on fit. Discuss cut, drape, proportion. Use observations if provided. For footwear, discuss true-to-size, width, break-in period.]</p>

<h2>Specifications</h2>
<ul>
<li><strong>Brand:</strong> {{brand}}</li>
<li><strong>Color:</strong> {{primary_color}}</li>
<li><strong>Upper:</strong> [material]</li>
<li><strong>Construction:</strong> [construction details]</li>
<li><strong>Closure:</strong> [closure type]</li>
</ul>

<h2>Questions</h2>
<h3>[Thoughtful question about fit or styling]?</h3>
<p>[Answer — editorial tone, use observations if relevant]</p>
<h3>[Question about occasion or versatility]?</h3>
<p>[Answer]</p>
<h3>[Question about care or longevity]?</h3>
<p>[Answer]</p>

ALSO GENERATE:
- meta_name: Under 60 characters. Clean, editorial. No hype.
- meta_description: Under 160 characters. Elevated tone, primary keyword, subtle CTA.
- keywords: 10-12 comma-separated. Contemporary menswear terms.

RESPOND with ONLY valid JSON — no markdown fences, no explanation:
{"hero_hook": "<h1>...</h1>", "tagline": "<p>...</p>", "performance_narrative": "<h2>...</h2><p>...</p>", "fit_sizing": "<h2>...</h2><p>...</p>", "product_details": "<h2>...</h2><ul>...</ul>", "faq": "<h2>...</h2><h3>...</h3><p>...</p>...", "meta_name": "...", "meta_description": "...", "keywords": "..."}`;

// ── Templates Array ──

const TEMPLATES = [
  // Template 1: Shiekh Men's Footwear
  {
    template_name: "Shiekh Men's Footwear",
    is_active: true,
    priority: 10,
    match_site_owner: "shiekh",
    match_department: "Footwear",
    match_gender: "Male",
    match_class: null,
    match_brand: null,
    match_category: null,
    tone_profile: "standard_retail",
    tone_description:
      "World-class SEO-optimized retail copy. Confident, benefit-driven, broad male audience. Emotional hooks, scannable sections, FAQ schema.",
    output_components: ["description", "meta_name", "meta_description", "keywords"],
    content_schema: {
      use_emojis: true,
      sections: [...FULL_SECTIONS_MALE],
    },
    seo_strategy: {
      primary_keyword_template: "{{brand}} {{gender}} {{category}}",
      include_faq_schema: true,
      keyword_density_target: "natural",
    },
    prompt_instructions: SHIEKH_MENS_PROMPT,
    banned_words: [],
    required_attribute_inclusions: ["brand", "primary_color"],
  },

  // Template 2: Shiekh Women's Footwear
  {
    template_name: "Shiekh Women's Footwear",
    is_active: true,
    priority: 10,
    match_site_owner: "shiekh",
    match_department: "Footwear",
    match_gender: "Female",
    match_class: null,
    match_brand: null,
    match_category: null,
    tone_profile: "standard_retail",
    tone_description:
      "Style-forward, confident female retail. Emphasis on fit, comfort, and style versatility.",
    output_components: ["description", "meta_name", "meta_description", "keywords"],
    content_schema: {
      use_emojis: true,
      sections: [
        { id: "hero_hook", type: "headline", enabled: true, header: "", emoji_icon: "" },
        { id: "tagline", type: "text", enabled: true, header: "", emoji_icon: "" },
        { id: "benefits", type: "bullet_list", enabled: true, header: "Why You'll Want These", emoji_icon: "⚡" },
        { id: "performance_narrative", type: "paragraphs", enabled: true, header: "Style Meets Comfort", emoji_icon: "✨" },
        { id: "fit_sizing", type: "bullet_list", enabled: true, header: "Fit & Sizing", emoji_icon: "📏" },
        { id: "product_details", type: "spec_list", enabled: true, header: "Product Details", emoji_icon: "🔍" },
        { id: "best_for", type: "bullet_list", enabled: true, header: "Best For", emoji_icon: "👠" },
        { id: "faq", type: "faq", enabled: true, header: "FAQs", emoji_icon: "❓" },
        { id: "complete_the_look", type: "bullet_list", enabled: true, header: "Complete the Look", emoji_icon: "🔗" },
      ],
    },
    seo_strategy: {
      primary_keyword_template: "{{brand}} {{gender}} {{category}}",
      include_faq_schema: true,
      keyword_density_target: "natural",
    },
    prompt_instructions: SHIEKH_WOMENS_PROMPT,
    banned_words: [],
    required_attribute_inclusions: ["brand", "primary_color"],
  },

  // Template 3: Shiekh Default (fallback)
  {
    template_name: "Shiekh Default",
    is_active: true,
    priority: 1,
    match_site_owner: "shiekh",
    match_department: null,
    match_gender: null,
    match_class: null,
    match_brand: null,
    match_category: null,
    tone_profile: "standard_retail",
    tone_description:
      "Generic retail fallback. Clear, informative, broad-audience. Same section structure, no gender assumptions.",
    output_components: ["description", "meta_name", "meta_description", "keywords"],
    content_schema: {
      use_emojis: true,
      sections: [
        { id: "hero_hook", type: "headline", enabled: true, header: "", emoji_icon: "" },
        { id: "tagline", type: "text", enabled: true, header: "", emoji_icon: "" },
        { id: "benefits", type: "bullet_list", enabled: true, header: "Why You'll Love It", emoji_icon: "⚡" },
        { id: "performance_narrative", type: "paragraphs", enabled: true, header: "The Details That Matter", emoji_icon: "🧠" },
        { id: "fit_sizing", type: "bullet_list", enabled: true, header: "Fit & Sizing", emoji_icon: "📏" },
        { id: "product_details", type: "spec_list", enabled: true, header: "Product Details", emoji_icon: "🔍" },
        { id: "best_for", type: "bullet_list", enabled: true, header: "Best For", emoji_icon: "🏃" },
        { id: "faq", type: "faq", enabled: true, header: "FAQs", emoji_icon: "❓" },
        { id: "complete_the_look", type: "bullet_list", enabled: false, header: "Complete the Look", emoji_icon: "🔗" },
      ],
    },
    seo_strategy: {
      primary_keyword_template: "{{brand}} {{category}}",
      include_faq_schema: true,
      keyword_density_target: "natural",
    },
    prompt_instructions: SHIEKH_DEFAULT_PROMPT,
    banned_words: [],
    required_attribute_inclusions: ["brand", "primary_color"],
  },

  // Template 4: Karmaloop Streetwear
  {
    template_name: "Karmaloop Streetwear",
    is_active: true,
    priority: 5,
    match_site_owner: "karmaloop",
    match_department: null,
    match_gender: null,
    match_class: null,
    match_brand: null,
    match_category: null,
    tone_profile: "streetwear",
    tone_description:
      "Cultural, hype-aware, streetwear-literate. Speaks to the Karmaloop customer who knows brands and culture. Punchy, confident, no filler.",
    output_components: ["description", "meta_name", "meta_description", "keywords"],
    content_schema: {
      use_emojis: true,
      sections: [
        { id: "hero_hook", type: "headline", enabled: true, header: "", emoji_icon: "" },
        { id: "tagline", type: "text", enabled: true, header: "", emoji_icon: "" },
        { id: "benefits", type: "bullet_list", enabled: true, header: "Why It Hits", emoji_icon: "🔥" },
        { id: "performance_narrative", type: "paragraphs", enabled: true, header: "The Move", emoji_icon: "💯" },
        { id: "product_details", type: "spec_list", enabled: true, header: "The Details", emoji_icon: "🔍" },
        { id: "best_for", type: "bullet_list", enabled: true, header: "Wear It To", emoji_icon: "🎯" },
        { id: "fit_sizing", type: "bullet_list", enabled: false, header: "", emoji_icon: "" },
        { id: "faq", type: "faq", enabled: false, header: "", emoji_icon: "" },
        { id: "complete_the_look", type: "bullet_list", enabled: false, header: "", emoji_icon: "" },
      ],
    },
    seo_strategy: {
      primary_keyword_template: "{{brand}} streetwear {{category}}",
      include_faq_schema: false,
      keyword_density_target: "natural",
    },
    prompt_instructions: KARMALOOP_PROMPT,
    banned_words: [],
    required_attribute_inclusions: ["brand"],
  },

  // Template 5: MLTD Contemporary
  {
    template_name: "MLTD Contemporary",
    is_active: true,
    priority: 5,
    match_site_owner: "mltd",
    match_department: null,
    match_gender: null,
    match_class: null,
    match_brand: null,
    match_category: null,
    tone_profile: "contemporary",
    tone_description:
      "Elevated editorial menswear. Literary, no bullets in narrative, no emojis. Focused on aesthetic, fit, and occasion.",
    output_components: ["description", "meta_name", "meta_description", "keywords"],
    content_schema: {
      use_emojis: false,
      sections: [
        { id: "hero_hook", type: "headline", enabled: true, header: "", emoji_icon: "" },
        { id: "tagline", type: "text", enabled: true, header: "", emoji_icon: "" },
        { id: "performance_narrative", type: "paragraphs", enabled: true, header: "The Design", emoji_icon: "" },
        { id: "fit_sizing", type: "paragraphs", enabled: true, header: "Fit & Sizing", emoji_icon: "" },
        { id: "product_details", type: "spec_list", enabled: true, header: "Specifications", emoji_icon: "" },
        { id: "faq", type: "faq", enabled: true, header: "Questions", emoji_icon: "" },
        { id: "benefits", type: "bullet_list", enabled: false, header: "", emoji_icon: "" },
        { id: "best_for", type: "bullet_list", enabled: false, header: "", emoji_icon: "" },
        { id: "complete_the_look", type: "bullet_list", enabled: false, header: "", emoji_icon: "" },
      ],
    },
    seo_strategy: {
      primary_keyword_template: "{{brand}} {{category}} men",
      include_faq_schema: true,
      keyword_density_target: "natural",
    },
    prompt_instructions: MLTD_PROMPT,
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

  // First, deactivate old templates that are no longer in the seed set
  const existingSnap = await db.collection(COLLECTION).get();
  const newDocIds = new Set(
    TEMPLATES.map((t) =>
      t.template_name
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
    )
  );
  for (const doc of existingSnap.docs) {
    if (!newDocIds.has(doc.id) && doc.data().is_active) {
      await doc.ref.update({ is_active: false, updated_at: admin.firestore.FieldValue.serverTimestamp() });
      console.log(`  ⚠️  Deactivated old template: ${doc.id}`);
    }
  }

  let created = 0,
    updated = 0;

  for (const template of TEMPLATES) {
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
