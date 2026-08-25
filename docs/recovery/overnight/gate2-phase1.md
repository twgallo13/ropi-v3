# TASK A — Gate 2 maps: Phase 1 (Products flow again)

Template per §3 TASK A. Repo @ `2698e48`; live reads against `ropi-aoss-dev`.
Route/gate facts come from the full inventory built for Task H1 (202 handlers across 47 routers).

---

## P1-0 — Dev reset tooling
Edit surface (from Build Plan): new script under `scripts/` (dev-only, refuses staging/prod)
Fields/collections/endpoints/states this tally writes or renames: none in the repo today — a new script only.
Blast radius:
  Backend readers/writers: NOT FOUND (no such script exists)
  Frontend readers/renderers: NOT FOUND
  Scripts (seed/migration): **the guard pattern to copy already exists** — [deploy-dev.sh](scripts/deploy-dev.sh), [deploy-staging.sh](scripts/deploy-staging.sh), [deploy-prod.sh](scripts/deploy-prod.sh) select a project; `scripts/seed/utils.js` is the shared seed helper. No existing script refuses staging/prod by project id — see **CONCERN A-P1-0-a**.
  Composite indexes: NONE
  Security rules: NONE
  Downstream consumers: NONE
  Live Firestore: N/A (new tooling)
Build Plan "?" markers on this tally: none.
Edit-surface check: **clean.** Nothing outside `scripts/` is implicated.

**[CONCERN A-P1-0-a]** Three service-account keys are present in the environment simultaneously — `GCP_SA_KEY_DEV`, `GCP_SA_KEY_STAGING`, `GCP_SA_KEY_PROD` (`client_email` values confirm `ropi-aoss-dev`, `ropi-aoss-staging-v3`, `ropi-aoss-prod`). Every existing script reads `process.env.GCP_SA_KEY_DEV` and hardcodes `projectId: "ropi-aoss-dev"` (e.g. `scripts/test-tally107.js:11-18`), so a reset script that follows the house pattern would be dev-only by accident, not by design. `.firebaserc` maps `staging` → `ropi-aoss-staging-v3`, not `ropi-aoss-staging` — see Task C.

---

