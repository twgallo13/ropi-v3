# OVERNIGHT AUDIT — ROPI AOSS Recovery (Gate 2 + full application audit)

**Purpose:** (1) convert every unverified blast-radius marker in the Build Plan into a verified fact so each tally can be dispatched with its Gate 2 map done; (2) a full application audit — security, workflows, dead ends, settings, data integrity, background jobs, tests, contracts — so nothing waits to be discovered mid-build.
**Mode:** long autonomous run, READ-ONLY, resumable, **repo-only (no Notion)**.
**Repo:** `twgallo13/ropi-v3` @ `main`. **Firestore:** `ropi-aoss-dev` via `GCP_SA_KEY_DEV`, reads only.
**Source of truth for this run:** this file in the repo (`docs/recovery/OVERNIGHT-AUDIT.md`). A reading/editing copy lives in Notion (Recovery anchor → "Overnight Gate 2 Audit"); if the Notion copy is edited, Lisa regenerates this file — the repo copy is what runs.

---

## 0. Absolute rules (read twice)

1. **READ-ONLY.** No commits, branches, pushes, deploys, Firestore/Storage writes, no secret values printed. Permitted: `npm install`, `npm run build`, the test suite, `git log/diff/show/branch -r`, grep/find/read, Firestore `.get()` only.
2. **Evidence or NOT FOUND.** Every claim carries `file:line`, a command + its output, or a Firestore doc id. If you cannot find it, write `NOT FOUND`. Never infer, reconstruct, or fill a gap.
3. **Never state an expected number.** Report raw counts and full lists. The architect compares afterwards.
4. **Blockers do not stop the run.** Record the blocker in the findings log, mark the task `BLOCKED`, move to the next task.
5. **Do not redesign.** You may record a concern or recommendation in the findings log; you may not change the plan.
6. **Checkpoint after every task** (see §2). If you are resuming, read the checkpoint first and continue from the first task not marked `DONE`.

## 1. Read first (REPO ONLY — do not use Notion)

This file is self-contained. **Appendix B** carries the full tally list, every edit surface, and every "?" marker. **Do not attempt to read Notion**; the repo is the source of truth for this run. Also read, from the repo:
- `docs/recovery/RECOVERY-ANCHOR.md` — state, rulings, roadmap
- `docs/recovery/PRE-BUILD-PROTOCOL.md` — Gate 2 defines what a blast-radius map must contain

If either file is missing, note it in the findings log and proceed from Appendix B alone.

## 2. Setup and checkpointing

Create `docs/recovery/overnight/` (DO NOT COMMIT anything under it). Files:

| File | Purpose |
|---|---|
| `PROGRESS.md` | Checkpoint. One line per task: `TASK-ID — DONE / BLOCKED / IN PROGRESS — timestamp`. Update after every task. |
| `FINDINGS-LOG.md` | Append-only. Every entry tagged `[FINDING]`, `[RECOMMENDATION]`, `[CONCERN]`, or `[BLOCKER]`, with the task id and evidence. This is the file the PO reads first. |
| `deep-map-department.md` | Task B1 |
| `deep-map-site.md` | Task B2 |
| `deep-map-brand.md` | Task B3 |
| `gate2-phase1.md` … `gate2-phase5.md` | Task A, one per phase |
| `contradictions.md` | Task C |
| `sequencing.md` | Task D |
| `open-questions.md` | Task E |
| `ux-defects.md` | Task G |
| `security.md` | Task H |
| `dead-ends.md` | Task I |
| `workflows.md` | Task J |
| `settings-and-hardcoding.md` | Task K |
| `data-integrity.md` | Task L |
| `background-and-silent-failures.md` | Task M |
| `tests-and-dependencies.md` | Task N |
| `contracts-and-roles.md` | Task O |
| `SUMMARY.md` | Task F |

Baseline before starting: record `git rev-parse HEAD`, `git status --porcelain` (must be clean), and the build + test results in `PROGRESS.md`.

## 3. Task order (highest value first — if the run dies, the important part exists)

### TASK B — Deep maps for the three highest-risk changes (do these FIRST)

Exhaustive. Every reference, no sampling. For each, produce a table with columns:
`Consumer | Kind (route/service/lib/script/CF/page/component/api.ts/index/rule/seed) | file:line | Reads or Writes | What breaks if the field is renamed or removed without touching this consumer`

