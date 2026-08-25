# TASK E — Named open questions

Repo @ `2698e48`; live reads against `ropi-aoss-dev`. Every answer carries `file:line`, a command output, or a Firestore doc id. **9 of 9 answered; none NOT FOUND.**

---

## E1. Can smart rules write to ROOT product fields, or only to `attribute_values` registry attributes?

**ANSWER: `attribute_values` only — with exactly one hardcoded exception, and the target must be a registry doc id or the write is silently skipped.**

The write path is `writeRuleAction` ([smartRules.ts:232-303](backend/functions/src/services/smartRules.ts#L232-L303)):

```ts
// :244-249  — registry gate
if (!registryKeys.has(targetField)) {
  console.error(`Smart Rule "${ruleId}": target_field "${targetField}" not found in attribute_registry — skipping.`);
  return { wrote: false, skippedReason: "target_field not in registry" };
}
// :251-252 — the only target
const productRef = firestore.collection("products").doc(mpn);
const attrRef = productRef.collection("attribute_values").doc(targetField);
// :272-281 — the write
await attrRef.set({ value, origin_type: "Smart Rule", origin_detail: `Rule #${ruleId} — ${ruleName}`,
                    verification_state: "Rule-Verified", written_at: ... }, { merge: true });
```

`registryKeys` is built from **`attribute_registry` doc ids** — [smartRules.ts:338](backend/functions/src/services/smartRules.ts#L338) and [:443](backend/functions/src/services/smartRules.ts#L443): `new Set(registrySnap.docs.map((d) => d.id))`.

**The one exception** is the legacy UUID-name cleanup at [smartRules.ts:354-368](backend/functions/src/services/smartRules.ts#L354-L368), which writes `attribute_values/source_inputs.raw_name_original` and then root `products/{mpn}.name = ""`. That branch is keyed on the literal rule id `rule_uuid_name_cleanup` and is not reachable by any configured rule.

Two ceilings also apply before the write: Human-Verified ([:255-257](backend/functions/src/services/smartRules.ts#L255-L257)) and fill-if-empty unless `always_overwrite` ([:259-264](backend/functions/src/services/smartRules.ts#L259-L264)).

**Consequences worth carrying:**
- The 13 live `Taxonomy: *` rules write `attribute_values/department_key` and **nothing mirrors that to root `department_key`**. Root is written only by import ([importFullProduct.ts:636](backend/functions/src/routes/importFullProduct.ts#L636), *before* rules fire at [:898](backend/functions/src/routes/importFullProduct.ts#L898)) and by the interactive editor ([products.ts:1183-1197](backend/functions/src/routes/products.ts#L1183-L1197)). A rule-determined department never reaches the list filter, the cadence engine, any index, or search.
- The Smart Rule Builder offers **`brand_key`** as an action target ([SmartRuleBuilderPage.tsx:186-189](frontend/src/pages/SmartRuleBuilderPage.tsx#L186-L189), [:200-207](frontend/src/pages/SmartRuleBuilderPage.tsx#L200-L207), [:309-323](frontend/src/pages/SmartRuleBuilderPage.tsx#L309-L323)) but **`attribute_registry/brand_key` does not exist live**, so any such rule is skipped forever with only a `console.error`.

---

## E2. Does `completionCompute`'s `depends_on` predicate support anything other than equality? Could it express "website INCLUDES Karmaloop" on a multi-select?

**ANSWER: Equality only — strict string equality, no operator field. It cannot express INCLUDES.**

Type ([completionCompute.ts:30](backend/functions/src/services/completionCompute.ts#L30)):
```ts
depends_on?: { field: string; value: string } | null;
```
There is no `operator` member.

Evaluation, verbatim ([completionCompute.ts:129-135](backend/functions/src/services/completionCompute.ts#L129-L135)):
```ts
if (rf.depends_on) {
  const depAttr = attrMap.get(rf.depends_on.field);
  const depValue = depAttr ? String(depAttr.value ?? "") : "";
  if (depValue !== rf.depends_on.value) {
    continue; // predicate not met — field not required in this context
  }
}
```
The only comparison operator in the entire predicate path is `!==`.

**Could it express "website INCLUDES Karmaloop"? No, on two independent counts.**
1. `String(depAttr.value)` on an array produces a JS comma-join — `["shiekh.com","karmaloop.com"]` → `"shiekh.com,karmaloop.com"` — which matches only when `value` is that exact string in that exact order. That is not an INCLUDES; it is an accidental full-array equality.
2. Live `attribute_values/website` values are **scalar strings, not arrays** (67 docs: `"shiekh.com"` ×33, `"karmaloop.com"` ×28, `"true"` ×5, `"fbrkclothing.com"` ×1), despite the registry declaring `field_type: "multi_select"`. So even the joined-string accident does not arise.

Expressing INCLUDES requires a new `operator` member on the type plus a new branch at `:132`.

**Live state of the feature:** 5 registry attributes carry `depends_on`, all identical — `{field: "is_fast_fashion", value: "true"}` on `heel_height`, `heel_type`, `platform_height`, `shoe_height_map`, `toe_shape`. **None of the five is `required_for_completion: true`**, so `depends_on` currently has **zero effect on any completion computation** (`getRequiredFieldKeys` queries only `required_for_completion == true`, [:212-215](backend/functions/src/services/completionCompute.ts#L212-L215)). The only UI honouring it is a hardcoded `is_fast_fashion` drawer at [ProductDetailPage.tsx:690-756](frontend/src/pages/ProductDetailPage.tsx#L690-L756), not a generic predicate renderer.

---

## E3. Which live `cadence_rules` filter on `department_key` (or `department`, `brand`, `brand_key`, `site_owner`)? List every rule doc id and its target filter.

**ANSWER: 14 rule docs live. 12 filter on `department_key`, 3 on `site_owner`, 1 on `brand_key`, 0 on `department`, 0 on `brand`.** (Rules carry multiple filters, so the counts overlap.)

| doc id | name | enabled | target_filters |
|---|---|---|---|
| `1a1a6ef7-f613-4e27-b641-20961605b071` | Alana — MLTD Clothing 45-Day Zero Sales | true | `site_owner equals mltd` (cs=false) · `department_key equals clothing` (cs=false) |
| `20c227f0-184f-4415-b120-9032ea473beb` | Heather — Women's Clothing 45-Day Zero Sales | true | `department_key equals clothing` (cs=**true**) · `gender equals Womens` (cs=true) |
| `2821a4b5-e09b-4f86-8a7c-e53e85e34273` | Alex — Boys' Footwear 45-Day Zero Sales **(TEST CHANGE)** | **false** | `department_key equals footwear` (cs=false) |
| `477c3199-860b-4235-a9e2-3a2cba37656b` | Alana — MLTD Accessories 45-Day Zero Sales | true | `site_owner equals mltd` (cs=false) · `department_key equals accessories` (cs=true) |
| `4e624c84-5997-4adf-9cbb-cdc72790c31e` | Heather — Women's Footwear 45-Day Zero Sales | true | `gender equals Womens` (cs=true) · `department_key equals footwear` (cs=true) |
| `6fe5bd2d-3605-4892-985f-fa7c9aa92134` | Richard — Men's Clothing 45-Day Zero Sales | true | `department_key equals clothing` (cs=true) · `gender equals Mens` (cs=true) |
| `9a10e6d6-a53a-4906-8311-5d3797ec50cb` | Heather — Girls' Footwear 45-Day Zero Sales | true | `department_key equals footwear` (cs=true) · `gender equals Girls` (cs=true) |
| `FcOgd2O6b9fgv2O2ego4` | Nike | **false** | **`brand_key contains nike`** (cs=false) |
| `a048c266-67e1-4bec-a434-b4efef2963d6` | Alex — Men's Footwear 45-Day Zero Sales | **false** | `department_key equals footwear` (cs=false) · `gender equals Mens` (cs=false) |
| `abc26100-aed0-4fe0-8730-c8f27efe7039` | Alana — MLTD Footwear 45-Day Zero Sales | true | `site_owner equals mltd` (cs=false) · `department_key equals footwear` (cs=true) |
| `f33237bb-e3bd-4931-8268-7faf9b5ec9ef` | Alex — Toddler Footwear 45-Day Zero Sales | true | `department_key equals footwear` (cs=false) · `gender equals Toddler` (cs=false) |
| `f63c1d49-f137-474a-a8b8-17b007e7ab84` | Mike — Accessories 45-Day Zero Sales | true | `department_key equals accessories` (cs=true) |
| `jsakAzUhKLHBW8paTSRU` | Alex — Men's Footwear 45-Day Zero Sales | true | `gender equals Mens` (cs=true) · `department_key equals footwear` (cs=true) |
| `oBHN3Xm85fSfNGM7tmh5` | **test** | **false** | `department_key contains footwear` (cs=true) |

**Every `department_key` value is lowercase.** Appendix B's "a known rule filters on `department_key equals Clothing`" is **not confirmed as written** (Task C, C2). This matters: `evaluateFilter` defaults `case_sensitive` to **true** ([cadenceEngine.ts:223](backend/functions/src/services/cadenceEngine.ts#L223) — `f.case_sensitive !== false`), and it reads **root** `product[f.field]` ([:206-217](backend/functions/src/services/cadenceEngine.ts#L206-L217)), where live values are lowercase. A rule written with `Clothing` + `case_sensitive: true` would match zero products.

**Related, on `smart_rules` (35 docs):** 13 write `target_field: "department_key"` (the `Taxonomy: *` rules); 4 read `department_key` as a condition field (`dim_clothing_weight`, `dim_footwear_kids_dimensions`, `dim_footwear_unisex_dimensions`, `dim_footwear_womens_dimensions`); 1 reads `brand_key` (`dim_nike_launch_shipping_override`). **One rule still stores the blocked legacy field:** `rule_acceptance_test_delete_me_mo2i4fkj` ("ACCEPTANCE TEST — delete me", disabled) has `conditions: [{field: "department", operator: "equals", value: "Footwear", case_sensitive: true}]`.

---

## E4. Do the three site descriptions (Shiekh / Karmaloop / MLTD) exist as registry attributes, root product fields, or not at all?

**ANSWER: NOT AT ALL. There is no per-site description anywhere — not as a registry attribute, not as a root product field, not in `attribute_values`, and not on `site_registry`.**

Evidence:
- `grep -rn -iE "shiekh_description|karmaloop_description|mltd_description|site_description|description_shiekh"` across `backend/functions/src`, `frontend/src` and `scripts` → **no matches**.
- Live `attribute_registry` docs matching `/desc/i` — **4, none site-scoped**: `ai_generated_description` ("AI Generated Description", `descriptions_seo`), `descriptive_color` ("Descriptive Color", `product_attributes`), `long_description` ("Long Description", `descriptions_seo`), `short_description` ("Short Description", `descriptions_seo`).
- Live root product fields matching `/desc/i` on a sample product (`1005177`) — **none** (`[]`).
- Live `attribute_values` doc ids matching `/desc/i` — `description`, `descriptive_color`. `description` is **not in the registry** (one of the 21 orphan attribute keys; 62 of 81 products carry it) and is a single field, not per-site.
- Live `site_registry` docs carry no description-shaped field: the 8 docs have `site_key`, `display_name`, `domain`, `is_active`, `priority`, `badge_color`, `platform`, `status`, `ai_content_strategy`, `locale`, `currency`, `timezone`, `vertical`, `features`, `feed_config`, timestamps.

**What exists instead, and is probably what the question is reaching for:** per-site *generated content* lives in the `products/{id}/content_versions` subcollection, keyed by `site_owner` ([aiDescribe.ts:262-287](backend/functions/src/services/aiDescribe.ts#L262-L287), read at [aiContent.ts:71](backend/functions/src/routes/aiContent.ts#L71)). And per-site *tone* lives on `site_registry.ai_content_strategy` (`use_shiekh_default`, `use_karmaloop_default`, `use_mltd_default`) — but `grep -rn ai_content_strategy backend/functions/src` returns **no matches**, so that field is written by the seed and read by nothing.

---

## E5. What does the export CSV emit for brand, department, class, category, sub_category, website — field by field from `exportSerializer.ts`, including whether it reads root or `attribute_values`?

**ANSWER (RetailOps export, `services/exportSerializer.ts`):**

| Column | Source | file:line | Live coverage (81 products) |
|---|---|---|---|
| `brand` | **root** `p.brand` | [:229](backend/functions/src/services/exportSerializer.ts#L229) | 76 non-empty |
| `department` | **`attribute_values/department`** — the **legacy, quarantined** doc | [:232](backend/functions/src/services/exportSerializer.ts#L232) | **25** — blank for 56 products, and wrong for `120029-CHRMWHTNVY` (emits `"Accessories"`; canonical is `footwear`) |
| `class` | `attribute_values/class` | [:233](backend/functions/src/services/exportSerializer.ts#L233) | 76 |
| `category` | `attribute_values/category` | [:234](backend/functions/src/services/exportSerializer.ts#L234) | 76 |
| `sub_category` | `attribute_values/sub_category` | [:235](backend/functions/src/services/exportSerializer.ts#L235) | **0 — always empty** |
| `website` | **not a hardcoded column.** It appears among the 92 **dynamic** registry-driven columns | [exportRegistry.ts:25-37](backend/functions/src/lib/exportRegistry.ts#L25-L37) | 67 non-empty, of which 5 hold the literal `"true"` |

`attrs` is built at [:163-167](backend/functions/src/services/exportSerializer.ts#L163-L167) from the raw `attribute_values` subcollection with **no `quarantined` filter** — unlike [products.ts:764](backend/functions/src/routes/products.ts#L764), which does filter. That is why the legacy `department` doc leaks into the CSV.

Site information is **not** `website` or `site_owner`: it is the `site_targets` column, built from each `site_targets` subcollection doc's **`domain`** field, joined by `admin_settings/export_site_separator` ([:191-195](backend/functions/src/services/exportSerializer.ts#L191-L195), [:96](backend/functions/src/services/exportSerializer.ts#L96)) — live value `"|"`. 62 of 81 products have that subcollection.

**Column count:** 24 hardcoded ([:101-126](backend/functions/src/services/exportSerializer.ts#L101-L126)) + up to 92 dynamic (deduped against the hardcoded set at [:127-131](backend/functions/src/services/exportSerializer.ts#L127-L131)). `loadExportableAttrs()` returns 92 of 96 registry attributes (filter: `active === true && export_enabled !== false`; 2 inactive + 2 with `export_enabled: false`), sorted by `display_order` — which is **heavily collided**: 14 attributes share `display_order: 1`, so ordering within a tier is effectively Firestore doc order.

**The parallel export disagrees.** `GET /api/v1/products/export.csv` ([products.ts:421-453](backend/functions/src/routes/products.ts#L421)) has its own 15-column hardcoded list and sources `department` from **`department_key`** ([:632-644](backend/functions/src/routes/products.ts#L632-L644)) — the canonical field — plus a `SUPPRESSED_DYNAMIC_KEYS = {"department_key"}` guard at [:593](backend/functions/src/routes/products.ts#L593). It emits `site_owner` (via `getSiteOwner()`) and no `site_targets`. The two exports therefore disagree about both Department and Site.

---

## E6. Are the `orders` composite indexes referenced by any code? If not, write UNREFERENCED.

**ANSWER: UNREFERENCED.** And the same is true of `payments` and `sessions`.

Indexes present in `firebase/firestore.indexes.json`:
- `orders`: `userId ASC + createdAt DESC` · `status ASC + createdAt DESC` · `userId ASC + status ASC + createdAt DESC` — **3**
- `payments`: `orderId ASC + status ASC + createdAt DESC` — **1**
- `sessions`: `userId ASC + isActive ASC + expiresAt ASC` — **1**

`grep -rn 'collection("orders")\|collection("payments")\|collection("sessions")\|collection("auditLogs")'` across `backend/functions/src`, `frontend/src` and `scripts` → **no matches**.

None of the three collections exists live either — `db.listCollections()` on `ropi-aoss-dev` returns 35 collections and none of them is `orders`, `payments` or `sessions`.

Two corroborating signals that these are foreign/template residue rather than planned work: they are the **only** indexes in the file that use camelCase field names (`userId`, `createdAt`, `orderId`, `isActive`, `expiresAt`) — the entire product uses snake_case — and they are the only entries with no `__comment__` key, while nearly every other index carries a `"__comment__": "Index NN — …"` tag.

**5 unreferenced index entries.** (With the 2 dead `department` indexes and the 2 dead `brand` indexes from Tasks B1/B3, that is **9 dead index entries of 108**.)

---

## E7. Does anything reference `ropi-aoss-staging` or `ropi-aoss-prod` at RUNTIME (not only in deploy scripts)?

**ANSWER: NO. Runtime references: zero.**

`grep -rn "ropi-aoss-staging\|ropi-aoss-prod"` across `--include='*.ts' --include='*.tsx' --include='*.js' --include='*.json' --include='*.sh'`, excluding `node_modules` and `docs/`, returns exactly two hits, both in deploy scripts:
- [scripts/deploy-prod.sh:6](scripts/deploy-prod.sh#L6) — `PROJECT="ropi-aoss-prod"`
- [scripts/deploy-staging.sh:5](scripts/deploy-staging.sh#L5) — `PROJECT="ropi-aoss-staging-v3"`

Plus `.firebaserc`, which is configuration rather than runtime: `{"projects": {"default": "ropi-aoss-dev", "dev": "ropi-aoss-dev", "staging": "ropi-aoss-staging-v3", "prod": "ropi-aoss-prod"}}`.

The runtime project resolution is environment-driven, not literal: [index.ts:72](backend/functions/src/index.ts#L72) reads `process.env.FIREBASE_PROJECT_ID` with a **hardcoded fallback of `"ropi-aoss-dev"`**, and [index.ts:59](backend/functions/src/index.ts#L59) reads `process.env.FIREBASE_STORAGE_BUCKET`.

**Naming correction (Task C, C6):** the staging project is **`ropi-aoss-staging-v3`**, not `ropi-aoss-staging` as the question states.

**Related risk worth recording:** all three service-account keys are present in this environment simultaneously (`GCP_SA_KEY_DEV`, `GCP_SA_KEY_STAGING`, `GCP_SA_KEY_PROD`; `client_email` values confirm `ropi-aoss-dev`, `ropi-aoss-staging-v3`, `ropi-aoss-prod`). Every script hardcodes `projectId: "ropi-aoss-dev"` and reads `GCP_SA_KEY_DEV` — dev-only by convention, not by guard. Relevant to P1-0.

---

## E8. Where does `aiDescribe.ts` take the site from — the product's `website` field, `site_owner`, or the request body?

**ANSWER: the REQUEST BODY, entirely, and unvalidated.**

`services/aiDescribe.ts` never reads the product's site. `generateContent` receives `siteOwner` as its third **parameter** ([aiDescribe.ts:144-151](backend/functions/src/services/aiDescribe.ts#L144-L151)) and uses it only to scope and stamp output — `content_versions` version count ([:262-266](backend/functions/src/services/aiDescribe.ts#L262-L266)), the new version doc ([:272](backend/functions/src/services/aiDescribe.ts#L272)), the `audit_log` entry ([:293](backend/functions/src/services/aiDescribe.ts#L293)), and the return value ([:303](backend/functions/src/services/aiDescribe.ts#L303)). It is also passed to `selectTemplate` as the site dimension ([:185](backend/functions/src/services/aiDescribe.ts#L185)).

The caller is `POST /api/v1/products/:mpn/ai-describe` ([aiContent.ts:18](backend/functions/src/routes/aiContent.ts#L18)):
```ts
// :25
const { site_owners, observations_note } = req.body;
// :27-30 — the ONLY validation
if (!site_owners || !Array.isArray(site_owners) || site_owners.length === 0) { … 400 … }
// :34-36
const results = await Promise.all(site_owners.map((siteOwner: string) => generateContent(…)));
```

**There is no check that the value exists in `site_registry`, is active, or is one of the product's own sites.** Any authenticated caller with `admin` / `completion_specialist` / `operations_operator` can generate and persist a `content_versions` doc under an arbitrary `site_owner` string.

The regenerate path reuses the stored value instead of the body: [aiContent.ts:418](backend/functions/src/routes/aiContent.ts#L418) — `const siteOwner = prevData.site_owner;`.

The **frontend** does supply registry-sourced values — [AIContentReviewPage.tsx:67-77](frontend/src/pages/AIContentReviewPage.tsx#L67-L77) calls `fetchSiteRegistry(true)` (active-only) and maps to `e.site_key` — but that is a client-side convention, not a server-side constraint.

---

## E9. What does the AI enrichment `POST /name/:mpn` path do with `rics_long_description` / `rics_short_description`? Does anything else treat those two fields as prose?

**ANSWER: `POST /name/:mpn` reads only the SHORT description, and only to put it in the prompt. It never reads the long one. Four other consumers treat both as prose — three of them via `contains` matching in live smart rules.**

### What `POST /api/v1/ai-enrich/name/:mpn` does

Route: [aiEnrichment.ts:166-178](backend/functions/src/routes/aiEnrichment.ts#L166-L178) → `enrichName(mpn)` ([:88-138](backend/functions/src/routes/aiEnrichment.ts#L88-L138)). **Gate: NONE** (one of the 13 ungated routes).

1. `loadProductCtx` ([:34-57](backend/functions/src/routes/aiEnrichment.ts#L34-L57)) reads the `attribute_values/source_inputs` doc and resolves **both** names, tolerating two spellings:
   ```ts
   rics_short_desc: sd.rics_short_desc || sd.rics_short_description,   // :53
   rics_long_desc:  sd.rics_long_desc  || sd.rics_long_description,    // :54
   ```
   Live `source_inputs` keys on a sample product: `["rics_color","rics_brand","rics_short_description","rics_long_description","rics_category"]` — i.e. the **long** spellings are what is actually stored, so the `||` fallback is the branch that fires.
2. **Only `rics_short_desc` reaches the prompt** — [:102](backend/functions/src/routes/aiEnrichment.ts#L102): `RICS Short Description: ${ctx.rics_short_desc || ""}`. **`ctx.rics_long_desc` is loaded and never used anywhere in `enrichName`.**
3. The model output is trimmed and de-quoted ([:127](backend/functions/src/routes/aiEnrichment.ts#L127)), then written **twice**: root `products/{id}` gets `{name, name_source: "ai_generated", needs_ai_name: false}` ([:132-135](backend/functions/src/routes/aiEnrichment.ts#L132-L135)), and `attribute_values/name` gets the value with `origin_type: "AI"`, `verification_state: "System-Applied"` ([:136](backend/functions/src/routes/aiEnrichment.ts#L136) → `writeAttr` at [:59-86](backend/functions/src/routes/aiEnrichment.ts#L59-L86), which respects a Human-Verified ceiling at [:72-74](backend/functions/src/routes/aiEnrichment.ts#L72-L74)).
   Note `attribute_values/name` is **not** a registry doc id — the registry field is `product_name`. So this write lands on an orphan attribute key.

### Everything else that treats the two fields as prose

| Consumer | Treats it as | file:line |
|---|---|---|
| **5 live smart rules** — `Material: Suede`, `Material: Canvas`, `Silhouette: High Top`, `Silhouette: Mid Top`, `Silhouette: Low Top` | **prose, substring-matched**: `rics_long_description contains "suede"` OR `rics_short_description contains "SUEDE"`, etc. | live `smart_rules`; seeded by [seed-taxonomy-rules.js:157-181](scripts/seed/seed-taxonomy-rules.js#L157-L181) |
| **Smart Rule Builder** — offers both as condition fields | prose (operator menu includes `contains`) | [SmartRuleBuilderPage.tsx:52-53](frontend/src/pages/SmartRuleBuilderPage.tsx#L52-L53) |
| **RICS parser — product name derivation** | **prose promoted to a product name**: when the CSV Name column is empty, `formatRicsShortDesc(rics)` becomes the product name and `name_source` is set to `"rics_short_desc"` | [ricsParser.ts:157-169](backend/functions/src/services/ricsParser.ts#L157-L169), [:379](backend/functions/src/services/ricsParser.ts#L379) |
| **Import — the trigger for this whole path** | flags the product for AI renaming | [importFullProduct.ts:672-676](backend/functions/src/routes/importFullProduct.ts#L672-L676) — `name_source === "rics_short_desc"` → `needs_ai_name: true` |
| **AI Describe — explicitly EXCLUDES them** | not prose; deliberately withheld from the description prompt | [aiDescribe.ts:13-19](backend/functions/src/services/aiDescribe.ts#L13-L19) — `EXCLUDED_FIELDS` contains `rics_short_desc`, `rics_long_desc` |
| **Legacy smart rule `rule_ai_name_enrichment`** | condition on `name_source == "rics_short_desc"` | live `smart_rules/rule_ai_name_enrichment`; seeded by [seed-smart-rules.js:54, :63](scripts/seed/seed-smart-rules.js#L54) |

**Naming inconsistency worth recording:** the CSV column map writes the **short** spellings (`rics_short_desc`, `rics_long_desc` — [ricsParser.ts:257-258](backend/functions/src/services/ricsParser.ts#L257-L258)), the import's `sourceInputs` writes the **long** spellings (`rics_short_description`, `rics_long_description` — [importFullProduct.ts:349-350](backend/functions/src/routes/importFullProduct.ts#L349-L350)), the live data carries the **long** spellings, and the live smart rules match on the **long** spellings — while `aiDescribe.ts:16-17` excludes only the **short** spellings. So AI Describe's exclusion list does not actually exclude the fields that exist. `aiEnrichment.ts:53-54` is the only place that tolerates both.

---

## Summary — one line each

| Q | Answer |
|---|---|
| **E1** | `attribute_values` only (`smartRules.ts:252`), target must be a registry **doc id** or it is silently skipped (`:244-249`); one hardcoded root write for `rule_uuid_name_cleanup` (`:364-367`). |
| **E2** | Strict string equality only — no operator field (`completionCompute.ts:30`, `:129-135`). Cannot express INCLUDES. Live: 5 attributes use it, none required, so it has zero effect today. |
| **E3** | 12 of 14 cadence rules filter `department_key`, 3 `site_owner`, 1 `brand_key`, 0 `department`, 0 `brand` — full table above. **All values lowercase**, contradicting Appendix B's `Clothing`. |
| **E4** | **Not at all.** No per-site description exists in any form. Closest neighbours: `content_versions` (per-site generated content) and `site_registry.ai_content_strategy` (written by seed, read by nothing). |
| **E5** | brand ← root · department ← **quarantined `attribute_values/department`** (25/81) · class/category/sub_category ← `attribute_values` (`sub_category` **always empty**) · website ← dynamic registry column · site info ← `site_targets.domain` joined by `"\|"`. |
| **E6** | **UNREFERENCED** — 3 `orders` + 1 `payments` + 1 `sessions` index entries, no code, no live collections, camelCase fields, no `__comment__` tags. |
| **E7** | **No runtime reference.** Only `scripts/deploy-prod.sh:6` and `scripts/deploy-staging.sh:5` (+ `.firebaserc`). Staging is `ropi-aoss-staging-v3`. |
| **E8** | **The request body** (`aiContent.ts:25`, `:34-36`), entirely unvalidated — no registry check, no active check, no product-ownership check. |
| **E9** | `POST /name/:mpn` uses **only the short** description, in the prompt (`aiEnrichment.ts:102`); the long one is loaded and unused. 5 live smart rules substring-match **both**; `ricsParser.ts:157-169` promotes the short one to a product name; `aiDescribe.ts:16-17` excludes them — but under the **wrong spelling**. |
