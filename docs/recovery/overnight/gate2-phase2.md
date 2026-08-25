# TASK A — Gate 2 maps: Phase 2 (One field, one registry)

Template per §3 TASK A. Repo @ `2698e48`; live reads against `ropi-aoss-dev`.
The three deep maps (`deep-map-department.md`, `deep-map-site.md`, `deep-map-brand.md`) carry the exhaustive consumer tables for `department`/`department_key`, the site family, and `brand`/`brand_key`. This file does not repeat them; it cites them and adds what is specific to each tally.

---

## Phase 2 baseline: the live registry

Facts every Phase 2 tally depends on, read from `ropi-aoss-dev`:

- **`attribute_registry` — 96 docs.** 94 `active: true`; 2 inactive (`department`, `maximum_quantity`).
- **`field_key` is absent on 85 of 96 docs.** It is set on exactly 11: `department_key`, `expedited_shipping_override`, `standard_shipping_override`, `launch`, `dimension_height`, `dimension_length`, `dimension_width`, `maximum_quantity`, `scom`, `scom_sale`, `weight`. **Where set, it never differs from the doc id** (`field_key !== doc.id` matches 0 docs).
- **`required_for_completion: true` on 14 docs.**
- **`is_editable`**: `false` on 5 · `true` on 15 · **`undefined` on 76**.
- **`depends_on`** set on 5 docs, all identical: `{field: "is_fast_fashion", value: "true"}` — `heel_height`, `heel_type`, `platform_height`, `shoe_height_map`, `toe_shape`.
- **`destination_tab`**: `core_information` 21 · `descriptions_seo` 11 · `launch_media` 12 · `product_attributes` 50 · `system` 2.
- **`field_type`**: `dropdown` 31 · `text` 31 · `number` 19 · `toggle` 9 · `date` 4 · `multi_select` 2.
- **60 of 96 registry attributes have zero `attribute_values` docs on any of the 81 products.**
- **21 `attribute_values` doc ids exist on products but are NOT in the registry**: `mpn`(81), `status`(81), `rics_offer`(81), `rics_retail`(81), `inventory_store`(81), `inventory_warehouse`(81), `height`(76), `length`(76), `total_inventory`(75), `distribution_center_inventory`(64), `department_raw`(62), `description`(62), `gender_raw`(62), `tax_class`(62), `style_id`(60), `rics_industry_mpn`(43), `age_group_detail`(15), `promo_status`(13), `is_map_protected`(12), `is_new_collection`(6), `inventory_whs`(6).

---

## P2-0 — Field-model spec (no code)
Edit surface (from Build Plan): none
Fields/collections/endpoints/states this tally writes or renames: none
Blast radius: **N/A — no code change.**
Build Plan "?" markers on this tally: none.
Edit-surface check: N/A.
Input this audit supplies to the spec: the four-location storage model documented in `deep-map-department.md` (root display, root key, attribute display, attribute key) and the doc-id-vs-`field_key` answer under P2-1b below.

---

