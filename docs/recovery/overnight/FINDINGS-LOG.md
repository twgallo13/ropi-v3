# FINDINGS LOG — Overnight Gate 2 Audit (append-only)

Tags: `[FINDING]` `[RECOMMENDATION]` `[CONCERN]` `[BLOCKER]`

---

## §1 / §2 — Setup

**[BLOCKER] SETUP-1 — `docs/recovery/RECOVERY-ANCHOR.md` does not exist.**
Evidence: `find docs -type f` returns exactly two files: `docs/scheduled-jobs.md` and `docs/recovery/overnight/OVERNIGHT-AUDIT.md`. `git ls-files docs/` confirms the same two are the only tracked files under `docs/`.
Impact: §1 required reading is unavailable, and **Task C** ("verify every specific-value claim in Appendix B *and in `docs/recovery/RECOVERY-ANCHOR.md`*") loses one of its two inputs. Per §1, proceeding from Appendix B alone. Task C will cover Appendix B only; the anchor half is recorded as NOT FOUND rather than skipped silently.

**[BLOCKER] SETUP-2 — `docs/recovery/PRE-BUILD-PROTOCOL.md` does not exist.**
Evidence: same commands as SETUP-1.
Impact: the Gate 2 definition of a blast-radius map is unavailable from the repo. Task A instead uses the template given verbatim in §3 TASK A of this audit file, which is self-contained.

**[FINDING] SETUP-3 — No test runner is wired up anywhere in the repo.**
Evidence: `backend/functions/package.json:8-14` — scripts are `build`, `build:watch`, `start`, `dev`, `lint`; **no `test`**. `scripts/package.json:7-9` has one migrate script. `scripts/seed/package.json:6-14` has seed scripts only. No root `package.json` exists. `.github/` contains only three agent markdown files — **no CI workflow**.
Impact: the five `*.test.ts` files are only ever run by hand, per the instructions in `backend/functions/src/services/completionCompute.test.ts:6-7`. Nothing runs them on push or PR.

**[FINDING] SETUP-4 — Test harnesses exit 0 even when assertions fail.**
Evidence: `node lib/services/completionCompute.test.js` prints `Results: 30 passed, 4 failed` and `EXIT=0`.
Impact: if these were wired into CI as-is, a failing suite would report green. Relevant to Task N.

**[FINDING] SETUP-5 — `frontend/node_modules` was absent; frontend build cannot run from a clean checkout without `npm install`.**
Evidence: `ls frontend/node_modules | wc -l` → `0`; `npm run build` → `sh: 1: tsc: not found`, exit 127. After `npm install`, build passes.
Impact: baseline only; not a code defect. Recorded because §2 requires the build result and the first attempt failed.

**[FINDING] SETUP-6 — `docs/recovery/OVERNIGHT-AUDIT.md` (the path named throughout this audit file, incl. §6 and the kickoff message) does not exist; the file lives at `docs/recovery/overnight/OVERNIGHT-AUDIT.md`.**
Evidence: `git ls-files docs/` → `docs/recovery/overnight/OVERNIGHT-AUDIT.md`.
Impact: cosmetic path drift in the audit brief itself. Also note §2 says "DO NOT COMMIT anything under `docs/recovery/overnight/`" while the audit file itself is already committed there (`git status` is clean with the file present).

**[FINDING] SETUP-7 — Live Firestore (`ropi-aoss-dev`) holds 35 collections. Four collection names named in Task I6 do not exist live.**
Evidence: `db.listCollections()` on `ropi-aoss-dev` returns: `_meta, admin_settings, ai_provider_registry, ai_workflow_routing, attribute_registry, audit_log, brand_registry, buyer_actions, buyer_performance, cadence_assignments, cadence_rules, department_registry, executive_projections, export_jobs, guided_tours, import_batches, launch_comments, launch_records, launch_subscribers, map_import_templates, map_policies, metric_snapshots, notifications, operator_throughput, pricing_export_jobs, pricing_export_queue, products, prompt_templates, sales_snapshots, site_registry, smart_rules, sop_panels, system_config, users, weekly_advisory_reports`.
Absent live: `orders`, `payments`, `sessions`, `auditLogs` (the live name is `audit_log`). Carried into Task I6 and Task E6.
Note: `listCollections()` returns only collections with at least one document; an empty collection is indistinguishable from a non-existent one.

---

## TASK B1 — `department` / `department_key`

**[FINDING] B1-1 — Department edits leave `search_tokens` stale (live instance confirmed).**
`backend/functions/src/routes/products.ts:1345-1352` — `SEARCH_TOKEN_FIELDS` contains `"department"` but not `"department_key"`. The live editor path saves `field_key: "department_key"` (`frontend/src/components/QuickEditPanel.tsx:234`), so the reindex at `:1353-1372` never fires, even though the same handler updates root `department` at `:1192`.
Live: 75 of 76 department-bearing products carry their department token; `120029-CHRMWHTNVY` has root `department: "Footwear"` and no `footwear` token. It cannot be found by searching its department.
Who would never know: the operator — search just returns nothing.

**[FINDING] B1-2 — Import builds `search_tokens` from the raw CSV department, not the canonicalized one.**
`backend/functions/src/routes/importFullProduct.ts:664` passes `mapped.attributes.department` (raw CSV) while root is written from `mapped.top_level.department` (canonicalized, `:631`). An alias-matched import (CSV `"Shoes"` → canonical `"Footwear"`) would index the wrong string. Latent on current data — no live product arrived via an alias.

**[CONCERN] B1-3 — `operator_throughput` is 98% synthetic; two reports are built on it.**
`backend/functions/src/services/completionCompute.ts:368-372` reads `opts?.context?.{uid,displayName,productData.department}`. **No call site passes `opts`** — all seven call `stampCompletionOnProduct(ref, result)` with two args: `routes/aiContent.ts:207`, `routes/importWeeklyOperations.ts:489`, `routes/importFullProduct.ts:947`, `routes/siteVerificationReview.ts:246`/`:328`/`:418`, `routes/products.ts:1403`, `functions/onAttributeRegistryWrite.ts:58`.
Live: 432 of 441 `operator_throughput` docs have `operator_uid: "system"` and `department: "Unknown"`. Consumers: Executive throughput-by-operator (`routes/executive.ts:83-98`) and the Completion Queue leaderboard (`routes/queueStats.ts:47-60`).
Who would never know: everyone — the reports render a plausible-looking single "system" operator.

**[FINDING] B1-4 — The RetailOps export CSV emits the quarantined legacy department.**
`backend/functions/src/services/exportSerializer.ts:232` reads `attrs["department"]`; `attrs` is built at `:163-167` from the raw `attribute_values` subcollection with **no `quarantined` filter** (contrast `routes/products.ts:764`, which does filter).
Live: only 25 of 81 products carry `attribute_values/department`, and all 25 are `quarantined: true`. The `department` column is blank for 56 products, and emits `"Accessories"` for `120029-CHRMWHTNVY` whose canonical value is `footwear`.
The sibling bulk-export path (`routes/products.ts:632-644`) was migrated to `department_key` under TALLY-144-2F; this one was missed.

**[FINDING] B1-5 — AI Describe reads the same quarantined legacy department.**
`backend/functions/src/services/aiDescribe.ts:179` (template selection) and `:192` (prompt context). Same 25-of-81 coverage. `services/templateMatcher.ts:105` compares `match_department` against this value, so department-scoped prompt templates silently fail to match for 56 of 81 products and fall through to the generic template.

**[FINDING] B1-6 — Smart rules cannot write root `department_key` (also answers E1).**
`backend/functions/src/services/smartRules.ts:252, 272-281` — the engine writes **only** `products/{mpn}/attribute_values/{target_field}`. The one root write in the engine is the hardcoded `name: ""` blanking at `:364-367` for `rule_uuid_name_cleanup`. Target must exist in `attribute_registry` (`:244-249`) or the write is skipped with `console.error` only.
13 live smart rules carry `target_field: "department_key"`. Nothing mirrors `attribute_values` → root outside the interactive PUT handler (`routes/products.ts:1183-1197`). Masked today only because import writes root at `:636` before rules fire at `:898`.

