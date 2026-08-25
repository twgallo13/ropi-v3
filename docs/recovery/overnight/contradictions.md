# TASK C — Contradiction sweep

**Scope as run.** §3 TASK C asks for every specific-value claim in **Appendix B** *and* in `docs/recovery/RECOVERY-ANCHOR.md`.
**`docs/recovery/RECOVERY-ANCHOR.md` does not exist** — `find docs -type f` returns exactly `docs/scheduled-jobs.md` and `docs/recovery/overnight/OVERNIGHT-AUDIT.md`; `git ls-files docs/` confirms those are the only tracked files under `docs/`. The anchor half of this task is therefore **NOT FOUND**, not skipped.
This sweep covers: every file path, line number, field name, enum value, route path, role name and count in **Appendix B**, plus the specific-value claims in **§3** of the audit file itself (Tasks E, G, I, K, M name concrete values), plus **`docs/scheduled-jobs.md`**, which is the one other doc in the repo.

Per §3: line drift of a few lines is not a contradiction; a wrong file, wrong field name, or wrong behaviour is.

---

## Confirmed accurate (no contradiction)

Every one of these Appendix B references was checked line-by-line against `2698e48` and is correct as written:

| Row | Claim | Verified |
|---|---|---|
| P1-1 | `index.ts` :78-80, :165 are the import + ai-enrich mounts | ✓ exact |
| P1-2 | `completionCompute.ts` stamp path ~:336 | ✓ (the `.set()` spans :329-339) |
| P1-2 | `pricingResolution.ts` :177 / :308 / :416 | ✓ all three are Loss-Leader / state-write lines |
| P1-2 | `exportEligibility.ts:65-69` | ✓ exact — the Loss-Leader reason branch |
| P1-2 | `pricingDomainReflow.ts:69` | ✓ exact — `writePricingSnapshot(...)` |
| P1-4 | `aiConfig.ts:19-21` is the SEEDED_DEFAULT block | ✓ exact |
| P1-4 | backend `aiPlane.ts` GET/PUT `/workflows` exists | ✓ 3 handlers at :350, :374, :401 |
| P2-1a | `material_fabric` keeper, **51 products** | ✓ exactly 51 `attribute_values` docs, 51 non-empty |
| P2-2 | `products.ts` :1155-1226 contains the `site_owner` mirror | ✓ the mirror is :1218-1225, inside the range |
| P2-3a | `SmartRuleBuilderPage` :201-202, :492-494 legacy-field block | ✓ exact |
| P2-5 | `aiDescribe.ts:177-185` | ✓ exact — the `selectTemplate` call |
| P2-5 | `completionCompute.ts:371` | ✓ exact — the throughput `department` line |
| P2-6 | `exportSerializer.ts:101-126` column list | ✓ exact — `const fields = [` at :101, `];` at :126 |
| P3-3 | `launches.ts:202`/`:233`, `launchNotifier.ts:39` — the 3 `launch_subscribers` touchpoints | ✓ exact, and complete (no fourth) |
| P3-3 | `AuthContext.tsx:31-33` role fallback | ✓ exact |
| P4-1 | `App.tsx:140` route placement | ✓ exact |
| P4-2 | `launchNotifier.ts` SendGrid :19-25, :51-100 | ✓ (:19-25 the consts; `sendGridSend` spans :51-99) |
| P4-3 | `routes/launches.ts` create :363 | ✓ exact — `router.post(` for `POST /` |
| P5-2 | `App.tsx:169-170` legacy pricing page | ✓ exact |
| P5-3 | `executive.ts:49`/`:69` gates vs `App.tsx:175` | ✓ exact — both are the `requireRole(["head_buyer"])` lines |
| P5-4 | `Sidebar.tsx:99`, `AIAutomationPillarPage.tsx:8` placeholders | ✓ exact |
| §3 K2 | `claude-opus-4-7` fallback | ✓ `aiConfig.ts:20` |
| §3 K2 | `@shiekh.com` regex | ✓ `launches.ts:195` |
| §3 K2 | SendGrid template ids | ✓ `launchNotifier.ts:19-24` |
| §3 K2 | `buyer_performance_review_window_days` | ✓ `buyerPerformanceMatrix.ts:88` |
| §3 G7 | duplicate labels "Material / Fabric" ×2, "Product Is Active" ×2 | ✓ both confirmed live |
| §3 J1–J8 | every named service file exists | ✓ all 8 |
| Frozen items | `department_key`, `site_owner`/`website`/`site_registry`, `portfolio_*`, `owner_buyer_id` all exist as named | ✓ |

---

## Contradictions

