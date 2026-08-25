# TASK B2 — Deep map: `site_owner`, `website`, `site_registry`, `site_key`, `site_targets`

**Scope:** every reference, no sampling. Repo @ `2698e48`, live reads against `ropi-aoss-dev`.

## The five names are five different things

| Name | Where it lives | Value form | Written by | Read by |
|---|---|---|---|---|
| `site_key` | `site_registry/{id}.site_key` (== doc id) | bare key (`shiekh`) | Site Registry admin | every registry lookup; **the key of the `site_verification` map** |
| `site_owner` (root) | `products/{id}.site_owner` | one `site_key` | import (`importFullProduct.ts:485`), attribute save (`products.ts:1218-1225`) | list filter, cadence engine, portfolio filter, product detail sort, reviewActiveOverrides |
| `site_owner` (attribute) | `products/{id}/attribute_values/site_owner` | one `site_key` | import (`importFullProduct.ts:500-512`), attribute save | Quick Edit pre-population only |
| `website` (attribute) | `products/{id}/attribute_values/website` | **domain string** (`shiekh.com`) | import (`importFullProduct.ts:855`) | **nothing in production** |
| `site_targets` | `products/{id}/site_targets/{site_key}` subcollection | `{site_id, domain, active}` | import (`importFullProduct.ts:444-458`) | RetailOps export, product detail, site-verification coverage gaps, **and the detail endpoint's `site_owner` wire field** |
| `site_verification` | `products/{id}.site_verification` — a **map field on the root doc** | keyed by `site_key` | `siteVerificationReview.ts:220-233, :285-297, :392-404` | product detail, Site Verification Review |

---

## "Which is read where"

### `site_owner` — root product field