**[FINDING] B1-7 — Completion Queue Brand and Department filters are free-text boxes matched against keys.**
`frontend/src/pages/CompletionQueuePage.tsx:290-303` renders both as plain `<input type="text">` and sends the raw contents as `?brand=` / `?department=` (`:94-95`). The backend does strict equality against `brand_key` / `department_key` (`routes/products.ts:207-208`). Typing the label shown everywhere else — `Footwear` — returns zero results silently; only `footwear` works. The Product List fixed this with a registry-backed `<select>` (`ProductListPage.tsx:578-607`); the Completion Queue was not migrated. Severity: **Blocks work** (carried to Task G).

**[CONCERN] B1-8 — Report joins keyed on display strings with silent `??` fallbacks.**
`backend/functions/src/services/buyerPerformanceMatrix.ts:97-103` hardcodes `gmTargets` keyed by display value, looked up at `:259`/`:317` with `?? 40`; `catalogStrByDept` looked up at `:260`/`:309` with `?? 0`. Live `metric_snapshots.dimension` for `dimension_type=="department"` contains `FOOTWEAR` (8 docs, casing variant) and `Unknown` (22 docs) — neither joins. The active `Beauty` department has no `gmTargets` entry.
Who would never know: buyers — `str_vs_catalog` reads as a full surplus and the GM target silently becomes 40.

**[FINDING] B1-9 — Composite indexes #37 and #38 (root `department`) are UNREFERENCED.**
`firebase/firestore.indexes.json:364-370` and `:373-380`. No query anywhere filters or orders on root `department`; every `where()` uses `department_key` (`routes/products.ts:208, 243, 366, 545, 608`). Dead index cost.

**[FINDING] B1-10 — Appendix B's cadence-rule claim is not confirmed as written.**
Appendix B (B1) states "a known rule filters on `department_key equals Clothing`". Live `cadence_rules`: 12 of 14 rules carry a `department_key` filter, but **every value is lowercase** (`clothing`, `footwear`, `accessories`). No rule uses `Clothing`. Carried to Task C.

**[FINDING] B1-11 — Live rule/data residue.**
`smart_rules/rule_acceptance_test_delete_me_mo2i4fkj` ("ACCEPTANCE TEST — delete me", disabled) still stores the blocked legacy field: `conditions:[{field:"department", value:"Footwear"}]`. `cadence_rules/2821a4b5-…` is named "…(TEST CHANGE)" and `cadence_rules/oBHN3Xm85fSfNGM7tmh5` is named "test". Carried to Task L5.

**[FINDING] B1-12 — Two active `department_registry` entries carry zero products.**
`beauty` (`po_confirmed: false`) and `home_and_tech`. Both appear in every operator-facing Department dropdown. Also: the legacy `attribute_registry/department` doc still stores stale `dropdown_options: ["Footwear","Clothing","Accessories","Home & Tech"]` — omitting the active `Beauty` — although `enum_source` should take precedence.

**[FINDING] B1-13 — `attribute_registry/department` and `/department_key` share `display_label` "Department" on `destination_tab: "core_information"`, and both carry `required_for_completion: true`.**
The duplicate is masked only by `active: false` on the legacy doc plus the `SUPERSEDED_FIELD_KEYS` filter at `routes/attributeRegistry.ts:93`. Two independent guards for one duplicate. Carried to Task G7.

**[FINDING] B1-14 — `firebase/firestore.rules` has no rule for `products` or any registry.**
The whole file is 30 lines: `users/{uid}` at `:20-23`, then deny-all `match /{document=**}` at `:26-28`. All client access to `products`, `attribute_registry`, `department_registry`, `cadence_rules`, `smart_rules`, `audit_log` is denied at the rules layer and mediated solely by the Express API. Carried to Task H3.

---

## TASK B2 — `site_owner` / `website` / `site_registry` / `site_key` / `site_targets`

**[FINDING] B2-1 — Product Detail shows a different Site Owner than the Product List, on 17 of 81 products.**
`backend/functions/src/routes/products.ts:921` builds the detail response's `site_owner` from `site_targets[0].site_id`, and exposes root `site_owner` under a different wire name, `primary_site_key` (`:922`). The list row uses `getSiteOwner()` (`:93-113`, `site_targets`-first with a root fallback), while every **filter** queries root `site_owner` directly (`:209`, `:367`, `:546`), as do `services/cadenceEngine.ts:102` and `lib/portfolioFilter.ts:53`.
Live: 17 of the 62 products with a `site_targets` subcollection have `site_targets[0].site_id != root.site_owner`. Examples: `1005177`, `1005394`, `210193C`, `30865601`, `71002882`, `A17830C`, `BLL150007-BLK`, `FC9297-UNCCLBL`, `GINO-24-PKPV` — all show **karmaloop** on the detail page while root says **shiekh**. `FBRK-CR92024-2CAMO` shows **fbrk**, an inactive site.
"First" is Firestore doc-id order, i.e. alphabetical: `fbrk` < `karmaloop` < `mltd` < `shiekh`. Any multi-site product reports its alphabetically-first site as its owner.
Severity: **Misleads** — the detail screen states a site that no filter, report, or routing rule agrees with.

**[FINDING] B2-2 — `attribute_values/website` has no production reader, and is `required_for_completion: true`.**
Written by `routes/importFullProduct.ts:855`. The only other backend mention of the bare word `website` is a doc comment at `lib/brandRegistry.ts:148`; there are **zero** references in `frontend/src`. Live: 67 of 81 products carry it. Operators are required to fill a field nothing consumes.

**[FINDING] B2-3 — Import writes `site_targets` docs for INACTIVE sites.**
`routes/importFullProduct.ts:240-247` builds `domainToSiteId` from `collection("site_registry").get()` with **no `is_active` filter**, unlike `buildSiteOwnerCanonicalizer` (`lib/registryAuthority.ts:130-132`) which does filter. Live: `site_targets/fbrk` exists on `FBRK-CR92024-2CAMO`; `fbrk` is `is_active: false`. That doc is also the product's alphabetically-first target, so it drives B2-1 for that product.

**[FINDING] B2-4 — `deriveSiteTargetKeys()` / `buildActiveRegistryView()` are dead code with 17 tests protecting them.**
`backend/functions/src/lib/brandRegistry.ts:98-184`. Only callers anywhere: `lib/brandRegistry.test.ts:108-132`. The documented input (`product.attribute_values.website`) is never passed in production. 17 of the 33 assertions in that suite protect unused behaviour. Carried to Task I5 and N2.

**[FINDING] B2-5 — `mark-live` and `flag` write arbitrary `site_verification` map keys with no registry FK check.**
`routes/siteVerificationReview.ts:209-233` and `:274-297` validate only that `site_key` is truthy, then write `site_verification[site_key]` with `merge: true` onto the product root. Only `reverify` checks the registry (`:363-368`). Orphan keys are permanent and surface solely as `console.warn` at `:107-109`. No cleanup path exists in the repo.

**[FINDING] B2-6 — New-site coverage warning goes to `console.log` only.**
`routes/siteRegistry.ts:128` — `[TALLY-079] New site_key added … Review prompt_templates.match_site_owner for coverage.` No admin surface, no notification, no `audit_log` entry for the warning. Carried to Task M3/M4.

**[FINDING] B2-7 — The `website` attribute's dropdown is a hardcoded list including 4 inactive sites.**
Live `attribute_registry/website`: `enum_source: undefined`, `dropdown_source: undefined`, `dropdown_options: ["fbrkclothing.com","karmaloop.com","mltd.com","plndr.com","shiekh.com","shiekhshoes.com","trendswap.com"]`. Four of those seven sites are `is_active: false` in `site_registry` (`fbrk`, `plndr`, `shiekhshoes`, `trendswap`). `attribute_registry/site_owner` on the same tab is correctly registry-driven. Carried to Task G3/G11 and K2.