| # | Row/tally | What the plan says | What the code says | file:line |
|---|---|---|---|---|
| **C1** | §3 TASK M1 + `docs/scheduled-jobs.md` | "**the four** Cloud Scheduler jobs"; the runbook's table lists `promote-scheduled-daily`, `daily-staleness-sweep`, **`neglected-inventory-nightly` → `POST /api/v1/internal/jobs/neglected-inventory`**, `weekly-snapshots` | **`internalJobs.ts` implements only THREE routes.** There is no `/neglected-inventory` handler. A Cloud Scheduler job pointed at it would 404 nightly. `computeNeglectedInventory()` exists (`executiveProjections.ts:183-262`) but is reachable only as a side-effect of `daily-staleness-sweep`. | [internalJobs.ts:83](backend/functions/src/routes/internalJobs.ts#L83), [:103](backend/functions/src/routes/internalJobs.ts#L103), [:118](backend/functions/src/routes/internalJobs.ts#L118) vs [docs/scheduled-jobs.md](docs/scheduled-jobs.md) "The four jobs" table |
| **C2** | Appendix B, B1 (Task B header) | "a known rule filters on `department_key` **equals `Clothing`**" | **No live cadence rule uses a capitalised value.** 12 of 14 rules carry a `department_key` filter; every value is lowercase (`clothing`, `footwear`, `accessories`). Two rules filter `department_key equals clothing` with `case_sensitive: true` — which works precisely *because* root `department_key` is lowercase. A rule with `Clothing` and `case_sensitive: true` would match nothing. | live `cadence_rules`; evaluator at [cadenceEngine.ts:220-238](backend/functions/src/services/cadenceEngine.ts#L220-L238) |
| **C3** | Appendix B, P3-1 "?" marker | "every consumer of `portfolio_*` (`lib/portfolioFilter.ts`, `services/cadenceEngine.ts`, **`scripts/seed-team-cadence-rules.js`**)" | **`scripts/seed-team-cadence-rules.js` contains no `portfolio_` reference at all.** It seeds `cadence_rules.owner_buyer_id` — P3-2's field, not P3-1's. The marker also omits the largest consumer, `routes/adminUsers.ts` (78 references). | [seed-team-cadence-rules.js:93](scripts/seed-team-cadence-rules.js#L93) vs [adminUsers.ts:88-91](backend/functions/src/routes/adminUsers.ts#L88-L91) |
| **C4** | §3 TASK G3 | "attributes whose live `dropdown_options` is empty AND whose `dropdown_source` resolves to nothing (**`site_owner` is known**)" | **`site_owner` is not an empty dropdown.** Live `attribute_registry/site_owner` has `dropdown_options: []` **but** `dropdown_source: "site_registry"`, which resolves to 3 active sites (`shiekh`, `karmaloop`, `mltd`). `AttributeField.tsx:82-85` maps them to options and `:154-166` uses them. The genuinely empty dropdowns are elsewhere — see `ux-defects.md` G3. | live registry; [AttributeField.tsx:82-85](frontend/src/components/AttributeField.tsx#L82-L85) |
| **C5** | §3 TASK K2 | "(Known: … **MAP tolerance cents**; **removal-review 90 days**)" | **Neither exists.** `grep -riE "toleran"` across `backend/functions/src` returns only `deriveSiteTargetKeys`'s "tolerant matcher" comments — no MAP price tolerance anywhere. The removal-review defer window is **7 days**, not 90: `const days = Number(defer_days) \|\| 7` — and it is caller-supplied, so the hardcoded value is the fallback `7`. | [mapReview.ts:430](backend/functions/src/routes/mapReview.ts#L430) |
| **C6** | §3 TASK E7 | "Does anything reference `ropi-aoss-staging` or `ropi-aoss-prod` at RUNTIME" | The staging project is **not** named `ropi-aoss-staging` — it is **`ropi-aoss-staging-v3`** in both `.firebaserc` and the deploy script. (The answer to the underlying question is still NO runtime reference — see `open-questions.md` E7.) | [.firebaserc:5](.firebaserc), [deploy-staging.sh:5](scripts/deploy-staging.sh#L5) |
| **C7** | §3 TASK I6 | "include `orders`, `payments`, `sessions`, **`auditLogs` vs `audit_log`**" | There is no `auditLogs` **anywhere** — not in code, not live. The only spelling used is `audit_log`. `grep -rn 'collection("auditLogs")'` returns nothing. The camelCase-vs-snake_case tension the row implies exists instead in the **index file**: the `orders`/`payments`/`sessions` indexes use `userId`, `createdAt`, `orderId`, `isActive`, `expiresAt` while the whole codebase uses snake_case. | `firebase/firestore.indexes.json` `orders`/`payments`/`sessions` entries |
| **C8** | §6 / kickoff message / §1 | "`docs/recovery/OVERNIGHT-AUDIT.md`" | The file is at **`docs/recovery/overnight/OVERNIGHT-AUDIT.md`**. Also §2 instructs "DO NOT COMMIT anything under `docs/recovery/overnight/`" while the audit file itself is already committed there. | `git ls-files docs/` |
| **C9** | §1 required reading | "`docs/recovery/RECOVERY-ANCHOR.md` — state, rulings, roadmap" and "`docs/recovery/PRE-BUILD-PROTOCOL.md` — Gate 2 defines what a blast-radius map must contain" | **Neither file exists.** `docs/` contains exactly two files. | `find docs -type f` |
| **C10** | Appendix B, P1-2 | "reconcile/delete `scripts/migrate-pricing-current-to-export-ready.js`, `test-tally107.js`" — implies these encode the intended target state | **Both encode the WRONG value.** They write / document `pricing_domain_state: "export_ready"` (snake_case); every one of the 14 live writers and the eligibility query use `"Export Ready"` (Title Case). | [migrate-pricing-current-to-export-ready.js:26](scripts/migrate-pricing-current-to-export-ready.js#L26) vs [exportEligibility.ts:28](backend/functions/src/services/exportEligibility.ts#L28) |
| **C11** | §3 TASK J4 | "**`launch_records` status** + readiness + publish + archive" | **`launch_records` has no `status` field.** Reading `status` across all 9 live docs returns `undefined` ×9. The field present is **`launch_status`**. | live `launch_records`; field union in `gate2-phase4.md` |
| **C12** | §3 TASK G1 | "re-verify D2's list: AdminOverview, **6 pillar pages**, legacy `/admin/settings` redirect, Completion Rules placeholder" | There are **5** pillar pages routed, not 6: `/admin/registries`, `/admin/ai-automation`, `/admin/pipeline`, `/admin/governance`, `/admin/experience`, `/admin/infrastructure` — that is 6 route mounts, but `RegistriesPillarPage` is one of them and `AdminOverviewPage` is separate. Counting the `*PillarPage` components: `RegistriesPillarPage`, `AIAutomationPillarPage`, `PipelinePillarPage`, `GovernancePillarPage`, `ExperiencePillarPage`, `InfrastructurePillarPage` = **6**. **No contradiction** — recorded here because the count was ambiguous until enumerated. | [App.tsx:186-196](frontend/src/App.tsx#L186-L196) |
| **C13** | `docs/scheduled-jobs.md` | "**No human user can call these routes.** They are not exposed to the frontend and no `requireAuth`/`requireRole` middleware sits in front of them — the OIDC gate is the sole authorization mechanism." | Accurate about the gate, but the same document states three paragraphs later that **`allUsers` holds `roles/run.invoker` on `ropi-aoss-api`**. So the Cloud Run service is publicly invocable and the OIDC middleware is the only thing between the internet and those routes — which is what the doc says, but it also means the **13 genuinely ungated routes** (see `security.md` H1) are internet-reachable. The runbook's reassuring framing applies only to `/internal/jobs/*`. | [docs/scheduled-jobs.md](docs/scheduled-jobs.md) "Service account and IAM" → "Pre-existing caveat" |

**C12 resolves to "not a contradiction"** on enumeration and is kept in the table for traceability. **Contradiction count: 12.**

---

## The three worst

1. **C1 — a documented scheduled job has no route.** `docs/scheduled-jobs.md` is a runbook an operator would follow, and it tells them a `neglected-inventory-nightly` job exists at `POST /api/v1/internal/jobs/neglected-inventory`. That handler does not exist. If the Cloud Scheduler job was provisioned per the runbook, it has been 404-ing nightly, and the failure surface is a scheduler retry log nobody reads (`M4` finds no alerting anywhere). The doc's own "Known interaction" note even reasons about the interplay between this job and `daily-staleness-sweep` — reasoning about a job that cannot run.

2. **C10 — the P1-2 migration script writes a value the system cannot see.** `"export_ready"` vs `"Export Ready"`. `exportEligibility.ts:28` queries the Title Case form, so every product that migration touched was silently removed from export eligibility. This is a data-integrity contradiction, not a documentation one, and P1-2 is the tally that inherits it.

3. **C5 — two of the six "known" K2 values do not exist.** "MAP tolerance cents" has no implementation at all, and "removal-review 90 days" is really a **7-day** caller-supplied default. A hardcoding audit that starts from a list containing two phantoms will spend effort looking for code that was never written, and — worse — may conclude the values are "already settings" when they are simply absent.

---

## Notes on scope

- The **Notion Findings Register is explicitly out of scope** for this run (§3 TASK C), and no Notion access was used at any point in this audit.
- Claims in §3 that are *instructions* rather than assertions (e.g. "produce a table with columns …") are not sweepable and were not swept.
- Line numbers cited in Appendix B were checked against `2698e48` with `sed -n`; all 21 checked references resolved to the intended construct. That is a notably high accuracy rate and worth recording as a positive finding: the Build Plan's file:line references are trustworthy.