| Consumer | Kind | file:line | Reads/Writes | What breaks |
|---|---|---|---|---|
| Product list sort allowlist | route | [products.ts:140](backend/functions/src/routes/products.ts#L140) | reads (sort field name) | `?sort=site_owner` drops out of the allowlist |
| Product list filter (no-search) | route | [products.ts:209](backend/functions/src/routes/products.ts#L209) | reads | Site filter returns everything |
| Product list filter (search path) | route | [products.ts:250-251](backend/functions/src/routes/products.ts#L250-L251) | reads via `getSiteOwner()` | Site filter matches nothing while searching |
| Product list count query | route | [products.ts:367](backend/functions/src/routes/products.ts#L367) | reads | page total diverges |
| Product list row value | route | [products.ts:310](backend/functions/src/routes/products.ts#L310) | reads via `getSiteOwner()` | Site column blanks |
| **`getSiteOwner()` helper** | route | [products.ts:93-113](backend/functions/src/routes/products.ts#L93-L113) | reads `site_targets[0].site_id` **first**, root `site_owner` as fallback | see **DEFECT B2-1** |
| Bulk CSV export filter | route | [products.ts:546](backend/functions/src/routes/products.ts#L546), [:612-613](backend/functions/src/routes/products.ts#L612-L613) | reads | filtered export returns wrong rows |
| Bulk CSV export column | route | [products.ts:426](backend/functions/src/routes/products.ts#L426) | reads | `site_owner` column disappears from the CSV |
| Product detail — primary-site sort | route | [products.ts:798-801, 866-872](backend/functions/src/routes/products.ts#L866-L872) | reads root | site verification tabs stop ordering primary-first |
| **Product detail — wire `site_owner`** | route | [products.ts:921](backend/functions/src/routes/products.ts#L921) | reads `site_targets[0].site_id` | see **DEFECT B2-1** |
| Product detail — wire `primary_site_key` | route | [products.ts:922](backend/functions/src/routes/products.ts#L922) | reads root `site_owner` | Site Verification tab loses its primary marker |
| Attribute save — registry validation | route | [products.ts:1048-1071](backend/functions/src/routes/products.ts#L1048-L1071) | reads active `site_registry` doc ids | any string saves as site_owner |
| Attribute save — root mirror | route | [products.ts:1218-1225](backend/functions/src/routes/products.ts#L1218-L1225) | **writes** root `site_owner` | edits stop reaching the filter/index layer |
| Attribute save — search-token exclusion | route | [products.ts:1344](backend/functions/src/routes/products.ts#L1344) | reads (comment + omission from `SEARCH_TOKEN_FIELDS`) | none — site is deliberately not searchable |
| Import — canonicalize + root write | route | [importFullProduct.ts:466-487](backend/functions/src/routes/importFullProduct.ts#L466-L487) | **writes** root `site_owner` | imports stop populating Site Owner |
| Import — brand-default override | route | [importFullProduct.ts:477-482](backend/functions/src/routes/importFullProduct.ts#L477-L482) | reads `brand_registry.default_site_owner` | brand routing default stops applying |
| Import — attribute mirror | route | [importFullProduct.ts:488-514](backend/functions/src/routes/importFullProduct.ts#L488-L514) | **writes** `attribute_values/site_owner` | Quick Edit Site Owner opens blank |
| Import — canonical skip-list | route | [importFullProduct.ts:696-698](backend/functions/src/routes/importFullProduct.ts#L696-L698) | reads `"site_owner"` as a skip key | raw CSV domain overwrites the canonical attribute value |
| Import — orphan tracking | route | [importFullProduct.ts:472-475, 1107](backend/functions/src/routes/importFullProduct.ts#L472-L475) | reads | unmatched sites stop being reported |
| Content versions query | route | [aiContent.ts:62, 71](backend/functions/src/routes/aiContent.ts#L71) | reads `content_versions.site_owner` | AI content tabs return all sites mixed |
| Content version payloads ×3 | route | aiContent.ts:[141](backend/functions/src/routes/aiContent.ts#L141), [191](backend/functions/src/routes/aiContent.ts#L191), [255](backend/functions/src/routes/aiContent.ts#L255) | reads | version rows lose their site |
| Content version restore | route | [aiContent.ts:351, 360](backend/functions/src/routes/aiContent.ts#L351) | reads | restore writes to the wrong site bucket |
| Regenerate-with-critique | route | [aiContent.ts:418](backend/functions/src/routes/aiContent.ts#L418) | reads prior version's `site_owner` | regenerate loses site targeting |
| Buyer discrepancy notification | route | [exports.ts:202, 211, 223, 231](backend/functions/src/routes/exports.ts#L202) | reads root → **writes** `notifications.site_owner` + `audit_log.site_owner` | notification/audit payloads lose the site |
| Buyer review queue row | route | [buyerReview.ts:151](backend/functions/src/routes/buyerReview.ts#L151) | reads root | Site column blanks |
| Review Active Overrides | route | [reviewActiveOverrides.ts:57, 126-129, 170](backend/functions/src/routes/reviewActiveOverrides.ts#L126-L129) | reads root, then indexes `site_verification[site_owner]` | override rows lose site + verification state |
| Cadence engine — portfolio site match | service | [cadenceEngine.ts:102, 119](backend/functions/src/services/cadenceEngine.ts#L102) | reads root | buyer site portfolios stop matching → products go Unassigned |
| Portfolio filter lib | lib | [portfolioFilter.ts:53](backend/functions/src/lib/portfolioFilter.ts#L53) | reads root | same on the filter path |
| Cadence rule target filters | service | [cadenceEngine.ts:220-238](backend/functions/src/services/cadenceEngine.ts#L220-L238) | reads root via `getProductField` | the 3 live MLTD rules stop matching |
| **AI Describe** | service | [aiDescribe.ts:147, 264, 272, 293, 303](backend/functions/src/services/aiDescribe.ts#L147) | reads the `siteOwner` **argument** — see **E8** | content_versions bucket by whatever the client sent |
| Prompt template matcher | service | [templateMatcher.ts](backend/functions/src/services/templateMatcher.ts) via `match_site_owner` | reads | site-scoped templates stop matching |
| RICS parser column map | service | [ricsParser.ts:269](backend/functions/src/services/ricsParser.ts#L269) | `Website` CSV column → `site_owner` | the CSV Website column stops being read |
| Registry authority canonicalizer | lib | [registryAuthority.ts:127-171](backend/functions/src/lib/registryAuthority.ts#L127-L171) | reads active `site_registry` by domain → key → display | every CSV website becomes an orphan |
| Brand-default map builder | lib | [registryAuthority.ts:179-190](backend/functions/src/lib/registryAuthority.ts#L179-L190) | reads `brand_registry.default_site_owner` | brand routing default disappears |
| Cascade delete | service | [productCascadeDelete.ts:26](backend/functions/src/services/productCascadeDelete.ts#L26) | deletes `site_targets` subcollection | orphaned subcollections on product delete |
| Product List — filter + column | page | ProductListPage.tsx:[42](frontend/src/pages/ProductListPage.tsx#L42), [79](frontend/src/pages/ProductListPage.tsx#L79), [218](frontend/src/pages/ProductListPage.tsx#L218), [613-641](frontend/src/pages/ProductListPage.tsx#L613-L641), [818](frontend/src/pages/ProductListPage.tsx#L818) | registry-backed `<select>` emitting `site_key` | filter empties (guarded with an explicit error message) |
| Completion Queue — filter + column | page | CompletionQueuePage.tsx:[39](frontend/src/pages/CompletionQueuePage.tsx#L39), [93](frontend/src/pages/CompletionQueuePage.tsx#L93), [256-285](frontend/src/pages/CompletionQueuePage.tsx#L256-L285), [391](frontend/src/pages/CompletionQueuePage.tsx#L391) | registry-backed `<select>` | filter empties (guarded). **Note: unlike Brand/Department on the same page, this one IS a proper select** |
| Quick Edit — Site Owner field | component | QuickEditPanel.tsx:[59](frontend/src/components/QuickEditPanel.tsx#L59), [71](frontend/src/components/QuickEditPanel.tsx#L71), [169](frontend/src/components/QuickEditPanel.tsx#L169) | reads `attribute_values/site_owner` via `readAttrValue` | Quick Edit Site Owner opens blank |
| Cadence Rules Admin | page | CadenceRulesAdminPage.tsx:[30](frontend/src/pages/CadenceRulesAdminPage.tsx#L30), [267-276](frontend/src/pages/CadenceRulesAdminPage.tsx#L267-L276) | `site_owner` is an allowed target-filter field, registry-backed dropdown | value becomes free text |
| `SiteBadge` component | component | [SiteBadge.tsx:7, 16, 27](frontend/src/components/SiteBadge.tsx#L27) | matches `site_key`, reads `badge_color` | badges lose colour/label |
| api.ts type contracts | api.ts | api.ts:[102](frontend/src/lib/api.ts#L102), [455](frontend/src/lib/api.ts#L455), [1065](frontend/src/lib/api.ts#L1065), [1296](frontend/src/lib/api.ts#L1296), [1321](frontend/src/lib/api.ts#L1321), [1401](frontend/src/lib/api.ts#L1401), [3561](frontend/src/lib/api.ts#L3561) | contracts | type errors (loud) |

### `website` — the attribute

| Consumer | Kind | file:line | Reads/Writes | What breaks |
|---|---|---|---|---|
| Import — attribute write | route | [importFullProduct.ts:820, 826, 855](backend/functions/src/routes/importFullProduct.ts#L855) | **writes** `attribute_values/website` = `siteList[0] \|\| websiteRaw \|\| ""` | the attribute stops being populated |
| `deriveSiteTargetKeys()` doc comment | lib | [brandRegistry.ts:148](backend/functions/src/lib/brandRegistry.ts#L148) | documents reading `attribute_values.website` | **nothing — see DEFECT B2-4, this function has no production caller** |
| Product Detail / editor render | component | [AttributeField.tsx](frontend/src/components/AttributeField.tsx) (generic) | rendered generically from `attribute_registry/website` | the Website field disappears from the editor |

**There is no other reader of `website` anywhere in `backend/functions/src` or `frontend/src`.** Grep for the bare word `website` returns 4 backend hits (3 in `importFullProduct.ts`, 1 comment in `brandRegistry.ts`) and **0 frontend hits**.

### `site_registry` / `site_key`

| Consumer | Kind | file:line | Reads/Writes | What breaks |
|---|---|---|---|---|
| Site Registry CRUD (5 routes) | route | [siteRegistry.ts:40-245](backend/functions/src/routes/siteRegistry.ts#L40) | reads/**writes** the collection | Site Registry admin dies |
| Site Registry — new-site coverage warning | route | [siteRegistry.ts:128](backend/functions/src/routes/siteRegistry.ts#L128) | `console.log` only | see **M3 / DEFECT B2-6** |
| Import — domain→site_id map | route | [importFullProduct.ts:240-247](backend/functions/src/routes/importFullProduct.ts#L240-L247) | reads `site_registry` **without an `is_active` filter** | see **DEFECT B2-3** |
| Registry authority — active sets | lib | [registryAuthority.ts:12, 23, 34](backend/functions/src/lib/registryAuthority.ts#L23) | reads active only | portfolio validation rejects every site |
| Attribute save — enum validation | route | [products.ts:1048-1070](backend/functions/src/routes/products.ts#L1048-L1070) | reads active doc ids | site_owner edits stop validating |
| Product detail — registry lookup by site_key | route | [products.ts:803-812](backend/functions/src/routes/products.ts#L803-L812) | reads `display_name`, `domain`, `priority` | verification tabs lose names/domains/order |
| Site verification review — registry map | route | [siteVerificationReview.ts:41-56, 105-118, 142-157](backend/functions/src/routes/siteVerificationReview.ts#L41-L56) | reads | review rows lose names; coverage gaps stop emitting |
| Site verification reverify — FK check | route | [siteVerificationReview.ts:363-368](backend/functions/src/routes/siteVerificationReview.ts#L363-L368) | reads active doc | reverify accepts any key |
| Brand Registry — `default_site_owner` FK | route | [brandRegistry.ts:171-179, 284-297](backend/functions/src/routes/brandRegistry.ts#L171-L179) | reads active site doc | brands can point at nonexistent/inactive sites |
| Brand registry lib | lib | brandRegistry.ts:[15](backend/functions/src/lib/brandRegistry.ts#L15), [55](backend/functions/src/lib/brandRegistry.ts#L55), [199](backend/functions/src/lib/brandRegistry.ts#L199) | reads `default_site_owner` | field drops off the wire |
| `buildActiveRegistryView` + `deriveSiteTargetKeys` | lib | [brandRegistry.ts:98-184](backend/functions/src/lib/brandRegistry.ts#L98-L184) | reads a registry view | **nothing — no production caller (DEFECT B2-4)** |
| Attribute Registry allowed sources | route | [attributeRegistry.ts:41-45](backend/functions/src/routes/attributeRegistry.ts#L41-L45) | `"site_registry"` | attributes cannot point at the site registry |
| `AttributeField` registry dropdown | component | AttributeField.tsx:[61](frontend/src/components/AttributeField.tsx#L61), [82](frontend/src/components/AttributeField.tsx#L82), [148](frontend/src/components/AttributeField.tsx#L148) | reads `dropdown_source === "site_registry"` | Site Owner select empties |
| **AI Content Review site tabs** | page | [AIContentReviewPage.tsx:67-77](frontend/src/pages/AIContentReviewPage.tsx#L67-L77) | `fetchSiteRegistry(true)` → `e.site_key` | tabs disappear |
| Site Registry Admin page | page | [SiteRegistryAdminPage.tsx](frontend/src/pages/SiteRegistryAdminPage.tsx) (whole file) | full CRUD, `site_key` is the row key and immutable | page dies |
| Import Hub site dropdown | page | [ImportHubPage.tsx:722, 885](frontend/src/pages/ImportHubPage.tsx#L885) | active-only | import site select empties |
| Brand Registry Admin — grouping + FK select | page | BrandRegistryAdminPage.tsx:[114-140](frontend/src/pages/BrandRegistryAdminPage.tsx#L114-L140), [205](frontend/src/pages/BrandRegistryAdminPage.tsx#L205), [350-382](frontend/src/pages/BrandRegistryAdminPage.tsx#L350-L382), [452](frontend/src/pages/BrandRegistryAdminPage.tsx#L452) | reads/writes `default_site_owner` | grouping collapses to "Unassigned"; FK select empties |
| Site Verification Review page | page | [SiteVerificationReviewPage.tsx:41-151](frontend/src/pages/SiteVerificationReviewPage.tsx#L41-L151) | sends `site_key` in every action body | mark-live / flag stop working |
| Site Verification Tab | component | [SiteVerificationTab.tsx:80](frontend/src/components/SiteVerificationTab.tsx#L80) | `site_key` as the React key | tab list breaks |

### `site_targets` (subcollection)

| Consumer | Kind | file:line | Reads/Writes | What breaks |
|---|---|---|---|---|
| Import — write | route | [importFullProduct.ts:443-464](backend/functions/src/routes/importFullProduct.ts#L443-L464) | **writes** `{site_id, domain, active}` | subcollection stops being populated |
| `getSiteOwner()` — primary source | route | [products.ts:99-107](backend/functions/src/routes/products.ts#L99-L107) | reads first doc | list Site column and filter change semantics |
| Product detail | route | [products.ts:727, 776-777, 921, 956](backend/functions/src/routes/products.ts#L776-L777) | reads all docs | `site_targets` array and wire `site_owner` go empty |
| **RetailOps export column** | service | [exportSerializer.ts:47, 96, 124, 191-195, 262](backend/functions/src/services/exportSerializer.ts#L191-L195) | reads `.domain` from each doc | the `site_targets` CSV column empties for the 19 products with no subcollection |
| Site verification coverage gaps | route | [siteVerificationReview.ts:137-167](backend/functions/src/routes/siteVerificationReview.ts#L137-L167) | reads | coverage-gap rows stop being produced |
| Cascade delete | service | [productCascadeDelete.ts:26](backend/functions/src/services/productCascadeDelete.ts#L26) | deletes | orphaned data on delete |
| api.ts detail type | api.ts | [api.ts:173-178](frontend/src/lib/api.ts#L173), [472](frontend/src/lib/api.ts#L472) | contract | type error |
| Product List delete-warning copy | page | [ProductListPage.tsx:950](frontend/src/pages/ProductListPage.tsx#L950) | display string only | copy drift |

### `site_verification` (root map field)

| Consumer | Kind | file:line | Reads/Writes | What breaks |
|---|---|---|---|---|
| Product detail response builder | route | [products.ts:796-880](backend/functions/src/routes/products.ts#L796-L880) | reads the map, keys on `site_key` | verification tabs empty |
| Mark live | route | [siteVerificationReview.ts:220-233](backend/functions/src/routes/siteVerificationReview.ts#L220-L233) | **writes** `site_verification[site_key]` — **no registry FK check** | see **DEFECT B2-5** |
| Flag mismatch | route | [siteVerificationReview.ts:285-297](backend/functions/src/routes/siteVerificationReview.ts#L285-L297) | **writes** — no FK check | same |
| Reverify | route | [siteVerificationReview.ts:363-404](backend/functions/src/routes/siteVerificationReview.ts#L363-L404) | **writes** — **has** an FK check at :364-368 | the only guarded writer |
| Review list — flagged rows | route | [siteVerificationReview.ts:88-128](backend/functions/src/routes/siteVerificationReview.ts#L88-L128) | reads; warns on orphaned keys at :107-109 | queue empties |
| Review Active Overrides | route | [reviewActiveOverrides.ts:126-129](backend/functions/src/routes/reviewActiveOverrides.ts#L126-L129) | reads `site_verification[site_owner]` | override rows lose verification state |
| Product Detail page tab | page | ProductDetailPage.tsx:[262](frontend/src/pages/ProductDetailPage.tsx#L262), [613-628](frontend/src/pages/ProductDetailPage.tsx#L613-L628) | reads | tab renders empty |
| Dashboard field label | page | [DashboardPage.tsx:24](frontend/src/pages/DashboardPage.tsx#L24) | display string | label drift |
| api.ts types | api.ts | api.ts:[180](frontend/src/lib/api.ts#L180), [473](frontend/src/lib/api.ts#L473) | contract | type error |

---

## What the export emits

**RetailOps export (`exportSerializer.ts`)** — the site information in the CSV is the **`site_targets` column only**: `siteTargets` is built at [:191-195](backend/functions/src/services/exportSerializer.ts#L191-L195) from each `site_targets` doc's **`domain`** field (not `site_id`), joined by the `admin_settings/export_site_separator` value (default `","`) at [:63-67, :96](backend/functions/src/services/exportSerializer.ts#L63-L67). It is column 23 of 24 ([:124](backend/functions/src/services/exportSerializer.ts#L124)). **`site_owner` is not an export column, and neither is `website`.**

**Bulk product CSV (`products.ts/export.csv`)** — `site_owner` **is** column 5 ([products.ts:426](backend/functions/src/routes/products.ts#L426)), resolved via `getSiteOwner()` — i.e. the `site_targets`-first semantics, not root. `site_targets` and `website` are not columns.

The two exports therefore disagree about what "the product's site" means.

## What AI Describe and the AI Content Review site tabs use

**AI Content Review tabs** are sourced from `site_registry` active-only: [AIContentReviewPage.tsx:67-77](frontend/src/pages/AIContentReviewPage.tsx#L67-L77) calls `fetchSiteRegistry(true)` and maps to `e.site_key`; the first key becomes the default tab. The tab value flows into `fetchContentVersions(mpn, activeSite)` → `?site_owner=` ([api.ts:1401](frontend/src/lib/api.ts#L1401)) → `aiContent.ts:71` `.where("site_owner","==",siteOwner)` on the `content_versions` subcollection.

**AI Describe (E8) — the site comes from the REQUEST BODY.** `routes/aiContent.ts:25` destructures `site_owners` from `req.body`; `:34-36` maps each entry straight into `generateContent(workflow_key, mpn, siteOwner, …)`. `services/aiDescribe.ts` takes `siteOwner` as parameter `:147` and never reads the product's `website` attribute or root `site_owner`. **There is no validation** that the value exists in `site_registry`, is active, or is one of the product's own sites — the only check is `Array.isArray(site_owners) && length > 0` at `:27`. The regenerate path (`:418`) reuses the prior version's stored `site_owner`.

## What site verification keys on (Appendix B, P2-2 "?" marker)

**CONFIRMED: it keys on `site_key`**, as the key of the `products/{id}.site_verification` **map field**. Written at `siteVerificationReview.ts:223`, `:288`, `:395` as `site_verification: { [site_key]: {...} }` with `merge: true`. Read back by `site_key` at `products.ts:816-818` (iterating registry keys) and `reviewActiveOverrides.ts:126-129`.

**It must stay.** These are persisted per-product map keys carrying reviewer identity and timestamps. Renaming `site_key` orphans every stored entry; the only code that notices is a `console.warn` at `siteVerificationReview.ts:107-109`. There is no migration path in the repo for these map keys — `scripts/tally-125-b2b-site-verification-desuffix.js` is the one precedent, and it was a one-off desuffix.

## Brand registry `default_site_owner`

Defined on the entry type ([brandRegistry.ts:15](backend/functions/src/lib/brandRegistry.ts#L15)), shaped on read at `:55` and `:199` and at [routes/brandRegistry.ts:57](backend/functions/src/routes/brandRegistry.ts#L57). FK-validated against **active** `site_registry` docs on POST ([:171-179](backend/functions/src/routes/brandRegistry.ts#L171-L179)) and on PUT ([:284-297](backend/functions/src/routes/brandRegistry.ts#L284-L297), with a skip when unchanged or null). Consumed at import time by [`buildBrandDefaultSiteOwnerMap`](backend/functions/src/lib/registryAuthority.ts#L179-L190), where it **overrides** the CSV-derived site ([importFullProduct.ts:481-482](backend/functions/src/routes/importFullProduct.ts#L481-L482)). Edited on [BrandRegistryAdminPage.tsx:350-382, 452](frontend/src/pages/BrandRegistryAdminPage.tsx#L350-L382), which also groups the whole table by it ([:114-140](frontend/src/pages/BrandRegistryAdminPage.tsx#L114-L140)) with a hardcoded group order comment at `:115`.

Live: all 42 `brand_registry` docs have a non-null `default_site_owner` — `{shiekh: 35, karmaloop: 4, mltd: 3}`. Because the brand default **wins over the CSV**, the CSV Website column is effectively decorative for every one of the 42 registered brands.

---

## Live Firestore (`ropi-aoss-dev`, reads only)

**`site_registry` — 8 docs, 3 active.**

| doc id | site_key | display_name | domain | is_active | priority | badge_color |
|---|---|---|---|---|---|---|
| shiekh | shiekh | Shiekh | shiekh.com | **true** | 10 | `#2563eb` |
| karmaloop | karmaloop | Karmaloop | karmaloop.com | **true** | 20 | `#16a34a` |
| mltd | mltd | MLTD | mltd.com | **true** | 30 | `#1f2937` |
| sangremia | sangremia | Sangre Mia | sangremia.com | false | 40 | null |
| shiekhshoes | shiekhshoes | Shiekh Shoes | shiekhshoes.com | false | 90 | null |
| fbrk | fbrk | FBRK Clothing | fbrkclothing.com | false | 91 | null |
| plndr | plndr | PLNDR | plndr.com | false | 92 | null |
| trendswap | trendswap | TrendSwap | trendswap.com | false | 93 | null |

`sangremia` carries `review_required: true` and a `review_reason` noting its operational fields were copied from `shiekh` and need PO review before activation.

**`products` — 81 docs.**

| Field | Docs carrying | Docs non-empty | Values |
|---|---|---|---|
| root `site_owner` | 76 | 76 | `{shiekh: 63, karmaloop: 13}` |
| `attribute_values/site_owner` | **81** | 81 | 76 canonical + **5 with the literal string `"TRUE"`** |
| `attribute_values/website` | **67** | 67 | `{"shiekh.com": 33, "karmaloop.com": 28, "true": 5, "fbrkclothing.com": 1}` |
| `site_targets` subcollection | **62** products, 99 docs | — | site_id histogram `{shiekh: 57, karmaloop: 30, mltd: 11, fbrk: 1}` |
| `site_verification` map | **1** product | — | key histogram `{karmaloop: 1}` |

Notable: **no product has root `site_owner == "mltd"`**, yet 11 `site_targets` docs point at `mltd`. **1 `site_targets` doc points at `fbrk`, an inactive site.**

**`attribute_registry` — site/website docs:**

| doc id | field_key | active | is_editable | field_type | enum_source | dropdown_source | dropdown_options | required_for_completion |
|---|---|---|---|---|---|---|---|---|
| `site_owner` | **undefined** | true | **undefined** | dropdown | site_registry | site_registry | `[]` | false |
| `website` | **undefined** | true | **undefined** | **multi_select** | **undefined** | **undefined** | `["fbrkclothing.com","karmaloop.com","mltd.com","plndr.com","shiekh.com","shiekhshoes.com","trendswap.com"]` | **true** |

**`brand_registry` — 42 docs**, `default_site_owner` histogram `{shiekh: 35, karmaloop: 4, mltd: 3}` (0 null).

---

## Defects found during B2

**DEFECT B2-1 — The Product Detail page shows a different Site Owner than the Product List, for 17 of 81 products.**
`products.ts:921` builds the detail response's `site_owner` from `site_targets[0].site_id`, and puts root `site_owner` under a *different* wire name, `primary_site_key` (`:922`). The list endpoint uses `getSiteOwner()` (`:93-113`), which prefers `site_targets[0]` and only falls back to root. But the **filters** (`:209`, `:367`, `:546`) query root `site_owner` directly, as do the cadence engine (`cadenceEngine.ts:102`) and the portfolio filter.
Live: 17 of the 62 products with a `site_targets` subcollection have `site_targets[0].site_id != root.site_owner` — e.g. `1005177`, `1005394`, `210193C`, `30865601`, `71002882`, `A17830C`, `BLL150007-BLK`, `FC9297-UNCCLBL`, `GINO-24-PKPV` all show **karmaloop** on the detail page while root (and therefore every filter, the cadence engine, and every index) says **shiekh**. `FBRK-CR92024-2CAMO` shows **fbrk**, an inactive site.
Note `site_targets` doc order is Firestore's lexicographic doc-id order, so "first" means alphabetically first — `fbrk` < `karmaloop` < `mltd` < `shiekh`. Any product with more than one site target will show its alphabetically-first site as its owner.

**DEFECT B2-2 — `attribute_values/website` has no production reader.**
Written by `importFullProduct.ts:855`; the only other mention of the bare word `website` in the backend is a doc comment at `brandRegistry.ts:148`, and there are **zero** references in `frontend/src`. It is rendered in the editor only generically, from `attribute_registry/website`. Meanwhile it is `required_for_completion: true`, so operators must fill a field nothing reads. Live: 67 of 81 products carry it; 5 of those hold the literal string `"true"`.

**DEFECT B2-3 — Import writes `site_targets` for inactive sites.**
`importFullProduct.ts:240-247` builds `domainToSiteId` from `firestore.collection("site_registry").get()` with **no `is_active` filter** — unlike `buildSiteOwnerCanonicalizer` (`registryAuthority.ts:130-132`), which does filter. So a CSV Website value of `fbrkclothing.com` (inactive) creates a `site_targets/fbrk` doc. Live: 1 such doc exists, on `FBRK-CR92024-2CAMO`, and it is that product's alphabetically-first site target — so it is also what the detail page reports as its Site Owner (see B2-1).

**DEFECT B2-4 — `deriveSiteTargetKeys()` and `buildActiveRegistryView()` are dead code with 17 tests protecting them.**
`brandRegistry.ts:98-184`. The only callers anywhere are `brandRegistry.test.ts:108-132`. The documented input (`product.attribute_values.website`) is never actually passed to it in production. 17 of the 33 assertions in `brandRegistry.test.js` protect behaviour nothing uses. Carried to Task I5 and N2.

**DEFECT B2-5 — `mark-live` and `flag` write arbitrary `site_verification` keys with no registry check.**
`siteVerificationReview.ts:209-233` (`mark-live`) and `:274-297` (`flag`) validate only that `site_key` is truthy, then write `site_verification[site_key]` with `merge: true`. Only `reverify` (`:363-368`) checks the registry. A typo or a stale client creates a permanent orphan map key on the product root, surfaced solely as `console.warn` at `:107-109`. There is no cleanup path.

**DEFECT B2-6 — New-site coverage warning goes to `console.log` only.**
`siteRegistry.ts:128` emits `[TALLY-079] New site_key added: "<key>". Review prompt_templates.match_site_owner for coverage.` to stdout. No admin surface, no notification, no `audit_log` entry for the warning itself. Adding a site silently leaves every site-scoped prompt template uncovered. Carried to Task M3/M4.

**DEFECT B2-7 — The `website` attribute's option list is hardcoded and includes 4 inactive sites.**
`attribute_registry/website` has `enum_source: undefined` and `dropdown_source: undefined`, so its 7 `dropdown_options` are a frozen literal list of domains rather than a registry read. Four of the seven (`fbrkclothing.com`, `plndr.com`, `shiekhshoes.com`, `trendswap.com`) are **inactive** sites; the operator can pick any of them. `site_owner`, by contrast, is correctly registry-driven (`dropdown_source: "site_registry"`, `dropdown_options: []`). Carried to Task G3/G11 and K2.

**DEFECT B2-8 — `field_key` is undefined on both `site_owner` and `website` registry docs.**
Live values are `undefined` for `attribute_registry/site_owner.field_key` and `.../website.field_key` (same shape as the legacy `attribute_registry/department` doc). Smart-rule targeting resolves against registry **doc ids** (`smartRules.ts:244`), so this is currently harmless — but it means the doc-id-vs-`field_key` question in Appendix B P2-1b ("is `field_key` mandatory or is doc_id the key") is answered by live data: **doc_id is the operative key; `field_key` is populated inconsistently.**

**DEFECT B2-9 — Test-fixture residue with invalid site values.**
The 5 `D3SMOKE-*` products carry `attribute_values/site_owner = "TRUE"` and `attribute_values/website = "true"`, with root `site_owner` empty. Neither value is in `site_registry`. Carried to Task L5.

---

## Totals

- **Total consumers found: 71** — 30 backend routes · 13 backend services/libs · 28 frontend pages/components/api.ts entries.
- **Live Firestore:** `products` 81 docs — root `site_owner` 76/76 · `attribute_values/site_owner` 81/81 (5 invalid) · `attribute_values/website` 67/67 (5 invalid, 1 inactive site) · `site_targets` on 62 products / 99 docs · `site_verification` on 1 product. `site_registry` 8 docs (3 active). `brand_registry` 42 docs, all with `default_site_owner`.
- **Indexes referencing `site_owner`: 21** of 108 — **20 on `products`** and **1 on `content_versions`** (`site_owner ASC + generated_at DESC`, which serves the `aiContent.ts:71` query). The 20 product indexes are: `site_owner+first_received_at`; `completion_state+site_owner+first_received_at`; `brand_key+site_owner+{first_received_at, updated_at ASC, updated_at DESC, completion_percent ASC, completion_percent DESC}`; `department_key+site_owner+{first_received_at, updated_at ASC, updated_at DESC, completion_percent ASC, completion_percent DESC}`; `site_owner+completion_state+{updated_at ASC, updated_at DESC, completion_percent ASC, completion_percent DESC}`; `site_owner+{updated_at ASC, updated_at DESC, completion_percent ASC, completion_percent DESC}`.
- **Indexes referencing `website`, `site_key`, `site_targets`, or `site_verification`: 0 each.** (Verified by parsing `firebase/firestore.indexes.json` and matching exact `fieldPath` values across all 108 entries.)
- **Security rules referencing any of them: 0.** `firebase/firestore.rules` covers only `users/{uid}`; everything else is deny-all.