## P2-1a — Remove duplicate attribute
Edit surface (from Build Plan): `scripts/seed/` — delete empty `material` (keeper is `material_fabric`, 51 products)
Fields/collections/endpoints/states this tally writes or renames: `attribute_registry/material` (delete or deactivate).
Blast radius:
  Backend readers/writers: **[aiDescribe.ts:197](backend/functions/src/services/aiDescribe.ts#L197)** — `material: attrs["material"] || ""` feeds the AI Describe prompt context. This is the **only** consumer of the `material` key by name anywhere in `backend/functions/src`. It reads the empty one; `material_fabric` is never read by the AI prompt builder.
  Also generic: `loadExportableAttrs()` ([exportRegistry.ts:25-37](backend/functions/src/lib/exportRegistry.ts#L25-L37)) includes both as dynamic CSV columns, and `getRequiredFieldKeys` ignores both (neither is required).
  Frontend readers/renderers: none by name — both render generically through `AttributeField` from the registry.
  Scripts (seed/migration): `scripts/seed/seed-attribute-registry.js` (script of record), `scripts/seed/remove-dead-fields.js`, `scripts/seed/second-purge.js`, `scripts/seed/great-purge.js` (existing deletion precedents).
  Composite indexes: NONE
  Security rules: NONE
  Downstream consumers: AI Describe prompt (`material`) · both CSV exports as dynamic columns · smart rules (`Material: Canvas` and `Material: Suede` both target **`material_fabric`**, live doc ids `1cb79077-…` and `a5cdd8f3-…`).
  Live Firestore: **`material` — 0 `attribute_values` docs across all 81 products (CONFIRMED empty). `material_fabric` — 51 docs / 51 non-empty (CONFIRMED, matches the Build Plan exactly).**
  Registry shapes: `material` = `field_type: "text"`, `dropdown_options: []`, `display_label: "Material / Fabric"`, `display_group: "Physical & Variant"`, `required_for_completion: false`. `material_fabric` = `field_type: "multi_select"`, **79 `dropdown_options`**, `display_label: "Material / Fabric"` (identical), `display_group: "Other"`, `required_for_completion: undefined`.
Build Plan "?" markers on this tally: **"which other attributes carry values on dev" → CONFIRMED, full list.**
  36 registry attributes have at least one `attribute_values` doc (`docs / non-empty`):
  `brand` 81/81 · `image_status` 81/81 · `is_in_stock` 81/81 · `product_name` 81/81 · `scom` 81/81 · `scom_sale` 81/81 · `site_owner` 81/81 · `sku` 81/81 · `category` 76/76 · `class` 76/76 · `department_key` 76/76 · `descriptive_color` 76/76 · `expedited_shipping_override` **76/3** · `gender` 76/76 · `standard_shipping_override` **76/4** · `weight` 76/76 · `width` 76/76 · `media_status` 75/75 · `age_group` 71/71 · `website` 67/67 · `primary_color` 62/62 · `material_fabric` 51/51 · `keywords` 50/50 · `launch_date` 39/39 · `dimension_height` 27/27 · `dimension_length` 27/27 · `dimension_width` 27/27 · `department` 25/25 (all quarantined) · `heel_type` 24/24 · `is_fast_fashion` 16/16 · `fit` 10/10 · `hide_image_until_date` 7/7 · `league` 5/5 · `is_hype` 4/4 · `sports_team` 4/4 · `silhouette` 2/2.
  **The other 60 registry attributes have zero docs anywhere**, including `material`, and — critically — `sub_category`, `ai_seo_title`, and `ai_seo_meta`, all three of which are `required_for_completion: true`. See **FINDING A-P2-a**.
Edit-surface check: **SCOPE RISK — one consumer sits outside `scripts/seed/`.** `backend/functions/src/services/aiDescribe.ts:197` reads `attrs["material"]` by name. Deleting the registry doc does not break that line (it would keep returning `""`), but the intent — "the AI prompt should see the material" — is already broken today and stays broken unless `:197` is re-pointed to `material_fabric`. That re-point is not in the declared surface.

---

## P2-1b — Registry reseed (after P2-0/2/3)
Edit surface (from Build Plan): `scripts/seed/` — one script of record
Fields/collections/endpoints/states this tally writes or renames: the whole `attribute_registry` collection.
Blast radius:
  Backend readers/writers: [attributeRegistry.ts](backend/functions/src/routes/attributeRegistry.ts) (4 handlers) · [completionCompute.ts:212-215](backend/functions/src/services/completionCompute.ts#L212-L215) (`getRequiredFieldKeys`) · [smartRules.ts:338](backend/functions/src/services/smartRules.ts#L338), `:443` (`registryKeys` = **doc ids**) · [exportRegistry.ts:25-37](backend/functions/src/lib/exportRegistry.ts#L25-L37) (`loadExportableAttrs` — `field_key || d.id`) · [registryAuthority.ts:24-30](backend/functions/src/lib/registryAuthority.ts#L24-L30) (reads `attribute_registry/class`, `/age_group`, `/gender` `dropdown_options` **by doc id**) · [products.ts:1014-1016](backend/functions/src/routes/products.ts#L1014-L1016) (`enum_source` dispatch).
  Cloud Function: **[onAttributeRegistryWrite.ts](backend/functions/src/functions/onAttributeRegistryWrite.ts)** — fires on *every* write to the collection and recomputes completion for products. A full reseed triggers it once per doc. See **CONCERN A-P2-1b-a**.
  Frontend readers/renderers: [AttributeRegistryAdminPage.tsx](frontend/src/pages/AttributeRegistryAdminPage.tsx) · [AttributeField.tsx](frontend/src/components/AttributeField.tsx) · [ProductDetailPage.tsx:690-845](frontend/src/pages/ProductDetailPage.tsx#L690-L845) (groups by `display_group`, tabs by `destination_tab`) · [SmartRuleBuilderPage.tsx:191-207](frontend/src/pages/SmartRuleBuilderPage.tsx#L191-L207) (field menus).
  Scripts (seed/migration): **there is no single script of record today.** At least 14 scripts write `attribute_registry`: `scripts/seed/seed-attribute-registry.js` (the npm-scripted one, `seed:attribute-registry`), `normalize-registry-phase-4-3.js`, `polish-registry-phase-4-3.js`, `realign-attribute-layout.js`, `fix-field-types-2.js`, `fix-field-types-labels.js`, `remove-dead-fields.js`, `second-purge.js`, `great-purge.js`, `product-editor-overhaul.js`, `seed-display-groups.js`, `cleanup-registry-and-rules.js`, `purge-tally167-site-ids-registry.js`, plus `scripts/tally-144-2c0-seed-department-key-registry.js` and the two `tally-168-*` scripts. Consolidating them is the tally.
  Composite indexes: NONE reference `attribute_registry`.
  Security rules: NONE (deny-all).
  Downstream consumers: completion required-set · smart-rule target validation · both CSV export column lists · product editor tabs/groups/types/options · portfolio validation for `class`/`age_group`/`gender`.
  Live Firestore: 96 docs (see Phase 2 baseline).
Build Plan "?" markers on this tally: **"is `field_key` mandatory or is doc_id the key" → ANSWERED: doc_id is the operative key; `field_key` is optional and inconsistently populated.**
  Evidence, both code and data:
  - **Code treats doc id as authoritative in every hot path.** `smartRules.ts:338` — `new Set(registrySnap.docs.map((d) => d.id))`. `completionCompute.ts:92` — `field_key: d.id`. `registryAuthority.ts:24-26` — `.doc("class")`, `.doc("age_group")`, `.doc("gender")`. `attributeRegistry.ts:100` — `SUPERSEDED_FIELD_KEYS.has(d.id)`. `products.ts` resolves `fieldKey` from the **URL path param** and writes `attribute_values/{fieldKey}`.
  - **The single exception** is `exportRegistry.ts:31` — `field_key: d.field_key || d.id`, which prefers `field_key` and falls back to the doc id.
  - **Live data**: `field_key` is `undefined` on **85 of 96** docs. On the 11 where it is set it is always exactly the doc id, so the two have never diverged in practice.
  - Contrast with the sibling registries, which *do* carry a key field: `brand_registry.brand_key` (and `brand_registry/"field grade"` has a doc id that **differs** from its `brand_key`, `field_grade` — see `deep-map-brand.md` DEFECT B3-3), `site_registry.site_key`, `department_registry.key`.
Edit-surface check: **SCOPE RISK — a reseed is a data change with two code-side couplings outside `scripts/seed/`.** (1) The `onAttributeRegistryWrite` Cloud Function fires on every doc write. (2) `registryAuthority.ts:24-26` hardcodes three doc ids (`class`, `age_group`, `gender`) — renaming any of them during the reseed silently empties the portfolio-validation allowlists for those dimensions, with no error.

**[CONCERN A-P2-1b-a]** `onAttributeRegistryWrite` recomputes completion for products on each registry write. A 96-doc reseed run doc-by-doc fans out to 96 × N-product recomputes. Its failure mode is `console.error` only ([onAttributeRegistryWrite.ts:59-62](backend/functions/src/functions/onAttributeRegistryWrite.ts#L59-L62)). Carried to Task M2.

---

## P2-2i — Website indexes + rules
Edit surface (from Build Plan): `firebase/firestore.indexes.json`, `firebase/firestore.rules`
Fields/collections/endpoints/states this tally writes or renames: index entries and rules for the site model.
Blast radius:
  Composite indexes — **"?" marker answered in full below.**
  Security rules: **`firebase/firestore.rules` is 30 lines total.** `users/{uid}` (read: owner or admin `:21`; write: owner `:22`), then `match /{document=**} { allow read, write: if false; }` at `:26-28`. **No rule mentions `products`, `site_registry`, or any other collection.** Every non-`users` collection is deny-all at the rules layer and reachable only through the Express API.
  Backend/frontend/scripts/downstream: unchanged by an index/rules edit; the queries served are enumerated in `deep-map-site.md`.
  Live Firestore: `site_registry` 8 docs (3 active).
Build Plan "?" markers on this tally: **"full list of indexes referencing site_owner" → CONFIRMED: 21 of 108.**
  Verified by parsing `firebase/firestore.indexes.json` and matching exact `fieldPath` values across all 108 entries.
  **1 on `content_versions`:** `site_owner ASC + generated_at DESC` — serves [aiContent.ts:71](backend/functions/src/routes/aiContent.ts#L71).
  **20 on `products`:**
  `site_owner + first_received_at` · `completion_state + site_owner + first_received_at` · `brand_key + site_owner + first_received_at` · `department_key + site_owner + first_received_at` · `brand_key + site_owner + updated_at ASC` · `department_key + site_owner + updated_at ASC` · `site_owner + completion_state + updated_at ASC` · `brand_key + site_owner + completion_percent ASC` · `department_key + site_owner + completion_percent ASC` · `site_owner + completion_state + completion_percent ASC` · `site_owner + updated_at ASC` · `site_owner + updated_at DESC` · `site_owner + completion_percent ASC` · `site_owner + completion_percent DESC` · `brand_key + site_owner + updated_at DESC` · `department_key + site_owner + updated_at DESC` · `site_owner + completion_state + updated_at DESC` · `brand_key + site_owner + completion_percent DESC` · `department_key + site_owner + completion_percent DESC` · `site_owner + completion_state + completion_percent DESC`.
  **Indexes referencing `website`, `site_key`, `site_targets`, or `site_verification`: 0 each.**
Edit-surface check: **clean** — but note the rules half of this tally has no existing content to modify. Adding rules for `products` would be net-new behaviour, not an edit, and would change the security posture from "API-only" to "API + direct client reads". That is a design decision, not an index change. Carried to Task H3.

---

## P2-2 — One website field
Edit surface (from Build Plan): `website` attribute definition + option source; `products.ts` save path (:1155-1226 `site_owner` mirror); Product Detail rendering; `AIContentReviewPage` site tabs
Fields/collections/endpoints/states this tally writes or renames: `attribute_values/website`, `attribute_values/site_owner`, root `products.site_owner`, `products/{id}/site_targets/*`, `products.site_verification` map keys.
Blast radius: **exhaustive table in [`deep-map-site.md`](deep-map-site.md) — 71 consumers.** Highlights specific to this tally:
  Backend readers/writers: [products.ts:93-113](backend/functions/src/routes/products.ts#L93-L113) (`getSiteOwner`), `:209`/`:250-251`/`:367` (filters), `:546`/`:612-613` (export filters), `:798-880` (verification map build), **`:921-922`** (the divergent detail payload), `:1048-1070` (enum validation), `:1218-1225` (root mirror) · [importFullProduct.ts:240-247](backend/functions/src/routes/importFullProduct.ts#L240-L247), `:443-464`, `:466-514`, `:826`, `:855`.
  Frontend readers/renderers: `ProductListPage` `:613-641`/`:818` · `CompletionQueuePage` `:256-285`/`:391` · `QuickEditPanel` `:71`/`:169` · `AttributeField` `:82`/`:148` · **`AIContentReviewPage.tsx:67-77`** (the site tabs named in the surface) · `SiteBadge` · `SiteVerificationTab` · `SiteVerificationReviewPage`.
  Scripts: `tally-124-fix-website-options.js`, `tally-125-b2a-product-site-owner.js`, `tally-125-b2b-site-verification-desuffix.js`, `tally-125-b2c-attribute-website-desuffix.js`, `tally-128-task3-site-owner-backfill.js`, `tally-128-task4-site-owner-attrval-mirror.js`, `tally-128-task5-site-targets-cleanup.js`, `scripts/seed/fix-site-registry.js`, `scripts/seed/seed-site-registry.js`.
  Composite indexes: 21 (see P2-2i).
  Security rules: NONE.
  Downstream consumers: list filter + column · both CSV exports (**differently** — see `deep-map-site.md` DEFECT B2-11) · AI Describe site targeting · AI Content Review tabs · site verification · cadence rules (3 live MLTD rules) · buyer site portfolios · brand `default_site_owner`.
  Live Firestore: root `site_owner` 76/76 · `attribute_values/site_owner` 81/81 (**5 hold the literal `"TRUE"`**) · `attribute_values/website` 67/67 (**5 hold `"true"`, 1 holds an inactive site's domain**) · `site_targets` on 62 products / 99 docs · `site_verification` map on **1** product.
Build Plan "?" markers on this tally:
  **"does site verification key on `site_key` and must it stay" → CONFIRMED YES, and YES it must stay.**
  `products/{id}.site_verification` is a **root map field** keyed by `site_registry` doc id. Written at [siteVerificationReview.ts:223](backend/functions/src/routes/siteVerificationReview.ts#L223), `:288`, `:395`; read at [products.ts:816-818](backend/functions/src/routes/products.ts#L816-L818) and [reviewActiveOverrides.ts:126-129](backend/functions/src/routes/reviewActiveOverrides.ts#L126-L129). These persisted map keys carry reviewer uid and timestamps. Renaming `site_key` orphans every stored entry, and the only thing that notices is a `console.warn` at `siteVerificationReview.ts:107-109`. No migration path exists in the repo (the sole precedent, `scripts/tally-125-b2b-site-verification-desuffix.js`, was a one-off desuffix).
  **"every site_owner consumer" → CONFIRMED, 71 consumers enumerated in `deep-map-site.md`.**
Edit-surface check: **SCOPE RISK — large. At least 12 consumers fall outside the four declared surfaces.** The surface names the `website` attribute definition, `products.ts:1155-1226`, Product Detail rendering, and `AIContentReviewPage` site tabs. Outside it: `importFullProduct.ts:240-247`/`:443-464`/`:466-514`/`:855` (all site writes) · `exportSerializer.ts:191-195` (the RetailOps `site_targets` column) · `siteVerificationReview.ts` (3 write paths + coverage-gap derivation) · `reviewActiveOverrides.ts:126-129` · `cadenceEngine.ts:102`/`:119` · `portfolioFilter.ts:53` · `aiDescribe.ts:264` · `products.ts:93-113` (`getSiteOwner`, *above* the declared line range) · `products.ts:921-922` (the detail payload, also above :1155) · `ProductListPage.tsx` and `CompletionQueuePage.tsx` filters · `brandRegistry.ts` FK validation. Note in particular that **`products.ts:921-922` — the line that makes the detail page disagree with every filter — is 234 lines above the declared `:1155-1226` window.**

---

## P2-3i — Taxonomy indexes + rules
Edit surface (from Build Plan): `firebase/firestore.indexes.json`, `firebase/firestore.rules`
Blast radius:
  Composite indexes — **"?" marker answered below.**
  Security rules: NONE exist (see P2-2i).
  Live Firestore: `department_registry` 5 docs, all active.
Build Plan "?" markers on this tally: **"full list of indexes referencing department / department_key" → CONFIRMED: 22 of 108, all on `products`.**
  **`department` (display) — 2:** `department + first_received_at` ([firestore.indexes.json:364-370](firebase/firestore.indexes.json#L364)) · `completion_state + department + first_received_at` ([:373-380](firebase/firestore.indexes.json#L373)). **Both are UNREFERENCED** — no query anywhere filters or orders on root `department`; every `where()` uses `department_key` (`products.ts:208`, `:243`, `:366`, `:545`, `:608`).
  **`department_key` — 20:** `department_key + first_received_at` (:402) · `completion_state + department_key + first_received_at` (:411) · `brand_key + department_key + first_received_at` (:459) · `department_key + site_owner + first_received_at` (:479) · `brand_key + department_key + updated_at ASC` (:490) · `department_key + site_owner + updated_at ASC` (:510) · `department_key + completion_state + updated_at ASC` (:530) · `brand_key + department_key + completion_percent ASC` (:551) · `department_key + site_owner + completion_percent ASC` (:571) · `department_key + completion_state + completion_percent ASC` (:591) · `department_key + updated_at ASC` (:630) · `department_key + updated_at DESC` (:639) · `department_key + completion_percent ASC` (:703) · `department_key + completion_percent DESC` (:712) · `brand_key + department_key + updated_at DESC` (:836) · `department_key + site_owner + updated_at DESC` (:856) · `department_key + completion_state + updated_at DESC` (:876) · `brand_key + department_key + completion_percent DESC` (:897) · `department_key + site_owner + completion_percent DESC` (:917) · `department_key + completion_state + completion_percent DESC` (:937).
  For completeness, the sibling display-value indexes on `brand` are also unreferenced (2 more) — **4 dead indexes total** across the two families.
Edit-surface check: **clean.** Same rules caveat as P2-2i.

---

## P2-3a — Taxonomy model + backend
Edit surface (from Build Plan): new taxonomy registry collection + seed; `products.ts` save path (remove department mirror/quarantine); import alias-walk; `SmartRuleBuilderPage` legacy-field block (:201-202, :492-494)
Fields/collections/endpoints/states this tally writes or renames: root `department`, root `department_key`, `attribute_values/department`, `attribute_values/department_key`, `department_registry`, plus a new taxonomy collection.
Blast radius: **exhaustive table in [`deep-map-department.md`](deep-map-department.md) — 96 consumers, 42 scripts, 22 indexes, 0 rules.**
Build Plan "?" markers on this tally:
  **"smart rules and cadence rules targeting department / department_key" → CONFIRMED, complete live inventory.**
  *Cadence rules* — **12 of 14** live docs carry a `department_key` target filter. Full table with doc ids, enabled state, operator and case-sensitivity in `deep-map-department.md`. Every filter value is **lowercase** (`clothing`, `footwear`, `accessories`). **No live rule uses `department_key equals Clothing` with a capital C** — Appendix B's stated example is not confirmed as written; see Task C.
  *Smart rules* — of 35 live docs: **13 write `target_field: "department_key"`** (`00fed715`, `0d13b325`, `17454719`, `181bb571`, `1aa7d070`, `27553bf2`, `71ac578f`, `9faca916`, `a0873bdc`, `c697d7bc`, `c8356222`, `e3da1f19`, `eb442c1f` — all `Taxonomy: *` rules), and **4 read `department_key` as a condition field** (`dim_clothing_weight`, `dim_footwear_kids_dimensions`, `dim_footwear_unisex_dimensions`, `dim_footwear_womens_dimensions`).
  **One live rule still stores the blocked legacy field**: `smart_rules/rule_acceptance_test_delete_me_mo2i4fkj` ("ACCEPTANCE TEST — delete me", `enabled: false`) has `conditions: [{field: "department", operator: "equals", value: "Footwear", case_sensitive: true}]`. The validator at [ruleFieldValidation.ts:20](backend/functions/src/lib/ruleFieldValidation.ts#L20) would now reject that on save; the stored doc predates it.
  **"every consumer" → CONFIRMED, 96 in `deep-map-department.md`.**
Edit-surface check: **SCOPE RISK — severe. The declared surface covers 4 areas; the field has 96 consumers.** Consumers outside it that would break silently, grouped:
  - **The two quarantine-reading consumers the tally is meant to fix but does not name:** [exportSerializer.ts:232](backend/functions/src/services/exportSerializer.ts#L232) and [aiDescribe.ts:179](backend/functions/src/services/aiDescribe.ts#L179)/`:192` still read the legacy `attribute_values/department`. Both are outside the surface. (`P2-5` names `aiDescribe.ts:177-185` but **not** `:192`, and does not name `exportSerializer.ts` at all.)
  - **The cadence engine**: `cadenceEngine.ts:206-247` reads root `department_key` for all 12 rules; `:90`/`:101`/`:107` for exclusions.
  - **The search-token path**: `products.ts:1345-1352` (`SEARCH_TOKEN_FIELDS`) and `importFullProduct.ts:664`.
  - **The reports**: `executive.ts:95-97`/`:136`/`:154`/`:172`, `executiveProjections.ts:73`/`:112-141`/`:231`/`:326-340`, `buyerPerformanceMatrix.ts:97-120`/`:239`/`:259-262`/`:306-318`, `aiWeeklyAdvisory.ts:329`/`:349`, `completionCompute.ts:371`.
  - **The list endpoint's legacy fallback**: `products.ts:290-296` still reads `attribute_values/department` when root `department` is empty.
  - **The frontend Completion Queue free-text filter**: `CompletionQueuePage.tsx:297-303`.

---

## P2-3b — Taxonomy picker (frontend)
Edit surface (from Build Plan): `AttributeField.tsx` (new `tree` type), new picker component
Fields/collections/endpoints/states this tally writes or renames: none — a render-type addition.
Blast radius:
  Backend readers/writers: [attributeRegistry.ts:30-39](backend/functions/src/routes/attributeRegistry.ts#L30-L39) — `ALLOWED_FIELD_TYPES`. A new `tree` type must be added there or POST/PUT on the registry will reject it.
  Frontend readers/renderers: [AttributeField.tsx:30](frontend/src/components/AttributeField.tsx#L30) (the `fieldType` union), `:168-176` (the `effectiveType` derivation). **Four call sites** pass `fieldType` with a hard cast: [ProductDetailPage.tsx:717](frontend/src/pages/ProductDetailPage.tsx#L717) (literal `"toggle"`), `:745`, `:775`, `:803-811`. Each cast lists the union members explicitly and must be widened. `QuickEditPanel.tsx` has its own separate `kind` union (`:65`) and does not use `AttributeField`.
  Scripts: any registry seed that writes `field_type`.
  Composite indexes / Security rules: NONE.
  Downstream consumers: `loadExportableAttrs` carries `field_type` into `serializeAttrValue` ([exportRegistry.ts:39-43](backend/functions/src/lib/exportRegistry.ts#L39-L43)), which ignores it except for arrays — so a `tree` value that is an array will comma-join in both CSVs.
  Live Firestore: 6 distinct `field_type` values today (`dropdown` 31, `text` 31, `number` 19, `toggle` 9, `date` 4, `multi_select` 2).
Build Plan "?" markers on this tally: **"no existing field type regresses" → CONFIRMED, with one caveat.**
  The `effectiveType` derivation at [AttributeField.tsx:170-176](frontend/src/components/AttributeField.tsx#L170-L176) is: if options resolved → `multi_select` when `fieldType === "multi_select"`, else `"select"`; else `"select"` when `fieldType === "dropdown"`; else `fieldType || "text"`. **Registry-resolved options override the declared type.** Live proof: `attribute_registry/brand` is `field_type: "text"` with `dropdown_source: "brand_registry"` and renders as a `<select>`. So adding a `tree` branch is safe for the other five types *provided* the new branch is placed after the `hasOptions` check — placing it before would change how `brand` renders today.
Edit-surface check: **SCOPE RISK — 2 items outside the declared surface**: `backend/functions/src/routes/attributeRegistry.ts:30-39` (`ALLOWED_FIELD_TYPES`, or the registry API rejects the new type), and the four `fieldType as …` casts in `ProductDetailPage.tsx`.

---

## P2-4 — Classification layers
Edit surface (from Build Plan): lookup at import; smart rules as DATA (no code); optional `aiEnrichment` pass
Fields/collections/endpoints/states this tally writes or renames: taxonomy attribute values via smart rules.
Blast radius:
  Backend readers/writers: [smartRules.ts:232-303](backend/functions/src/services/smartRules.ts#L232-L303) (`writeRuleAction`), `:338`/`:443` (`registryKeys`), `:371-413` (action loop) · fired from [importFullProduct.ts:898](backend/functions/src/routes/importFullProduct.ts#L898) (Step D).
  Frontend readers/renderers: [SmartRuleBuilderPage.tsx](frontend/src/pages/SmartRuleBuilderPage.tsx) · [SmartRulesAdminPage.tsx](frontend/src/pages/SmartRulesAdminPage.tsx).
  Scripts: `scripts/seed/seed-taxonomy-rules.js` (seeds the 13 `Taxonomy: *` rules), `scripts/seed-dimension-rules.js` (the 7 `dim_*` rules), `scripts/tally-144-2b-taxonomy-smart-rule-migration.js`.
  Composite indexes / Security rules: NONE.
  Downstream consumers: everything that reads the taxonomy attributes.
  Live Firestore: `smart_rules` 35 docs.
Build Plan "?" markers on this tally: **"can rules write taxonomy fields (must stay registry attributes)" → CONFIRMED YES, with two hard constraints.**
  1. **Rules write ONLY `products/{mpn}/attribute_values/{target_field}`** ([smartRules.ts:252](backend/functions/src/services/smartRules.ts#L252), `:272-281`) — never a root product field. The single root write in the whole engine is the hardcoded `name: ""` blanking at `:364-367` for `rule_uuid_name_cleanup`. This is also the answer to **E1**.
  2. **The target must exist as an `attribute_registry` doc id** (`:244-249`), else the write is skipped with `console.error` and no user-visible signal. So "must stay registry attributes" is not a preference — it is enforced, silently.
  Consequence for taxonomy specifically: the 13 live `Taxonomy: *` rules write `attribute_values/department_key` and **nothing mirrors that to root `department_key`**. Root is written only by the import at `importFullProduct.ts:636` (before rules fire at `:898`) and by the interactive editor at `products.ts:1183-1197`. A product whose department is determined by a rule rather than the CSV column gets an attribute value with no root mirror, and is then invisible to the list filter, the cadence engine, every index, and search. See `deep-map-department.md` DEFECT B1-6.
  Additional trap found: `brand_key` is offered as a rule action target by the builder ([SmartRuleBuilderPage.tsx:186-189](frontend/src/pages/SmartRuleBuilderPage.tsx#L186-L189), `:200-207`, `:309-323`) but **`attribute_registry/brand_key` does not exist**, so any such rule is silently skipped forever. See `deep-map-brand.md` DEFECT B3-1.
Edit-surface check: **clean as declared, but the surface is insufficient for the goal.** "Smart rules as DATA (no code)" is only true if the root-mirror gap above is accepted or fixed elsewhere. Fixing it requires code in `smartRules.ts`, which the surface explicitly excludes.

---

## P2-5 — Re-point consumers
Edit surface (from Build Plan): `templateMatcher.ts`, `aiDescribe.ts:177-185`, `executive.ts`, `executiveProjections.ts`, `buyerPerformanceMatrix.ts`, `aiWeeklyAdvisory.ts`, `completionCompute.ts:371`
Fields/collections/endpoints/states this tally writes or renames: read paths only.
Blast radius:
  Backend readers/writers — mapping each declared file to what it actually reads:
  | Declared file | Reads today | file:line |
  |---|---|---|
  | `templateMatcher.ts` | `match_department` vs **root display** `product.department`; `match_brand` vs root display `product.brand` — **exact, case-sensitive equality** | [:105](backend/functions/src/services/templateMatcher.ts#L105), [:109](backend/functions/src/services/templateMatcher.ts#L109), [:131](backend/functions/src/services/templateMatcher.ts#L131), [:133](backend/functions/src/services/templateMatcher.ts#L133) |
  | `aiDescribe.ts:177-185` | `attrs["department"]` (**legacy quarantined**) for template selection | [:179](backend/functions/src/services/aiDescribe.ts#L179) |
  | *(not declared)* `aiDescribe.ts:192` | `attrs["department"]` again, for prompt context | [:192](backend/functions/src/services/aiDescribe.ts#L192) |
  | *(not declared)* `aiDescribe.ts:90-95, 197` | root `brand`; `attrs["material"]` (empty) | [:90-95](backend/functions/src/services/aiDescribe.ts#L90-L95), [:197](backend/functions/src/services/aiDescribe.ts#L197) |
  | `executive.ts` | `operator_throughput.department`; root `department` in 3 `.select()` projections | [:95-97](backend/functions/src/routes/executive.ts#L95-L97), [:136](backend/functions/src/routes/executive.ts#L136), [:154](backend/functions/src/routes/executive.ts#L154), [:172](backend/functions/src/routes/executive.ts#L172) |
  | `executiveProjections.ts` | root `department` → writes `metric_snapshots.dimension` (display); reads it back on the heatmap join | [:73](backend/functions/src/services/executiveProjections.ts#L73), [:112-141](backend/functions/src/services/executiveProjections.ts#L112-L141), [:231](backend/functions/src/services/executiveProjections.ts#L231), [:326-340](backend/functions/src/services/executiveProjections.ts#L326-L340), [:421-423](backend/functions/src/services/executiveProjections.ts#L421-L423) |
  | `buyerPerformanceMatrix.ts` | root `department` as a key into a hardcoded display-keyed `gmTargets` map and into `catalogStrByDept`, both with silent `??` fallbacks | [:97-103](backend/functions/src/services/buyerPerformanceMatrix.ts#L97-L103), [:105-120](backend/functions/src/services/buyerPerformanceMatrix.ts#L105-L120), [:239](backend/functions/src/services/buyerPerformanceMatrix.ts#L239), [:259-262](backend/functions/src/services/buyerPerformanceMatrix.ts#L259-L262), [:306-318](backend/functions/src/services/buyerPerformanceMatrix.ts#L306-L318) |
  | `aiWeeklyAdvisory.ts` | root `department`, root `brand` | [:329](backend/functions/src/services/aiWeeklyAdvisory.ts#L329), [:349](backend/functions/src/services/aiWeeklyAdvisory.ts#L349) |
  | `completionCompute.ts:371` | `opts.context.productData.department` — **which no caller ever supplies** | [:371](backend/functions/src/services/completionCompute.ts#L371) |
  Live Firestore backing these reads: `metric_snapshots` with `dimension_type == "department"` — **84 docs**, `dimension` histogram `{Footwear: 22, Unknown: 22, Clothing: 16, Accessories: 16, FOOTWEAR: 8}`. `operator_throughput` — **441 docs**, `department` histogram `{Unknown: 432, Clothing: 5, Footwear: 3, FOOTWEAR: 1}`.
Build Plan "?" markers on this tally: **"none beyond B1/B2/B3" → CONFIRMED.** No unverified marker remains; the three deep maps cover every consumer named here.
Edit-surface check: **SCOPE RISK — 3 material omissions from the declared surface.**
  1. **`exportSerializer.ts:232`** reads the quarantined `attribute_values/department` and is **not in the surface**. It is the RetailOps CSV — the highest-consequence department reader in the system. Live: blank for 56 of 81 products, wrong for 1.
  2. **`aiDescribe.ts:192`** is outside the declared `:177-185` window but reads the same quarantined doc.
  3. **`completionCompute.ts:371` cannot be fixed inside `completionCompute.ts`.** The value comes from an `opts` argument that all **seven** call sites omit — `aiContent.ts:207`, `importWeeklyOperations.ts:489`, `importFullProduct.ts:947`, `siteVerificationReview.ts:246`/`:328`/`:418`, `products.ts:1403`, `onAttributeRegistryWrite.ts:58`. Re-pointing the read does nothing; the fix is at the call sites, none of which are in the surface.

---

## P2-6 — Export columns
Edit surface (from Build Plan): `exportSerializer.ts:101-126` column list only
Fields/collections/endpoints/states this tally writes or renames: the RetailOps CSV column list.
Blast radius:
  Backend readers/writers: [exportSerializer.ts:73-98](backend/functions/src/services/exportSerializer.ts#L73-L98) (row build), **`:101-126`** (the declared 24-name `fields` array), `:127-131` (dedupe + dynamic append), `:133-141` (dynamic value resolution), `:160-262` (`buildExportRow`). The dynamic half comes from [`loadExportableAttrs`](backend/functions/src/lib/exportRegistry.ts#L25-L37) — filter `active === true && export_enabled !== false`, sorted by `display_order` asc.
  A **parallel and independent** column list exists at [products.ts:421-453](backend/functions/src/routes/products.ts#L421) (15 hardcoded names) with its own dynamic append at `:585-598` and its own suppression set (`SUPPRESSED_DYNAMIC_KEYS = {"department_key"}`, `:593`).
  Frontend readers/renderers: [ExportCenterPage.tsx](frontend/src/pages/ExportCenterPage.tsx) triggers and lists jobs; it does not know the columns.
  Scripts: NONE.
  Composite indexes: `buyer_actions` (`mpn + action_type + created_at DESC`) backs `exportSerializer.ts:205-211`; the `catch` at `:215-218` silently falls back if it is missing.
  Security rules: NONE.
  Downstream consumers: RetailOps ingestion (external).
  Live Firestore: **`loadExportableAttrs()` returns 92 of 96 attributes** (2 inactive + 2 with `export_enabled: false`). `export_enabled` is defined on 76 of 96 docs and `false` on 2. `display_order` is numeric on all 96 but **heavily collided** — 14 attributes share `display_order: 1`, so the dynamic column order is effectively arbitrary within each tier (`Array.prototype.sort` stability makes it Firestore doc order).
Build Plan "?" markers on this tally: **"does RetailOps ingestion tolerate extra columns (external — mark N/A)" → N/A** (external system, outside this repo). What *is* verifiable and worth recording: the CSV already emits **24 hardcoded + up to 92 dynamic columns**, deduped, so extra columns are already the norm rather than an exception.
Edit-surface check: **SCOPE RISK — the declared surface is the hardcoded list only, but 92 of the ~116 columns are registry-driven and not editable there.** Changing which columns are emitted mostly means editing `attribute_registry` (`export_enabled`, `display_order`), not `exportSerializer.ts:101-126`. Also outside the surface: the parallel 15-column list at `products.ts:421-453`.
Additional finding relevant to this tally — **E5 answered in full** (what the export emits, field by field, from `exportSerializer.ts`):
  | Column | Source | file:line | Live coverage |
  |---|---|---|---|
  | `brand` | **root** `p.brand` | [:229](backend/functions/src/services/exportSerializer.ts#L229) | 76/81 non-empty |
  | `department` | **`attribute_values/department`** (legacy, quarantined, unfiltered) | [:232](backend/functions/src/services/exportSerializer.ts#L232) | **25/81** — blank for 56 products |
  | `class` | `attribute_values/class` | [:233](backend/functions/src/services/exportSerializer.ts#L233) | 76/81 |
  | `category` | `attribute_values/category` | [:234](backend/functions/src/services/exportSerializer.ts#L234) | 76/81 |
  | `sub_category` | `attribute_values/sub_category` | [:235](backend/functions/src/services/exportSerializer.ts#L235) | **0/81 — always empty** |
  | `website` | **not a column** | — | — |
  | (site info) | `site_targets` subcollection, each doc's **`domain`** field, joined by `admin_settings/export_site_separator` (default `","`) | [:191-195](backend/functions/src/services/exportSerializer.ts#L191-L195), [:96](backend/functions/src/services/exportSerializer.ts#L96) | 62/81 products have the subcollection |
  `attrs` is built at `:163-167` from the raw `attribute_values` subcollection with **no `quarantined` filter** (contrast `products.ts:764`, which does filter). `website` does appear as one of the 92 **dynamic** columns (it is `active` and not `export_enabled: false`), sourced from `attribute_values/website` — 67/81 non-empty, of which 5 hold the literal string `"true"`.

---

## P2-7 — Import miss handling + conditional required
Edit surface (from Build Plan): `importFullProduct.ts` miss branch; `completionCompute.ts` `depends_on`
Fields/collections/endpoints/states this tally writes or renames: import orphan handling; the `depends_on` predicate.
Blast radius:
  Backend readers/writers — miss branches: [importFullProduct.ts:339-341](backend/functions/src/routes/importFullProduct.ts#L339-L341) (orphan brand), `:627-629` (orphan department), `:472-475` (orphan site_owner), `:1104-1108` (batch summary). Each is `console.warn` + a Set, surfaced only in `import_batches.summary.orphans`.
  `depends_on`: type at [completionCompute.ts:30](backend/functions/src/services/completionCompute.ts#L30); loaded at `:94`; **evaluated at `:129-135`**; required-set query at `:212-215`.
  Frontend readers/renderers: [ImportProgressCard.tsx](frontend/src/components/ImportProgressCard.tsx) and [ImportHubPage.tsx](frontend/src/pages/ImportHubPage.tsx) render batch status. `ProductDetailPage.tsx:690-756` implements the **only** `depends_on` UI — a hardcoded `is_fast_fashion` drawer, not a generic predicate renderer.
  Scripts: NONE.
  Composite indexes / Security rules: NONE.
  Downstream consumers: completion percent and state for every product; the import orphan report.
  Live Firestore: **5 attributes carry `depends_on`, all `{field: "is_fast_fashion", value: "true"}`**: `heel_height`, `heel_type`, `platform_height`, `shoe_height_map`, `toe_shape`. **None of them is `required_for_completion: true`**, so `depends_on` currently has **zero effect on any completion computation.** `attribute_values/is_fast_fashion` exists on 16 of 81 products.
Build Plan "?" markers on this tally: **"does depends_on support INCLUDES on multi-select (E2)" → CONFIRMED NO — equality only, and only strict string equality.**
  Type: `{ field: string; value: string } | null` ([completionCompute.ts:30](backend/functions/src/services/completionCompute.ts#L30)) — there is **no operator field**.
  Evaluation, verbatim ([:129-135](backend/functions/src/services/completionCompute.ts#L129-L135)):
  ```ts
  if (rf.depends_on) {
    const depAttr = attrMap.get(rf.depends_on.field);
    const depValue = depAttr ? String(depAttr.value ?? "") : "";
    if (depValue !== rf.depends_on.value) {
      continue; // predicate not met — field not required in this context
    }
  }
  ```
  The only comparison in the entire predicate path is `!==`. Could it express "website INCLUDES Karmaloop" on a multi-select? **No, on two counts.** (a) `String(depAttr.value)` on an array yields JS comma-join (`["shiekh.com","karmaloop.com"]` → `"shiekh.com,karmaloop.com"`), which matches only if `value` is that exact joined string in that exact order — not an INCLUDES. (b) Live `attribute_values/website` values are **scalar strings**, not arrays (67 docs: `"shiekh.com"` ×33, `"karmaloop.com"` ×28, `"true"` ×5, `"fbrkclothing.com"` ×1), so even that accident does not apply. Expressing INCLUDES requires a new operator field and a new evaluation branch.
Edit-surface check: **clean for `depends_on`** — the predicate lives entirely in `completionCompute.ts`. **SCOPE RISK for the UI half**: the only renderer that honours `depends_on` is the hardcoded `is_fast_fashion` drawer at `ProductDetailPage.tsx:690-756`; a generic predicate would need that file, which is not in the surface. **SCOPE RISK for the miss branch**: the orphan sets are built in `importFullProduct.ts` but the only surface that displays them is `import_batches.summary.orphans`, rendered nowhere in the frontend (`grep -rn "orphans" frontend/src` → no matches).

---

## FINDING A-P2-a — No product can reach 100% completion. Three of the 14 required fields are structurally unfillable.

This is the largest single finding in Phase 2 and it sits underneath the whole "Products flow again" goal.

**Live: 0 of 81 products have `completion_state == "complete"`.**

`getRequiredFieldKeys` ([completionCompute.ts:212-215](backend/functions/src/services/completionCompute.ts#L212-L215)) queries `attribute_registry.where("required_for_completion", "==", true)` — **with no `active` filter**. Replaying that query live returns 14 fields. Coverage of each across the 81 products:

| Required field | active | `attribute_values` docs | Fillable in the editor? |
|---|---|---|---|
| `brand` | true | 81 | yes |
| `is_in_stock` | true | 81 | yes |
| `product_name` | true | 81 | yes |
| `sku` | true | 81 | yes |
| `category` | true | 76 | yes |
| `class` | true | 76 | yes |
| `department_key` | true | 76 | yes |
| `gender` | true | 76 | yes |
| `age_group` | true | 71 | yes |
| `website` | true | 67 | yes |
| **`department`** | **false** | **25** | **NO** |
| **`sub_category`** | true | **0** | yes, but nothing populates it |
| **`ai_seo_title`** | true | **0** | AI Describe only |
| **`ai_seo_meta`** | true | **0** | AI Describe only |

- **`sub_category`** is required and active with 224 `dropdown_options`, yet **zero** products carry it. `importFullProduct.ts:850` writes it from `mapped.attributes.sub_category`, which is empty for every live product, and no smart rule targets it.
- **`ai_seo_title` / `ai_seo_meta`** are required and are AI-Describe-owned ([completionCompute.ts:125](backend/functions/src/services/completionCompute.ts#L125)); they are written only by the AI Describe approve flow in `aiContent.ts`. Zero products have been through it.
- **`department` is the hard blocker.** It is `required_for_completion: true` and `active: false`. The registry API hides inactive docs (`attributeRegistry.ts:98`) **and** separately suppresses this doc id (`:93`, `:100`), so it never renders in the product editor — yet the completion query still counts it. For the 56 products without the legacy doc there is **no UI path to satisfy it**.

**Verified by replaying the exact algorithm** (`computeCompletionProgressPure`, `completionCompute.ts:104-180`) against live data. Computed values match the stored `completion_percent` exactly:

| Product | computed | stored `completion_percent` | missing |
|---|---|---|---|
| `1005177` | 11/14 = 79 | **79** | `ai_seo_meta`, `ai_seo_title`, `sub_category` |
| `1005394` | 10/14 = 71 | **71** | `ai_seo_meta`, `ai_seo_title`, `department`, `sub_category` |
| `101405-CHRM` | 11/14 = 79 | **79** | `ai_seo_meta`, `ai_seo_title`, `sub_category` |

Ceiling with `department` present: 11/14 = **79%**. Without it: 10/14 = **71%**. Neither reaches `complete`.

Two secondary defects surfaced by the same replay:
- **`completionCompute.ts:249`** returns `total_required: requiredFields.length` — the **raw** count — while `pct` at `:251` uses the `depends_on`-gated `effectiveTotal`. The back-compat `completion_progress` payload is internally inconsistent whenever any `depends_on` predicate is unmet.
- **The required set silently includes deactivated registry docs.** Any attribute deactivated without first clearing `required_for_completion` becomes a permanent, invisible completion blocker. `department` is the live instance; the pattern will recur on every future deactivation.

---

## FINDING A-P2-b — Four duplicate `display_label` pairs on the same `destination_tab`; three have both docs active.

| `destination_tab` | `display_label` | Doc ids | Both active? |
|---|---|---|---|
| `core_information` | "Department" | `department` *(inactive)*, `department_key` | no |
| `core_information` | "Product Is Active" | `is_in_stock`, `product_is_active` | **yes** |
| `product_attributes` | "Material / Fabric" | `material`, `material_fabric` | **yes** |
| `product_attributes` | "Weight (oz)" | `weight`, `weight_oz` | **yes** |

Appendix B / Task G7 names the first two pairs as known. **`weight` vs `weight_oz` is a third, previously unnamed pair** — `weight` (`field_key: "weight"`, number, 76 `attribute_values` docs, the target of 6 live `dim_*` smart rules) and `weight_oz` (no `field_key`, number, **0** docs). Same shape as `material`/`material_fabric`: the populated one is the smart-rule target, the empty one is the older doc. Carried to Task G7.

## FINDING A-P2-c — Two parallel dimension field sets, one colliding with a dropdown.

Registry defines `dimension_height` / `dimension_length` / `dimension_width` (`field_key` set, numeric) — 27 `attribute_values` docs each, written by the `dim_*` smart rules. Products *also* carry `height` (76), `length` (76) and `width` (76). `height` and `length` are **not in the registry at all**; `width` **is**, but as a footwear-width **dropdown** with 4 options — while the live stored values are numerics (`5`, `5`, `4`, `4` on the first four products, matching their `weight`). So `attribute_values/width` holds a dimension number in a field the editor renders as a size dropdown, and `AttributeField`'s orphan-value contract will render it as `"5 (inactive)"`. Carried to Task L6 and Task G11.

---

## Phase 2 summary

| Tally | ? markers | Converted | Out-of-surface consumers |
|---|---|---|---|
| P2-0 | 0 | — | 0 |
| P2-1a | 1 | 1 CONFIRMED | **1** (`aiDescribe.ts:197`) |
| P2-1b | 1 | 1 CONFIRMED (doc_id is the key) | **2** (`onAttributeRegistryWrite`, `registryAuthority.ts:24-26`) |
| P2-2i | 1 | 1 CONFIRMED (21 indexes) | 0 |
| P2-2 | 2 | 2 CONFIRMED | **12+** |
| P2-3i | 1 | 1 CONFIRMED (22 indexes, 2 dead) | 0 |
| P2-3a | 2 | 2 CONFIRMED | **~90** (96 consumers vs a 4-area surface) |
| P2-3b | 1 | 1 CONFIRMED | **2** (`ALLOWED_FIELD_TYPES`, 4 casts) |
| P2-4 | 1 | 1 CONFIRMED | 0 as declared (but surface insufficient for the goal) |
| P2-5 | 1 | 1 CONFIRMED | **3** (`exportSerializer.ts:232`, `aiDescribe.ts:192`, 7 stamp call sites) |
| P2-6 | 1 | 1 **N/A (external)** | **2** (registry-driven columns, `products.ts:421-453`) |
| P2-7 | 1 | 1 CONFIRMED (**equality only**) | **2** (`ProductDetailPage.tsx:690-756`, orphan display) |
| **Total** | **13** | **12 CONFIRMED · 1 N/A** | **~115** |