## P1-1 — Auth on import + enrichment routes
Edit surface (from Build Plan): router-level middleware lines in `importFullProduct.ts`, `importWeeklyOperations.ts`, `importSales.ts`, `aiEnrichment.ts` OR their mounts in `index.ts` (:78-80, :165) — nothing else
Fields/collections/endpoints/states this tally writes or renames: no fields. It adds gates to **10 currently open endpoints**.
Blast radius:
  Backend readers/writers — the exact 10 ungated handlers:
  | Method | Path | file:line |
  |---|---|---|
  | POST | `/api/v1/imports/full-product/upload` | [importFullProduct.ts:67](backend/functions/src/routes/importFullProduct.ts#L67) (+ multer) |
  | POST | `/api/v1/imports/full-product/:batch_id/commit` | [importFullProduct.ts:175](backend/functions/src/routes/importFullProduct.ts#L175) |
  | POST | `/api/v1/imports/weekly-operations/upload` | [importWeeklyOperations.ts:100](backend/functions/src/routes/importWeeklyOperations.ts#L100) (+ multer) |
  | POST | `/api/v1/imports/weekly-operations/:batch_id/commit` | [importWeeklyOperations.ts:209](backend/functions/src/routes/importWeeklyOperations.ts#L209) |
  | POST | `/api/v1/imports/sales/upload` | [importSales.ts:130](backend/functions/src/routes/importSales.ts#L130) (+ multer) |
  | POST | `/api/v1/imports/sales/:batch_id/commit` | [importSales.ts:255](backend/functions/src/routes/importSales.ts#L255) |
  | GET | `/api/v1/imports/sales/status` | [importSales.ts:471](backend/functions/src/routes/importSales.ts#L471) |
  | POST | `/api/v1/ai-enrich/name/:mpn` | [aiEnrichment.ts:166](backend/functions/src/routes/aiEnrichment.ts#L166) |
  | POST | `/api/v1/ai-enrich/color/:mpn` | [aiEnrichment.ts:180](backend/functions/src/routes/aiEnrichment.ts#L180) |
  | POST | `/api/v1/ai-enrich/run-pending` | [aiEnrichment.ts:194](backend/functions/src/routes/aiEnrichment.ts#L194) |
  Mounts: [index.ts:78-80](backend/functions/src/index.ts#L78-L80), [index.ts:165](backend/functions/src/index.ts#L165). Note `index.ts:83` also mounts `importsStatus.ts` at the bare `/api/v1/imports` prefix — its two handlers **are** gated (`requireAuth`), so a router-level gate added to the three import routers does not shadow it.
  Frontend readers/renderers: `uploadImport()` [api.ts:662-673](frontend/src/lib/api.ts#L662-L673) — **its type parameter is `"full-product" | "weekly-operations"` only.** [ImportHubPage.tsx:31](frontend/src/pages/ImportHubPage.tsx#L31) declares the same two-value union; `:308-312` renders exactly two `ImportCard`s. `authHeaders()` [api.ts:655-660](frontend/src/lib/api.ts#L655-L660) already attaches a bearer token, so adding `requireAuth` breaks nothing on the FE.
  Scripts (seed/migration): NONE call these routes.
  Composite indexes: NONE
  Security rules: NONE
  Downstream consumers: none — these are entry points.
  Live Firestore: N/A
Build Plan "?" markers on this tally: **"any non-browser caller of these routes (D2 found none)" → CONFIRMED, with two corrections.**
  - No `scripts/` file calls any of the 10. The only script that calls the API at all is `scripts/test-tally107.js`, which targets `POST /complete` and `POST /attributes/map` (`:3-5`) with a Firebase ID token (`getAuthToken()`), not these routes.
  - **The three `/api/v1/imports/sales/*` handlers DO have frontend callers** — `uploadImport` cannot construct that path (`api.ts:662`), but three dedicated functions do: `salesUpload` ([api.ts:730-741](frontend/src/lib/api.ts#L730-L741)), `salesCommit` ([api.ts:743-751](frontend/src/lib/api.ts#L743-L751)), `fetchSalesStatus` ([api.ts:753](frontend/src/lib/api.ts#L753)). All three are called from `SalesImportCard` ([ImportHubPage.tsx:1007-1120](frontend/src/pages/ImportHubPage.tsx#L1007), calls at `:1018`, `:1038`, `:1052`), which **is rendered** at [ImportHubPage.tsx:320-322](frontend/src/pages/ImportHubPage.tsx#L320-L322). So the sales import is a live, reachable operator surface — and all three of its routes are ungated.
  - **`POST /api/v1/ai-enrich/run-pending` (`:194`) has no frontend caller.** `grep -rn "ai-enrich" frontend/src` returns nothing — none of the three `ai-enrich` routes is called from the frontend at all.
Edit-surface check: **clean, and the surface is larger than it looks in one respect.** All 10 handlers live inside the four named files. However, `POST /api/v1/ai-enrich/run-pending` reads `req.body?.limit` and fans out to up to 100 products **per query, across two queries** (`aiEnrichment.ts:196-209`), each triggering a paid AI call — so this is the one route where the missing gate is a spend risk, not only a data risk. Note also that **7 of the 10 routes are reachable operator surfaces today** (both `ImportCard` families plus `SalesImportCard`), so adding `requireAuth` is a behaviour change for real users, not only a hardening of dead paths — the FE already sends a bearer token via `authHeaders()` (`api.ts:655-660`), so no FE change is required.

---

## P1-2 — TALLY-107 auto-promotion
Edit surface (from Build Plan): `services/completionCompute.ts` (stamp path ~:336), `services/pricingResolution.ts` (below-cost branch :177/:308/:416), `services/exportEligibility.ts:65-69`, `services/pricingDomainReflow.ts:69`, one unit test; reconcile/delete `scripts/migrate-pricing-current-to-export-ready.js`, `scripts/test-tally107.js`
Fields/collections/endpoints/states this tally writes or renames: `products.pricing_domain_state` (transition `Pricing Current` → `Export Ready`); `products.completion_state`; a new `audit_log` event shape.
Blast radius:
  Backend readers/writers — **every `pricing_domain_state` writer** (14 sites):
  | Writer | file:line | Value written |
  |---|---|---|
  | `resolvePricing` result mirror | [pricingResolution.ts:382](backend/functions/src/services/pricingResolution.ts#L382), [:416](backend/functions/src/services/pricingResolution.ts#L416) | `result.status` — `Pricing Current` \| `Pricing Discrepancy` \| `Loss-Leader Review Pending` \| `Pricing Pending` |
  | `routeToPricingDiscrepancy` | [pricingResolution.ts:283](backend/functions/src/services/pricingResolution.ts#L283) | `Pricing Discrepancy` |
  | `routeToLossLeaderReview` | [pricingResolution.ts:308](backend/functions/src/services/pricingResolution.ts#L308) | `Loss-Leader Review Pending` |
  | Import — pricing flags | [importFullProduct.ts:910](backend/functions/src/routes/importFullProduct.ts#L910), [:916](backend/functions/src/routes/importFullProduct.ts#L916) | `Pricing Discrepancy`, `Pricing Incomplete` |
  | MAP conflict resolve | [mapReview.ts:357](backend/functions/src/routes/mapReview.ts#L357) | `Export Ready` |
  | Discrepancy resolve ×2 | [pricingDiscrepancy.ts:212](backend/functions/src/routes/pricingDiscrepancy.ts#L212), [:302](backend/functions/src/routes/pricingDiscrepancy.ts#L302) | `Export Ready` |
  | Scheduled promotion | [scheduledPromotion.ts:53](backend/functions/src/services/scheduledPromotion.ts#L53), [:63](backend/functions/src/services/scheduledPromotion.ts#L63) | `Export Ready` |
  | Buyer price override | [buyerPriceOverride.ts:302](backend/functions/src/services/buyerPriceOverride.ts#L302), [:351](backend/functions/src/services/buyerPriceOverride.ts#L351) | `Export Ready` \| `Scheduled` |
  | Buyer markdown action | [buyerMarkdownAction.ts:199](backend/functions/src/services/buyerMarkdownAction.ts#L199), [:249](backend/functions/src/services/buyerMarkdownAction.ts#L249), [:312](backend/functions/src/services/buyerMarkdownAction.ts#L312), [:374](backend/functions/src/services/buyerMarkdownAction.ts#L374) | `Buyer Denied` \| step-derived |
  | Export marking | [exports.ts:96](backend/functions/src/routes/exports.ts#L96) | `Exported` |
  Readers: [exportEligibility.ts:28](backend/functions/src/services/exportEligibility.ts#L28) (`== "Export Ready"`), `:55`, `:60`, `:65-69`; [buyerReview.ts:131](backend/functions/src/routes/buyerReview.ts#L131) (`CADENCE_EXCLUDED_STATES`), `:210`; [pricingDiscrepancy.ts:49](backend/functions/src/routes/pricingDiscrepancy.ts#L49), `:131`; [executiveProjections.ts:352](backend/functions/src/services/executiveProjections.ts#L352), `:382`; [buyerPriceOverride.ts:253](backend/functions/src/services/buyerPriceOverride.ts#L253); [buyerMarkdownAction.ts:169](backend/functions/src/services/buyerMarkdownAction.ts#L169); [dashboard.ts:128](backend/functions/src/routes/dashboard.ts#L128); [reviewActiveOverrides.ts:183](backend/functions/src/routes/reviewActiveOverrides.ts#L183); [applyStepOverride.ts:200-233](backend/functions/src/services/applyStepOverride.ts#L200-L233); [products.ts:314](backend/functions/src/routes/products.ts#L314), `:919`, `:1900`; [exports.ts:34](backend/functions/src/routes/exports.ts#L34).
  Frontend readers/renderers: `pricing_domain_state` surfaces on the product list row ([products.ts:314](backend/functions/src/routes/products.ts#L314) → ProductListPage), the detail payload (`:919`), the Export Center, Review Active Overrides, and Pricing Discrepancy. Full enumeration in `workflows.md` (J2).
  Scripts (seed/migration): [migrate-pricing-current-to-export-ready.js:17-26](scripts/migrate-pricing-current-to-export-ready.js#L17-L26) and [test-tally107.js](scripts/test-tally107.js) — **both use the wrong value casing, see FINDING A-P1-2-a.**
  Composite indexes: NONE reference `pricing_domain_state`. Confirmed by parsing all 108 index entries — no `fieldPath` matches. Every query on it is single-field (`exportEligibility.ts:28`, `pricingDiscrepancy.ts:49`, `executiveProjections.ts:352`/`:382`) and served by automatic single-field indexes.
  Security rules: NONE
  Downstream consumers: export eligibility (the gate this tally exists to unblock) · Buyer Review queue exclusion · Executive projections (Scheduled + Loss-Leader counts) · Export Center list · audit payloads.
  Live Firestore: see the state histogram in `workflows.md` (J2).
Build Plan "?" markers on this tally: **"audit event shape for the new transition" → NOT FOUND.**
  There is no existing audit event for a `pricing_domain_state` transition. The nearest precedent is the **completion** transition event at [completionCompute.ts:342-357](backend/functions/src/services/completionCompute.ts#L342-L357): `{entity_type: "product", entity_id, event_type: "completion_state.changed", old_value, new_value, changed_by, changed_at}`. Note that shape uses `changed_by`/`changed_at`, while most other writers in this repo use `acting_user_id`/`created_at` (e.g. `exports.ts:219-225`) — the audit log has **two competing field conventions**; carried to Task M5.
Edit-surface check: **SCOPE RISK — 10 of the 14 `pricing_domain_state` writers are OUTSIDE the declared edit surface.** The surface names `completionCompute.ts`, `pricingResolution.ts`, `exportEligibility.ts`, `pricingDomainReflow.ts`. Writers not in that list: `importFullProduct.ts:910/:916`, `mapReview.ts:357`, `pricingDiscrepancy.ts:212/:302`, `scheduledPromotion.ts:53/:63`, `buyerPriceOverride.ts:302/:351`, `buyerMarkdownAction.ts:199/:249/:312/:374`, `exports.ts:96`. If auto-promotion is implemented only inside the declared surface, five other paths continue to set the state directly and can override it.

**[FINDING A-P1-2-a] Both scripts named for reconcile/delete write `"export_ready"` (snake_case); every code path uses `"Export Ready"` (Title Case).**
`scripts/migrate-pricing-current-to-export-ready.js:26` — `{ pricing_domain_state: "export_ready" }`. `scripts/test-tally107.js:3` documents `pricing_domain_state = export_ready`. All 14 live writers use `"Export Ready"` (e.g. `exportEligibility.ts:28` queries `.where("pricing_domain_state","==","Export Ready")`). Any product this migration touched became invisible to export eligibility. Live-state check in `data-integrity.md`.

**[FINDING A-P1-2-b] `scripts/test-tally107.js:23` hardcodes a Firebase Web API key in the repo.**
`const FIREBASE_API_KEY = "AIzaSy…"` alongside a hardcoded Cloud Run URL at `:22`. Firebase Web API keys are not secrets in the usual sense (they identify the project, not the caller), but this is a committed credential-shaped literal and belongs in the H4 inventory.

---

## P1-3 — Smoke (no code)
Edit surface (from Build Plan): none
Fields/collections/endpoints/states this tally writes or renames: none
Blast radius: **N/A — no code change.**
Build Plan "?" markers on this tally: none.
Edit-surface check: N/A.

---

## P1-4 — Workflow Routing admin page
Edit surface (from Build Plan): new FE page + route + `api.ts` functions only (backend `aiPlane.ts` GET/PUT `/workflows` exists)
Fields/collections/endpoints/states this tally writes or renames: `ai_workflow_routing/{workflow_key}` (`provider_key`, `model_key`, `fallback_provider_key`, `fallback_model_key`, `is_active`).
Blast radius:
  Backend readers/writers — **the backend already exists, confirmed:**
  | Method | Path | file:line | Gate |
  |---|---|---|---|
  | GET | `/api/v1/admin/ai/workflows` | [aiPlane.ts:350](backend/functions/src/routes/aiPlane.ts#L350) | `requireAuth + requireRole([admin,owner])` |
  | GET | `/api/v1/admin/ai/workflows/:workflow_key` | [aiPlane.ts:374](backend/functions/src/routes/aiPlane.ts#L374) | same |
  | PUT | `/api/v1/admin/ai/workflows/:workflow_key` | [aiPlane.ts:401](backend/functions/src/routes/aiPlane.ts#L401) | same |
  Consumer of the data: [`getAiConfigForWorkflow`](backend/functions/src/lib/aiConfig.ts#L157-L215) — reads `ai_workflow_routing/{key}`, then `ai_provider_registry/{provider_key}`, falling back to `SEEDED_DEFAULT` on **five** distinct miss-paths, each with a `console.warn` only (`:166`, `:175`, `:184`, `:196`, `:202`). Callers: `services/aiDescribe.ts` (via `resolveAdapter`), `routes/aiContent.ts`, `routes/aiEnrichment.ts`, `services/aiWeeklyAdvisory.ts`.
  Frontend readers/renderers: **NOT FOUND** — there is no page for `/workflows`. [AIProvidersListPage.tsx](frontend/src/pages/AIProvidersListPage.tsx) and [AIProviderEditor.tsx](frontend/src/components/admin/AIProviderEditor.tsx) cover `/providers` only. This is precisely the gap the tally fills.
  Scripts (seed/migration): [scripts/seed/seed-ai-workflow-routing.js](scripts/seed/seed-ai-workflow-routing.js) (npm script `seed:ai-workflow-routing`), [scripts/seed/seed-ai-provider-registry.js](scripts/seed/seed-ai-provider-registry.js), [scripts/seed/update-active-model.js](scripts/seed/update-active-model.js), [scripts/migrate-ai-plane.js](scripts/migrate-ai-plane.js).
  Composite indexes: NONE
  Security rules: NONE (deny-all; access is API-only)
  Downstream consumers: every AI call in the product. A wrong `model_key` here breaks AI Describe, AI Assistant chat + vision, both enrichment routes, and the weekly advisory — all silently, because `getAiConfigForWorkflow` never throws.
  Live Firestore: `ai_workflow_routing` — **9 docs**, all `is_active: true`, all routing to `provider_key: "anthropic"` / `model_key: "claude-sonnet-4-6"`, all with `fallback_provider_key: null` and `fallback_model_key: null`: `ai_assistant_chat`, `ai_assistant_vision`, `ai_enrichment_color`, `ai_enrichment_name`, `anomaly_detection`, `content_generation`, `content_review_regeneration`, `smart_rule_inference`, `weekly_advisory_report`.
  `ai_provider_registry` — **4 docs**: `anthropic` (active; models `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5`, all `is_active: true`), `openai` (inactive, `models: []`), `google` (inactive, `models: []`), and **`asdfasfer`** — a test doc (`display_name: "test"`, one model `test1`, `api_key_env_var_name: "test_ai_key"`, `is_active: false`).
Build Plan "?" markers on this tally: **"is fallback model `claude-opus-4-7` (aiConfig.ts:19-21) still valid" → CONFIRMED VALID.**
  `claude-opus-4-7` is a currently available Anthropic model ID (Claude Opus 4.7 — 1M context, $5/$25 per MTok). It is also registered live as an active model on `ai_provider_registry/anthropic` (`models[0]`, `sort_order: 1`). The fallback is functional, not stale. Two caveats worth recording rather than acting on:
  - It is **not the newest** model — `claude-opus-5` supersedes it at the same $5/$25 pricing. The fallback being an older model is a cost/quality choice, not a bug.
  - `DEFAULT_MODEL_KEY` at [aiConfig.ts:20](backend/functions/src/lib/aiConfig.ts#L20) is a **hardcoded constant**, not an `admin_settings` key, so it cannot be changed from the admin surface this tally builds. Carried to Task K2.
  Two additional facts the tally should know: (a) **`fallback_model_key` is null on all 9 live routing docs** and is never read by `getAiConfigForWorkflow` — grep confirms no reader; the only fallback that exists is the hardcoded `SEEDED_DEFAULT`. (b) The `OpenAIAdapter` ([aiConfig.ts:97-106](backend/functions/src/lib/aiConfig.ts#L97-L106)) and `GeminiAdapter` (`:109-118`) are stubs that `throw new Error("… not yet configured")`, so the provider dropdown this page renders must not offer them as selectable — both are `is_active: false` live, which currently prevents that.
Edit-surface check: **clean.** The declared surface (new FE page + route + `api.ts`) is sufficient; the backend is complete and gated. One note: `frontend/src/pages/AIAutomationPillarPage.tsx` and `Sidebar.tsx` would each need a nav entry for the page to be reachable — those are outside the declared surface. Carried to Task D.

---

## P1-5 — Tests
Edit surface (from Build Plan): `services/completionCompute.test.ts`, `package.json` test script
Fields/collections/endpoints/states this tally writes or renames: none.
Blast radius:
  Backend readers/writers: [completionCompute.test.ts](backend/functions/src/services/completionCompute.test.ts) — hand-rolled assertions, no framework. Header at `:6-7` documents the run command: `cd backend/functions && npx tsc && node lib/services/completionCompute.test.js`.
  Frontend readers/renderers: NONE (zero FE tests — see Task N3)
  Scripts (seed/migration): NONE
  Composite indexes / Security rules: NONE
  Downstream consumers: NONE
  Live Firestore: N/A (pure functions, no Firestore mocking — `:4`)
Build Plan "?" markers on this tally: none.
Edit-surface check: **SCOPE RISK — the declared surface names "`package.json` test script", but there are three `package.json` files and no root one.** `backend/functions/package.json:8-14` has no `test` script; `scripts/package.json` and `scripts/seed/package.json` are unrelated. There are **four other test files** that a `test` script would need to cover or deliberately exclude: `lib/brandRegistry.test.ts` (33 pass), `lib/departmentRegistry.test.ts` (38 pass), `lib/parseAdditionalImageUrls.test.ts` (10 pass), `middleware/requireSchedulerOIDC.test.ts` (18 pass). All five live outside the one file named in the surface.
Additional fact for this tally: **`completionCompute.test.js` currently fails 4 of 34 assertions** — `2b all-AI ai_blockers cnt`, `2c all-AI hint prefix`, `4a mixed ai_blockers cnt`, `4c mixed hint = AI first` — and **exits 0 anyway**. Wiring it into a `test` script as-is would report green. Full detail in `tests-and-dependencies.md`.

---

## P1-6 — Housekeeping (no code)
Edit surface (from Build Plan): none
Fields/collections/endpoints/states this tally writes or renames: none
Blast radius: **N/A — no code change.** The two markers below are the deliverable.
Build Plan "?" markers on this tally:

**"FR-23 did Weekly Ops Import replace separate imports" → NO.**
  The `Family` union covers two values ([ImportHubPage.tsx:31](frontend/src/pages/ImportHubPage.tsx#L31), [api.ts:662](frontend/src/lib/api.ts#L662)), but that union governs only the two generic `ImportCard`s. The Import Hub actually renders **five** import cards at [ImportHubPage.tsx:307-323](frontend/src/pages/ImportHubPage.tsx#L307-L323):
  | Card | Component | Backend | Gate |
  |---|---|---|---|
  | Full Product Import | `ImportCard family="full-product"` (`:309`) | `importFullProduct.ts` | **NONE** |
  | Weekly Operations Import | `ImportCard family="weekly-operations"` (`:312`) | `importWeeklyOperations.ts` | **NONE** |
  | MAP Policy Import | `MapPolicyImportCard` (`:315`) | `mapImport.ts` | `requireRole([map_analyst])` |
  | Site Verification Import | `SiteVerificationImportCard` (`:318`) | `siteVerificationImport.ts` | `requireRole(operatorRoles)` |
  | **Sales Import** | **`SalesImportCard` (`:321`, defined `:1007-1120`)** | `importSales.ts` | **NONE** |
  The Sales import has its own three `api.ts` functions — `salesUpload` ([:730](frontend/src/lib/api.ts#L730)), `salesCommit` ([:743](frontend/src/lib/api.ts#L743)), `fetchSalesStatus` ([:753](frontend/src/lib/api.ts#L753)) — called at `ImportHubPage.tsx:1018`, `:1038`, `:1052`. **Nothing was replaced.** Five import families coexist, and the three ungated ones are Full Product, Weekly Operations and Sales.

**"FR-25 is `Hold` fully retired" → NOT RETIRED — and it does not work.**
  `Hold` is live end to end: `POST /api/v1/buyer-actions/hold` at [buyerActions.ts:79-127](backend/functions/src/routes/buyerActions.ts#L79-L127) (`requireAuth` only). FE wiring: [api.ts:1217](frontend/src/lib/api.ts#L1217), [roleGates.ts:19](frontend/src/lib/roleGates.ts#L19) (`canCallBuyerHold`), [CockpitDrawer.tsx:81](frontend/src/components/cockpit/CockpitDrawer.tsx#L81)/`:85`/`:146`/`:311-315` (keyboard `h`), [CockpitCadenceSection.tsx:208](frontend/src/components/cockpit/CockpitCadenceSection.tsx#L208).
  `Hold` is **not** a `cadence_state` value — [types/cadence.ts:7-11](backend/functions/src/types/cadence.ts#L7-L11) defines exactly `assigned | unassigned | rule_conflict | excluded`. It is a separate boolean, `products.cadence_hold`.
  **`cadence_hold` has exactly one reference in the entire repository — the write at [buyerActions.ts:101](backend/functions/src/routes/buyerActions.ts#L101). Nothing reads it.** `grep -rn cadence_hold backend/functions/src frontend/src scripts` returns that single line.
  Consequence: the handler does two things — it sets `cadence_hold: true` (read by nothing) and `in_cadence_review_queue: false` (`:107`), which does remove the row from the buyer queue. But [cadenceEngine.ts:515](backend/functions/src/services/cadenceEngine.ts#L515) unconditionally writes `in_cadence_review_queue: true` on every re-assignment and **never checks `cadence_hold`**. The next engine run puts the product straight back in the queue. **Hold does not hold.** Carried to Task I9 and Task J3.
Edit-surface check: N/A — no code change. Both answers imply follow-up work outside this tally.

---

## Phase 1 summary

| Tally | ? markers | Converted | Out-of-surface consumers |
|---|---|---|---|
| P1-0 | 0 | — | 0 |
| P1-1 | 1 | 1 CONFIRMED | 0 (7 of the 10 open routes are live operator surfaces; 3 `ai-enrich` routes have no caller) |
| P1-2 | 1 | 1 **NOT FOUND** | **10** |
| P1-3 | 0 | — | 0 |
| P1-4 | 1 | 1 **CONFIRMED VALID** | 2 (`AIAutomationPillarPage.tsx`, `Sidebar.tsx` for reachability) |
| P1-5 | 0 | — | **5** (4 sibling test files + the absent root `package.json`) |
| P1-6 | 2 | 1 CONFIRMED (partial), 1 **CONFIRMED FALSE** | n/a |
| **Total** | **5** | **4 CONFIRMED · 1 NOT FOUND** | **17** |
