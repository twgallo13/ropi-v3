# TASK B3 — Deep map: `brand` and `brand_key`

**Scope:** every reference, no sampling. Repo @ `2698e48`, live reads against `ropi-aoss-dev`.
**Additional requirement (Appendix B):** every place the DISPLAY value (`brand`) is used for grouping, filtering, or matching rather than the key is flagged **⚠ DISPLAY-AS-KEY**.

## Storage model

| Location | Value form | Written by | Notes |
|---|---|---|---|
| `brand_registry/{doc_id}.brand_key` | key (`nike`) | Brand Registry admin | **doc_id and `brand_key` are NOT guaranteed equal** — see DEFECT B3-3 |
| `brand_registry/{doc_id}.display_name` | display (`Nike`) | Brand Registry admin | not unique — see DEFECT B3-2 |
| `products/{id}.brand` (root) | display (`Nike`) | import `:622`, attribute save `:1168` | filter/report/match target for 9 consumers |
| `products/{id}.brand_key` (root) | key (`nike`) | import `:623`, attribute save `:1169` | the list filter + index target |
| `products/{id}/attribute_values/brand` | **display** (`Nike`) | import `:829`, attribute save | **not quarantined**; the editor's alias-walk source |
| `attribute_registry/brand_key` | — | — | **does not exist** — see DEFECT B3-1 |

---

## Consumer table

### Backend — routes

