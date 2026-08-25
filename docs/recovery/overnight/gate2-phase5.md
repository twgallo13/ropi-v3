# TASK A — Gate 2 maps: Phase 5 (Settings + surfaces)

Template per §3 TASK A. Repo @ `2698e48`; live reads against `ropi-aoss-dev`.

---

## P5-1 — Decorative settings
Edit surface (from Build Plan): six pages: ExportProfiles, ImportTemplates, SearchSettings, CommentThreads, LaunchSettings, SopPanels
Fields/collections/endpoints/states this tally writes or renames: six collections and their six CRUD routers.
Blast radius:
  Backend readers/writers — each collection is touched by **exactly one** file, its own CRUD router:
  | Collection | Router | Handlers | Any consumer outside the router? |
  |---|---|---|---|
  | `export_profiles` | [exportProfiles.ts](backend/functions/src/routes/exportProfiles.ts) (`:75`, `:91`, `:142`, `:218`, `:260`) | 5 | **NONE** |
  | `import_templates` | [importTemplates.ts](backend/functions/src/routes/importTemplates.ts) (`:49`, `:65`, `:109`, `:176`, `:217`) | 5 | **NONE** |
  | `search_settings` | [searchSettings.ts](backend/functions/src/routes/searchSettings.ts) (`:63`, `:79`, `:124`, `:174`, `:237`) | 5 | **NONE** |
  | `comment_threads` | [commentThreads.ts](backend/functions/src/routes/commentThreads.ts) (`:51`, `:67`, `:107`, `:175`, `:217`) | 5 | **NONE** |
  | `launch_settings` | [launchSettings.ts](backend/functions/src/routes/launchSettings.ts) (`:59`, `:75`, `:120`, `:169`, `:232`) | 5 | **NONE** |
  | `sop_panels` | [sopPanels.ts](backend/functions/src/routes/sopPanels.ts) (`:57`, `:73`, `:117`, `:184`, `:225`) | 5 | **NONE** |
  Verified by `grep -rn '"<collection>"' backend/functions/src frontend/src scripts` for each of the six: every hit is inside the collection's own router (plus, for `sop_panels`, the seed script `scripts/seed/seed-sop-panels.js:22`).
  Frontend readers/renderers: one admin page each — [ExportProfilesPage.tsx](frontend/src/pages/ExportProfilesPage.tsx) (`/admin/pipeline/export-profiles`), [ImportTemplatesPage.tsx](frontend/src/pages/ImportTemplatesPage.tsx) (`/admin/pipeline/import-templates`), [SearchSettingsPage.tsx](frontend/src/pages/SearchSettingsPage.tsx) (`/admin/infrastructure/search`), [CommentThreadsPage.tsx](frontend/src/pages/CommentThreadsPage.tsx) (`/admin/governance/comment-threads`), [LaunchSettingsPage.tsx](frontend/src/pages/LaunchSettingsPage.tsx) (`/admin/experience/launch-settings`), [SopPanelsPage.tsx](frontend/src/pages/SopPanelsPage.tsx) (`/admin/experience/sop-panels`). All six are mounted in `App.tsx` (`:212`, `:218`, `:220`, `:221`, `:219`, `:223`) and all six have a `Sidebar.tsx` entry (`:107`, `:106`, `:137`, `:117`, `:127`, `:126`).
  Scripts: only `scripts/seed/seed-sop-panels.js`.
  Composite indexes: NONE for any of the six.
  Security rules: NONE (deny-all).
  Downstream consumers: **NONE for any of the six.** No service, no export path, no import path, no UI outside the admin page itself reads any of these collections.
  Live Firestore: **`export_profiles` 0 docs · `import_templates` 0 · `search_settings` 0 · `comment_threads` 0 · `launch_settings` 0 · `sop_panels` 5 docs** (`cadence_review_overview`, `completion_queue_overview`, `export_center_overview`, `import_hub_overview`, `launch_admin_overview`).
