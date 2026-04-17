const admin = require('firebase-admin');
const { initApp } = require('./utils');
initApp();
const db = admin.firestore();
const { v4: uuidv4 } = require('uuid');

const rules = [
  // ─── 1. MENS FOOTWEAR ─────────────────────────────────────────
  {
    rule_name: "Taxonomy: Men's Basketball Sneakers",
    rule_type: "type_1", is_active: true, priority: 30, always_overwrite: false,
    conditions: [{ field: "rics_category", operator: "contains", value: "Mens||Footwear||Athletic||Basketball", logic: "AND", case_sensitive: false }],
    actions: [
      { target_field: "department", value: "Footwear" }, { target_field: "gender", value: "Mens" },
      { target_field: "age_group", value: "Adult" }, { target_field: "class", value: "Sneakers" }, { target_field: "category", value: "Basketball" }
    ]
  },
  {
    rule_name: "Taxonomy: Men's Lifestyle Sneakers",
    rule_type: "type_1", is_active: true, priority: 31, always_overwrite: false,
    conditions: [{ field: "rics_category", operator: "contains", value: "Mens||Footwear||Athletic||Lifestyle", logic: "AND", case_sensitive: false }],
    actions: [
      { target_field: "department", value: "Footwear" }, { target_field: "gender", value: "Mens" },
      { target_field: "age_group", value: "Adult" }, { target_field: "class", value: "Sneakers" }, { target_field: "category", value: "Lifestyle" }
    ]
  },
  {
    rule_name: "Taxonomy: Men's Sandals/Slides",
    rule_type: "type_1", is_active: true, priority: 32, always_overwrite: false,
    conditions: [{ field: "rics_category", operator: "contains", value: "Mens||Footwear||Sandal", logic: "AND", case_sensitive: false }],
    actions: [
      { target_field: "department", value: "Footwear" }, { target_field: "gender", value: "Mens" },
      { target_field: "age_group", value: "Adult" }, { target_field: "class", value: "Sandals" }, { target_field: "category", value: "Slides" }
    ]
  },

  // ─── 2. WOMENS FOOTWEAR ───────────────────────────────────────
  {
    rule_name: "Taxonomy: Women's High Heels",
    rule_type: "type_1", is_active: true, priority: 33, always_overwrite: false,
    conditions: [{ field: "rics_category", operator: "contains", value: "Womens||", logic: "AND", case_sensitive: false }, { field: "rics_category", operator: "contains", value: "Heel", logic: "AND", case_sensitive: false }],
    actions: [
      { target_field: "department", value: "Footwear" }, { target_field: "gender", value: "Womens" },
      { target_field: "age_group", value: "Adult" }, { target_field: "class", value: "High Heels" }
    ]
  },
  {
    rule_name: "Taxonomy: Women's Boots",
    rule_type: "type_1", is_active: true, priority: 34, always_overwrite: false,
    conditions: [{ field: "rics_category", operator: "contains", value: "Womens||", logic: "AND", case_sensitive: false }, { field: "rics_category", operator: "contains", value: "Boots", logic: "AND", case_sensitive: false }],
    actions: [
      { target_field: "department", value: "Footwear" }, { target_field: "gender", value: "Womens" },
      { target_field: "age_group", value: "Adult" }, { target_field: "class", value: "Boots" }
    ]
  },

  // ─── 3. KIDS FOOTWEAR ─────────────────────────────────────────
  {
    rule_name: "Taxonomy: Boys Grade School Sneakers",
    rule_type: "type_1", is_active: true, priority: 35, always_overwrite: false,
    conditions: [{ field: "rics_category", operator: "contains", value: "Kids||Boys Grade School||Footwear", logic: "AND", case_sensitive: false }],
    actions: [
      { target_field: "department", value: "Footwear" }, { target_field: "gender", value: "Boys" },
      { target_field: "age_group", value: "Grade-School" }, { target_field: "class", value: "Sneakers" }
    ]
  },
  {
    rule_name: "Taxonomy: Girls Pre-School Sneakers",
    rule_type: "type_1", is_active: true, priority: 36, always_overwrite: false,
    conditions: [{ field: "rics_category", operator: "contains", value: "Kids||Girls Pre School||Footwear", logic: "AND", case_sensitive: false }],
    actions: [
      { target_field: "department", value: "Footwear" }, { target_field: "gender", value: "Girls" },
      { target_field: "age_group", value: "Pre-School" }, { target_field: "class", value: "Sneakers" }
    ]
  },
  {
    rule_name: "Taxonomy: Toddler Footwear",
    rule_type: "type_1", is_active: true, priority: 37, always_overwrite: false,
    conditions: [{ field: "rics_category", operator: "contains", value: "Toddler", logic: "AND", case_sensitive: false }],
    actions: [
      { target_field: "department", value: "Footwear" }, { target_field: "gender", value: "Toddler" },
      { target_field: "age_group", value: "Toddler" }, { target_field: "class", value: "Sneakers" }
    ]
  },

  // ─── 4. APPAREL & CLOTHING ────────────────────────────────────
  {
    rule_name: "Taxonomy: Men's T-Shirts",
    rule_type: "type_1", is_active: true, priority: 40, always_overwrite: false,
    conditions: [{ field: "rics_category", operator: "contains", value: "Apparel||Mens||Tops||T-short sleeve", logic: "AND", case_sensitive: false }],
    actions: [
      { target_field: "department", value: "Clothing" }, { target_field: "gender", value: "Mens" },
      { target_field: "age_group", value: "Adult" }, { target_field: "class", value: "T-shirts" }, { target_field: "category", value: "Short Sleeve" }
    ]
  },
  {
    rule_name: "Taxonomy: Men's Hoodies",
    rule_type: "type_1", is_active: true, priority: 41, always_overwrite: false,
    conditions: [{ field: "rics_category", operator: "contains", value: "Apparel||Mens||Tops||Hoodie", logic: "AND", case_sensitive: false }],
    actions: [
      { target_field: "department", value: "Clothing" }, { target_field: "gender", value: "Mens" },
      { target_field: "age_group", value: "Adult" }, { target_field: "class", value: "Sweatshirts" }, { target_field: "category", value: "Pullover Hoodie" }
    ]
  },
  {
    rule_name: "Taxonomy: Women's Pants/Joggers",
    rule_type: "type_1", is_active: true, priority: 42, always_overwrite: false,
    conditions: [{ field: "rics_category", operator: "contains", value: "Apparel||Womens||Pants", logic: "AND", case_sensitive: false }],
    actions: [
      { target_field: "department", value: "Clothing" }, { target_field: "gender", value: "Womens" },
      { target_field: "age_group", value: "Adult" }, { target_field: "class", value: "Pants" }
    ]
  },

  // ─── 5. ACCESSORIES ───────────────────────────────────────────
  {
    rule_name: "Taxonomy: Hats & Headwear",
    rule_type: "type_1", is_active: true, priority: 45, always_overwrite: false,
    conditions: [{ field: "rics_category", operator: "contains", value: "Accessories", logic: "AND", case_sensitive: false }, { field: "rics_category", operator: "contains", value: "Hat", logic: "AND", case_sensitive: false }],
    actions: [
      { target_field: "department", value: "Accessories" }, { target_field: "class", value: "Hats" }
    ]
  },
  {
    rule_name: "Taxonomy: Socks",
    rule_type: "type_1", is_active: true, priority: 46, always_overwrite: false,
    conditions: [{ field: "rics_category", operator: "contains", value: "Accessories", logic: "AND", case_sensitive: false }, { field: "rics_category", operator: "contains", value: "Socks", logic: "AND", case_sensitive: false }],
    actions: [
      { target_field: "department", value: "Accessories" }, { target_field: "class", value: "Socks & Underwear" }, { target_field: "category", value: "Socks" }
    ]
  },

  // ─── 6. COLORWAY NORMALIZATIONS ───────────────────────────────
  {
    rule_name: "Color: Triple White",
    rule_type: "type_1", is_active: true, priority: 50, always_overwrite: false,
    conditions: [{ field: "rics_color", operator: "equals", value: "WHT/WHT", logic: "OR", case_sensitive: false }, { field: "rics_color", operator: "equals", value: "WHITE/WHITE", logic: "OR", case_sensitive: false }],
    actions: [ { target_field: "primary_color", value: "White" }, { target_field: "descriptive_color", value: "Triple White" } ]
  },
  {
    rule_name: "Color: Triple Black",
    rule_type: "type_1", is_active: true, priority: 51, always_overwrite: false,
    conditions: [{ field: "rics_color", operator: "equals", value: "BLK/BLK", logic: "OR", case_sensitive: false }, { field: "rics_color", operator: "equals", value: "BLACK/BLACK", logic: "OR", case_sensitive: false }],
    actions: [ { target_field: "primary_color", value: "Black" }, { target_field: "descriptive_color", value: "Triple Black" } ]
  },
  {
    rule_name: "Color: Bred (Black/Red)",
    rule_type: "type_1", is_active: true, priority: 52, always_overwrite: false,
    conditions: [{ field: "rics_color", operator: "equals", value: "BLK/RED", logic: "OR", case_sensitive: false }],
    actions: [ { target_field: "primary_color", value: "Black" }, { target_field: "descriptive_color", value: "Black / Red" } ]
  },

  // ─── 7. MATERIAL & SILHOUETTE ENRICHMENT ──────────────────────
  {
    rule_name: "Material: Suede",
    rule_type: "type_1", is_active: true, priority: 60, always_overwrite: false,
    conditions: [{ field: "rics_long_description", operator: "contains", value: "suede", logic: "OR", case_sensitive: false }, { field: "rics_short_description", operator: "contains", value: "SUEDE", logic: "OR", case_sensitive: false }],
    actions: [ { target_field: "material_fabric", value: "Suede" } ]
  },
  {
    rule_name: "Material: Canvas",
    rule_type: "type_1", is_active: true, priority: 61, always_overwrite: false,
    conditions: [{ field: "rics_long_description", operator: "contains", value: "canvas", logic: "OR", case_sensitive: false }, { field: "rics_short_description", operator: "contains", value: "CNVS", logic: "OR", case_sensitive: false }],
    actions: [ { target_field: "material_fabric", value: "Canvas" } ]
  },
  {
    rule_name: "Silhouette: High Top",
    rule_type: "type_1", is_active: true, priority: 62, always_overwrite: false,
    conditions: [{ field: "rics_long_description", operator: "contains", value: "high top", logic: "OR", case_sensitive: false }, { field: "rics_short_description", operator: "contains", value: " HIGH", logic: "OR", case_sensitive: false }],
    actions: [ { target_field: "silhouette", value: "High Top" } ]
  },
  {
    rule_name: "Silhouette: Mid Top",
    rule_type: "type_1", is_active: true, priority: 63, always_overwrite: false,
    conditions: [{ field: "rics_long_description", operator: "contains", value: "mid top", logic: "OR", case_sensitive: false }, { field: "rics_short_description", operator: "contains", value: " MID", logic: "OR", case_sensitive: false }],
    actions: [ { target_field: "silhouette", value: "Mid Top" } ]
  },
  {
    rule_name: "Silhouette: Low Top",
    rule_type: "type_1", is_active: true, priority: 64, always_overwrite: false,
    conditions: [{ field: "rics_long_description", operator: "contains", value: "low top", logic: "OR", case_sensitive: false }, { field: "rics_short_description", operator: "contains", value: " LOW", logic: "OR", case_sensitive: false }],
    actions: [ { target_field: "silhouette", value: "Low Top" } ]
  }
];

(async () => {
  console.log(`Seeding ${rules.length} taxonomy and enrichment rules...`);
  for (const rule of rules) {
    const ruleId = uuidv4();
    await db.collection('smart_rules').doc(ruleId).set({
      ...rule,
      rule_id: ruleId,
      created_by: 'admin',
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  console.log('✅ Taxonomy & Enrichment rules successfully seeded.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