**[FINDING] B2-8 — `field_key` is `undefined` on the live `site_owner` and `website` registry docs (answers P2-1b's "?" marker).**
Same shape as the legacy `attribute_registry/department` doc. Smart-rule targeting resolves against registry **doc ids** (`services/smartRules.ts:244`), so doc_id is the operative key today and `field_key` is populated inconsistently across the registry.

**[FINDING] B2-9 — Test-fixture residue with invalid site values.**
The 5 `D3SMOKE-*` products carry `attribute_values/site_owner = "TRUE"` and `attribute_values/website = "true"`, with root `site_owner` empty. Neither value exists in `site_registry`. Carried to Task L5.

**[FINDING] B2-10 — E8 answered: AI Describe takes the site entirely from the request body, unvalidated.**
`routes/aiContent.ts:25` destructures `site_owners` from `req.body`; `:34-36` maps each straight into `generateContent(workflow_key, mpn, siteOwner, …)`. `services/aiDescribe.ts:147` receives it as a parameter and never reads the product's `website` attribute or root `site_owner`. The only check is `Array.isArray(site_owners) && length > 0` at `:27` — no registry membership check, no active check, no check that the site is one of the product's own. Regenerate (`:418`) reuses the prior version's stored value.

**[FINDING] B2-11 — The two export paths disagree about what "the product's site" is.**
RetailOps export (`services/exportSerializer.ts:191-195, :96, :124`) emits a `site_targets` column built from each subcollection doc's **`domain`**, and emits **no** `site_owner` column. The bulk product CSV (`routes/products.ts:426`) emits a `site_owner` column resolved via `getSiteOwner()` — `site_targets`-first. Neither emits `website`. Live: 19 of 81 products have no `site_targets` subcollection at all, so their RetailOps `site_targets` column is empty.

**[FINDING] B2-12 — Brand defaults override the CSV for every registered brand.**
`routes/importFullProduct.ts:481-482` — `brandDefaultSiteOwner ?? siteMatch?.key ?? ""`. Live: all 42 `brand_registry` docs have a non-null `default_site_owner` (`{shiekh: 35, karmaloop: 4, mltd: 3}`), so the CSV Website column never determines root `site_owner` for a registered brand. This also explains why no product has root `site_owner == "mltd"` while 11 `site_targets` docs point at `mltd`.

**[FINDING] B2-13 — P2-2's "?" marker answered: site verification keys on `site_key` and must stay.**
`products/{id}.site_verification` is a **root map field** whose keys are `site_registry` doc ids. Written at `routes/siteVerificationReview.ts:223`, `:288`, `:395`; read at `routes/products.ts:816-818` and `routes/reviewActiveOverrides.ts:126-129`. These persisted map keys carry reviewer identity and timestamps; renaming `site_key` orphans them with no migration path in the repo (the sole precedent, `scripts/tally-125-b2b-site-verification-desuffix.js`, was a one-off).

**[FINDING] B2-14 — Index inventory for the site family.**
`site_owner`: **21** of 108 indexes — 20 on `products`, 1 on `content_versions` (`site_owner ASC + generated_at DESC`, serving `routes/aiContent.ts:71`). `website`, `site_key`, `site_targets`, `site_verification`: **0 each**. Verified by parsing `firebase/firestore.indexes.json` and matching exact `fieldPath` values across all 108 entries.

---

## TASK B3 — `brand` / `brand_key`

**[FINDING] B3-1 — The Smart Rule Builder offers `brand_key` as an action target, but no such registry doc exists; those rules silently never fire.**
`frontend/src/pages/SmartRuleBuilderPage.tsx:186-189` injects `{field_key: "brand_key", display_label: "Brand"}` into both `conditionFieldOptions` (`:191-198`) and `actionFieldOptions` (`:200-207`), with a registry-backed value dropdown at `:309-323`. At runtime `backend/functions/src/services/smartRules.ts:338`/`:443` builds `registryKeys` from `attribute_registry` **doc ids**, and `:244-249` skips any target not in that set with `console.error` only.
Live: `attribute_registry/brand_key` **does not exist**. (`attribute_registry/department_key` does — seeded by TALLY-144-2C.0, which is why the department equivalent works.)
Who would never know: the admin — the rule saves, validates, displays correctly, and writes nothing forever.

**[FINDING] B3-2 — Two `brand_registry` docs share `display_name: "Jordan"`.**
`brand_registry/jordan` (`is_active: true`) and `brand_registry/brand_jordan` (`is_active: false`). `lib/brandRegistry.ts:39-63` filters to active so matching is deterministic today, but `listBrandRegistry` (`:190-206`) returns both, so the Brand Registry admin table shows two identical "Jordan" rows distinguishable only by the `brand_key` column. Carried to Task L4.

**[FINDING] B3-3 — One `brand_registry` doc has id ≠ `brand_key`, and two libs key the same collection differently — buyer portfolios are validated against the wrong key set.**
`brand_registry/"field grade"` (doc id contains a **space**) has `brand_key: "field_grade"`.
`lib/brandRegistry.ts:49-52` keys its Map by `brand_key`. `lib/registryAuthority.ts:32` builds `brand: new Set(brandSnap.docs.map(d => d.id))` — by **doc id**. Not the same set.
`routes/adminUsers.ts:88` validates `portfolio_brands` against the doc-id set; `frontend/src/components/admin/UserPortfolioEditor.tsx:82` submits `brand_key` values. So a portfolio containing `field_grade` is **rejected as invalid**, while `field grade` would be accepted and never match a product (products carry `brand_key: "field_grade"`).
The TALLY-149 comment at `lib/registryAuthority.ts:74-77` documents this exact hazard and parameterizes the canonicalizer for it — but `loadRegistryAuthority` was not fixed.

**[FINDING] B3-4 — 8 products carry a root `brand` with no `brand_key`, and are invisible to every key-based consumer.**
Live: root `brand` non-empty on 76; root `brand_key` non-empty on **68**. The 8 are the four orphan brands: `INDIVIDUALIST` (5 products), `FISLL` (1), `Rebel Minds` (1), `FIRST ROW` (1) — none is in `brand_registry`.
`routes/importFullProduct.ts:343-344` sets `identity.brand = rawBrand` but `identity.brand_key = ""` on no match; the only signals are a `console.warn` at `:341` and the batch-summary orphan list at `:1105`.
Consequence: those 8 cannot be found by the Product List Brand filter (`routes/products.ts:207`), are absent from every `brand_key` index, fail `evaluateFilter` in `services/cadenceEngine.ts:220-222` (empty → `false` → `no_rule_match`), and never match a buyer's `portfolio_brands`.

**[FINDING] B3-5 — MAP import stamps an uncanonicalized brand onto products.**
`routes/mapImport.ts:353-354` takes the mapped CSV column raw, carries it through `:381`, `:433-441`, `:480`, and stamps `map_brand` at `:526`. No `matchBrand`, no registry check, no orphan tracking — unlike Full Product Import (`routes/importFullProduct.ts:334-344`). `frontend/src/pages/ImportHubPage.tsx:439` makes the brand column **required**, so every MAP import writes free text.

**[FINDING] B3-6 — Launch records take a free-text brand that is published publicly.**
`frontend/src/pages/LaunchAdminListPage.tsx:267-268` is a plain `<input>`; `routes/launches.ts:391` stores `body.brand` unvalidated (allowlisted at `:51`, `:373`, `:468`). Rendered on the public calendar (`PublicLaunchCalendarPage.tsx:132`) and in notification emails (`services/launchNotifier.ts:108`). Nothing links it to `brand_registry`.

**[FINDING] B3-7 — Brand- and department-scoped prompt templates match on exact display-string equality.**
`services/templateMatcher.ts:109` — `if (template.match_brand && template.match_brand !== product.brand) return false;` No trim, no case fold, no registry resolution, unlike every other brand comparison in the codebase (all of which go through `normalizeBrand`). Same at `:133` (scoring) and `:105`/`:131` for `match_department`. A template authored as `"nike"` or `" Nike"` silently never matches and falls through to the generic template.

**[FINDING] B3-8 — Brand round-trips through a display-valued attribute doc written by two writers in two value forms.**
Live `attribute_values/brand`: 81 docs holding **display** strings (`"Nike"`, `"Mitchell & Ness"`), **none quarantined** — unlike the department equivalent, which is fully quarantined.
Import writes display (`routes/importFullProduct.ts:829`). Quick Edit reads that display value, alias-walks it to a key (`QuickEditPanel.tsx:161` → `lib/registryAliases.ts:13-24`), and saves under `field_key: "brand"` (`:234` rewrites only `department`) with a **key-form** value, which `routes/products.ts:1165-1173` accepts and writes back. The doc's value form flips from display to key on every edit.
`lib/registryAliases.ts:23` masks this by matching key OR display OR alias — and on total failure returns the display string **as if it were a key**.

**[FINDING] B3-9 — `attribute_registry/brand` is `field_type: "text"` with `dropdown_source: "brand_registry"`.**
`AttributeField.tsx:154-176` resolves registry options first and forces `effectiveType = "select"` whenever options exist, so the declared type is overridden and a select renders. Wrong but inert today. Carried to Task G4/G12.

**[FINDING] B3-10 — The 2 root-`brand` composite indexes are UNREFERENCED** (same shape as B1-9). `products: brand + first_received_at` and `products: completion_state + brand + first_received_at`. Every query uses `brand_key`. With B1-9 that is **4 dead indexes**.

**[FINDING] B3-11 — `AttributeField.tsx` has no `is_editable` handling at all; the guard exists in only 1 of 4 render sites.**
The props interface (`frontend/src/components/AttributeField.tsx:23-36`) has no `is_editable` prop and the component never references one. Enforcement lives entirely in the caller: `ProductDetailPage.tsx:814` renders a display-only badge when `entry.is_editable === false`. That covers the render at `:826` only. The other three `<AttributeField>` sites on the same page — `:710` (hardcoded `is_fast_fashion` toggle), `:737` (fast-fashion drawer fields), `:767` (display-group sibling fields) — render editable controls regardless of the flag. `QuickEditPanel.tsx` never checks it either. Full treatment in Task G2.

**[FINDING] B3-12 — 12 DISPLAY-AS-KEY sites catalogued** (full table in `deep-map-brand.md`): `services/templateMatcher.ts:109` and `:133`; `services/ricsParser.ts:141-143`; `services/searchTokens.ts:44`; `services/exportSerializer.ts:229`; `services/aiDescribe.ts:82`/`:181`/`:191`; `frontend/src/components/QuickEditPanel.tsx:161`; `frontend/src/components/AttributeField.tsx:127-131`; `frontend/src/lib/registryAliases.ts:23`; `routes/mapImport.ts:353-354`/`:526`; `routes/launches.ts:391`; `routes/adminUsers.ts:88` → `lib/registryAuthority.ts:32`.

---

## TASK A — Gate 2 maps (Phases 1–2)

**[CONCERN A-P2-a] HEADLINE: no product can reach 100% completion. 0 of 81 products are `complete`.**
`backend/functions/src/services/completionCompute.ts:212-215` (`getRequiredFieldKeys`) queries `attribute_registry.where("required_for_completion","==",true)` **with no `active` filter**. Replaying it live returns 14 fields. Three are structurally unfillable:
- **`department`** — `required_for_completion: true` but `active: false`. Hidden from the editor twice over (`routes/attributeRegistry.ts:98` filters inactive; `:93`/`:100` suppress this doc id), yet still counted as required. Present on only 25 of 81 products. **For the other 56 there is no UI path to satisfy it.**
- **`sub_category`** — required, active, 224 dropdown options, **0 `attribute_values` docs across all 81 products**. `routes/importFullProduct.ts:850` writes it from an always-empty source; no smart rule targets it.
- **`ai_seo_title` / `ai_seo_meta`** — required, AI-Describe-owned (`services/completionCompute.ts:125`), written only by the AI Describe approve flow. **0 docs live.**
Verified by replaying `computeCompletionProgressPure` (`:104-180`) against live data; computed values match stored `completion_percent` exactly: `1005177` 11/14=**79** (stored 79), `1005394` 10/14=**71** (stored 71), `101405-CHRM` 11/14=**79** (stored 79). Ceiling is 79%.
**Generalized risk:** deactivating any registry attribute without first clearing `required_for_completion` creates a permanent invisible completion blocker. `department` is the live instance.

**[FINDING] A-P2-a2 — `completion_progress.total_required` ignores `depends_on` gating while `pct` honours it.**
`services/completionCompute.ts:249` returns `total_required: requiredFields.length` (raw), but `:251` returns `pct` computed from the gated `effectiveTotal` (`:117`, `:176-177`). The back-compat payload is internally inconsistent whenever a `depends_on` predicate is unmet.

**[FINDING] A-P2-b — A third duplicate-label pair exists that Appendix B does not name: `weight` vs `weight_oz`.**
Live `attribute_registry`, four pairs share `display_label` on one `destination_tab`: `core_information`/"Department" (`department` inactive + `department_key`); `core_information`/"Product Is Active" (`is_in_stock` + `product_is_active`, **both active**); `product_attributes`/"Material / Fabric" (`material` + `material_fabric`, **both active**); `product_attributes`/"Weight (oz)" (`weight` + `weight_oz`, **both active**). `weight` has `field_key: "weight"` and 76 `attribute_values` docs and is the target of 6 live `dim_*` smart rules; `weight_oz` has 0 docs. Carried to Task G7.

**[FINDING] A-P2-c — Two parallel dimension field sets; `width` collides with a footwear-size dropdown.**
Registry has `dimension_height`/`dimension_length`/`dimension_width` (27 `attribute_values` docs each, written by `dim_*` smart rules). Products *also* carry `height` (76 docs), `length` (76) and `width` (76). `height` and `length` are **not in the registry**. `width` **is** — as a `dropdown` with 4 footwear-width options — but the stored values are dimension numerics (`5`,`5`,`4`,`4` on the first four products). `AttributeField`'s orphan-value contract (`frontend/src/components/AttributeField.tsx:159-163`) will render that as `"5 (inactive)"`. Carried to Task L6 and G11.

**[FINDING] A-P2-d — E2 answered: `depends_on` supports strict string equality only.**
Type `{field: string; value: string} | null` (`services/completionCompute.ts:30`) — **no operator field**. Evaluation at `:129-135` is a single `!==` against `String(depAttr.value ?? "")`. It cannot express "website INCLUDES Karmaloop": (a) `String()` on an array yields an order-sensitive comma-join, not an INCLUDES; (b) live `attribute_values/website` values are scalar strings, not arrays.
Live: 5 attributes carry `depends_on`, all `{field:"is_fast_fashion", value:"true"}` (`heel_height`, `heel_type`, `platform_height`, `shoe_height_map`, `toe_shape`). **None is `required_for_completion: true`, so `depends_on` currently has zero effect on any completion computation.** The only UI that honours it is a hardcoded `is_fast_fashion` drawer at `frontend/src/pages/ProductDetailPage.tsx:690-756`, not a generic renderer.

**[FINDING] A-P2-e — P2-1b answered: doc_id is the operative key; `field_key` is optional and 85/96 docs lack it.**
Every hot path keys on doc id: `services/smartRules.ts:338` (`docs.map(d => d.id)`), `services/completionCompute.ts:92` (`field_key: d.id`), `lib/registryAuthority.ts:24-26` (hardcoded `.doc("class")`/`.doc("age_group")`/`.doc("gender")`), `routes/attributeRegistry.ts:100`, and `routes/products.ts` (URL path param → `attribute_values/{fieldKey}`). The single exception is `lib/exportRegistry.ts:31` (`d.field_key || d.id`). Live: `field_key` undefined on 85 of 96 docs, and never differs from the doc id on the 11 where it is set.

**[FINDING] A-P2-f — E5 answered: what the RetailOps CSV emits, field by field.**
From `services/exportSerializer.ts`: `brand` ← **root** `p.brand` (`:229`); `department` ← **`attribute_values/department`** (legacy, quarantined, unfiltered — `:232`); `class` ← `attribute_values/class` (`:233`); `category` ← `attribute_values/category` (`:234`); `sub_category` ← `attribute_values/sub_category` (`:235`); `website` ← **not a hardcoded column** (it appears among the 92 dynamic registry-driven columns). Site information is the `site_targets` column, built from each subcollection doc's **`domain`** field joined by `admin_settings/export_site_separator` (`:191-195`, `:96`).
Live coverage: `brand` 76/81 · `department` **25/81** · `class` 76/81 · `category` 76/81 · **`sub_category` 0/81 — always empty** · `website` 67/81 (5 hold the literal `"true"`) · `site_targets` present on 62/81.
`attrs` is built at `:163-167` with **no `quarantined` filter**, unlike `routes/products.ts:764` which does filter.

**[FINDING] A-P1-2-a — Both scripts named for reconcile/delete in P1-2 write the wrong value casing.**
`scripts/migrate-pricing-current-to-export-ready.js:26` writes `pricing_domain_state: "export_ready"`; `scripts/test-tally107.js:3` documents the same. Every one of the 14 live writers uses `"Export Ready"` (Title Case), and `services/exportEligibility.ts:28` queries `.where("pricing_domain_state","==","Export Ready")`. Any product that migration touched became invisible to export eligibility.

**[FINDING] A-P1-2-b — `scripts/test-tally107.js:23` hardcodes a Firebase Web API key, `:22` a Cloud Run URL.**
Firebase Web API keys identify the project rather than the caller, so this is not a high-severity leak, but it is a committed credential-shaped literal. Carried to Task H4.

**[FINDING] A-P1-2-c — 10 of the 14 `pricing_domain_state` writers fall OUTSIDE P1-2's declared edit surface.**
Surface names `completionCompute.ts`, `pricingResolution.ts`, `exportEligibility.ts`, `pricingDomainReflow.ts`. Writers outside it: `routes/importFullProduct.ts:910`/`:916`, `routes/mapReview.ts:357`, `routes/pricingDiscrepancy.ts:212`/`:302`, `services/scheduledPromotion.ts:53`/`:63`, `services/buyerPriceOverride.ts:302`/`:351`, `services/buyerMarkdownAction.ts:199`/`:249`/`:312`/`:374`, `routes/exports.ts:96`. Auto-promotion implemented only inside the declared surface can be overridden by five other paths.

**[FINDING] A-P1-2-d — P1-2's audit-event "?" marker is NOT FOUND, and the audit log has two competing field conventions.**
No `pricing_domain_state` transition event exists. The nearest precedent is the completion transition at `services/completionCompute.ts:342-357`: `{entity_type, entity_id, event_type: "completion_state.changed", old_value, new_value, changed_by, changed_at}` — which uses `changed_by`/`changed_at`, while most other writers use `acting_user_id`/`created_at` (e.g. `routes/exports.ts:219-225`). Carried to Task M5.

**[FINDING] A-P1-4-a — P1-4 answered: the `claude-opus-4-7` fallback IS valid.**
`claude-opus-4-7` is a currently available Anthropic model ID (Claude Opus 4.7, 1M context, $5/$25 per MTok), and it is registered live as an active model on `ai_provider_registry/anthropic` (`models[0]`, `sort_order: 1`). The fallback is functional, not stale. Two notes: it is not the newest model (`claude-opus-5` supersedes it at the same price), and `DEFAULT_MODEL_KEY` at `backend/functions/src/lib/aiConfig.ts:20` is a **hardcoded constant**, not an `admin_settings` key, so the admin page this tally builds cannot change it (carried to K2).
Two further facts for the tally: `fallback_model_key` is `null` on all 9 live `ai_workflow_routing` docs and is **never read** by `getAiConfigForWorkflow` — the only fallback that exists is the hardcoded `SEEDED_DEFAULT`. And `OpenAIAdapter` / `GeminiAdapter` (`lib/aiConfig.ts:97-118`) are stubs that throw; both providers are `is_active: false` live.

**[FINDING] A-P1-4-b — Test residue in `ai_provider_registry`.**
Doc `asdfasfer`: `display_name: "test"`, one model `test1`, `api_key_env_var_name: "test_ai_key"`, `is_active: false`. Carried to Task L5.

**[FINDING] A-P1-6-a — FR-23 answered: NO, Weekly Ops did not replace the separate imports.**
The `Family` union covers only two families (`frontend/src/pages/ImportHubPage.tsx:31`; `frontend/src/lib/api.ts:662`), but the Import Hub renders **five** import cards (`:307-323`): Full Product, Weekly Operations, MAP Policy, Site Verification, and **Sales**. The Sales import has its own three `api.ts` functions (`:730`, `:743`, `:753`) and its own `SalesImportCard` component (`:1007-1120`). It is live and in use.
The Sales routes are, however, the only import family that is **entirely ungated** (`backend/functions/src/routes/importSales.ts:130`, `:255`, `:471`), while MAP Policy requires `map_analyst` and Site Verification requires `operatorRoles`. Carried to I1 and H1.

**[FINDING] A-P1-6-b — FR-25 answered: `Hold` is NOT retired, and it does not hold.**
Live end to end: `POST /api/v1/buyer-actions/hold` (`routes/buyerActions.ts:79-127`, `requireAuth` only), wired in `frontend/src/lib/api.ts:1217`, `lib/roleGates.ts:19`, `components/cockpit/CockpitDrawer.tsx:81`/`:146`/`:311-315` (keyboard `h`), `components/cockpit/CockpitCadenceSection.tsx:208`.
It is **not** a `cadence_state` value — `backend/functions/src/types/cadence.ts:7-11` defines only `assigned | unassigned | rule_conflict | excluded`. It is a separate boolean, `products.cadence_hold`.
**`cadence_hold` has exactly one reference in the whole repo — the write at `routes/buyerActions.ts:101`. Nothing reads it.**
The handler also sets `in_cadence_review_queue: false` (`:107`), which does clear the queue row — but `services/cadenceEngine.ts:515` unconditionally writes `in_cadence_review_queue: true` on every re-assignment and never checks `cadence_hold`. The next engine run returns the product to the queue. Carried to I9 and J3.

**[FINDING] A-P1-1-a — 3 of the 10 ungated routes have no caller; the other 7 are live operator surfaces.**
**Correction to an earlier reading in this run:** the three `/api/v1/imports/sales/*` routes DO have frontend callers — `salesUpload` (`frontend/src/lib/api.ts:730`), `salesCommit` (`:743`), `fetchSalesStatus` (`:753`), all called from `SalesImportCard` (`frontend/src/pages/ImportHubPage.tsx:1007-1120`, calls at `:1018`/`:1038`/`:1052`), which **is rendered** at `:320-322`. The sales import is a live surface whose three routes are all ungated.
The routes with **no** caller are the three `ai-enrich` ones — `grep -rn "ai-enrich" frontend/src` returns nothing. `POST /api/v1/ai-enrich/run-pending` is the notable one: `routes/aiEnrichment.ts:196-209` reads `req.body?.limit` and fans out to up to 100 products **per query across two queries**, each a paid AI call — an open endpoint with a spend multiplier and no legitimate caller. Carried to I1 and H2.
Consequence for P1-1: adding `requireAuth` is a behaviour change for real operator flows, not only hardening of dead paths. The FE already sends a bearer token via `authHeaders()` (`frontend/src/lib/api.ts:655-660`), so no FE change is required.

**[FINDING] A-P1-5-a — P1-5's "`package.json` test script" surface is ambiguous and omits 4 sibling suites.**
There is no root `package.json`; `backend/functions/package.json:8-14` has no `test` script. Four other test files sit outside the declared single-file surface: `lib/brandRegistry.test.ts` (33 pass), `lib/departmentRegistry.test.ts` (38 pass), `lib/parseAdditionalImageUrls.test.ts` (10 pass), `middleware/requireSchedulerOIDC.test.ts` (18 pass). `completionCompute.test.js` currently fails 4 of 34 and exits 0 anyway.

---

## TASK A — Gate 2 maps (Phases 3–5)

**[BLOCKER-SEVERITY FINDING] A-P3-1-a — `firestore.rules:22` lets any authenticated user write their own `users/{uid}` doc, including `role`, and the backend falls back to reading exactly that field.**
`firebase/firestore.rules:22` — `allow write: if isOwner(uid)`, with **no field restriction**. A user can set `users/{uid}.role = "admin"` directly from the browser Firebase SDK.
`backend/functions/src/middleware/roles.ts:33-36` checks the Firebase custom claim first, but `:40-45` **falls back to `users/{uid}.role`**. For any user without a custom claim, self-writing `role: "admin"` grants admin on every backend route — and `:30` appends `admin`/`owner` to every `requireRole` list, so that is total access.
This is the highest-severity security finding in the audit. Carried to Task H3 and H6.

**[FINDING] A-P3-0-a — `requireRole` auto-appends `admin` and `owner` to every allowed list.**
`backend/functions/src/middleware/roles.ts:30` — `const allowedWithAdmin = Array.from(new Set([...allowed, "admin", "owner"]))`. **No route in the system is unreachable by an `admin` or `owner`.** Live: 5 of 14 users are `admin` and 1 is `owner` — 6 of 14 bypass every gate. This is the "auto-pass" column for Task O2.
Also: the comment at `:53-55` says "fall through to permissive mode on read failures", but the code falls through to the **deny** at `:58-61`. Comment is wrong; behaviour is correct (fail-closed).

**[FINDING] A-P3-3-a — `AuthContext.tsx:31-34` invents `product_ops` for any user without a role claim.**
```
// Dev fallback: if no role claim is set, default to product_ops so ops features are testable.
setRole(claimRole || "product_ops");
```
and the `catch` at `:33-35` does the same. The frontend never reads `users/{uid}.role` — the fallback the **backend** uses. So FE and BE can disagree about the same user in both directions: the FE renders `product_ops` UI for a user the BE may 403. Severity: **Misleads**. Carried to G9 and H6.

**[FINDING] A-P3-3-b — `frontend/src/lib/roleGates.ts` is a hardcoded second copy of four backend gates.**
`:27-50` re-implements the allow-lists for `POST /products/bulk/markdown`, `/products/bulk/assign-support`, `/buyer-actions/markdown`, `/buyer-actions/hold`, pinning the BE `file:line` in comments at `:8`, `:12`, `:16`, `:20`. It is not in P3-3's declared edit surface and will drift silently. Carried to O1/O3.

**[FINDING] A-P3-1-b — Appendix B P3-1 names a file that is not a `portfolio_*` consumer.**
The marker lists "`lib/portfolioFilter.ts`, `services/cadenceEngine.ts`, `scripts/seed-team-cadence-rules.js`". The first two are real. **`scripts/seed-team-cadence-rules.js` contains no `portfolio_` reference** (`grep -rn "portfolio_"` → no matches); it seeds `cadence_rules.owner_buyer_id`, which is P3-2's field. Carried to Task C.
Six material consumers the marker omits: `routes/adminUsers.ts` (**78 references — the largest**), `types/cadence.ts`, `frontend/src/pages/UserManagementPage.tsx`, `frontend/src/lib/api.ts`, `frontend/src/components/admin/UserPortfolioEditor.tsx`, `frontend/src/components/admin/PortfolioExclusionsEditor.tsx`.

**[FINDING] A-P3-1-c — 4 of 14 users have `portfolio_depts: null` and `portfolio_exclusions.department` is unset on all 14.**
Nulls: `anahi@shiekhshoes.org`, `vanessabautista@shiekhshoes.org`, `theo@shiekh.com`, `mykhailo@shiekhshoes.org`. `routes/adminUsers.ts:280` documents a normalization on read, but the stored shape is inconsistent. The department exclusion dimension has never been used in production.

**[FINDING] A-P4-2-a — The production email path fails silently and its callers ignore the result.**
All real outbound email goes through `services/launchNotifier.ts`, which returns `{sent:false, reason}` and logs to stdout when `SENDGRID_API_KEY` is unset (`:57-63`), when a template id is unset (`:64-67`), or on non-2xx from SendGrid (`:89-93`). **Its three callers ignore the return value** — `routes/launches.ts:526`, `:645`, `:730` are bare `await`s. A launch can publish, the subscriber list be read, and zero emails sent, with no operator signal, no `audit_log` entry, and no notification.
`services/emailService.ts` — which **throws** on the same conditions (`:51-55`, `:65-69`) — is called by exactly one place: `routes/adminSettings.ts:96`, the SMTP **test** button. The only loud path is the one nothing uses. Carried to M3/M4.

**[FINDING] A-P4-2-b — Live config selects `custom_smtp`; the production sender is hardcoded to SendGrid.**
`admin_settings/email_provider = "custom_smtp"`, `smtp_host = "smtp.gmail.com"`, `smtp_port = 465`. That key is read **only** by `services/emailService.ts:47` — the test button. `services/launchNotifier.ts` never reads it and always POSTs to `https://api.sendgrid.com/v3/mail/send` (`:81`). An admin who configures and successfully tests SMTP has changed nothing about how launch emails are actually sent.

**[FINDING] A-P4-2-c — P4-2's two "?" markers answered: 3 launchNotifier callers, 1 emailService caller.**
`launchNotifier`: `routes/launches.ts:526` (`notifyDateChanged`), `:645` (`notifyNewLaunch`), `:730` (`notifyNewComment`) — imported at `:31-34`, no other importer.
`emailService`: `routes/adminSettings.ts:96` only — imported at `:16`.

**[FINDING] A-P4-3-a — `launch_records` has no `status` field; the live field is `launch_status` and it is `undefined` on all 9 docs.**
Reading `status` across the 9 live docs returns `undefined` ×9. Task J4's stated workflow ("`launch_records` status + readiness + publish + archive") has no `status` to track; state is carried by `launch_status`, `published_at`, `archived_at`, `token_status` and `date_change_badge_expires_at` in combination.

**[FINDING] A-P4-3-b — P4-3's "placeholder checkbox" marker answered: two booleans, neither drives behaviour.**
`mpn_is_placeholder` and `is_launch_only` are both present on live `launch_records`, both appear in the three field allowlists (`routes/launches.ts:51`, `:373`, `:468`), and both are displayed by `LaunchAdminListPage.tsx` / `LaunchAdminDetailPage.tsx`. **Neither appears in any backend conditional** — they persist and render and drive nothing.

**[FINDING] A-P4-3-c — The `launch_records` field allowlist exists in three places; P4-3's surface names one.**
`routes/launches.ts:51`, `:373` (create), `:468` (patch). The declared surface is "create :363". Adding a field to create without adding it to `:468` makes it un-editable after creation. Also, the create **form** lives in `LaunchAdminListPage.tsx:208`/`:267-268`, not the detail page named in the surface.

**[FINDING] A-P5-1-a — P5-1's "?" marker answered: zero consumers, all six collections. Five of the six are also empty live.**
Each of `export_profiles`, `import_templates`, `search_settings`, `comment_threads`, `launch_settings`, `sop_panels` is read and written **only** by its own CRUD router (5 handlers each) and rendered only by its own admin page. Verified by grepping each collection name across `backend/functions/src`, `frontend/src`, `scripts`.
Live doc counts: `export_profiles` **0** · `import_templates` **0** · `search_settings` **0** · `comment_threads` **0** · `launch_settings` **0** · `sop_panels` **5** (whose content is rendered nowhere outside the admin editor).
Do **not** sweep up `guided_tours` (5 live docs, consumed by `routes/tours.ts:21` → `GET /api/v1/tours/:hub`).

**[FINDING] A-P5-1-b — `isFeatureEnabled()` is never called; two unrelated feature-flag systems both go unread.**
`backend/functions/src/lib/featureToggleCache.ts:30` exports `isFeatureEnabled(toggleKey)`. The module's only importer anywhere is `routes/featureToggles.ts:27`, which imports `clearFeatureToggleCache` — the cache-buster, not the reader. Live `feature_toggles` is **empty**.
Separately, `admin_settings/feature_flags` holds a **second, unrelated** set of 7 flags (`enable_ai_descriptions`, `enable_smart_rules`, `enable_dynamic_pricing`, `enable_multi_currency`, `enable_analytics_dashboard`, `enable_feed_export`, `enable_bulk_import`) which nothing reads either. Carried to I8 and K3.

**[FINDING] A-P5-2-a — Only 1 of P5-2's 3 named "duplicate surfaces" is actually a duplicate.**
(a) **Real duplicate**: `App.tsx:169` redirects `/pricing-discrepancy` → `/buyer-review?tab=pricing` while `:170` still mounts `PricingDiscrepancyPage` at `/pricing-discrepancy-legacy`, which has **no Sidebar entry** and is reachable only by URL.
(b) **Not a duplicate**: `MapPolicyPage` (`/map-policy`) is a cross-product queue; `CockpitMapSection` is a per-product section inside the Cockpit drawer. `MapConflictReviewPage.tsx` and `MapRemovalReviewPage.tsx` are **not orphans** — `MapPolicyPage.tsx:19-20`/`:81`/`:83` imports and renders them as its tab bodies, and `App.tsx:14-15` documents that.
(c) **Not a duplicate**: `SiteVerificationReviewPage` is a cross-product queue; `SiteVerificationTab` (`ProductDetailPage.tsx:626`) is one product's map. The genuinely duplicated element is the **action set** — both call the same three POSTs.

**[FINDING] A-P5-3-a — Executive Dashboard is shown to every logged-in user and 403s for 7 of 14.**
`/executive` has no frontend gate (`frontend/src/App.tsx:175`) and a `Sidebar.tsx:60-76` entry visible to all roles, while `GET /api/v1/executive/health` and `/throughput` require `head_buyer` (`backend/functions/src/routes/executive.ts:49`, `:69`).
Live: 4 `buyer` + 2 `product_ops` + 1 `map_analyst` = **7 of 14 users see the link and get an error**. The 5 `admin` + 1 `owner` pass only via the `roles.ts:30` bypass; the 1 `head_buyer` passes directly.
Note: across all 69 routes in `App.tsx`, **exactly one** is wrapped in `RoleGate` — `/admin/component-demo` (`:225-231`). Severity: **Misleads**. Carried to G9.

**[FINDING] A-P5-3-b — The Permissions page renders a hand-maintained description of the gates, not the gates.**
`frontend/src/pages/PermissionsPage.tsx:37` reads `GET /api/v1/admin/role-permissions`, served from `backend/functions/src/lib/rolePermissions.ts:16-29`, whose own header at `:5` says it is hand-maintained ("codegen DROPPED — see D.3 Frink correction"). It can drift from actual `requireRole` calls with nothing to detect it, and it shows no column for the `roles.ts:30` admin/owner bypass. Carried to O2.

**[FINDING] A-P5-4-a — The two Completion Rules placeholders are shaped inconsistently; one carries a dead href.**
`frontend/src/components/Sidebar.tsx:99` — `{ label: "Completion Rules", comingLabel: "B.3" }` with **no `path` key**, so it renders as a non-link (correct).
`frontend/src/pages/AIAutomationPillarPage.tsx:8` — carries `href: "/admin/ai-automation/completion-rules"`, and **that path is not among the 69 routes in `App.tsx`**. Carried to G8.
Also for whoever builds it: the promised "blocking vs warning" distinction does not exist in the model. `services/completionCompute.ts` has one severity — satisfied or blocker (`:154`, `:158`). And per A-P2-a, three of the 14 currently-required fields cannot be satisfied at all.

**[FINDING] A-P5-1-c — `admin_settings` holds 57 docs; most are read by nothing.**
Only these keys have a code reader: the 10 pricing keys in `services/adminSettings.ts:21-32` (`gross_margin_safe_threshold`, `estimated_cost_multiplier`, `below_cost_acknowledgment_required`, `below_cost_reason_min_chars`, `export_price_rounding_enabled`, `export_price_rounding_mode`, `slow_moving_str_threshold`, `slow_moving_wos_threshold`, `str_calculation_window_days`, `wos_trailing_average_days`); `export_site_separator` (`services/exportSerializer.ts:63`); `launch_priority_window_days` (`routes/products.ts:88`, ×3); `launch_past_retention_days` (`routes/launches.ts:131`); `smtp_throttle_hours` (`services/launchNotifier.ts`); `system_health` and `global`; the 6 email keys in `services/emailService.ts:38-76`; and the 5 KPI keys in `services/buyerPerformanceMatrix.ts:88-98`.
Unread examples with misleading content: **`ai_model_config`** = `{default_model: "gpt-4o", fallback_model: "gpt-4o-mini", …}` — OpenAI models in a system whose only working adapter is Anthropic; **`role_definitions`** = `{superadmin, admin, editor, viewer}` — a role set with no relationship to the 10 canonical roles; **`active_model`** = `"claude-sonnet-4-5-20250929"` vs **`active_ai_model`** = `"claude-sonnet-4-6"` — two competing model keys, neither of which `lib/aiConfig.ts` reads (it reads `ai_workflow_routing`); plus `auth_config`, `api_rate_limits`, `maintenance_mode`, `analytics_config`, `analytics_export`, `feed_*` (3), `notification_slack`, `notification_email`, `notification_in_app`, `bulk_import_config`, `data_mapping_defaults`, `platform_info`, `ai_content_moderation`, `ai_enrichment_schedule`, `ai_prompt_templates`, `feature_flags`.
`notification_email.recipients = ["admin@ropi.io"]` and `platform_info.support_email = "support@ropi.io"` reference a `ropi.io` domain unrelated to `shiekh.com`. Full treatment in Task K1.

---

## TASKS C / D / E / G / H

**[BLOCKER] H3-CRITICAL — Privilege escalation: any authenticated user can grant themselves `admin`.**
`firebase/firestore.rules:22` — `allow write: if isOwner(uid)` on `users/{uid}`, **unrestricted by field**. A user can set `users/{uid}.role = "admin"` from the browser Firebase SDK.
`backend/functions/src/middleware/roles.ts:40-45` falls back to reading exactly that field when no custom claim is present, and `:30` appends `admin`/`owner` to every `requireRole` list. Result: total API access, including `DELETE /api/v1/products/:mpn`, `POST /api/v1/products/bulk-delete`, every registry mutation, and every `admin_settings` write.
The same rule also allows self-editing `portfolio_*`, bypassing the registry validation at `routes/adminUsers.ts:88-136` and changing cadence buyer resolution. `hasRole()` at `firestore.rules:14-17` reads the same self-writable field, so the admin **read** grant at `:21` is self-grantable too.
**Highest-severity finding in this audit.**

**[FINDING] H1 — 202 route handlers; 13 have no gate; 10 of those are accidental.**
Accidental: `POST /imports/full-product/upload` (`:67`), `/full-product/:batch_id/commit` (`:175`), `/weekly-operations/upload` (`:100`), `/weekly-operations/:batch_id/commit` (`:209`), `/sales/upload` (`:130`), `/sales/:batch_id/commit` (`:255`), `GET /imports/sales/status` (`:471`), `POST /ai-enrich/name/:mpn` (`:166`), `/ai-enrich/color/:mpn` (`:180`), `/ai-enrich/run-pending` (`:194`).
By design (comment-marked): `GET /launches/public` (`:128`), `POST /launches/subscribe` (`:187`), `DELETE /launches/unsubscribe` (`:225`).
**These are internet-reachable**: `docs/scheduled-jobs.md` records that `allUsers` holds `roles/run.invoker` on `ropi-aoss-api`, so Express middleware is the only gate.
Worst single route: `POST /api/v1/ai-enrich/run-pending` — unauthenticated, **no frontend caller**, reads `req.body?.limit` and fans out to **up to 200 paid AI calls** per request (`routes/aiEnrichment.ts:196-209`).

**[FINDING] H7 — CORS reflects any origin; no security headers; no rate limiting.**
`backend/functions/src/index.ts:63` — `app.use(cors({ origin: true }))` reflects the request `Origin`, which (unlike `*`) permits credentialed cross-origin requests. No allowlist, no `credentials`/`methods`/`allowedHeaders` options.
No `helmet` and no manual CSP / HSTS / X-Frame-Options / X-Content-Type-Options anywhere. No rate limiting — `admin_settings/api_rate_limits` exists live (`{global_rpm:1000, per_user_rpm:100, per_ip_rpm:200, burst_limit:50}`) and **nothing reads it**.

**[FINDING] H5 — No upload has a MIME or extension filter; two admin write routes have no meaningful validation.**
All 6 multer configs (`importFullProduct.ts:47`, `importWeeklyOperations.ts:39-42`, `importSales.ts:32-35`, `mapImport.ts:26-29`, `siteVerificationImport.ts:26-29`, `launches.ts:39-42`) use `memoryStorage` with a `fileSize` limit (50 MB ×5, 10 MB ×1) and **no `fileFilter`**. Global JSON limit is also 50 MB (`index.ts:64-65`).
`PUT /api/v1/admin/settings/:key` (`routes/adminSettings.ts:52-81`) validates only `value !== undefined` — **no key allowlist, no type check**. `services/adminSettings.ts:47-54` then returns whatever is stored straight into pricing arithmetic. `routes/promptTemplates.ts:52-113` similarly writes `match_*` fields and prompt bodies with no type or enum validation.

**[FINDING] H4 — Secrets are handled correctly; one committed credential-shaped literal.**
No secret is logged, returned, or written to Firestore. Firestore stores only env-var *names* (`ai_provider_registry.api_key_env_var_name`), documented at `services/emailService.ts:5-7` and surfaced to operators at `frontend/src/pages/SmtpSettingsPage.tsx:223-224`.
One note: `backend/functions/src/lib/aiConfig.ts:44` does `process.env[<dynamic>]` where the name comes from an admin-editable Firestore field (`routes/aiPlane.ts:145`, `:258-259`) — an arbitrary-env-var **presence** check, with the name (never the value) echoed in the error at `:46-48`. Enumeration primitive, not exfiltration.
Committed literal: `scripts/test-tally107.js:23` (Firebase Web API key) and `:22` (Cloud Run URL).

**[FINDING] C1 — A documented Cloud Scheduler job has no route.**
`docs/scheduled-jobs.md` documents **four** jobs including `neglected-inventory-nightly` → `POST /api/v1/internal/jobs/neglected-inventory`. `backend/functions/src/routes/internalJobs.ts` implements **three** (`:83`, `:103`, `:118`). There is no `/neglected-inventory` handler; a Cloud Scheduler job provisioned per the runbook has been 404-ing nightly, and nothing alerts on it (see M4). `computeNeglectedInventory()` exists (`services/executiveProjections.ts:183-262`) but runs only as a side-effect of `daily-staleness-sweep`.

**[FINDING] C-summary — 12 contradictions found; full table in `contradictions.md`.**
Worst three: **C1** (above); **C10** — `scripts/migrate-pricing-current-to-export-ready.js:26` writes `"export_ready"` while every live writer and `services/exportEligibility.ts:28` use `"Export Ready"`; **C5** — two of the six "known" K2 values do not exist (no MAP tolerance anywhere; removal-review defer is **7 days**, `routes/mapReview.ts:430`, not 90).
Also: **C4** — Appendix B's "`site_owner` is a known empty dropdown" is wrong; it is correctly registry-driven. **C2** — no live cadence rule uses `department_key equals Clothing`; all values are lowercase. **C7** — `auditLogs` does not exist anywhere; the only spelling is `audit_log`.
**Positive finding:** all 21 Appendix B `file:line` references checked resolved to the intended construct. The Build Plan's line references are trustworthy.

**[FINDING] D-summary — 17 sequencing violations; full table in `sequencing.md`.**
Worst: **D1** — P1-2's acceptance criterion (a product reaching `complete`) is unreachable until a Phase 2 tally makes the required set satisfiable; 0 of 81 products are complete. **D16** — P1-1 can be implemented safely (`index.ts` mounts) or unsafely (router-level inside `importFullProduct.ts`, the largest writer of both frozen models); the plan permits both. **D9** — P2-2, P2-3a and P2-5 edit adjacent branches of one `if/else if` chain at `routes/products.ts:1165-1226`, across two phases.
2 of 7 Phase 1 tallies touch frozen ground: **D16** (P1-1, conditional on implementation choice) and **D18** (P1-6's FR-25 answer forces a cadence-engine decision that must not be made in Phase 1).

**[FINDING] E-summary — 9 of 9 open questions answered, none NOT FOUND.** Full detail in `open-questions.md`. Newly-surfaced: **E4** — the three site descriptions do not exist in any form; the closest neighbours are `content_versions` (per-site generated content) and `site_registry.ai_content_strategy`, which is seeded and **read by nothing**. **E9** — `POST /name/:mpn` uses only the *short* RICS description; the long one is loaded and never used; and `services/aiDescribe.ts:16-17` excludes the `rics_short_desc`/`rics_long_desc` spellings while the live data and 5 live smart rules use `rics_short_description`/`rics_long_description` — so the exclusion list does not exclude the fields that exist.

**[FINDING] G-summary — 49 UX defects: 16 Blocks work, 20 Misleads, 13 Cosmetic.** Full table in `ux-defects.md`.
New defects not named in Appendix B: **G5-1** — there is **no required-field indicator anywhere**; `AttributeField.tsx:23-36` has no `required` prop and `ProductDetailPage.tsx:826-840` never passes `required_for_completion`, though `api.ts:334` types it. All 14 required attributes render identically to the 82 optional ones.
**G-NEW-4** — two completion-shaped fields disagree on 61 of 81 products: live `status` = `{Complete: 61, Incomplete: 15}` (root + `attribute_values`, emitted at `routes/products.ts:910`) vs `completion_state` = `{incomplete: 81}`.
**G12-3** — `attribute_registry/width` is a 4-option footwear-width dropdown, but live `attribute_values/width` holds dimension numerics on 76 products, which `AttributeField.tsx:159-163` renders as `"5 (inactive)"`.
**G10-1/G10-2** — no `display_group` is conditional; "Footwear Details" renders on Accessories products. 27 of 96 attributes sit in a group named `Other`, including `department_key` and `site_owner`.
**G3 result** — there are **zero** dropdowns with empty options and no resolving source. The real defect in that family is `website`, whose 7 options are a hardcoded literal list including 4 **inactive** sites.

---