**B1 — `department` and `department_key`.** Include: every route/service/lib; frontend pages/components; seed and migration scripts; `firebase/firestore.indexes.json` entries; `firebase/firestore.rules`; cadence rule target filters (query `cadence_rules` live — a known rule filters on `department_key equals Clothing`); smart rule conditions and action targets; `SmartRuleBuilderPage` legacy-field block; every report (`executive.ts`, `executiveProjections.ts`, `buyerPerformanceMatrix.ts`, `aiWeeklyAdvisory.ts`, `dashboard.ts`, `completionCompute.ts` throughput stamp); export serializer; AI Describe context builder; import alias-walk.
**B2 — `site_owner`, `website`, `site_registry`, `site_key`, `site_targets`.** Which is read where; what the export emits; what AI Describe and the AI Content Review site tabs use; what site verification keys on; brand registry `default_site_owner`.
**B3 — `brand` and `brand_key`.** Same treatment. Additionally flag every place the DISPLAY value (`brand`) is used for grouping, filtering, or matching rather than the key.

End each deep map with: total consumers found · live Firestore doc counts (docs carrying the field / docs with a non-empty value; non-empty = not null, not "", not [], not whitespace-only) · indexes referencing it · rules referencing it.

### TASK A — Gate 2 map for every Build Plan tally

For EVERY tally in Appendix B, use this template exactly:

```
## <Tally id> — <name>
Edit surface (from Build Plan): <files>
Fields/collections/endpoints/states this tally writes or renames: <list>
Blast radius:
  Backend readers/writers: <file:line …> | NOT FOUND
  Frontend readers/renderers: <file:line …> | NOT FOUND
  Scripts (seed/migration): <file:line …> | NOT FOUND
  Composite indexes: <index entries> | NONE
  Security rules: <rule lines> | NONE
  Downstream consumers: list filters / sort / search tokens / dropdown sources / export columns / AI context / reports / cadence rule filters / smart rule conditions / smart rule action targets / audit payloads — each with file:line or NONE
  Live Firestore: <docs carrying> / <docs non-empty> | N/A
Build Plan "?" markers on this tally: <each one → CONFIRMED (evidence) | NOT FOUND>
Edit-surface check: do the consumers above fall INSIDE the declared edit surface? List any consumer OUTSIDE it (this is a scope risk).
```

Order: Phase 1 tallies, then Phase 2, then 3, 4, 5. Checkpoint after each phase file.

**Overall task order:** B → A → C → D → E → G → H → I → J → K → L → M → N → O → F. If the run must be cut short, everything through H is the must-have; I–O are the full application audit and resume on the next run.

### TASK C — Contradiction sweep

For every specific-value claim in Appendix B and in `docs/recovery/RECOVERY-ANCHOR.md` — file paths, line numbers, field names, enum values, route paths, role names, counts — verify against the code. (The Notion Findings Register is NOT in scope for this run; Lisa sweeps it from your output.) Report each mismatch in `contradictions.md` as:
`Row/tally | What the plan says | What the code says | file:line`
Line-number drift of a few lines after no code change is NOT a contradiction; a wrong file, wrong field name, or wrong behaviour IS.

### TASK D — Sequencing violations

In `sequencing.md`: (1) any tally that depends on something a LATER tally provides; (2) any two tallies whose edit surfaces overlap in a way that would conflict; (3) any Phase 1 tally that touches a frozen item (`department_key`, `site_owner`/site model, buyer routing). Cite tally ids and file:line.

### TASK E — Named open questions

In `open-questions.md`, each answered with evidence or `NOT FOUND`:
- **E1.** Can smart rules write to ROOT product fields, or only to `attribute_values` registry attributes? Cite the write path in `smartRules.ts`.
- **E2.** Does `completionCompute`'s `depends_on` predicate support anything other than equality? Could it express "website INCLUDES Karmaloop" on a multi-select? Cite the evaluation code.
- **E3.** Which live `cadence_rules` filter on `department_key` (or `department`, `brand`, `brand_key`, `site_owner`)? List every rule doc id and its target filter.
- **E4.** Do the three site descriptions (Shiekh / Karmaloop / MLTD) exist as registry attributes, root product fields, or not at all?
- **E5.** What does the export CSV emit for brand, department, class, category, sub_category, website — field by field from `exportSerializer.ts`, including whether it reads root or attribute_values.
- **E6.** Are the `orders` composite indexes referenced by any code? If not, write UNREFERENCED.
- **E7.** Does anything reference `ropi-aoss-staging` or `ropi-aoss-prod` at RUNTIME (not only in deploy scripts)?
- **E8.** Where does `aiDescribe.ts` take the site from — the product's `website` field, `site_owner`, or the request body? Cite.
- **E9.** What does the AI enrichment `POST /name/:mpn` path do with `rics_long_description` / `rics_short_description`? Does anything else treat those two fields as prose?

