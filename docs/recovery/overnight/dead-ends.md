# TASK I — Dead ends and dead code

Repo @ `2698e48`; live reads against `ropi-aoss-dev`. Route reconciliation done by parsing all 202 handlers from the 47 mounted routers against every `${BASE}/api/v1/...` template literal in `frontend/src/lib/api.ts` (133 distinct paths), normalising `:param` ↔ `${interpolation}` and trailing-slash/query artifacts on both sides.

---

## I1 — Backend routes with no frontend caller

**14 of 202.** Excludes nothing by default; the intentional categories are labelled.

| Method | Path | file:line | Category |
|---|---|---|---|
| GET | `/api/v1/admin/ai/workflows/:workflow_key` | [aiPlane.ts:374](backend/functions/src/routes/aiPlane.ts#L374) | **Genuinely uncalled** — the P1-4 gap |
| PUT | `/api/v1/admin/ai/workflows/:workflow_key` | [aiPlane.ts:401](backend/functions/src/routes/aiPlane.ts#L401) | **Genuinely uncalled** — the P1-4 gap |
| POST | `/api/v1/ai-enrich/name/:mpn` | [aiEnrichment.ts:166](backend/functions/src/routes/aiEnrichment.ts#L166) | **Genuinely uncalled — and ungated** |
| POST | `/api/v1/ai-enrich/color/:mpn` | [aiEnrichment.ts:180](backend/functions/src/routes/aiEnrichment.ts#L180) | **Genuinely uncalled — and ungated** |
| POST | `/api/v1/ai-enrich/run-pending` | [aiEnrichment.ts:194](backend/functions/src/routes/aiEnrichment.ts#L194) | **Genuinely uncalled — and ungated. Up to 200 paid AI calls per request** |
| POST | `/api/v1/buyer-actions/custom-price` | [buyerActions.ts:242](backend/functions/src/routes/buyerActions.ts#L242) | **Genuinely uncalled** — `buyerPriceOverride` service is fully built behind it |
| POST | `/api/v1/buyer-actions/step-override` | [buyerActions.ts:296](backend/functions/src/routes/buyerActions.ts#L296) | **Genuinely uncalled** — `applyStepOverride` service is fully built behind it |
| POST | `/api/v1/executive/jobs/weekly-snapshots` | [executive.ts:296](backend/functions/src/routes/executive.ts#L296) | **Genuinely uncalled** — the scheduler calls the `/internal/jobs` twin instead |
| POST | `/api/v1/executive/jobs/buyer-performance` | [executive.ts:311](backend/functions/src/routes/executive.ts#L311) | **Genuinely uncalled** — no scheduler twin either |
| GET | `/api/v1/launches/upcoming` | [launches.ts:282](backend/functions/src/routes/launches.ts#L282) | **Genuinely uncalled** |
| DELETE | `/api/v1/launches/unsubscribe` | [launches.ts:225](backend/functions/src/routes/launches.ts#L225) | Intentional — public unsubscribe, called from an email link |
| POST | `/api/v1/internal/jobs/promote-scheduled` | [internalJobs.ts:83](backend/functions/src/routes/internalJobs.ts#L83) | Intentional — Cloud Scheduler |
| POST | `/api/v1/internal/jobs/daily-staleness-sweep` | [internalJobs.ts:103](backend/functions/src/routes/internalJobs.ts#L103) | Intentional — Cloud Scheduler |
| POST | `/api/v1/internal/jobs/weekly-snapshots` | [internalJobs.ts:118](backend/functions/src/routes/internalJobs.ts#L118) | Intentional — Cloud Scheduler |

**Excluding the 4 intentional (scheduler + public unsubscribe): 10 genuinely uncalled routes.**

Two of them are notable beyond being dead:
- **`POST /buyer-actions/custom-price` and `/step-override`** each front a complete, tested service ([buyerPriceOverride.ts](backend/functions/src/services/buyerPriceOverride.ts), 350+ lines with an eligible-states gate at `:253`; [applyStepOverride.ts](backend/functions/src/services/applyStepOverride.ts)) that writes `buyer_actions`, mutates `pricing_domain_state`, and emits audit entries. `frontend/src/lib/api.ts` exposes `buyerHold`, `buyerMarkdown`, `buyerSaveForSeason`, `buyerPostponeReview` — but no wrapper for these two. Substantial finished backend behind no door.
- **`POST /executive/jobs/buyer-performance`** is the only way to trigger a `buyer_performance` rebuild on demand, and nothing calls it — not the FE, and not Cloud Scheduler (`internalJobs.ts` has no twin).

## I2 — Frontend `api.ts` functions with no backend route

**NONE.** All 133 distinct paths in `api.ts` resolve to a mounted handler. This is a clean result and worth stating plainly — the FE→BE contract has no broken paths.

(The generic `uploadImport(family, …)` at [api.ts:662-673](frontend/src/lib/api.ts#L662-L673) constructs `/api/v1/imports/${family}/upload` and `/…/${batchId}/commit`; the `family` union is typed to `"full-product" | "weekly-operations"`, both of which mount.)

## I3 — Pages with no route

**1 orphan, 2 false positives.**

| Page | Verdict |
|---|---|
| **[AdminSettingsPage.tsx](frontend/src/pages/AdminSettingsPage.tsx)** | **ORPHANED.** Not mounted in `App.tsx`, and **never imported anywhere** — `grep -rn "AdminSettingsPage"` returns only comments in the four pages that were extracted *from* it (`SmtpSettingsPage.tsx:6`, `SystemVariablesPage.tsx:6`, `UserManagementPage.tsx:2/:5/:55/:720`, `ProductListPage.tsx:63`, `ModalTabBar.tsx:2`) plus `App.tsx:181`'s comment. The file exports a default component that nothing renders. **Dead file.** |
| `MapConflictReviewPage.tsx` | Not mounted directly, but **imported and rendered** by `MapPolicyPage.tsx:19`/`:81` as a tab body. Not dead. |
| `MapRemovalReviewPage.tsx` | Same — `MapPolicyPage.tsx:20`/`:83`. Not dead. |

## I4 — Routes with no nav entry

**22 of 71 route entries** are reachable only by URL. Collected nav targets from `Sidebar.tsx`, `MobileBottomNav.tsx`, `MorePage.tsx`, `DashboardPage.tsx` and all 7 pillar pages.

| Route | Intentional? |
|---|---|
| `/login` | **Yes** — auth entry |
| `/` | **Yes** — redirects to `/dashboard` |
| `/more` | **Yes** — the mobile nav renders it |
| `/launches` | **Yes** — public calendar, deliberately outside `RequireAuth` ([App.tsx:139-140](frontend/src/App.tsx#L139-L140)). *This is exactly what P4-1 is about.* |
| `/cadence-review` | **Yes** — redirect → `/buyer-review` |
| `/admin/cadence-rules` · `/admin/prompt-templates` · `/admin/smart-rules` · `/admin/smart-rules/new` | **Yes** — legacy redirects to the `/admin/<pillar>/…` canonical mounts |
| `/map-conflict-review` · `/map-removal-review` | **Yes** — redirects → `/map-policy?tab=…` |
| `/pricing-discrepancy` | **Yes** — redirect → `/buyer-review?tab=pricing` |
| `/admin/settings` · `/admin` · `/admin/pricing-guardrails` · `/admin/export-profiles` · `/admin/permissions` · `/admin/pipeline/review-active-overrides` | **Yes** — all redirects |
| `/admin/ai-automation/smart-rules/new` | **Yes** — reached from the Smart Rules list page's "New" button |
| `/settings/notifications` | **Probably not** — a real page (`NotificationSettingsPage`) with no nav entry anywhere. Reached only from the `UserMenu`/`NotificationBell` if at all |
| **`/pricing-discrepancy-legacy`** | **No** — a real page (`PricingDiscrepancyPage`) with no nav entry, superseded by the cockpit tab. **This is P5-2(a)'s target.** |
| **`/admin/component-demo`** | **No** — a component gallery; the only `RoleGate`-wrapped route in the app ([App.tsx:225-231](frontend/src/App.tsx#L225-L231)) |

**Genuinely unreachable-by-nav real pages: 3** — `/settings/notifications`, `/pricing-discrepancy-legacy`, `/admin/component-demo`. Everything else is a deliberate redirect, an auth entry, or the public calendar.

## I5 — Components never imported

**NONE.** All 52 components under `frontend/src/components/` are imported at least once. Clean result.

## I6 — Collections written but never read, and read but never written

**50 distinct collection names appear in `collection("...")` calls. 15 of them are not top-level live collections** — 12 legitimately (they are **subcollections**), and **3 are bugs**.

### Subcollections (correct — `listCollections()` returns only top-level)
`attribute_values` (31 refs) · `content_versions` (11) · `site_targets` (5) · `comments` (5) · `pricing_snapshots` (3) · `map_state` (1) · `errors` (1) · `settings` (2, under `users/{uid}/settings/notifications`).

### Empty-but-defined (the P5-1 family — routers exist, collections have 0 live docs)
`export_profiles` · `import_templates` · `search_settings` · `comment_threads` · `launch_settings` · `feature_toggles`. All six are **written and read only by their own CRUD router**. `sop_panels` is the same shape but has 5 live docs.

### **Three wrong-collection-name bugs**

| # | Code writes/reads | Correct name | Evidence | Effect |
|---|---|---|---|---|
| **I6-1** | `products/{id}/attributes/web_discount_cap` | **`attribute_values`** | [mapReview.ts:377-379](backend/functions/src/routes/mapReview.ts#L377-L379) — the *only* use of `attributes` anywhere; the other 31 refs all use `attribute_values` | MAP conflict resolution mirrors `web_discount_cap` into a subcollection **nothing reads**. The export reads `attrs["web_discount_cap"]` from `attribute_values` ([exportSerializer.ts:186](backend/functions/src/services/exportSerializer.ts#L186)), so the operator's choice never reaches the CSV |
| **I6-2** | `collection("launches")` | **`launch_records`** | [dashboard.ts:201-205](backend/functions/src/routes/dashboard.ts#L201-L205) — every other launch reference uses `launch_records` (14 refs) | The Dashboard's `high_priority_launches` tile queries a **non-existent collection**. It returns empty every time, inside a `try` — so the tile silently shows nothing while 9 real `launch_records` exist |
| **I6-3** | `collection("buyer_assignments")` | **`cadence_assignments`** | [aiWeeklyAdvisory.ts:96](backend/functions/src/services/aiWeeklyAdvisory.ts#L96), [buyerPerformanceMatrix.ts:144](backend/functions/src/services/buyerPerformanceMatrix.ts#L144) — every other assignment reference uses `cadence_assignments` (21 refs) | Both readers wrap it in `try` and fall through to a secondary path, so it degrades silently. `buyer_assignments` does not exist live |

`grep -rn 'collection("auditLogs")'` → **no matches.** The only spelling used anywhere is `audit_log` (72 refs), which is also the live collection name. Appendix B's `auditLogs` (Task C, C7) does not exist.

### Live collections with no code reference

`_meta` and `system_config`.
- `system_config` is a **false positive** — [staleness.ts:9](backend/functions/src/lib/staleness.ts#L9) reads it as a path string constant (`const SYSTEM_CONFIG_DOC = "system_config/site_verification"`) rather than via `collection("system_config")`. Live: 1 doc, `site_verification`.
- **`_meta` is genuinely unreferenced** — no code reads or writes it.

### `orders` / `payments` / `sessions`
Not live, not referenced, but carrying **5 composite index entries**. See `open-questions.md` E6 — UNREFERENCED.

## I7 — Scripts never referenced

**152 script files. 131 (86%) are referenced by nothing** — not `package.json`, not any doc, not another script.

| Group | Referenced | Unreferenced |
|---|---|---|
| `scripts/` (top level) | 6 | 96 |
| `scripts/seed/` | 6 | 29 |
| `scripts/lib/` | 0 | 1 |
| `scripts/migrate/` | 0 | 1 |
| **Total** | **21** | **131** |

The 21 that are referenced: the 8 npm scripts in `scripts/seed/package.json` (`seed-attribute-registry.js`, `seed-site-registry.js`, `seed-smart-rules.js`, `seed-admin-settings.js`, `seed-ai-provider-registry.js`, `seed-ai-workflow-routing.js`, `backfill-rics-taxonomy.js`, plus `seed:all` chaining four of them), the 1 in `scripts/package.json` (`migrate-admin-tours-to-guided-tours.ts`), `deploy-dev.sh` (referenced by docs), and 9 that are only cross-referenced by other scripts.

Full unreferenced list is long; the clearly-disposable clusters are:
- **`_tmp-*` / `_frink-*` (5)** — named as temporary by their own filenames
- **`a4-*` / `a5-*` (11)** — one-off investigation scripts
- **`step15`–`step31`, `test-tally118*`, `test-step*` (9)** — superseded verification scripts
- **`tally-12x` / `tally-13x` / `tally-144-*` / `tally-168-*` (24)** — completed one-shot migrations
- **`d3b`–`d3e` (6)**, **`phase-4-4` / `phase5-*` (4)**, **`dump-*` (3)**, **`diagnostic-*` (3)**
- **`scripts/migrate/pascal-canonicalize-pricing-domain-state.js`** — the only file under `scripts/migrate/`, referenced by nothing, and it targets the same `pricing_domain_state` casing problem as the P1-2 script in Task C's C10

Two that should **not** be swept: `scripts/seed/seed-department-registry.js` and `scripts/seed/seed-taxonomy-rules.js` are the seeds of record for `department_registry` and the 13 live `Taxonomy: *` smart rules, despite being unreferenced by `package.json`.

## I8 — Feature flags defined but never checked, or checked but never defined

**Two independent flag systems. Neither is ever checked.**

| System | Definition | Consumer | Live |
|---|---|---|---|
| `feature_toggles` collection + `isFeatureEnabled()` | [featureToggleCache.ts:30](backend/functions/src/lib/featureToggleCache.ts#L30), 60s TTL cache; full CRUD at [featureToggles.ts](backend/functions/src/routes/featureToggles.ts) (5 handlers) + [FeatureTogglesPage.tsx](frontend/src/pages/FeatureTogglesPage.tsx) | **`isFeatureEnabled` is never called.** The module's only importer anywhere is `featureToggles.ts:27`, which imports `clearFeatureToggleCache` — the cache-buster, not the reader | **0 docs** |
| `admin_settings/feature_flags` | seeded doc holding 7 flags: `enable_ai_descriptions`, `enable_smart_rules`, `enable_dynamic_pricing`, `enable_multi_currency`, `enable_analytics_dashboard`, `enable_feed_export`, `enable_bulk_import` | **No reader.** `getAdminSettings` ([adminSettings.ts:21-32](backend/functions/src/services/adminSettings.ts#L21-L32)) reads only the 10 pricing keys | **1 doc, unread** |

The code is candid about it — [featureToggleCache.ts:15](backend/functions/src/lib/featureToggleCache.ts#L15): *"No consumer in PR 1 (consumer is featureToggles router in PR 2)."* PR 2 shipped the router, not a runtime consumer.

**Checked but never defined: NONE.**

There is a third, unrelated visibility mechanism that *does* work: `dashboard.ts` gates tiles on a `visible` set ([:197](backend/functions/src/routes/dashboard.ts#L197) — `if (visible.has("high_priority_launches"))`), which is role-derived rather than flag-derived.

## I9 — Buttons and actions that end nowhere

| # | Action | Evidence | Effect |
|---|---|---|---|
| **I9-1** | **Buyer Cockpit → Hold** | [buyerActions.ts:101](backend/functions/src/routes/buyerActions.ts#L101) writes `products.cadence_hold`; `grep -rn cadence_hold` across `backend/functions/src`, `frontend/src`, `scripts` returns **that one line**. [cadenceEngine.ts:515](backend/functions/src/services/cadenceEngine.ts#L515) unconditionally re-writes `in_cadence_review_queue: true` and never checks the flag | The button succeeds, the row leaves the queue, and the next engine run puts it back. **Hold does not hold** |
| **I9-2** | **SMTP Settings → Send Test** | [adminSettings.ts:96](backend/functions/src/routes/adminSettings.ts#L96) → `emailService.sendEmail`, which honours `admin_settings/email_provider`. All real launch email goes through [launchNotifier.ts:81](backend/functions/src/services/launchNotifier.ts#L81), hardcoded to SendGrid, which never reads that setting | A green test proves nothing about production email |
| **I9-3** | **AI Provider Registry → Test** (non-Anthropic) | [aiPlane.ts:579](backend/functions/src/routes/aiPlane.ts#L579) — `Provider '<x>' test not implemented`; the adapters themselves throw ([aiConfig.ts:105](backend/functions/src/lib/aiConfig.ts#L105), [:117](backend/functions/src/lib/aiConfig.ts#L117)) | Both non-Anthropic providers are `is_active: false` live, so this is currently unreachable — but the UI would offer it if either were activated |
| **I9-4** | **MAP conflict resolve → Web Discount Cap** | I6-1 — writes to `products/{id}/attributes/…`, a subcollection nothing reads | The operator's choice never reaches the export |
| **I9-5** | **Dashboard → high-priority launch alerts tile** | I6-2 — queries `collection("launches")`, which does not exist | Tile is permanently empty despite 9 live `launch_records` |
| **I9-6** | **Export Center → `site_targets` / push lists** | [exportSerializer.ts:198-199](backend/functions/src/services/exportSerializer.ts#L198-L199) — *"Phase 1: Push Lists not yet implemented — always []"* | `push_list_ids` is always an empty column. Honestly commented |
| **I9-7** | **Smart Rule Builder → Brand action** | `attribute_registry/brand_key` does not exist; [smartRules.ts:244-249](backend/functions/src/services/smartRules.ts#L244-L249) skips with `console.error` | Rule saves and validates, writes nothing, forever |
| **I9-8** | **Launch publish → notification email** | [launches.ts:645](backend/functions/src/routes/launches.ts#L645) is a bare `await notifyNewLaunch(published)`; the function returns `{sent:false, reason}` on a missing key/template and the caller discards it | Publish reports success whether or not any email was sent |

**No handler in `frontend/src` is a bare `console.log` or an empty function** — `grep -rn "onClick={() => console"` returns nothing, and the only `TODO`/`FIXME` strings in the frontend are the two `rel="noopener"` false positives. The dead actions above are all dead on the **backend** side, which is why they look like they work.

---

## Summary

| Check | Result |
|---|---|
| **I1** routes with no FE caller | **14** (10 genuine, 4 intentional) |
| **I2** api.ts paths with no route | **0** |
| **I3** pages with no route | **1** (`AdminSettingsPage.tsx`, also never imported) |
| **I4** routes with no nav entry | **22** (19 deliberate redirects/entries, **3 genuine**) |
| **I5** components never imported | **0** |
| **I6** wrong-collection bugs | **3** (`attributes`, `launches`, `buyer_assignments`) · 1 unreferenced live collection (`_meta`) · 5 unreferenced index entries (`orders`/`payments`/`sessions`) |
| **I7** unreferenced scripts | **131 of 152** |
| **I8** flags defined never checked | **2 systems, 0 consumers** |
| **I9** actions that end nowhere | **8** |

### The three worst

1. **I6-2 — the Dashboard's launch-alerts tile queries a collection that does not exist.** `collection("launches")` vs `launch_records`. Wrapped in `try`, so it returns empty forever while 9 real launch records sit unqueried. A silent wrong-name bug in a user-facing tile.
2. **I1 — two complete buyer-action services sit behind uncalled routes.** `custom-price` and `step-override` each front hundreds of lines of finished, state-mutating, audit-emitting service code with no `api.ts` wrapper. This is the largest block of finished-but-unreachable functionality in the repo.
3. **I7 — 86% of scripts are unreferenced**, including `scripts/migrate/pascal-canonicalize-pricing-domain-state.js`, which addresses the very casing defect Task C found live (C10). Knowing which of the 131 are safe to delete is itself now a research task.