| Consumer | Kind | file:line | Reads/Writes | ⚠ | What breaks |
|---|---|---|---|---|---|
| Product list sort allowlist | route | [products.ts:138](backend/functions/src/routes/products.ts#L138) | reads `brand_key` | | `?sort=brand_key` drops out |
| Product list filter (no-search) | route | [products.ts:207](backend/functions/src/routes/products.ts#L207) | reads `brand_key` | | Brand filter returns everything |
| Product list filter (search path) | route | [products.ts:242](backend/functions/src/routes/products.ts#L242) | reads `brand_key` | | Brand filter matches nothing while searching |
| Product list count | route | [products.ts:365](backend/functions/src/routes/products.ts#L365) | reads `brand_key` | | page total diverges |
| Product list row cell | route | [products.ts:307](backend/functions/src/routes/products.ts#L307) | reads root `brand` | | Brand column blanks |
| Bulk CSV export filters | route | [products.ts:544](backend/functions/src/routes/products.ts#L544), [:607](backend/functions/src/routes/products.ts#L607) | reads `brand_key` | | wrong row set |
| Bulk CSV export column | route | [products.ts:423, 662](backend/functions/src/routes/products.ts#L662) | reads root `brand` | | `brand` column blanks |
| Product detail payload | route | [products.ts:902, 907](backend/functions/src/routes/products.ts#L902) | reads root `brand` + `brand_key` | | detail header and Quick Edit lose Brand |
| Attribute save — registry validation | route | [products.ts:1038-1047](backend/functions/src/routes/products.ts#L1038-L1047) | `loadBrandRegistry` + `matchBrand` | | any string saves as brand |
| Attribute save — root mirror | route | [products.ts:1165-1173](backend/functions/src/routes/products.ts#L1165-L1173) | **writes** root `brand` (display) + `brand_key` (key) | | edits stop reaching filters/indexes |
| Attribute save — search-token trigger | route | [products.ts:1349, 1362](backend/functions/src/routes/products.ts#L1349) | reads root `brand` | | brand search goes stale on edit |
| Import — brand canonicalization | route | [importFullProduct.ts:327, 334-344](backend/functions/src/routes/importFullProduct.ts#L334-L344) | **writes** `identity.brand` (display) + `identity.brand_key` | | see DEFECT B3-4 |
| Import — top-level mirror | route | [importFullProduct.ts:621-623](backend/functions/src/routes/importFullProduct.ts#L621-L623) | **writes** root `brand` + `brand_key` | | root fields stop being populated |
| Import — brand-default site lookup | route | [importFullProduct.ts:481](backend/functions/src/routes/importFullProduct.ts#L481) | reads `identity.brand_key` | | brand→site routing silently falls back to CSV |
| Import — search tokens | route | [importFullProduct.ts:662](backend/functions/src/routes/importFullProduct.ts#L662) | reads `identity.brand` | | brand search breaks |
| Import — canonical skip-list | route | [importFullProduct.ts:692](backend/functions/src/routes/importFullProduct.ts#L692) | reads `"brand"` | | raw CSV brand overwrites the canonical attribute |
| Import — attribute write | route | [importFullProduct.ts:519, 829](backend/functions/src/routes/importFullProduct.ts#L829) | **writes** `attribute_values/brand` = **display** | | Quick Edit pre-population breaks |
| Import — orphan report | route | [importFullProduct.ts:339-341, 1105](backend/functions/src/routes/importFullProduct.ts#L339-L341) | reads | | orphan brands stop being reported |
| Brand Registry CRUD (5 routes) | route | [brandRegistry.ts:52-393](backend/functions/src/routes/brandRegistry.ts#L52) | reads/**writes** `brand_registry` | | admin page dies |
| Brand Registry alias-collision check | route | [brandRegistry.ts:196-215, 300-330](backend/functions/src/routes/brandRegistry.ts#L196-L215) | reads active docs' `aliases` + doc.id | | alias collisions become possible |
| Review Active Overrides — filter | route | [reviewActiveOverrides.ts:101-102, 200-201](backend/functions/src/routes/reviewActiveOverrides.ts#L200-L201) | reads `brand_key` | | brand filter no-ops |
| Review Active Overrides — hydration | route | [reviewActiveOverrides.ts:118, 141-145, 165-167](backend/functions/src/routes/reviewActiveOverrides.ts#L141-L145) | `brandRegistry.get(brandKey)` → `display_name`, `logo_url` | | brand name + logo become null; see DEFECT B3-3 |
| Executive `.select()` projections ×3 | route | executive.ts:[135](backend/functions/src/routes/executive.ts#L135), [153](backend/functions/src/routes/executive.ts#L153), [171](backend/functions/src/routes/executive.ts#L171) | reads root `brand` | | field silently `undefined` in the response |
| Cadence review queue | route | [cadenceReview.ts:48](backend/functions/src/routes/cadenceReview.ts#L48) | reads root `brand` | | Brand column blanks |
| Buyer review queue ×3 | route | buyerReview.ts:[148](backend/functions/src/routes/buyerReview.ts#L148), [194](backend/functions/src/routes/buyerReview.ts#L194), [219](backend/functions/src/routes/buyerReview.ts#L219) | reads root `brand` | | Brand column blanks |
| MAP review queue ×2 | route | mapReview.ts:[55](backend/functions/src/routes/mapReview.ts#L55), [287](backend/functions/src/routes/mapReview.ts#L287) | reads root `brand` | | Brand column blanks |
| MAP import — brand column | route | mapImport.ts:[35, 46](backend/functions/src/routes/mapImport.ts#L46), [227](backend/functions/src/routes/mapImport.ts#L227), [353-354](backend/functions/src/routes/mapImport.ts#L353-L354), [381](backend/functions/src/routes/mapImport.ts#L381), [433-441](backend/functions/src/routes/mapImport.ts#L433-L441), [480](backend/functions/src/routes/mapImport.ts#L480), [526](backend/functions/src/routes/mapImport.ts#L526), [657](backend/functions/src/routes/mapImport.ts#L657) | **writes** `map_brand` from a **raw CSV column, never canonicalized** | **⚠** | MAP brand data is free text; see DEFECT B3-5 |
| Pricing discrepancy queue | route | [pricingDiscrepancy.ts:70](backend/functions/src/routes/pricingDiscrepancy.ts#L70) | reads root `brand` | | Brand column blanks |
| Site verification review ×2 | route | siteVerificationReview.ts:[115](backend/functions/src/routes/siteVerificationReview.ts#L115), [154](backend/functions/src/routes/siteVerificationReview.ts#L154) | reads root `brand` | | Brand column blanks |
| Exports — pending list | route | [exports.ts:33](backend/functions/src/routes/exports.ts#L33) | reads root `brand` | | Brand column blanks |
| Launch records | route | launches.ts:[51](backend/functions/src/routes/launches.ts#L51), [373](backend/functions/src/routes/launches.ts#L373), [391](backend/functions/src/routes/launches.ts#L391), [468](backend/functions/src/routes/launches.ts#L468) | **writes** `launch_records.brand` from **free-text request body** | **⚠** | launch brand is unconstrained; see DEFECT B3-6 |
| AI content chat prompt | route | [aiContent.ts:477](backend/functions/src/routes/aiContent.ts#L477) | reads root `brand` | | prompt says "unknown brand" |
| AI enrichment context | route | aiEnrichment.ts:[23, 47](backend/functions/src/routes/aiEnrichment.ts#L47), [93](backend/functions/src/routes/aiEnrichment.ts#L93), [101](backend/functions/src/routes/aiEnrichment.ts#L101), [143](backend/functions/src/routes/aiEnrichment.ts#L143) | reads root `brand` | | AI name/colour prompts lose brand |
| Admin users — portfolio validation | route | [adminUsers.ts:88, 133](backend/functions/src/routes/adminUsers.ts#L88) | validates `portfolio_brands` against `loadRegistryAuthority().brand` (**doc ids**) | **⚠** | see DEFECT B3-3 |
| Admin users — exclusion dimensions | route | [adminUsers.ts:32](backend/functions/src/routes/adminUsers.ts#L32) | `"brand"` as a dimension name | | dimension disappears from the contract |
| Smart-rule validator | route | [adminSmartRules.ts:72](backend/functions/src/routes/adminSmartRules.ts#L72) + [ruleFieldValidation.ts:19](backend/functions/src/lib/ruleFieldValidation.ts#L19) | rejects `"brand"` → `"brand_key"` | | legacy field creatable again |
| Cadence-rule validator | route | [cadenceRules.ts:27-30](backend/functions/src/routes/cadenceRules.ts#L27-L30) | same | | same |
| Router mount | route | [index.ts:125](backend/functions/src/index.ts#L125) | `/api/v1/brand-registry` | | endpoint 404s |

### Backend — services and libs

| Consumer | Kind | file:line | Reads/Writes | ⚠ | What breaks |
|---|---|---|---|---|---|
| Brand registry lib — normalize/load/match | lib | [brandRegistry.ts:26-92](backend/functions/src/lib/brandRegistry.ts#L26-L92) | Map keyed by **`brand_key`**, active-only, alias walk at compare time | | every brand validation and hydration path |
| Brand registry lib — `listBrandRegistry` | lib | [brandRegistry.ts:190-206](backend/functions/src/lib/brandRegistry.ts#L190-L206) | falls back to `doc.id` when `brand_key` absent | | admin list loses entries |
| Registry authority — active brand set | lib | [registryAuthority.ts:10, 21, 32](backend/functions/src/lib/registryAuthority.ts#L32) | Set of **doc ids** | **⚠** | see DEFECT B3-3 |
| Brand canonicalizer factory | lib | [registryAuthority.ts:113-115](backend/functions/src/lib/registryAuthority.ts#L113-L115) | parameterized on `brand_key` (TALLY-149 fix, `:74-77`) | | import alias-walk stops resolving |
| Brand-default site map | lib | [registryAuthority.ts:179-190](backend/functions/src/lib/registryAuthority.ts#L179-L190) | keyed by `brand_key` | | brand→site routing default dies |
| Cadence engine — brand portfolio | service | [cadenceEngine.ts:100, 117](backend/functions/src/services/cadenceEngine.ts#L100) | reads root `brand_key` | | buyer brand portfolios stop matching |
| Cadence engine — brand exclusion | service | [cadenceEngine.ts:89, 106](backend/functions/src/services/cadenceEngine.ts#L106) | reads `portfolio_exclusions.brand` (keys) | | exclusions fail open |
| Cadence engine — target filters | service | [cadenceEngine.ts:220-238](backend/functions/src/services/cadenceEngine.ts#L220-L238) | reads root `brand_key` via `getProductField` | | the 2 live brand_key rules stop matching |
| Portfolio filter lib | lib | [portfolioFilter.ts:37, 51, 59](backend/functions/src/lib/portfolioFilter.ts#L51) | reads root `brand_key` | | same on the filter path |
| Cadence portfolio type | lib | [types/cadence.ts:20](backend/functions/src/types/cadence.ts#L20) | type | | compile error (loud) |
| **Prompt template matcher** | service | [templateMatcher.ts:52, 97, 109, 123, 133](backend/functions/src/services/templateMatcher.ts#L109) | `template.match_brand !== product.brand` — **exact display-string equality**, no normalization, no registry | **⚠** | brand-scoped templates silently fall to generic; see DEFECT B3-7 |
| Search token builder | service | [searchTokens.ts:21, 44](backend/functions/src/services/searchTokens.ts#L44) | reads root `brand` (display) | | brand text search dies |
| RetailOps export serializer | service | [exportSerializer.ts:17, 76, 104, 229](backend/functions/src/services/exportSerializer.ts#L229) | reads root `brand` (**display**) — column 3 of 24 | **⚠** | `brand` column blanks in the RetailOps CSV |
| Executive projections ×4 | service | executiveProjections.ts:[230](backend/functions/src/services/executiveProjections.ts#L230), [268](backend/functions/src/services/executiveProjections.ts#L268), [362](backend/functions/src/services/executiveProjections.ts#L362), [403](backend/functions/src/services/executiveProjections.ts#L403) | reads root `brand` | | brand labels null in loss-leader / markdown tables |
| AI weekly advisory ×5 | service | aiWeeklyAdvisory.ts:[250](backend/functions/src/services/aiWeeklyAdvisory.ts#L250), [260](backend/functions/src/services/aiWeeklyAdvisory.ts#L260), [328](backend/functions/src/services/aiWeeklyAdvisory.ts#L328), [348](backend/functions/src/services/aiWeeklyAdvisory.ts#L348), [418](backend/functions/src/services/aiWeeklyAdvisory.ts#L418) | reads root `brand` | | advisory prompts lose brand |
| AI Describe — prompt + template | service | aiDescribe.ts:[82](backend/functions/src/services/aiDescribe.ts#L82), [89](backend/functions/src/services/aiDescribe.ts#L89), [181](backend/functions/src/services/aiDescribe.ts#L181), [191](backend/functions/src/services/aiDescribe.ts#L191) | reads root `brand`, falls back to `attrs["brand"]` | **⚠** | `{{brand}}` renders empty; template match fails |
| RICS parser — column map | service | [ricsParser.ts:229, 386, 399](backend/functions/src/services/ricsParser.ts#L229) | CSV `Brand` → `brand` | | CSV Brand column stops being read |
| RICS parser — Nike MPN rule | service | [ricsParser.ts:141-143](backend/functions/src/services/ricsParser.ts#L141-L143) | **lowercases the display brand and compares to a hardcoded literal** | **⚠** | Nike MPN normalization stops firing; hardcoded brand name in business logic (→ K2) |
| Launch notifier | service | [launchNotifier.ts:108](backend/functions/src/services/launchNotifier.ts#L108) | reads `launch.brand` | | notification email loses brand |
| **Smart rules engine** | service | [smartRules.ts:244, 338, 443](backend/functions/src/services/smartRules.ts#L244) | `registryKeys` = **`attribute_registry` doc ids** | **⚠** | see DEFECT B3-1 |

### Frontend

| Consumer | Kind | file:line | Reads/Writes | ⚠ | What breaks |
|---|---|---|---|---|---|
| Product List — filter | page | ProductListPage.tsx:[43](frontend/src/pages/ProductListPage.tsx#L43), [80](frontend/src/pages/ProductListPage.tsx#L80), [221](frontend/src/pages/ProductListPage.tsx#L221), [543-568](frontend/src/pages/ProductListPage.tsx#L543-L568) | registry-backed `<select>` emitting `brand_key`, sent as `?brand=` | | filter empties (guarded with an explicit message) |
| Product List — Brand column | page | [ProductListPage.tsx:815](frontend/src/pages/ProductListPage.tsx#L815) | reads `p.brand` (display) | | column blanks |
| **Completion Queue — Brand filter** | page | CompletionQueuePage.tsx:[40](frontend/src/pages/CompletionQueuePage.tsx#L40), [94](frontend/src/pages/CompletionQueuePage.tsx#L94), [290-295](frontend/src/pages/CompletionQueuePage.tsx#L290-L295) | **free-text input** sent as `?brand=`, matched against `brand_key` | **⚠** | zero results for anything a user would type; see B1-7 |
| Completion Queue — Brand column | page | [CompletionQueuePage.tsx:390](frontend/src/pages/CompletionQueuePage.tsx#L390) | reads `p.brand` | | column blanks |
| Quick Edit — pre-population | component | [QuickEditPanel.tsx:161](frontend/src/components/QuickEditPanel.tsx#L161) | reads `attribute_values/brand` (**display**) then `displayToBrandKey` | **⚠** | see DEFECT B3-8 |
| Quick Edit — Brand select | component | [QuickEditPanel.tsx:316-336](frontend/src/components/QuickEditPanel.tsx#L316-L336) | `brand_key` values, `display_name` labels; orphan preserved as "(inactive)" | | select empties |
| Quick Edit — save key | component | [QuickEditPanel.tsx:234](frontend/src/components/QuickEditPanel.tsx#L234) | saves `field_key: "brand"` with a **key-form value** | **⚠** | see DEFECT B3-8 |
| `AttributeField` — brand dropdown | component | AttributeField.tsx:[86-90](frontend/src/components/AttributeField.tsx#L86-L90), [127-131](frontend/src/components/AttributeField.tsx#L127-L131), [149](frontend/src/components/AttributeField.tsx#L149) | `dropdown_source === "brand_registry"` → `{label: display_name, value: brand_key}`; alias-walks `initialValue` | | Product Detail Brand select empties |
| `registryAliases.displayToBrandKey` | lib | [registryAliases.ts:13-24](frontend/src/lib/registryAliases.ts#L13-L24) | matches on key OR display_name OR alias, falls back to the raw display string | **⚠** | legacy display values render "(inactive)" |
| **Smart Rule Builder — legacy migration** | page | SmartRuleBuilderPage.tsx:[22-29](frontend/src/pages/SmartRuleBuilderPage.tsx#L22-L29), [121-165](frontend/src/pages/SmartRuleBuilderPage.tsx#L121-L165), [456-515](frontend/src/pages/SmartRuleBuilderPage.tsx#L456-L515) | rewrites `brand` → `brand_key` on load and on save | | legacy rules stop auto-migrating |
| **Smart Rule Builder — action menu** | page | [SmartRuleBuilderPage.tsx:186-207](frontend/src/pages/SmartRuleBuilderPage.tsx#L186-L207), [309-323](frontend/src/pages/SmartRuleBuilderPage.tsx#L309-L323) | injects `brand_key` as an **action target** with a registry dropdown | **⚠** | see DEFECT B3-1 |
| Cadence Rules Admin | page | CadenceRulesAdminPage.tsx:[26](frontend/src/pages/CadenceRulesAdminPage.tsx#L26), [120](frontend/src/pages/CadenceRulesAdminPage.tsx#L120), [256-265](frontend/src/pages/CadenceRulesAdminPage.tsx#L256-L265) | `brand_key` filter field + registry dropdown; **the default new-filter field** | | value becomes free text |
| Review Active Overrides page | page | ReviewActiveOverridesPage.tsx:[102](frontend/src/pages/ReviewActiveOverridesPage.tsx#L102), [201](frontend/src/pages/ReviewActiveOverridesPage.tsx#L201), [262](frontend/src/pages/ReviewActiveOverridesPage.tsx#L262) | `brand_key` filter + display fallback chain | | filter empties |
| Brand Registry Admin page | page | [BrandRegistryAdminPage.tsx](frontend/src/pages/BrandRegistryAdminPage.tsx) (whole file) | full CRUD; `brand_key` immutable, is the row key | | page dies |
| User Portfolio Editor | component | [UserPortfolioEditor.tsx:82](frontend/src/components/admin/UserPortfolioEditor.tsx#L82) | `{value: brand_key, label: display_name}` | **⚠** | writes `brand_key` into `portfolio_brands`, which the backend validates against **doc ids** — see DEFECT B3-3 |
| MAP Import Hub — brand mapping | page | ImportHubPage.tsx:[379](frontend/src/pages/ImportHubPage.tsx#L379), [409](frontend/src/pages/ImportHubPage.tsx#L409), [439](frontend/src/pages/ImportHubPage.tsx#L439), [470](frontend/src/pages/ImportHubPage.tsx#L470), [531](frontend/src/pages/ImportHubPage.tsx#L531), [541-542](frontend/src/pages/ImportHubPage.tsx#L541-L542) | maps a CSV column to `brand`, **required** | **⚠** | MAP import brand mapping breaks |
| Launch Admin — brand input | page | LaunchAdminListPage.tsx:[129](frontend/src/pages/LaunchAdminListPage.tsx#L129), [208](frontend/src/pages/LaunchAdminListPage.tsx#L208), [267-268](frontend/src/pages/LaunchAdminListPage.tsx#L267-L268) | **free-text `<input>`** | **⚠** | see DEFECT B3-6 |
| Launch Admin Detail | page | [LaunchAdminDetailPage.tsx:150](frontend/src/pages/LaunchAdminDetailPage.tsx#L150) | reads `launch.brand` | | header loses brand |
| Public Launch Calendar | page | [PublicLaunchCalendarPage.tsx:132](frontend/src/pages/PublicLaunchCalendarPage.tsx#L132) | reads `card.brand` | | public card loses brand |
| Prompt Templates Admin | page | PromptTemplatesAdminPage.tsx:[117](frontend/src/pages/PromptTemplatesAdminPage.tsx#L117), [393](frontend/src/pages/PromptTemplatesAdminPage.tsx#L393) | `{{brand}}` placeholder + `match_brand` | **⚠** | template placeholders break |
| Display-only Brand cells (9 pages) | page | AdvisoryPage.tsx:[59](frontend/src/pages/AdvisoryPage.tsx#L59)/[109](frontend/src/pages/AdvisoryPage.tsx#L109) · ExecutiveDashboardPage.tsx:[270](frontend/src/pages/ExecutiveDashboardPage.tsx#L270)/[381-382](frontend/src/pages/ExecutiveDashboardPage.tsx#L381-L382) · PricingDiscrepancyPage.tsx:[152](frontend/src/pages/PricingDiscrepancyPage.tsx#L152) · CadenceUnassignedPage.tsx:[112](frontend/src/pages/CadenceUnassignedPage.tsx#L112) · ChannelDisparityPage.tsx:[89](frontend/src/pages/ChannelDisparityPage.tsx#L89)/[145](frontend/src/pages/ChannelDisparityPage.tsx#L145)/[196](frontend/src/pages/ChannelDisparityPage.tsx#L196) · SiteVerificationReviewPage.tsx:[107](frontend/src/pages/SiteVerificationReviewPage.tsx#L107) · MapConflictReviewPage.tsx:[50](frontend/src/pages/MapConflictReviewPage.tsx#L50) · ProductDetailPage.tsx:[450](frontend/src/pages/ProductDetailPage.tsx#L450) · ExportCenterPage.tsx:[264-265](frontend/src/pages/ExportCenterPage.tsx#L264-L265) | reads root `brand` | | columns blank |
| api.ts — registry CRUD ×4 + types | api.ts | api.ts:[94-98](frontend/src/lib/api.ts#L94-L98), [2159](frontend/src/lib/api.ts#L2159), [3002-3033](frontend/src/lib/api.ts#L3002-L3033), [3557](frontend/src/lib/api.ts#L3557), [3589](frontend/src/lib/api.ts#L3589) | contracts + CRUD | | type errors (loud) + admin CRUD dies |
| Sidebar / Registries pillar | page | [RegistriesPillarPage.tsx:7](frontend/src/pages/RegistriesPillarPage.tsx#L7) | nav link `/admin/registries/brands` | | dead card |

### Scripts

`grep -rn -wE 'brand\|brand_key' scripts/` matches **41 files** (39 when restricted to `*.js` + `*.ts`). Live-relevant ones: `scripts/tally-brand-jordan-canonicalization-apply.js` (the Jordan duplicate), `scripts/tally-128-task2-brand-registry-seed.js` (registry of record), `scripts/tally-product-list-ux-p05-brand-reseed.js`, `scripts/phase5-pass1-fbrk-key-correction.js`, `scripts/seed/seed-attribute-registry.js`, `scripts/seed-team-users.js` (`portfolio_brands`), `scripts/migrate-smart-rules-to-key-fields.ts` and `scripts/migrate-cadence-rules-to-key-fields.ts` (`brand` → `brand_key`), `scripts/migrate-user-portfolio-fields.ts`.

### Composite indexes

**22 of 108** reference a brand field, all on `products`:
- `brand` (**display**) — **2**: `brand + first_received_at`; `completion_state + brand + first_received_at`. **Both UNREFERENCED** — no query filters or orders on root `brand`.
- `brand_key` — **20**: `brand_key+first_received_at`; `completion_state+brand_key+first_received_at`; `brand_key+department_key+{first_received_at, updated_at ASC/DESC, completion_percent ASC/DESC}`; `brand_key+site_owner+{first_received_at, updated_at ASC/DESC, completion_percent ASC/DESC}`; `brand_key+completion_state+{updated_at ASC/DESC, completion_percent ASC/DESC}`; `brand_key+{updated_at ASC/DESC, completion_percent ASC/DESC}`.

### Security rules

**NONE.** `firebase/firestore.rules` contains no reference to `brand`, `brand_key`, `brand_registry`, or `products`. Everything but `users/{uid}` is deny-all.

---

## Live Firestore (`ropi-aoss-dev`, reads only)

**`brand_registry` — 42 docs, 41 active** (`brand_jordan` is the sole inactive).

| Field | Docs carrying | Docs non-empty |
|---|---|---|
| `products.brand` (root) | 76 | 76 |
| `products.brand_key` (root) | 76 | **68** |
| `products/{id}/attribute_values/brand` | **81** | 81 — **0 quarantined** |

`root.brand` histogram (21 distinct):
`{Nike: 29, Jordan: 9, Paper Planes: 5, Adidas: 5, INDIVIDUALIST: 5, FBRK: 4, Converse: 3, Field Grade: 2, Mitchell & Ness: 2, True Religion: 1, Crocs: 1, Puma: 1, FISLL: 1, Rebel Minds: 1, New Era: 1, Pro Standard: 1, FIRST ROW: 1, Legend Footwear: 1, Smoke Rise: 1, JP Original: 1, New Balance: 1}`

`root.brand_key` histogram (17 distinct):
`{nike: 29, jordan: 9, paper_planes: 5, adidas: 5, fbrk: 4, converse: 3, field_grade: 2, mitchell_ness: 2, true_religion: 1, crocs: 1, puma: 1, new_era: 1, pro_standard: 1, legend_footwear: 1, smoke_rise: 1, jp_original: 1, new_balance: 1}`

**`root.brand` vs `brand_registry.display_name` drift: 0** — every populated `brand_key` resolves and its display matches.

`attribute_values/brand` histogram is identical to `root.brand` except **Nike: 34** (vs 29 at root) — the extra 5 are the `D3SMOKE-*` fixtures, which carry the attribute doc but no root `brand`.

**`attribute_registry/brand`:** `field_key: undefined`, `active: true`, `is_editable: undefined`, `field_type: **"text"**`, `enum_source: "brand_registry"`, `dropdown_source: "brand_registry"`, `dropdown_options: []`, `destination_tab: "core_information"`, `display_label: "Brand"`, `required_for_completion: true`.

**`attribute_registry/brand_key`: DOES NOT EXIST.**

Live rules referencing brand: `cadence_rules/FcOgd2O6b9fgv2O2ego4` ("Nike", disabled) — `brand_key contains nike`; `smart_rules/dim_nike_launch_shipping_override` — condition `brand_key equals nike`. **No live rule writes `brand_key`.**

---

## ⚠ DISPLAY-AS-KEY inventory (the Appendix B B3 requirement)

Every place the display value `brand` is used for grouping, filtering, or matching rather than the key:

| # | Site | file:line | What it does |
|---|---|---|---|
| 1 | Prompt template matcher — hard filter | [templateMatcher.ts:109](backend/functions/src/services/templateMatcher.ts#L109) | `template.match_brand !== product.brand` — exact, case-sensitive display equality. A template stored as `"nike"` never matches a product whose display is `"Nike"` |
| 2 | Prompt template matcher — score | [templateMatcher.ts:133](backend/functions/src/services/templateMatcher.ts#L133) | `template.match_brand === product.brand` adds a specificity point on the same display equality |
| 3 | RICS parser — Nike MPN rule | [ricsParser.ts:141-143](backend/functions/src/services/ricsParser.ts#L141-L143) | lowercases the display brand and compares to a hardcoded `"nike"` literal |
| 4 | Search tokens | [searchTokens.ts:44](backend/functions/src/services/searchTokens.ts#L44) | tokenizes the display value; a search for `nike` matches only because the prefix loop happens to lowercase |
| 5 | RetailOps export column | [exportSerializer.ts:229](backend/functions/src/services/exportSerializer.ts#L229) | emits the display value as the downstream system's brand identifier |
| 6 | AI Describe prompt + template selection | [aiDescribe.ts:82, 181, 191](backend/functions/src/services/aiDescribe.ts#L181) | display value feeds `{{brand}}` and `selectTemplate` |
| 7 | Quick Edit pre-population | [QuickEditPanel.tsx:161](frontend/src/components/QuickEditPanel.tsx#L161) | reads the display-valued `attribute_values/brand` and alias-walks it back to a key |
| 8 | `AttributeField` initialValue walk | [AttributeField.tsx:127-131](frontend/src/components/AttributeField.tsx#L127-L131) | same walk, same reason |
| 9 | `displayToBrandKey` fallback | [registryAliases.ts:23](frontend/src/lib/registryAliases.ts#L23) | `return match?.brand_key \|\| displayName` — on no match it returns the **display string as if it were a key** |
| 10 | MAP import `map_brand` | [mapImport.ts:353-354, 526](backend/functions/src/routes/mapImport.ts#L353-L354) | stamps a raw CSV brand string onto the product, never canonicalized |
| 11 | Launch record `brand` | [launches.ts:391](backend/functions/src/routes/launches.ts#L391) + [LaunchAdminListPage.tsx:267-268](frontend/src/pages/LaunchAdminListPage.tsx#L267-L268) | free-text input stored and displayed publicly |
| 12 | Admin portfolio validation | [adminUsers.ts:88](backend/functions/src/routes/adminUsers.ts#L88) → [registryAuthority.ts:32](backend/functions/src/lib/registryAuthority.ts#L32) | validates against **doc ids**, while the UI submits `brand_key` |

---

## Defects found during B3

**DEFECT B3-1 — The Smart Rule Builder offers `brand_key` as an action target, but no such registry doc exists, so those rules silently never fire.**
`SmartRuleBuilderPage.tsx:186-189` injects `{field_key: "brand_key", display_label: "Brand"}` into **both** `conditionFieldOptions` (`:191-198`) and `actionFieldOptions` (`:200-207`), and `:309-323` renders a registry-backed value dropdown for it. At runtime `smartRules.ts:338`/`:443` builds `registryKeys` from `attribute_registry` **doc ids**, and `:244-249` skips any target not in that set with a `console.error` and no user-visible signal. Live: `attribute_registry/brand_key` **does not exist** (`attribute_registry/department_key` does — seeded by TALLY-144-2C.0). An admin can build, save, and see a perfectly valid-looking Brand action rule that writes nothing, permanently.

**DEFECT B3-2 — Two `brand_registry` docs share the display name "Jordan".**
`brand_registry/jordan` (`is_active: true`) and `brand_registry/brand_jordan` (`is_active: false`), both `display_name: "Jordan"`. `loadBrandRegistry` (`brandRegistry.ts:39-63`) filters to active, so `matchBrand("Jordan")` resolves deterministically today — but `listBrandRegistry` (`:190-206`) returns both, so the Brand Registry admin table and any `activeOnly=false` consumer show two identical "Jordan" rows distinguishable only by the `brand_key` column. Carried to Task L4.

**DEFECT B3-3 — `brand_registry` has a doc whose id ≠ `brand_key`, and two libs key the same collection differently.**
`brand_registry/"field grade"` (doc id contains a **space**) has `brand_key: "field_grade"`. `lib/brandRegistry.ts:49-52` keys its Map by `brand_key`; `lib/registryAuthority.ts:32` builds `brand: new Set(brandSnap.docs.map(d => d.id))` — by **doc id**. The two sets are not equal.
Consequence: `adminUsers.ts:88` validates `portfolio_brands` against the doc-id set, while `UserPortfolioEditor.tsx:82` submits `brand_key` values. A portfolio containing `field_grade` is **rejected as invalid**, and one containing `field grade` would be accepted but never match a product (products carry `brand_key: "field_grade"`, per the live histogram). The TALLY-149 comment at `registryAuthority.ts:74-77` documents exactly this hazard and fixes it for the canonicalizer — but not for `loadRegistryAuthority`.

**DEFECT B3-4 — 8 products have a root `brand` but no `brand_key`, and are invisible to every key-based consumer.**
Live: `root.brand` non-empty on 76 products; `root.brand_key` non-empty on **68**. The 8 with a display but no key are the four orphan brands: `INDIVIDUALIST` (5), `FISLL` (1), `Rebel Minds` (1), `FIRST ROW` (1) — none is a `brand_registry` entry. `importFullProduct.ts:343-344` sets `identity.brand = rawBrand` but `identity.brand_key = ""` on no match (a `console.warn` at `:341` plus a batch-summary orphan list at `:1105` are the only signals).
Those 8 products cannot be found by the Product List Brand filter (`products.ts:207`), are excluded from every `brand_key` index, fail `evaluateFilter` in the cadence engine (`cadenceEngine.ts:220-222` returns `false` on empty), and never match a buyer's `portfolio_brands`.

**DEFECT B3-5 — MAP import stamps an uncanonicalized brand onto products.**
`mapImport.ts:353-354` reads the mapped CSV column raw (`brandRaw || null`), carries it through commit (`:381`, `:433-441`, `:480`) and stamps it as `map_brand` at `:526`. No `matchBrand`, no registry check, no orphan tracking — unlike the Full Product Import, which canonicalizes at `importFullProduct.ts:334-344`. `ImportHubPage.tsx:439` makes the brand column **required** for MAP import, so every MAP import writes a free-text brand.

**DEFECT B3-6 — Launch records take a free-text brand that is published publicly.**
`LaunchAdminListPage.tsx:267-268` is a plain `<input>`; `launches.ts:391` stores `body.brand` with no validation (`brand` is in the field allowlists at `:51`, `:373`, `:468`). It is rendered on the public calendar (`PublicLaunchCalendarPage.tsx:132`) and in launch notification emails (`launchNotifier.ts:108`). Nothing links a launch brand to `brand_registry`.

**DEFECT B3-7 — Brand-scoped prompt templates match on exact display-string equality.**
`templateMatcher.ts:109` — `if (template.match_brand && template.match_brand !== product.brand) return false;`. No trim, no case fold, no registry resolution — unlike every other brand comparison in the codebase, which goes through `normalizeBrand`. A template authored as `"nike"`, `"NIKE"`, or `" Nike"` silently never matches, falling through to the generic template with no error. Same pattern at `:133` for scoring, and identically for `match_department` (see B1).

**DEFECT B3-8 — Brand round-trips through the display-valued attribute doc.**
`attribute_values/brand` holds **display** strings live (`"Nike"`, `"Mitchell & Ness"`) — 81 docs, **none quarantined**, unlike the department equivalent. Quick Edit reads that display value and alias-walks it to a key (`QuickEditPanel.tsx:161` → `registryAliases.ts:13-24`), then saves under `field_key: "brand"` (`:234` only rewrites `department`) with a **key-form** value. The backend's `matchBrand` accepts the key (`brandRegistry.ts:82-83`), mirrors root correctly (`products.ts:1165-1173`), and writes the key back into `attribute_values/brand` — so the doc's value form silently flips from display to key on every edit, while import keeps writing display (`importFullProduct.ts:829`). Two writers, two value forms, one doc. `displayToBrandKey` masks it by matching key OR display OR alias, and on total failure returns the display string **as if it were a key** (`registryAliases.ts:23`).

**DEFECT B3-9 — `attribute_registry/brand` is `field_type: "text"` with a `dropdown_source`.**
Live: `field_type: "text"`, `dropdown_source: "brand_registry"`. `AttributeField.tsx:154-176` resolves registry options first and derives `effectiveType = "select"` whenever `hasOptions`, so the declared type is overridden and a select renders. The registry value is therefore wrong but inert — until something reads `field_type` directly (e.g. the export or a future generic renderer). Carried to Task G4/G12.

**DEFECT B3-10 — Brand indexes #37-equivalents on root `brand` are UNREFERENCED.**
`products: brand + first_received_at` and `products: completion_state + brand + first_received_at`. No query anywhere filters or orders on root `brand`; every one uses `brand_key`. Same finding as B1-9 for department — 4 dead indexes between them.

**DEFECT B3-11 — `AttributeField.tsx` has no `is_editable` handling at all.**
The props interface (`AttributeField.tsx:23-36`) has no `is_editable` / `isEditable` prop, and the component never references one. Read-only enforcement lives entirely in the **caller**: `ProductDetailPage.tsx:814` returns a display-only badge when `entry.is_editable === false`. That guard covers **one** of the four `<AttributeField>` render sites on that page — `:710` (the hardcoded `is_fast_fashion` toggle), `:737` (fast-fashion drawer fields) and `:767` (display-group sibling fields) render an editable control regardless. `QuickEditPanel.tsx` never checks it either. Recorded here because `brand`, `site_owner` and `website` all carry `is_editable: undefined` live; carried in full to Task G2.

---

## Totals

- **Total consumers found: 89** — 38 backend routes · 22 backend services/libs · 29 frontend pages/components/api.ts entries.
- **Scripts referencing brand / brand_key: 41.**
- **Live Firestore:** `products` 81 docs — root `brand` 76 carrying / 76 non-empty · root `brand_key` 76 carrying / **68 non-empty** · `attribute_values/brand` 81 / 81 (0 quarantined). `brand_registry` 42 docs, 41 active, 1 duplicate display_name pair, 1 doc-id≠key.
- **Indexes referencing it: 22** (2 on `brand` — both unreferenced; 20 on `brand_key`).
- **Security rules referencing it: 0.**
- **⚠ DISPLAY-AS-KEY sites: 12.**