Build Plan "?" markers on this tally: **"confirm zero consumers for each collection" → CONFIRMED for all six.** Each collection is read and written only by its own CRUD router; nothing else in the repo references it. Five of the six are also **empty live** — only `sop_panels` has data (5 docs), and even those 5 are read by nothing (the SOP content is never rendered outside the admin editor).
  Two collections that look similar but are **NOT** decorative and should not be swept up:
  - **`guided_tours`** — 5 live docs; consumed by [tours.ts:21](backend/functions/src/routes/tours.ts#L21) (`GET /api/v1/tours/:hub`), which feeds `TourLoader.tsx` / `useTours.ts` / `GuidedTour.tsx`.
  - **`feature_toggles`** — has a would-be consumer, [featureToggleCache.ts:30](backend/functions/src/lib/featureToggleCache.ts#L30) `isFeatureEnabled()`. But see **FINDING A-P5-1-a**: that function is never called, and the collection is empty live. It is decorative *in effect* while not being on the tally's list.
Edit-surface check: **clean.** The six pages are the whole surface for the frontend half. Note that removing the pages leaves six routers, six route mounts in `index.ts` (`:153-159`), six `Sidebar.tsx` entries and ~30 `api.ts` functions — all outside the declared "six pages". If the tally means to delete the feature rather than the page, the surface is larger.

**[FINDING A-P5-1-a] `isFeatureEnabled()` is never called; the feature-toggle system is defined but never checked.**
[featureToggleCache.ts:30](backend/functions/src/lib/featureToggleCache.ts#L30) exports `isFeatureEnabled(toggleKey)`. The only import of the module anywhere is [featureToggles.ts:27](backend/functions/src/routes/featureToggles.ts#L27), which imports `clearFeatureToggleCache` — the cache-buster, not the reader. So a toggle can be created, cached and cleared, and never consulted. Live `feature_toggles` is empty. Separately, `admin_settings/feature_flags` holds a **second, unrelated** set of 7 flags (`enable_ai_descriptions`, `enable_smart_rules`, `enable_dynamic_pricing`, `enable_multi_currency`, `enable_analytics_dashboard`, `enable_feed_export`, `enable_bulk_import`) which nothing reads either. Carried to Task I8 and K3.

---

## P5-2 — Remove duplicate surfaces
Edit surface (from Build Plan): `App.tsx:169-170` legacy pricing page; MapPolicyPage vs CockpitMapSection; SiteVerificationReviewPage vs SiteVerificationTab
Fields/collections/endpoints/states this tally writes or renames: routes and page components only.
Blast radius:
  **(a) Legacy pricing page — CONFIRMED duplicate.**
  [App.tsx:169](frontend/src/App.tsx#L169) redirects `/pricing-discrepancy` → `/buyer-review?tab=pricing`. [App.tsx:170](frontend/src/App.tsx#L170) mounts [PricingDiscrepancyPage.tsx](frontend/src/pages/PricingDiscrepancyPage.tsx) at `/pricing-discrepancy-legacy`. **`/pricing-discrepancy-legacy` has no `Sidebar.tsx` entry** — it is reachable only by typing the URL. Both surfaces call the same backend: [pricingDiscrepancy.ts:31](backend/functions/src/routes/pricingDiscrepancy.ts#L31) (`GET /`) and `:97` (`POST /:mpn/resolve`). Removing the page leaves the router untouched.
  **(b) MapPolicyPage vs CockpitMapSection — NOT a straight duplicate.**
  [App.tsx:157](frontend/src/App.tsx#L157) mounts [MapPolicyPage.tsx](frontend/src/pages/MapPolicyPage.tsx) at `/map-policy`, with `:158`/`:159` redirecting the legacy `/map-conflict-review` and `/map-removal-review` into it via `?tab=`. [CockpitMapSection.tsx](frontend/src/components/cockpit/CockpitMapSection.tsx) is a **per-product section** inside the Buyer Cockpit drawer ([CockpitTabs.tsx:5](frontend/src/components/cockpit/CockpitTabs.tsx#L5)). One is a cross-product queue, the other is one product's MAP state. Shared backend: [mapReview.ts](backend/functions/src/routes/mapReview.ts) (4 handlers). The **already-removed** duplicates are [MapConflictReviewPage.tsx](frontend/src/pages/MapConflictReviewPage.tsx) and [MapRemovalReviewPage.tsx](frontend/src/pages/MapRemovalReviewPage.tsx) — **both files still exist and are still imported and routed?** No: `App.tsx` routes only `/map-policy`; the two page files exist but are consumed by `MapPolicyPage` as its tab bodies. Confirmed by the import graph, not orphans.
  **(c) SiteVerificationReviewPage vs SiteVerificationTab — NOT a duplicate either.**
  [App.tsx:171](frontend/src/App.tsx#L171) mounts [SiteVerificationReviewPage.tsx](frontend/src/pages/SiteVerificationReviewPage.tsx) at `/site-verification` (a cross-product review queue backed by `GET /api/v1/site-verification/review`). [SiteVerificationTab.tsx](frontend/src/components/SiteVerificationTab.tsx) is rendered inside [ProductDetailPage.tsx:626](frontend/src/pages/ProductDetailPage.tsx#L626) for one product, fed by the `site_verification` map on the product detail payload. Different scope, different data source. The genuinely duplicated element is the **action set** — both surfaces call the same three POSTs (`mark-live`, `flag`, `reverify`).
  Backend readers/writers: no backend change implied by any of the three.
  Scripts / indexes / rules: NONE.
  Live Firestore: `map_policies` **255 docs** (the largest non-`audit_log` collection); `site_verification` map on **1** product.
Build Plan "?" markers on this tally: none.
Edit-surface check: **clean for (a); (b) and (c) are mischaracterised as duplicates in the plan.** Recording rather than redesigning: only the legacy pricing page is a true duplicate surface. The other two pairs are queue-vs-detail views of the same data, which is a normal pattern. If the intent is to consolidate the *action set* in (c), that touches `SiteVerificationReviewPage.tsx` and `SiteVerificationTab.tsx` plus `api.ts` — the first two are named, `api.ts` is not.

---

## P5-3 — Honest gating
Edit surface (from Build Plan): `executive.ts:49/:69` gates vs `App.tsx:175`; PermissionsPage
Fields/collections/endpoints/states this tally writes or renames: route gates and nav visibility.
Blast radius:
  Backend readers/writers — the executive router's gates, verified verbatim:
  | Path | file:line | `requireRole` |
  |---|---|---|
  | `GET /api/v1/executive/health` | [executive.ts:46-49](backend/functions/src/routes/executive.ts#L46-L49) | `["head_buyer"]` (`requireRole` on **:49**) |
  | `GET /api/v1/executive/throughput` | [executive.ts:66-69](backend/functions/src/routes/executive.ts#L66-L69) | `["head_buyer"]` (on **:69**) |
  | `GET /api/v1/executive/channel-disparity` | [:123](backend/functions/src/routes/executive.ts#L123) | `["buyer","head_buyer"]` |
  | `GET /api/v1/executive/buyer-performance` | [:223](backend/functions/src/routes/executive.ts#L223) | `["buyer","head_buyer"]` |
  | `GET /api/v1/executive/buyer-performance/:buyer_uid` | [:263](backend/functions/src/routes/executive.ts#L263) | `["buyer","head_buyer"]` |
  | `POST /api/v1/executive/jobs/weekly-snapshots` | [:296](backend/functions/src/routes/executive.ts#L296) | `["admin"]` |
  | `POST /api/v1/executive/jobs/buyer-performance` | [:311](backend/functions/src/routes/executive.ts#L311) | `["admin"]` |
  | `POST /api/v1/executive/jobs/weekly-advisory` | [:326](backend/functions/src/routes/executive.ts#L326) | `["admin","head_buyer"]` |
  (The Build Plan cites `:49`/`:69` — those are exactly the `requireRole` lines. Confirmed, no drift.)
  Frontend readers/renderers: **[App.tsx:175](frontend/src/App.tsx#L175)** — `<Route path="/executive" element={<ExecutiveDashboardPage />} />`, inside `RequireAuth` + `Layout` but with **no `RoleGate`**. Across all 69 routes in `App.tsx`, **exactly one** is wrapped in `RoleGate`: `/admin/component-demo` at [:225-231](frontend/src/App.tsx#L225-L231). [Sidebar.tsx:60-76](frontend/src/components/Sidebar.tsx#L60-L76) lists "Executive Dashboard" (`/executive`) and "Buyer Performance" (`/buyer-performance`) under an Intelligence group.
  [PermissionsPage.tsx](frontend/src/pages/PermissionsPage.tsx) — reads `GET /api/v1/admin/role-permissions` ([:37](frontend/src/pages/PermissionsPage.tsx#L37)), which serves [lib/rolePermissions.ts:16-29](backend/functions/src/lib/rolePermissions.ts#L16-L29). Its own header (`:10`) calls it a "source-of-truth view of role surfacing in the codebase"; `rolePermissions.ts:5` says it is **hand-maintained** ("codegen DROPPED"). So the Permissions page renders a hand-written description of the gates, not the gates.
  Scripts / indexes: NONE. Security rules: NONE.
  Downstream consumers: every role-gated nav item; the Permissions matrix.
  Live Firestore: `users` role histogram `{admin: 5, buyer: 4, product_ops: 2, owner: 1, head_buyer: 1, map_analyst: 1}`.
Build Plan "?" markers on this tally: none.
Edit-surface check: **SCOPE RISK — 2 items outside the declared surface.**
  1. **`Sidebar.tsx`** shows the Executive Dashboard and Buyer Performance links to every logged-in user. The surface names `App.tsx:175` and `PermissionsPage` but not the nav that leads there.
  2. **`middleware/roles.ts:30`** — any "honest gating" statement is incomplete without it: `admin` and `owner` are silently appended to every `requireRole` list, so the Permissions page's matrix is honest only if it shows that bypass. It currently renders `CANONICAL_ROLES` rows with no bypass column.

**[FINDING A-P5-3-a] Executive Dashboard is shown to every logged-in user and 403s for most of them.**
`/executive` has no frontend gate ([App.tsx:175](frontend/src/App.tsx#L175)) and a `Sidebar.tsx` entry visible to all roles, while `GET /api/v1/executive/health` and `/throughput` require `head_buyer` ([executive.ts:49](backend/functions/src/routes/executive.ts#L49), [:69](backend/functions/src/routes/executive.ts#L69)). Live, that is **7 of 14 users** who see the link and get an error page: 4 `buyer`, 2 `product_ops`, 1 `map_analyst`. The 5 `admin` and 1 `owner` pass via the `roles.ts:30` bypass; the 1 `head_buyer` passes directly. Severity: **Misleads**. Carried to Task G9.

---

## P5-4 — Completion Rules
Edit surface (from Build Plan): `Sidebar.tsx:99`, `AIAutomationPillarPage.tsx:8` placeholder
Fields/collections/endpoints/states this tally writes or renames: none — a placeholder nav entry.
Blast radius:
  Backend readers/writers: **NOT FOUND.** There is no completion-rules route, service, or collection. The nearest existing machinery is `attribute_registry.required_for_completion` + `depends_on`, evaluated in [completionCompute.ts:127-160](backend/functions/src/services/completionCompute.ts#L127-L160).
  Frontend readers/renderers — both declared lines confirmed verbatim:
  - **[Sidebar.tsx:99](frontend/src/components/Sidebar.tsx#L99)** — `{ label: "Completion Rules", comingLabel: "B.3" }`. Note it has **no `path` key at all**, so it renders as a non-link. That is the correct shape for a placeholder — it is not a dead link.
  - **[AIAutomationPillarPage.tsx:8](frontend/src/pages/AIAutomationPillarPage.tsx#L8)** — `{ title: "Completion Rules", description: "Blocking vs warning rules for publishing.", href: "/admin/ai-automation/completion-rules", status: "coming", comingLabel: "Coming in B.3" }`. This one **does** carry an `href`, and **`/admin/ai-automation/completion-rules` is not among the 69 routes in `App.tsx`.** Whether it is a dead link depends on `AdminNavCard` honouring `status: "coming"`; the two placeholders are shaped inconsistently regardless. Carried to Task G8.
  Scripts / indexes / rules: NONE.
  Downstream consumers: NONE.
  Live Firestore: N/A — no collection exists.
Build Plan "?" markers on this tally: none.
Edit-surface check: **clean.** Both declared lines are exactly the two placeholders. One correction to the plan's line reference: `Sidebar.tsx:99` is the Completion Rules entry — confirmed, no drift.
Additional fact for whoever builds this: the "blocking vs warning" distinction the placeholder promises does not exist in the model today. `completionCompute.ts` has exactly one severity — a required field is either satisfied or a blocker (`:154`, `:158`). The only near-neighbour is the AI-blocker split (`ai_blockers`, `:167-174`), which is a *source* distinction, not a severity. And per **FINDING A-P2-a**, three of the 14 currently-required fields cannot be satisfied at all, so any new rules surface inherits an already-unsatisfiable required set.

---

## Phase 5 summary

| Tally | ? markers | Converted | Out-of-surface consumers |
|---|---|---|---|
| P5-1 | 1 | 1 CONFIRMED (zero consumers, all six) | 0 as declared (larger if deleting the feature) |
| P5-2 | 0 | — | **1** (`api.ts`), plus 2 of 3 pairs are not duplicates |
| P5-3 | 0 | — | **2** (`Sidebar.tsx`, `middleware/roles.ts:30`) |
| P5-4 | 0 | — | 0 |
| **Total** | **1** | **1 CONFIRMED** | **3** |

---

# TASK A — overall totals

| Phase | Tallies | "?" markers | CONFIRMED | NOT FOUND | N/A | Out-of-surface consumers |
|---|---|---|---|---|---|---|
| 1 | 7 | 5 | 4 | 1 | 0 | 17 |
| 2 | 12 | 13 | 12 | 0 | 1 | ~115 |
| 3 | 3 | 3 | 3 | 0 | 0 | ~21 |
| 4 | 3 | 3 | 3 | 0 | 0 | 7 |
| 5 | 4 | 1 | 1 | 0 | 0 | 3 |
| **Total** | **29** | **25** | **23** | **1** | **1** | **~163** |

Tallies with out-of-surface consumers (scope risk), by id: **P1-2, P1-4, P1-5, P2-1a, P2-1b, P2-2, P2-3a, P2-3b, P2-5, P2-6, P2-7, P3-1, P3-2, P3-3, P4-2, P4-3, P5-2, P5-3** — **18 of 29**.