### TASK G — Static UX-defect sweep (from code + live registry; no browser)

Produce `ux-defects.md`: one table, columns `Surface | Defect | Evidence (file:line / doc id) | Severity (Blocks work / Misleads / Cosmetic)`. Check each of the following; for each, list every instance found or write NONE:
- **G1 Shell pages** — pages that call no backend route (re-verify D2's list: AdminOverview, 6 pillar pages, legacy /admin/settings redirect, Completion Rules placeholder). For each: is it a deliberate nav hub or a dead surface?
- **G2 Read-only rendered as editable** — registry attributes with `is_editable == false` where `AttributeField.tsx` still renders an input/select/toggle a user can change. Cite the is_editable handling (or its absence) in `AttributeField.tsx`.
- **G3 Empty dropdowns** — `dropdown`/`select`/`multi_select` attributes whose live `dropdown_options` is empty AND whose `dropdown_source` resolves to nothing (`site_owner` is known; find all).
- **G4 Free text where a controlled list exists** — attributes with `field_type == text` for which a dropdown option list exists elsewhere (in the registry, the site registry, the brand registry, or the Master Attribute Sheet) — e.g. `material` text vs `material_fabric` multi_select.
- **G5 Required not marked** — attributes with `required_for_completion == true` that the editor renders without a required indicator. Cite the indicator logic.
- **G6 Source/reference fields that accept input** — inventory, media/image status, RO status, received dates, any `rics_*` value, rendered as editable inputs anywhere (Product Detail, Quick Edit, bulk panels).
- **G7 Duplicate labels on one tab** — two registry docs with the same `display_label` on the same `destination_tab` (known: "Material / Fabric" ×2, "Product Is Active" ×2; find all).
- **G8 Nav entries to placeholders** — sidebar or pillar links whose target is a "coming soon" label or a route that does not exist in `App.tsx`.
- **G9 Dead actions** — buttons whose handler is a no-op, calls a route that does not exist, or calls a route gated to a role the page is shown to (e.g. Executive Dashboard shown to buyers, API head_buyer-only).
- **G10 Groups shown regardless of context** — attribute `display_group`s with no `depends_on` on the group that only make sense for one department (e.g. "Footwear Details" on Accessories). List every group and whether it is conditional.
- **G11 Inconsistent casing/labels in dropdown values** — option lists mixing cases or near-duplicates (e.g. `Footwear` vs `FOOTWEAR` in any option list or live product values; `lace_up` vs "Lace-Up").
- **G12 Fields on the wrong tab** — registry `destination_tab` values that do not match any tab the editor renders, or attributes on `product_attributes` that the Master Attribute Sheet places elsewhere (report, do not judge).

Severity: **Blocks work** = an operator cannot complete a task or is led to enter bad data · **Misleads** = the screen implies something untrue (editable/required/available when not) · **Cosmetic** = layout/label only.

### TASK H — Security sweep

`security.md`. Cite file:line for everything.
- **H1 Route gate inventory.** Every Express route (method + path + file:line) with its gate: `requireAuth` only / `requireRole([...])` / `requireSchedulerOIDC` / NONE. Produce the full table. Then list every route with NONE — these are open to the internet.
- **H2 Public by design vs by accident.** For each NONE route, say whether the code or a comment marks it intentionally public (e.g. `/launches/public`, `/launches/subscribe`) or not.
- **H3 Firestore rules coverage.** From `firebase/firestore.rules`: which collections have explicit rules, which fall to the deny-all default, and whether any rule grants client write access beyond `users/{uid}`.
- **H4 Secrets and config.** Every `process.env.*` read, with file:line, and whether it is required at startup or read lazily. Any secret value logged, returned in a response, or written to Firestore.
- **H5 Input validation on writes.** For each import/upload/commit route and each admin POST/PUT: is the body validated (schema, type, size)? Cite the validator or write NONE.
- **H6 Frontend trust.** Any role/permission decision made only in the frontend with no matching backend gate (e.g. `AuthContext.tsx:31-33` fallback; `isAdminGlobal` bypasses).
- **H7 CORS and headers.** What `index.ts` sets for CORS; any `*` origin.

### TASK I — Dead ends and dead code

`dead-ends.md`. For each list, every instance with file:line, or NONE.
- **I1 Routes with no frontend caller** — backend routes no `api.ts` function or component calls (exclude scheduler + public + health).
- **I2 Frontend api.ts functions with no route** — calls to paths no router defines.
- **I3 Pages with no route** — page files under `frontend/src/pages` not mounted in `App.tsx`.
- **I4 Routes with no nav entry** — mounted routes reachable only by URL (list; note which are intentional detail pages).
- **I5 Components never imported.**
- **I6 Collections written but never read**, and **read but never written** (repo-wide grep on collection names; include `orders`, `payments`, `sessions`, `auditLogs` vs `audit_log`).
- **I7 Scripts never referenced** by package.json, docs, or other scripts (list `scripts/` and `scripts/seed/`).
- **I8 Feature flags / toggles** defined but never checked, or checked but never defined.
- **I9 Buttons and actions that end nowhere** — handlers that only `console.log`, `TODO`, or call a stub.

### TASK J — Workflow state machines

`workflows.md`. For each workflow below: list every state value that exists in code (enum, string literal, or Firestore value seen live), every transition (from → to, file:line that writes it, and what triggers it), **states with no exit (stuck states)**, **states nothing can enter (unreachable)**, and states that exist live but not in code (or vice versa).
- **J1 Completion** — `completion_state` (`completionCompute.ts`).
- **J2 Pricing domain** — `pricing_domain_state` (all writers from Task B/A; incl. `Loss-Leader Review Pending`, `Buyer Denied`, `Pricing Incomplete`, `Scheduled`, `Exported`).
- **J3 Cadence** — `cadence_state` + `cadence_assignments` lifecycle (`cadenceEngine.ts`, `buyerActions.ts`, hold/save-for-season/postpone).
- **J4 Launch** — `launch_records` status + readiness + publish + archive (`launches.ts`).
- **J5 Site verification** — `site_verification[site_key].live_status` (`siteVerificationReview.ts`).
- **J6 Export** — pending → exported, `export_jobs`/`pricing_export_jobs` statuses (`exports.ts`, `pricingExport.ts`).
- **J7 Content versions** — AI Describe version states (draft/approved/rejected/restored) (`aiContent.ts`).
- **J8 MAP** — conflict / removal / exit queue states (`mapReview.ts`, `mapImport.ts`).
End with one table: workflow · states · stuck states · unreachable states · live-only values.

### TASK K — Settings and hardcoding

`settings-and-hardcoding.md`.
- **K1 admin_settings inventory** — every key read anywhere (file:line), whether a UI edits it (which page), its default, and whether it is seeded.
- **K2 Hardcoded values that should be settings** — thresholds, intervals, model names, email addresses, domain lists, site lists, role lists, column lists, magic numbers in business logic. For each: file:line, the value, and which admin surface would own it. (Known: `claude-opus-4-7` fallback; `@shiekh.com` regex; SendGrid template ids; `buyer_performance_review_window_days`; MAP tolerance cents; removal-review 90 days.)
- **K3 Duplicate config sources** — the same setting defined in two places (env + admin_settings, or seed + code).
- **K4 Env vars** — the full list from H4 with which environment/deploy script sets each.

### TASK L — Live data integrity (Firestore reads only)

`data-integrity.md`. Counts and the first 5 offending doc ids for each.
- **L1 Orphan references** — products whose `brand_key` is not a `brand_registry` doc; whose `department_key` / `department` matches no registry doc; whose `site_owner` matches no `site_registry` doc; `cadence_assignments` whose `assigned_user_id` / `primary_user_id` / `support_user_ids` match no `users` doc; `cadence_rules.owner_buyer_id` matching no user; `launch_records` whose mpn matches no product.
- **L2 Field-value drift** — products where root `brand` ≠ registry display_name for `brand_key`; where root `department` ≠ `department_key`'s display; any casing variants of the same value in root fields (`Footwear`/`FOOTWEAR`).
- **L3 Required-but-empty** — for each `required_for_completion == true` attribute, count products with `completion_state == complete` that have it empty.
- **L4 Duplicate identities** — two `users` docs with the same email; two `brand_registry` docs with the same display_name (Jordan pattern); two `launch_subscribers` for one email with different prefs.
- **L5 Stale test residue** — docs that look like test fixtures (e.g. `Test Buyer Alice`, mpn patterns like `TEST-`), by collection.
- **L6 Schema drift** — for `products`, `attribute_registry`, `users`, `cadence_rules`: the set of top-level field names present across docs, and fields that appear on <10% of docs.

### TASK M — Background jobs and silent failures

`background-and-silent-failures.md`.
- **M1 Scheduled jobs** — the four Cloud Scheduler jobs (`docs/scheduled-jobs.md`, `internalJobs.ts`): route, what it reads/writes, what happens if it fails (retry? alert? nothing?).
- **M2 Cloud Functions** — `onAttributeRegistryWrite`, `onProductDeletedCleanupCadenceAssignment`: trigger, effect, failure behaviour.
- **M3 Silent failure catalogue** — every place the code catches an error and continues, logs-and-skips, or falls back to a default without surfacing it to a user or an admin (known: SendGrid key unset → skip; `aiConfig` → hardcoded model; smart rule target not in registry → skip; export eligibility conditions). For each: file:line, what fails silently, who would never know.
- **M4 Alerting** — is there ANY mechanism that notifies a human when an import, export, scheduler job, or AI call fails? Cite or write NONE.
- **M5 Audit log coverage** — which write paths emit an `audit_log` event and which do not (table by route/service).

### TASK N — Tests and dependencies

`tests-and-dependencies.md`.
- **N1 Coverage map** — every service/route/lib file and whether a test file exists for it; run the existing tests and report pass/fail per file.
- **N2 What the tests actually assert** — for each test file, one line: what behaviour it protects. Flag tests asserting superseded behaviour (known: `completionCompute.test.ts` ×4; `test-tally107.js`).
- **N3 Frontend** — confirm zero FE tests; list the 5 components whose breakage would be most visible to operators (candidates for a first smoke test).
- **N4 Dependencies** — `npm audit` in backend/functions and frontend (read-only; report counts by severity, do not fix); packages more than 2 major versions behind; any package present in package.json but unused (`depcheck` if available, else grep).

### TASK O — Frontend/backend contract and roles matrix

`contracts-and-roles.md`.
- **O1 API contract** — for every `api.ts` function: the path it calls, the route that serves it, request/response shape agreement (fields the FE reads that the BE never returns, and vice versa). Mismatches with file:line.
- **O2 Roles matrix** — a table of every route × every role (10 roles from `lib/rolePermissions.ts`): allowed / denied / auto-pass. Compare to what the Permissions page displays and to what the sidebar shows each role; list every route a role can reach in nav but is denied by the API.
- **O3 Registry-driven vs hardcoded UI** — every dropdown/option list in the frontend and whether it comes from the registry or is hardcoded (site lists, role lists, status lists, tab lists).

### TASK F — Self-check and summary

1. Pick 5 claims you made in Task A or B at random and re-verify each from scratch. Record the result honestly (`re-verified` / `CORRECTED: …`).
2. Write `SUMMARY.md`, max 40 lines: ? markers converted (count + list) · contradictions (count + the three worst) · sequencing violations · E1–E9 one line each · consumers found OUTSIDE a declared edit surface (count + tally ids) · UX defects by severity (counts + the five worst) · open routes (H1 NONE count) · stuck/unreachable workflow states (J) · orphan reference counts (L1) · silent-failure count (M3) · hardcoded-should-be-settings count (K2) · blockers hit · what you could not verify.
3. Post the SUMMARY.md contents as your only chat message. Do not paste any other file into chat.

## 4. Stop-summary format (final chat message = SUMMARY.md)

```
Tallies mapped: N of M · ? converted: N · Contradictions: N · Sequencing violations: N
Out-of-surface consumers: N (tally ids) · UX defects: N/N/N · Open routes: N · Stuck states: N · Orphan refs: N · Silent failures: N · Hardcoded-should-be-settings: N · Blockers: N · Self-check: 5/5 re-verified | corrections: …
E1–E9: one line each
Could not verify: …
Repo state at end: HEAD <sha>, working tree clean except docs/recovery/overnight/ (untracked)
```

---

## Appendix B — Tally list, edit surfaces, and "?" markers (self-contained copy of the Build Plan)

Edit surface = the ONLY files that tally may touch. "?" = unverified blast-radius item this audit must convert to CONFIRMED or NOT FOUND.

### Phase 1 — Products flow again
| Tally | Edit surface | "?" markers |
|---|---|---|
| P1-0 Dev reset tooling | new script under scripts/ (dev-only, refuses staging/prod) | none |
| P1-1 Auth on import + enrichment routes | router-level middleware lines in `importFullProduct.ts`, `importWeeklyOperations.ts`, `importSales.ts`, `aiEnrichment.ts` OR their mounts in `index.ts` (:78-80, :165) — nothing else | any non-browser caller of these routes (D2 found none) |
| P1-2 TALLY-107 auto-promotion | `services/completionCompute.ts` (stamp path ~:336), `services/pricingResolution.ts` (below-cost branch :177/:308/:416), `services/exportEligibility.ts:65-69`, `services/pricingDomainReflow.ts:69`, one unit test; reconcile/delete `scripts/migrate-pricing-current-to-export-ready.js`, `test-tally107.js` | audit event shape for the new transition |
| P1-3 Smoke (no code) | none | none |
| P1-4 Workflow Routing admin page | new FE page + route + api.ts functions only (backend `aiPlane.ts` GET/PUT /workflows exists) | is fallback model `claude-opus-4-7` (aiConfig.ts:19-21) still valid |
| P1-5 Tests | `services/completionCompute.test.ts`, `package.json` test script | none |
| P1-6 Housekeeping (no code) | none | FR-23 did Weekly Ops Import replace separate imports; FR-25 is `Hold` fully retired |

### Phase 2 — One field, one registry
| Tally | Edit surface | "?" markers |
|---|---|---|
| P2-0 Field-model spec (no code) | none | none |
| P2-1a Remove duplicate attribute | `scripts/seed/` — delete empty `material` (keeper is `material_fabric`, 51 products) | which other attributes carry values on dev |
| P2-1b Registry reseed (after P2-0/2/3) | `scripts/seed/` — one script of record | is `field_key` mandatory or is doc_id the key |
| P2-2i Website indexes + rules | `firebase/firestore.indexes.json`, `firebase/firestore.rules` | full list of indexes referencing site_owner |
| P2-2 One website field | `website` attribute definition + option source; `products.ts` save path (:1155-1226 site_owner mirror); Product Detail rendering; `AIContentReviewPage` site tabs | does site verification key on `site_key` and must it stay; every site_owner consumer |
| P2-3i Taxonomy indexes + rules | `firebase/firestore.indexes.json`, `firebase/firestore.rules` | full list of indexes referencing department / department_key |
| P2-3a Taxonomy model + backend | new taxonomy registry collection + seed; `products.ts` save path (remove department mirror/quarantine); import alias-walk; SmartRuleBuilderPage legacy-field block (:201-202, :492-494) | smart rules and cadence rules targeting department / department_key; every consumer |
| P2-3b Taxonomy picker (frontend) | `AttributeField.tsx` (new `tree` type), new picker component | no existing field type regresses |
| P2-4 Classification layers | lookup at import; smart rules as DATA (no code); optional aiEnrichment pass | can rules write taxonomy fields (must stay registry attributes) |
| P2-5 Re-point consumers | `templateMatcher.ts`, `aiDescribe.ts:177-185`, `executive.ts`, `executiveProjections.ts`, `buyerPerformanceMatrix.ts`, `aiWeeklyAdvisory.ts`, `completionCompute.ts:371` | none beyond B1/B2/B3 |
| P2-6 Export columns | `exportSerializer.ts:101-126` column list only | does RetailOps ingestion tolerate extra columns (external — mark N/A) |
| P2-7 Import miss handling + conditional required | `importFullProduct.ts` miss branch; `completionCompute.ts` depends_on | does depends_on support INCLUDES on multi-select (E2) |

### Phase 3 — People
| Tally | Edit surface | "?" markers |
|---|---|---|
| P3-1 Buyer positions + assignments | new collections + admin page | every consumer of `portfolio_*` (lib/portfolioFilter.ts, services/cadenceEngine.ts, scripts/seed-team-cadence-rules.js) |
| P3-2 Buyer routing rules (IFTTT, priority ladder) | new rules surface reusing Smart Rule builder patterns; routing layer replacing UID lookups | every consumer of `cadence_rules.owner_buyer_id`, `assigned_user_id`, `primary_user_id`, `support_user_ids` |
| P3-3 One user record (facets, prefs, profile, roles) | `users` model; `launch_subscribers` (3 touchpoints: launches.ts:202/:233, launchNotifier.ts:39); `AuthContext.tsx:31-33` role fallback; `lib/rolePermissions.ts` | every consumer of role strings; every requireRole gate |

### Phase 4 — Launch
| Tally | Edit surface | "?" markers |
|---|---|---|
| P4-1 Calendar reachable logged-in | `App.tsx` route placement (:140), `Sidebar.tsx` | none |
| P4-2 One email system + base URL setting | `launchNotifier.ts` (SendGrid :19-25, :51-100) → `emailService.ts`; admin_settings key | every caller of launchNotifier; every emailService caller |
| P4-3 Launch admin completeness (+ MPN auto-create idea) | `routes/launches.ts` create :363; `LaunchAdminDetailPage` | placeholder checkbox consumers |

### Phase 5 — Settings + surfaces
| Tally | Edit surface | "?" markers |
|---|---|---|
| P5-1 Decorative settings | six pages: ExportProfiles, ImportTemplates, SearchSettings, CommentThreads, LaunchSettings, SopPanels | confirm zero consumers for each collection |
| P5-2 Remove duplicate surfaces | `App.tsx:169-170` legacy pricing page; MapPolicyPage vs CockpitMapSection; SiteVerificationReviewPage vs SiteVerificationTab | none |
| P5-3 Honest gating | `executive.ts:49/:69` gates vs `App.tsx:175`; PermissionsPage | none |
| P5-4 Completion Rules | `Sidebar.tsx:99`, `AIAutomationPillarPage.tsx:8` placeholder | none |

Known frozen items (any Phase 1 touch = sequencing violation): `department_key` model, site model (`site_owner`/`website`/`site_registry`), buyer routing (`portfolio_*`, `owner_buyer_id`).

---

## Appendix A — Claude Code unattended-safety config (PO sets this up once)

Put this in `.claude/settings.json` at the repo root before starting the run. It lets the agent read, search, build, and test — and refuses to commit, push, deploy, or write to Firestore even if asked.

```json
{
  "permissions": {
    "allow": [
      "Read", "Grep", "Glob", "LS",
      "Write(docs/recovery/overnight/**)",
      "Edit(docs/recovery/overnight/**)",
      "Bash(npm install:*)", "Bash(npm ci:*)", "Bash(npm run build:*)", "Bash(npm test:*)",
      "Bash(node:*)", "Bash(npx tsc:*)",
      "Bash(git status:*)", "Bash(git log:*)", "Bash(git diff:*)", "Bash(git show:*)",
      "Bash(git branch -r:*)", "Bash(git rev-parse:*)", "Bash(git fetch:*)",
      "Bash(grep:*)", "Bash(rg:*)", "Bash(find:*)", "Bash(cat:*)", "Bash(sed -n:*)", "Bash(wc:*)", "Bash(ls:*)"
    ],
    "deny": [
      "Bash(git commit:*)", "Bash(git push:*)", "Bash(git checkout:*)", "Bash(git merge:*)", "Bash(git rebase:*)", "Bash(git reset:*)",
      "Bash(firebase deploy:*)", "Bash(gcloud run deploy:*)", "Bash(bash scripts/deploy:*)", "Bash(sh scripts/deploy:*)",
      "Bash(rm -rf:*)", "Bash(curl -X POST:*)", "Bash(curl -X PUT:*)", "Bash(curl -X DELETE:*)",
      "Write(backend/**)", "Write(frontend/**)", "Write(scripts/**)", "Write(firebase/**)",
      "Edit(backend/**)", "Edit(frontend/**)", "Edit(scripts/**)", "Edit(firebase/**)"
    ]
  }
}
```

Note: Firestore writes happen inside `node` scripts, which the allow-list permits. The deny-list cannot inspect script contents, so the **read-only rule in §0 is the real guard for Firestore** — the config guards the repo and the deploy path. If you want a hard guarantee for Firestore, run the audit with a service account that has the **Viewer** role only (Firestore read, no write). That is the one extra step worth taking.

**Kickoff message for Claude Code:**
```
Read docs/recovery/OVERNIGHT-AUDIT.md in full and execute it exactly as written, in the task order given, checkpointing after each task. You are the Homer role. Read-only. Do not use Notion. Begin with §2 setup and the baseline, then Task B1.
```
