# TASK B1 — Deep map: `department` and `department_key`

**Scope:** every reference, no sampling. Repo @ `2698e48`, live reads against `ropi-aoss-dev`.
**Field model as found:** `department_key` (lowercase registry key, e.g. `footwear`) is canonical. `department` (display string, e.g. `Footwear`) is a root mirror kept for search tokens, reports, and the RetailOps export. There are **four** storage locations, not two:

| Location | Value form | Status |
|---|---|---|
| `products/{id}.department_key` (root) | key (`footwear`) | canonical, filter/sort/index target |
| `products/{id}.department` (root) | display (`Footwear`) | mirror; still read by 8 consumers |
| `products/{id}/attribute_values/department_key` | key (`footwear`) | canonical attribute doc; smart-rule + editor write target |
| `products/{id}/attribute_values/department` | display (`Accessories`) | **legacy, quarantined** — still read by 2 consumers |

---

## Consumer table

Kind legend: route · service · lib · script · CF (cloud function) · page · component · api.ts · index · rule · seed

### Backend — routes

| Consumer | Kind | file:line | Reads / Writes | What breaks if the field is renamed or removed without touching this consumer |
|---|---|---|---|---|
| `GET /api/v1/products` sort allowlist | route | [products.ts:136-144](backend/functions/src/routes/products.ts#L136-L144) | reads (`department_key` as sort field name) | `?sort=department_key` falls out of the allowlist → 400 or silent fallback to default sort |
| `GET /api/v1/products` filter (no-search path) | route | [products.ts:208](backend/functions/src/routes/products.ts#L208) | reads `department_key` | Department filter on the Product List returns **everything** (clause dropped) or FAILED_PRECONDITION |
| `GET /api/v1/products` filter (search path, in-memory) | route | [products.ts:243](backend/functions/src/routes/products.ts#L243) | reads `department_key` | with a search term active, Department filter silently matches nothing (`(data.department_key \|\| "") !== department` is always true) |
| `GET /api/v1/products` count query | route | [products.ts:366](backend/functions/src/routes/products.ts#L366) | reads `department_key` | page total diverges from page contents |
| `GET /api/v1/products` list row `department` cell | route | [products.ts:290-296, 308](backend/functions/src/routes/products.ts#L290-L308) | reads root `department`, **falls back to legacy `attribute_values/department`** | Department column in the Product List goes blank. Note this is the ONLY read path still reaching the quarantined legacy doc on the list surface |
| `GET /api/v1/products/export.csv` query param contract | route | [products.ts:400, 461](backend/functions/src/routes/products.ts#L400) | reads `?department=` (wire name) | bulk export ignores the Department filter |
| `GET /api/v1/products/export.csv` filters | route | [products.ts:545](backend/functions/src/routes/products.ts#L545), [products.ts:608](backend/functions/src/routes/products.ts#L608) | reads `department_key` | filtered export returns the wrong row set |
| `GET /api/v1/products/export.csv` column suppression | route | [products.ts:588-597](backend/functions/src/routes/products.ts#L588-L597) | reads `department_key` (as a key name in `SUPPRESSED_DYNAMIC_KEYS`) | a **second** Department column reappears in the CSV (the registry-driven dynamic column stops being suppressed) |
| `GET /api/v1/products/export.csv` `department` cell | route | [products.ts:632-644](backend/functions/src/routes/products.ts#L632-L644) | reads root `department_key`, then `attribute_values/department_key` | Department column in the bulk CSV goes blank |
| `GET /api/v1/products/:mpn` detail payload | route | [products.ts:908](backend/functions/src/routes/products.ts#L908) | reads root `department_key` → emits `department_key` on the wire | Quick Edit pre-population loses Department (see `QuickEditPanel.tsx:166-168`) |
| `PUT` attribute save — registry enum validation | route | [products.ts:1014-1037](backend/functions/src/routes/products.ts#L1014-L1037) | reads `enum_source == "department_registry"`; calls `loadDepartmentRegistry` / `isDepartmentValueAllowed` | Department edits stop validating against the registry — any string saves |
| `PUT` attribute save — root mirror (`fieldKey === "department"`) | route | [products.ts:1174-1182](backend/functions/src/routes/products.ts#L1174-L1182) | **writes** root `department` + `department_key` | legacy edit path stops mirroring |
| `PUT` attribute save — root mirror (`fieldKey === "department_key"`) | route | [products.ts:1183-1197](backend/functions/src/routes/products.ts#L1183-L1197) | **writes** root `department` + `department_key` | **the live editor path.** Root mirrors stop updating → list filter, sort, indexes, reports and the CSV all go stale on every Department edit |
| `PUT` attribute save — search-token reindex trigger set | route | [products.ts:1345-1352](backend/functions/src/routes/products.ts#L1345-L1352) | reads `department` (as a member of `SEARCH_TOKEN_FIELDS`) | see **DEFECT B1-1** below — already broken today |
| `POST /api/v1/products/:mpn/enrich/name` context | route | [aiEnrichment.ts:27, 49, 103](backend/functions/src/routes/aiEnrichment.ts#L49) | reads root `department` | the AI name prompt emits `Department: ?` → worse names, no error |
| Full Product Import — canonicalizer + root write | route | [importFullProduct.ts:625-632, 636](backend/functions/src/routes/importFullProduct.ts#L625-L636) | **writes** root `department` (display) + `department_key` (key) | imports stop populating Department entirely; every downstream filter/report empties |
| Full Product Import — search token build | route | [importFullProduct.ts:659-668](backend/functions/src/routes/importFullProduct.ts#L659-L668) | reads `mapped.attributes.department` (**raw CSV**, not the canonicalized value) | search by department breaks; see **DEFECT B1-2** |
| Full Product Import — canonical skip-list | route | [importFullProduct.ts:689-695](backend/functions/src/routes/importFullProduct.ts#L689-L695) | reads `"department"` as a skip key | the raw CSV department string starts overwriting the quarantined `attribute_values/department` doc again |
| Full Product Import — attribute_values write | route | [importFullProduct.ts:827-845](backend/functions/src/routes/importFullProduct.ts#L827-L845) | **writes** `attribute_values/department_key` | canonical attribute doc stops being written; completion recompute sees Department as missing on every imported product |
| Full Product Import — orphan report | route | [importFullProduct.ts:627-629, 1104-1108](backend/functions/src/routes/importFullProduct.ts#L1104-L1108) | reads (orphan set) | unmatched CSV departments stop being reported in the batch summary |
| Cadence Review queue row | route | [cadenceReview.ts:49](backend/functions/src/routes/cadenceReview.ts#L49) | reads root `department` | Department column blank in the cadence review queue |
| Buyer Review queue row | route | [buyerReview.ts:149](backend/functions/src/routes/buyerReview.ts#L149) | reads root `department` | Department column blank in the buyer review queue |
| Buyer discrepancy notification | route | [exports.ts:203, 212](backend/functions/src/routes/exports.ts#L203) | reads root `department` → **writes** `notifications.department` | notification payload loses the routing dimension |
| Executive throughput-by-operator | route | [executive.ts:95-97](backend/functions/src/routes/executive.ts#L95-L97) | reads `operator_throughput.department` | per-operator department breakdown empties — **already 98% empty, see DEFECT B1-3** |
| Executive channel-disparity `.select()` projections ×3 | route | [executive.ts:136](backend/functions/src/routes/executive.ts#L136), [:154](backend/functions/src/routes/executive.ts#L154), [:172](backend/functions/src/routes/executive.ts#L172) | reads root `department` | `department` silently drops out of the projection — the field is simply `undefined` in the response, no error |
| Attribute registry — allowed dropdown sources | route | [attributeRegistry.ts:41-45](backend/functions/src/routes/attributeRegistry.ts#L41-L45) | reads `"department_registry"` | admins can no longer point an attribute at the department registry |
| Attribute registry — superseded-key filter | route | [attributeRegistry.ts:93, 100](backend/functions/src/routes/attributeRegistry.ts#L93-L100) | reads `"department"` | the legacy `attribute_registry/department` doc reappears in the operator editor as a duplicate "Department" field |
| Department Registry CRUD (5 routes) | route | [departmentRegistry.ts:145-413](backend/functions/src/routes/departmentRegistry.ts#L145) | reads/**writes** `department_registry` collection | the registry admin page 500s across the board |
| Smart-rule body validator | route | [adminSmartRules.ts:71-72](backend/functions/src/routes/adminSmartRules.ts#L71-L72) + [ruleFieldValidation.ts:20](backend/functions/src/lib/ruleFieldValidation.ts#L20) | reads `"department"` → rejects, suggests `"department_key"` | legacy `department` rules become creatable again |
| Cadence-rule body validator | route | [cadenceRules.ts:27-30](backend/functions/src/routes/cadenceRules.ts#L27-L30) + [ruleFieldValidation.ts:20](backend/functions/src/lib/ruleFieldValidation.ts#L20) | reads `"department"` → rejects | same |
| Admin users — portfolio validator | route | [adminUsers.ts:91](backend/functions/src/routes/adminUsers.ts#L91), [:135-136](backend/functions/src/routes/adminUsers.ts#L135-L136) | reads `department_registry` to validate `portfolio_depts` + `portfolio_exclusions.department` | buyer portfolios accept departments that do not exist |
| Admin users — legacy field hard-cut list | route | [adminUsers.ts:31, 171](backend/functions/src/routes/adminUsers.ts#L31) | reads `"departments"` (the pre-migration user field) | pre-migration `departments` field stops being stripped |
| Admin users — exclusion dimensions | route | [adminUsers.ts:32](backend/functions/src/routes/adminUsers.ts#L32) | reads `"department"` as a dimension name | the department exclusion dimension disappears from the portfolio editor contract |
| Prompt templates CRUD | route | [promptTemplates.ts:62, 84, 130](backend/functions/src/routes/promptTemplates.ts#L62) | reads/**writes** `match_department` | AI Describe template matching loses its department dimension |
| Queue stats (doc comment only) | route | [queueStats.ts:11](backend/functions/src/routes/queueStats.ts#L11) | none (comment) | nothing — documentation drift only |

### Backend — services and libs

| Consumer | Kind | file:line | Reads / Writes | What breaks |
|---|---|---|---|---|
| **RetailOps export serializer** | service | [exportSerializer.ts:232](backend/functions/src/services/exportSerializer.ts#L232) | reads **`attribute_values/department`** (legacy, quarantined) | see **DEFECT B1-4** — already emitting wrong/blank data today |
| RetailOps export CSV column list | service | [exportSerializer.ts:78, 106](backend/functions/src/services/exportSerializer.ts#L78) | reads `hierarchy.department` | `department` column vanishes from the RetailOps CSV contract |
| **AI Describe context builder** | service | [aiDescribe.ts:179, 192](backend/functions/src/services/aiDescribe.ts#L179) | reads **`attrs["department"]`** (legacy, quarantined) | see **DEFECT B1-5** |
| AI Describe prompt fragment builder | service | [aiDescribe.ts:90-95](backend/functions/src/services/aiDescribe.ts#L90-L95) | reads `productData.department` | the "{gender} {department}" phrase collapses to gender only |
| Prompt template matcher | service | [templateMatcher.ts:30, 105, 131](backend/functions/src/services/templateMatcher.ts#L105) | reads `match_department` vs `product.department` (**display**) | every department-scoped prompt template stops matching → falls to the generic template silently |
| Completion throughput stamp | service | [completionCompute.ts:73, 371](backend/functions/src/services/completionCompute.ts#L371) | **writes** `operator_throughput.department` | see **DEFECT B1-3** |
| Executive projections — per-dept GM% snapshot | service | [executiveProjections.ts:73, 112-128](backend/functions/src/services/executiveProjections.ts#L73) | reads root `department` → **writes** `metric_snapshots.dimension` (display) | GM%-by-department snapshots all bucket to `"Unknown"` |
| Executive projections — per-dept STR% snapshot | service | [executiveProjections.ts:130-141](backend/functions/src/services/executiveProjections.ts#L130-L141) | reads root `department` → **writes** `metric_snapshots.dimension` | STR%-by-department snapshots all bucket to `"Unknown"` |
| Executive projections — loss-leader rows | service | [executiveProjections.ts:231](backend/functions/src/services/executiveProjections.ts#L231) | reads root `department` | loss-leader table shows `"Unknown"` |
| Executive projections — STR heatmap join | service | [executiveProjections.ts:326-340, 421-423](backend/functions/src/services/executiveProjections.ts#L326-L340) | reads `metric_snapshots.dimension_type == "department"` | the Executive Dashboard STR heatmap empties |
| Buyer performance — catalog STR by dept | service | [buyerPerformanceMatrix.ts:105-120](backend/functions/src/services/buyerPerformanceMatrix.ts#L105-L120) | reads `metric_snapshots` dept snapshots | `catalogStrByDept[dept]` misses → `?? 0` → every buyer's `str_vs_catalog` reads as a full surplus. **Silent** |
| Buyer performance — per-dept breakdown | service | [buyerPerformanceMatrix.ts:239, 262](backend/functions/src/services/buyerPerformanceMatrix.ts#L239) | reads root `department` (**display**) | breakdown collapses to a single `"Unknown"` row |
| Buyer performance — GM target lookup | service | [buyerPerformanceMatrix.ts:97-103, 259, 316-318](backend/functions/src/services/buyerPerformanceMatrix.ts#L97-L103) | reads root `department` as a key into a **hardcoded display-keyed map** | every target falls to `?? 40`. **Silent.** Also: `Beauty` is an active registry department with no entry in this map today |
| AI weekly advisory product context ×2 | service | [aiWeeklyAdvisory.ts:329, 349](backend/functions/src/services/aiWeeklyAdvisory.ts#L329) | reads root `department` | advisory prompts lose the department dimension |
| RICS parser — taxonomy inference | service | [ricsParser.ts:51, 61, 80, 96, 106](backend/functions/src/services/ricsParser.ts#L51) | **writes** `result.department` (hardcoded `"Clothing"` / `"Accessories"` / `"Footwear"` display strings) | import taxonomy inference stops producing a department |
| RICS parser — column map + attribute list | service | [ricsParser.ts:233, 358-364, 393](backend/functions/src/services/ricsParser.ts#L233) | reads CSV `Department` → `department_raw` → `department` | the CSV Department column stops being read at all |
| Search token builder | service | [searchTokens.ts:23, 46](backend/functions/src/services/searchTokens.ts#L46) | reads `product.department` (display) | department text search stops working |
| Cadence engine — target-filter evaluation | service | [cadenceEngine.ts:206-247, 633-637](backend/functions/src/services/cadenceEngine.ts#L206-L247) | reads **root** `product[f.field]`, i.e. root `department_key` | **12 of 14 live cadence rules stop matching.** `evaluateFilter` returns `false` on `undefined` → `no_rule_match` → every product lands in Unassigned. Silent |
| Cadence engine — portfolio exclusion | service | [cadenceEngine.ts:90, 101, 107, 118](backend/functions/src/services/cadenceEngine.ts#L101) | reads root `department_key` | buyer department exclusions stop applying (fail-open: excluded products get assigned) |
| Portfolio filter lib | lib | [portfolioFilter.ts:38, 52, 60](backend/functions/src/lib/portfolioFilter.ts#L52) | reads root `department_key` | same as above on the portfolio-filter path |
| Registry authority lib | lib | [registryAuthority.ts:11, 22, 33](backend/functions/src/lib/registryAuthority.ts#L22) | reads `department_registry` (active only) | the active-department allowlist empties → portfolio validation rejects everything |
| Department canonicalizer factory | lib | [registryAuthority.ts:117-119](backend/functions/src/lib/registryAuthority.ts#L117-L119) | reads `department_registry` `key` field | import alias-walk stops resolving; every CSV department becomes an orphan |
| Legacy rule-field blocklist | lib | [ruleFieldValidation.ts:18-21](backend/functions/src/lib/ruleFieldValidation.ts#L18-L21) | reads `"department"` → `"department_key"` | legacy field names become writable in both rule builders |
| Cadence portfolio type | lib | [types/cadence.ts:21](backend/functions/src/types/cadence.ts#L21) | type only | compile error (loud — good) |
| Router mount | route | [index.ts:28, 126](backend/functions/src/index.ts#L126) | mount `/api/v1/department-registry` | the whole registry endpoint 404s |
| **Smart rules engine** | service | [smartRules.ts:244-281](backend/functions/src/services/smartRules.ts#L244-L281) | **writes `attribute_values/{target_field}` ONLY** | see **DEFECT B1-6** — 20 live rules target `department_key` |

### Cloud Functions

| Consumer | Kind | file:line | Reads / Writes | What breaks |
|---|---|---|---|---|
| `onAttributeRegistryWrite` | CF | [onAttributeRegistryWrite.ts:19, 58](backend/functions/src/functions/onAttributeRegistryWrite.ts#L58) | indirect — recomputes completion for all products when `attribute_registry/department_key` changes | toggling `required_for_completion` on Department stops re-stamping products |

### Frontend

| Consumer | Kind | file:line | Reads / Writes | What breaks |
|---|---|---|---|---|
| Product List — filter state + URL param | page | [ProductListPage.tsx:44, 81, 222](frontend/src/pages/ProductListPage.tsx#L222) | writes `?department=<department_key>` on the wire | Department filter no-ops |
| Product List — registry-driven dropdown | page | [ProductListPage.tsx:115-117, 196-198, 578-607](frontend/src/pages/ProductListPage.tsx#L578-L607) | reads `department_registry` via `fetchDepartmentRegistry` | dropdown disables itself with "Could not load department list" (this failure IS handled — good) |
| Product List — Department column cell | page | [ProductListPage.tsx:817](frontend/src/pages/ProductListPage.tsx#L817) | reads `p.department` (display, from the list payload) | column blanks |
| **Completion Queue — Department filter** | page | [CompletionQueuePage.tsx:41, 95, 297-303](frontend/src/pages/CompletionQueuePage.tsx#L297-L303) | writes `?department=` from a **free-text input** | see **DEFECT B1-7** — broken today |
| Quick Edit — field definition | component | [QuickEditPanel.tsx:58, 65, 70](frontend/src/components/QuickEditPanel.tsx#L70) | field kind `"department"` | Department disappears from Quick Edit |
| Quick Edit — value pre-population | component | [QuickEditPanel.tsx:162-168](frontend/src/components/QuickEditPanel.tsx#L162-L168) | reads `detail.department_key`, falls back to legacy `attribute_values.department` via `displayToDeptKey` | Quick Edit opens with Department blank |
| Quick Edit — save key rewrite | component | [QuickEditPanel.tsx:227-234](frontend/src/components/QuickEditPanel.tsx#L227-L234) | **writes** `field_key: "department_key"` | saves would hit the legacy `department` path and mutate the quarantined doc |
| Quick Edit — dropdown render | component | [QuickEditPanel.tsx:338-356](frontend/src/components/QuickEditPanel.tsx#L338-L356) | reads `departmentRegistry` | dropdown empties (guarded: disabled when length 0) |
| Attribute field — registry-backed dropdown | component | [AttributeField.tsx:63, 91, 119-150](frontend/src/components/AttributeField.tsx#L91) | reads `dropdown_source === "department_registry"` | Product Detail Department select empties |
| **Smart Rule Builder — legacy-field block** | page | [SmartRuleBuilderPage.tsx:22-29, 121-181, 456-515](frontend/src/pages/SmartRuleBuilderPage.tsx#L121-L181) | reads/normalizes `department` → `department_key` on load and on save | legacy rules stop being auto-migrated on open; the builder starts emitting `department` again |
| Smart Rule Builder — field menu injection | page | [SmartRuleBuilderPage.tsx:181-202](frontend/src/pages/SmartRuleBuilderPage.tsx#L181-L202) | strips registry docs `brand`/`department`, injects `department_key` | the phantom legacy Department entry reappears in both field menus |
| Smart Rule Builder — registry-native dropdowns | page | [SmartRuleBuilderPage.tsx:244-252, 325-333](frontend/src/pages/SmartRuleBuilderPage.tsx#L244-L252) | reads `departmentRegistry` | condition/action value becomes free text |
| Cadence Rules Admin — allowed filter fields | page | [CadenceRulesAdminPage.tsx:25, 69](frontend/src/pages/CadenceRulesAdminPage.tsx#L25) | `department_key` is a target-filter field and the **default** new-filter field | new cadence rules default to a dead field |
| Cadence Rules Admin — registry dropdown | page | [CadenceRulesAdminPage.tsx:245-256, 499, 692](frontend/src/pages/CadenceRulesAdminPage.tsx#L245-L256) | reads `departmentRegistry` | value becomes free text |
| Cadence Unassigned — Department column | page | [CadenceUnassignedPage.tsx:113](frontend/src/pages/CadenceUnassignedPage.tsx#L113) | reads `p.department` | column blanks |
| Buyer Performance — breakdown table | page | [BuyerPerformancePage.tsx:52-53](frontend/src/pages/BuyerPerformancePage.tsx#L52-L53) | reads `c.department` | rows lose their label / collapse to one row |
| Executive Dashboard — STR heatmap | page | [ExecutiveDashboardPage.tsx:217-220](frontend/src/pages/ExecutiveDashboardPage.tsx#L217-L220) | reads `row.department` | heatmap empties |
| Executive Dashboard — operator departments | page | [ExecutiveDashboardPage.tsx:316](frontend/src/pages/ExecutiveDashboardPage.tsx#L316) | reads `o.departments` | operator breakdown empties |
| Cockpit cadence row | component | [CockpitCadenceSection.tsx:161](frontend/src/components/cockpit/CockpitCadenceSection.tsx#L161) | reads `item.department` | row label loses Department |
| Cockpit drawer header | component | [CockpitDrawer.tsx:220](frontend/src/components/cockpit/CockpitDrawer.tsx#L220) | reads `item.department` | header loses Department |
| Portfolio exclusions editor | component | [PortfolioExclusionsEditor.tsx:5, 125-126](frontend/src/components/admin/PortfolioExclusionsEditor.tsx#L125-L126) | reads/writes `portfolio_exclusions.department` | department exclusion control disappears |
| Attribute Registry Admin — enum source option | page | [AttributeRegistryAdminPage.tsx:57](frontend/src/pages/AttributeRegistryAdminPage.tsx#L57) | reads `"department_registry"` | admins cannot select the department registry as an enum source |
| Prompt Templates Admin | page | [PromptTemplatesAdminPage.tsx:66, 104, 166, 191, 299, 438](frontend/src/pages/PromptTemplatesAdminPage.tsx#L191) | reads/writes `match_department`; docs a `department` placeholder | department-scoped templates uneditable |
| Department Registry Admin page | page | [DepartmentRegistryAdminPage.tsx](frontend/src/pages/DepartmentRegistryAdminPage.tsx) (whole file) | full CRUD | page dies |
| api.ts — `ProductDetail.department_key` / `.department` | api.ts | [api.ts:94-100](frontend/src/lib/api.ts#L94-L100) | type contract | type error (loud) |
| api.ts — `fetchDepartmentRegistry` | api.ts | [api.ts:2139-2152](frontend/src/lib/api.ts#L2139-L2152) | reads `GET /api/v1/department-registry` | every registry dropdown above empties |
| api.ts — department registry CRUD ×4 | api.ts | [api.ts:3037-3083](frontend/src/lib/api.ts#L3037-L3083) | POST/PUT/DELETE | admin page CRUD dies |
| api.ts — report/list type contracts | api.ts | api.ts:[453](frontend/src/lib/api.ts#L453), [1063](frontend/src/lib/api.ts#L1063), [1093](frontend/src/lib/api.ts#L1093), [2407](frontend/src/lib/api.ts#L2407), [2435](frontend/src/lib/api.ts#L2435), [2451](frontend/src/lib/api.ts#L2451), [2483](frontend/src/lib/api.ts#L2483), [2541](frontend/src/lib/api.ts#L2541), [2553](frontend/src/lib/api.ts#L2553) | type contracts | type errors (loud) |
| App.tsx route | page | [App.tsx:191](frontend/src/App.tsx#L191) | `/admin/registries/departments` | route 404s |
| Sidebar nav entry | component | [Sidebar.tsx:89](frontend/src/components/Sidebar.tsx#L89) | nav link | dead nav link |
| Registries pillar card | page | [RegistriesPillarPage.tsx:8](frontend/src/pages/RegistriesPillarPage.tsx#L8) | nav link | dead card |

### Scripts (seed / migration / diagnostic)

Full list, by reference count (`grep -rn department scripts/`). Files marked **live-relevant** write or read production-shaped data.

| Script | file | Refs | Role |
|---|---|---|---|
| `tally-144-2c-department-attribute-values-backfill.js` | scripts/ | 69 | **live-relevant** — backfilled `attribute_values/department_key`, quarantined legacy |
| `tally-144-2f-soft-retire-department-registry.js` | scripts/ | 43 | **live-relevant** — soft-retired legacy registry doc |
| `tally-product-list-ux-p05-test-backfill.js` | scripts/ | 26 | test fixture backfill |
| `seed/seed-department-registry.js` | scripts/seed/ | 24 | **live-relevant, script of record** — seeds `department_registry`, patches `attribute_registry/department` enum_source |
| `tally-144-2c0-seed-department-key-registry.js` | scripts/ | 21 | **live-relevant** — seeded `attribute_registry/department_key` |
| `migrate-user-portfolio-fields.ts` | scripts/ | 20 | `departments` → `portfolio_depts` |
| `migrate-smart-rules-to-key-fields.ts` | scripts/ | 15 | `department` → `department_key` in smart rules |
| `_frink-archaeology1.js` | scripts/ | 15 | diagnostic |
| `seed/seed-taxonomy-rules.js` | scripts/seed/ | 13 | **live-relevant** — seeds the 20 taxonomy smart rules that target `department_key` |
| `tally-144-2b-taxonomy-smart-rule-migration.js` | scripts/ | 11 | **live-relevant** |
| `seed-team-users.js` | scripts/ | 11 | seeds `portfolio_depts` |
| `seed-team-cadence-rules.js` | scripts/ | 11 | **live-relevant** — seeds the `department_key` target_filters |
| `seed/tally-168-department-canonical-unlock.js` | scripts/seed/ | 10 | **live-relevant** — `department_key.is_editable=true`, `department.active=false` |
| `seed/seed-prompt-templates.js` | scripts/seed/ | 10 | seeds `match_department` |
| `migrate-portfolio-gender-and-cleanup.ts` | scripts/ | 9 | portfolio migration |
| `seed/backfill-rics-taxonomy.js` | scripts/seed/ | 8 | **live-relevant** |
| `lib/tally163-taxonomy.js` | scripts/lib/ | 8 | shared taxonomy helper |
| `seed-dimension-rules.js` | scripts/ | 7 | **live-relevant** — seeds `dim_*` smart rules with `department_key` conditions |
| `migrate-cadence-rules-to-key-fields.ts` | scripts/ | 7 | `department` → `department_key` in cadence rules |
| `tally-product-editor-registry-dropdowns-attribute-registry-seed.js` | scripts/ | 6 | registry seed |
| `seed/tally-168-restore-department-editability.js` | scripts/seed/ | 6 | **live-relevant** |
| `seed/backfill-attribute-values-from-product.js` | scripts/seed/ | 6 | **live-relevant** |
| `a4-q6-diagnostic.js` | scripts/ | 6 | diagnostic |
| `test-tally118-final.js` | scripts/ | 4 | test |
| `seed/seed-attribute-registry.js` | scripts/seed/ | 4 | **live-relevant** |
| `d3d-fixture-inject.ts` | scripts/ | 4 | fixture |
| `test-step17.js`, `step31-verify.js`, `step22-verify.js`, `seed/backfill-search-tokens.js`, `d3c-cadence-cleanup.ts` | scripts/ | 3 each | verify / backfill |
| `tally-product-list-ux-phase-4b-enum-source.js`, `dump-executive-samples.js` | scripts/ | 2 each | seed / diagnostic |
| `test-step18.js`, `step21-verify.js`, `seed/seed-smart-rules.js`, `seed/seed-display-groups.js`, `seed/seed-admin-settings.js`, `d3e-signal-augment.ts`, `acceptance-smart-rules-admin.js`, `a4-audit-emission-verify.js`, `_tmp-frink-arch3-probe.js` | scripts/ | 1 each | assorted |

**Total: 42 scripts reference department / department_key.**

### Composite indexes — `firebase/firestore.indexes.json`

108 indexes total; **22** reference a department field.

`department` (**display**) — 2, both on `products`:
- [#37 firestore.indexes.json:364-370](firebase/firestore.indexes.json#L364) `department + first_received_at`
- [#38 firestore.indexes.json:373-380](firebase/firestore.indexes.json#L373) `completion_state + department + first_received_at`

`department_key` — 20, all on `products`:
`#38c` (:402), `#38d` (:411), `#43` (:459), `#45` (:479), `#46` (:490), `#48` (:510), `#50` (:530), `#52` (:551), `#54` (:571), `#56` (:591), `#60` (:630), `#61` (:639), `#68` (:703), `#69` (:712), `#82` (:836), `#84` (:856), `#86` (:876), `#88` (:897), `#90` (:917), `#92` (:937).

**[FINDING] Indexes #37 and #38 are UNREFERENCED.** No query in the codebase filters or orders on root `department` — every `where()` uses `department_key` (products.ts:208/243/366/545/608). Rename/removal of `department` is index-safe; these two are dead index cost today.

### Security rules — `firebase/firestore.rules`

**NONE.** The file is 30 lines: `users/{uid}` (read: owner or admin, write: owner) at :20-23, then a catch-all `match /{document=**} { allow read, write: if false; }` at :26-28. No `products`, no `department_registry`, no field-level rule anywhere. Renaming `department` / `department_key` has **zero** rules impact.

---

## Live Firestore (`ropi-aoss-dev`, reads only)

**`products` — 81 docs total.** Non-empty = not null, not `""`, not `[]`, not whitespace-only.

| Field | Docs carrying | Docs non-empty |
|---|---|---|
| root `department` | 76 | 76 |
| root `department_key` | 76 | 76 |
| `attribute_values/department_key` | 76 | 76 |
| `attribute_values/department` (legacy) | **25** | 25 — **all 25 have `quarantined: true`** |

Value histograms:
- root `department`: `{"Footwear":39, "Clothing":32, "Accessories":5}`
- root `department_key`: `{"footwear":39, "clothing":32, "accessories":5}`
- `attribute_values/department_key`: `{"footwear":39, "clothing":32, "accessories":5}`
- `attribute_values/department` (legacy): `{"Clothing":11, "Footwear":11, "Accessories":3}`

Consistency: root `department` vs root `department_key` disagree (case-insensitively) on **0** of 76. `attribute_values/department_key` vs root `department_key` disagree on **0**. `attribute_values/department` (legacy) vs `attribute_values/department_key` disagree on **1**: `120029-CHRMWHTNVY` — legacy `"Accessories"`, canonical `"footwear"`.

The 5 products with no department anywhere are all D3 smoke fixtures: `D3SMOKE-ALLZERO-1777944544180`, `D3SMOKE-DISPAR-1777944544180`, `D3SMOKE-NORMAL1-1777944544180`, `D3SMOKE-NORMAL2-1777944544180`, `D3SMOKE-NORMAL3-1777944544180`.

**`department_registry` — 5 docs, all `is_active: true`.**

| doc id | key | display_name | priority | aliases | po_confirmed |
|---|---|---|---|---|---|
| accessories | accessories | Accessories | 3 | `["Accessory","ACCESSORIES"]` | true |
| beauty | beauty | Beauty | 9 | `[]` | **false** |
| clothing | clothing | Clothing | 2 | `["CLOTHING","Apparel"]` | true |
| footwear | footwear | Footwear | 1 | `["Shoes","FOOTWEAR"]` | true |
| home_and_tech | home_and_tech | Home & Tech | 4 | `["Home and Tech","HOME & TECH"]` | true |

`beauty` and `home_and_tech` are active but carry **0 products**.

**`attribute_registry` — 2 department docs:**

| doc id | field_key | active | is_editable | field_type | enum_source | dropdown_options | destination_tab | display_label | required_for_completion |
|---|---|---|---|---|---|---|---|---|---|
| `department` | **undefined** | **false** | true | dropdown | department_registry | `["Footwear","Clothing","Accessories","Home & Tech"]` | core_information | Department | **true** |
| `department_key` | department_key | true | true | dropdown | department_registry | `[]` | core_information | Department | **true** |

Note both carry `required_for_completion: true` and the same `display_label` "Department" on the same `destination_tab` — a duplicate-label pair masked only by `active: false` (carried to Task G7). The legacy doc still lists **stale** `dropdown_options` that omit the active `Beauty` department.

**`cadence_rules` — 14 docs; 12 have a `department_key` target filter** (Task E3 answered in full):

| doc id | name | enabled | department filter |
|---|---|---|---|
| `1a1a6ef7-f613-4e27-b641-20961605b071` | Alana — MLTD Clothing 45-Day Zero Sales | true | `department_key equals clothing` (cs=false) + `site_owner equals mltd` |
| `20c227f0-184f-4415-b120-9032ea473beb` | Heather — Women's Clothing 45-Day Zero Sales | true | `department_key equals clothing` (cs=true) + `gender equals Womens` |
| `2821a4b5-e09b-4f86-8a7c-e53e85e34273` | Alex — Boys' Footwear 45-Day Zero Sales (TEST CHANGE) | **false** | `department_key equals footwear` (cs=false) |
| `477c3199-860b-4235-a9e2-3a2cba37656b` | Alana — MLTD Accessories 45-Day Zero Sales | true | `department_key equals accessories` (cs=true) + `site_owner equals mltd` |
| `4e624c84-5997-4adf-9cbb-cdc72790c31e` | Heather — Women's Footwear 45-Day Zero Sales | true | `department_key equals footwear` (cs=true) + `gender equals Womens` |
| `6fe5bd2d-3605-4892-985f-fa7c9aa92134` | Richard — Men's Clothing 45-Day Zero Sales | true | `department_key equals clothing` (cs=true) + `gender equals Mens` |
| `9a10e6d6-a53a-4906-8311-5d3797ec50cb` | Heather — Girls' Footwear 45-Day Zero Sales | true | `department_key equals footwear` (cs=true) + `gender equals Girls` |
| `a048c266-67e1-4bec-a434-b4efef2963d6` | Alex — Men's Footwear 45-Day Zero Sales | **false** | `department_key equals footwear` (cs=false) + `gender equals Mens` |
| `abc26100-aed0-4fe0-8730-c8f27efe7039` | Alana — MLTD Footwear 45-Day Zero Sales | true | `department_key equals footwear` (cs=true) + `site_owner equals mltd` |
| `f33237bb-e3bd-4931-8268-7faf9b5ec9ef` | Alex — Toddler Footwear 45-Day Zero Sales | true | `department_key equals footwear` (cs=false) + `gender equals Toddler` |
| `f63c1d49-f137-474a-a8b8-17b007e7ab84` | Mike — Accessories 45-Day Zero Sales | true | `department_key equals accessories` (cs=true) |
| `jsakAzUhKLHBW8paTSRU` | Alex — Men's Footwear 45-Day Zero Sales | true | `department_key equals footwear` (cs=true) + `gender equals Mens` |
| `oBHN3Xm85fSfNGM7tmh5` | test | **false** | `department_key contains footwear` (cs=true) |
| `FcOgd2O6b9fgv2O2ego4` | Nike | **false** | none (brand_key only) |

**No live cadence rule filters on `department_key equals Clothing` with a capital C.** Appendix B's "known rule filters on `department_key equals Clothing`" is **NOT CONFIRMED as written** — every live value is lowercase. Carried to Task C.

**`smart_rules` — 35 docs; 20 write `department_key`** as an action `target_field`: the 15 `Taxonomy: *` rules (`00fed715`, `0d13b325`, `17454719`, `181bb571`, `1aa7d070`, `27553bf2`, `71ac578f`, `9faca916`, `a0873bdc`, `c697d7bc`, `c8356222`, `e3da1f19`, `eb442c1f`) plus `dim_clothing_weight`, `dim_footwear_kids_dimensions`, `dim_footwear_unisex_dimensions`, `dim_footwear_womens_dimensions` — those last four **read** `department_key` as a condition field rather than writing it. Precisely: **13 rules write `target_field: "department_key"`; 4 rules use `department_key` as a condition field.**

**One live smart rule still uses the blocked legacy field:** `rule_acceptance_test_delete_me_mo2i4fkj` ("ACCEPTANCE TEST — delete me", `enabled: false`) has `conditions: [{field:"department", operator:"equals", value:"Footwear", case_sensitive:true}]`. The validator at `ruleFieldValidation.ts:20` would now reject this on save, but the stored doc predates it.

**`metric_snapshots` with `dimension_type == "department"` — 84 docs.** `dimension` histogram: `{"Footwear":22, "Unknown":22, "Clothing":16, "Accessories":16, "FOOTWEAR":8}`. Display-cased, with a `FOOTWEAR` casing variant and 22 `Unknown`.

**`operator_throughput` — 441 docs.** `department` histogram: `{"Unknown":432, "Clothing":5, "Footwear":3, "FOOTWEAR":1}`.

**`users` — 14 docs.** `portfolio_depts` (key form): 5 users have values (`["footwear"]` ×3, `["footwear","clothing","accessories"]`, `["clothing","accessories"]`), 5 have `[]`, 4 have `null`. **No user has `portfolio_exclusions.department` set** (field absent on all 14).

---

## Defects found during B1 (each carries to the findings log)

**DEFECT B1-1 — Department edits leave `search_tokens` stale.**
`products.ts:1345-1352` gates the search-token reindex on `SEARCH_TOKEN_FIELDS`, which contains `"department"` but **not `"department_key"`**. Since TALLY-144-2F the live editor path saves `field_key: "department_key"` (QuickEditPanel.tsx:234), so the reindex never fires on a Department edit, even though the same handler updates root `department` at :1192. Live instance: `120029-CHRMWHTNVY` has root `department: "Footwear"` but its `search_tokens` array contains no `footwear` token — 75 of 76 department-bearing products have the token, that one does not. Searching "footwear" will not return it.

**DEFECT B1-2 — Import builds search tokens from the raw CSV department, not the canonicalized one.**
`importFullProduct.ts:664` passes `department: mapped.attributes.department` (raw CSV) while the root doc is written from `mapped.top_level.department` (canonicalized display, line 631). An alias-matched import (CSV `"Shoes"` → canonical `"Footwear"`) stamps `search_tokens` from `"Shoes"` and the root field from `"Footwear"` — search and display disagree. Latent on current data because no live product came in via an alias.

**DEFECT B1-3 — `operator_throughput.department` and `.operator_uid` are always the fallback values.**
`completionCompute.ts:368-372` reads `opts?.context?.productData?.department`, `opts?.context?.uid`, `opts?.context?.displayName`. **No caller anywhere passes the `opts` argument** — all seven call sites (`aiContent.ts:207`, `importWeeklyOperations.ts:489`, `importFullProduct.ts:947`, `siteVerificationReview.ts:246/:328/:418`, `products.ts:1403`, `onAttributeRegistryWrite.ts:58`) invoke `stampCompletionOnProduct(ref, result)` with two arguments. Live confirmation: 432 of 441 `operator_throughput` docs have `department: "Unknown"` and `operator_uid: "system"`. The Executive throughput-by-operator report (`executive.ts:83-98`) and the Completion Queue leaderboard (`queueStats.ts:47-60`) are therefore reporting almost entirely on a synthetic `"system"` operator with `"Unknown"` department.

**DEFECT B1-4 — The RetailOps export emits the quarantined legacy department.**
`exportSerializer.ts:232` reads `attrs["department"]`, where `attrs` (built at :163-167) is the raw `attribute_values` subcollection with **no `quarantined` filter** — unlike the product-detail path, which does filter (`products.ts:764`). Live consequence on `ropi-aoss-dev`: only 25 of 81 products carry that doc, so the `department` column in the RetailOps CSV is **blank for 56 products**, and for `120029-CHRMWHTNVY` it emits `"Accessories"` when the canonical value is `footwear`. The parallel bulk-export path in `products.ts:632-644` was migrated to `department_key`; this one was not.

**DEFECT B1-5 — AI Describe reads the quarantined legacy department.**
`aiDescribe.ts:179` (template selection) and `:192` (prompt context) both read `attrs["department"]`. Same 25-of-81 coverage. Department-scoped prompt templates (`templateMatcher.ts:105`, which compares `match_department` against this value) therefore fail to match for 56 of 81 products and fall through to the generic template with no error.

**DEFECT B1-6 — Smart rules cannot reach root `department_key`.**
`smartRules.ts:252` writes **only** `products/{mpn}/attribute_values/{target_field}`; the sole root-document write in the whole engine is the hardcoded `name: ""` blanking at `:367` for `rule_uuid_name_cleanup`. The 13 live taxonomy rules with `target_field: "department_key"` therefore update the attribute doc but never root `department_key` or root `department`. Nothing mirrors attribute → root outside the interactive `PUT` handler (`products.ts:1183-1197`). Today this is masked because `importFullProduct.ts:636` writes root from the CSV *before* smart rules fire at `:898` — but any product whose department is determined by a taxonomy rule rather than the CSV column gets an attribute value with no root mirror, and is then invisible to the list filter, the cadence engine, every index, and search. (Also answers **E1**.)

**DEFECT B1-7 — The Completion Queue Department filter is a free-text box matched against a key.**
`CompletionQueuePage.tsx:297-303` renders `placeholder="Department…"` as a plain `<input type="text">` and sends its raw contents as `?department=` (`:95`). The backend matches that string against `department_key` with strict equality (`products.ts:208`). An operator typing the label they see everywhere else — `Footwear` — gets **zero results**, silently; only the lowercase key `footwear` works. The Product List solved this with a registry-backed `<select>` (`ProductListPage.tsx:578-607`); the Completion Queue was not migrated. The adjacent Brand filter (`:290-295`) has the identical defect against `brand_key`.

**DEFECT B1-8 — Report joins are keyed on display strings with silent `??` fallbacks.**
`buyerPerformanceMatrix.ts:97-103` defines `gmTargets` as a hardcoded map keyed by display value (`Footwear`/`Clothing`/`Accessories`/`Home & Tech`), looked up at `:259` and `:317` with `?? 40`, and `catalogStrByDept` is looked up at `:260`/`:309` with `?? 0`. Live `metric_snapshots.dimension` contains a `FOOTWEAR` casing variant (8 docs) and `Unknown` (22 docs), neither of which joins. The active `Beauty` department has no `gmTargets` entry at all. Every miss is silent — a buyer's `str_vs_catalog` reads as a full surplus and the GM target silently becomes 40.

---

## Totals

- **Total consumers found: 96** — 36 backend routes · 24 backend services/libs · 1 Cloud Function · 26 frontend pages/components/api.ts · (42 scripts counted separately) · 22 indexes · 0 rules.
- **Scripts referencing the field: 42.**
- **Live Firestore:** `products` 81 docs — root `department` 76 carrying / 76 non-empty; root `department_key` 76 / 76; `attribute_values/department_key` 76 / 76; `attribute_values/department` 25 / 25 (all quarantined). `department_registry` 5 docs, all active. `attribute_registry` 2 department docs (1 active).
- **Indexes referencing it: 22** (2 on `department` — both unreferenced by any query; 20 on `department_key`).
- **Security rules referencing it: 0** (`firestore.rules` has no rule for `products` at all; everything but `users/{uid}` falls to deny-all).
