# TASK M — Background jobs and silent failures

Repo @ `2698e48`; live reads against `ropi-aoss-dev`.

---

## M1 — Scheduled jobs

`docs/scheduled-jobs.md` documents **four** Cloud Scheduler jobs. `backend/functions/src/routes/internalJobs.ts` implements **three routes**. All three are gated by a router-level `requireSchedulerOIDC` at [:30](backend/functions/src/routes/internalJobs.ts#L30) — no `requireAuth`, no `requireRole`, by design.

| Documented job | Cron (LA) | Route | Implemented? | Reads / writes | On failure |
|---|---|---|---|---|---|
| `promote-scheduled-daily` | `55 5 * * *` | `POST /api/v1/internal/jobs/promote-scheduled` → [internalJobs.ts:83](backend/functions/src/routes/internalJobs.ts#L83) → `promoteScheduledItems()` | **Yes** | reads `buyer_actions` where `pricing_domain_state_after == "Scheduled"` ([scheduledPromotion.ts:26](backend/functions/src/services/scheduledPromotion.ts#L26)); writes `products.pricing_domain_state = "Export Ready"` ([:53](backend/functions/src/services/scheduledPromotion.ts#L53)), `buyer_actions.pricing_domain_state_after` ([:63](backend/functions/src/services/scheduledPromotion.ts#L63)), one `audit_log` entry | `runJob` catches, stamps `scheduler_runs.promote_scheduled.{ok:false,error}` and returns non-2xx → **Cloud Scheduler retries.** No alert |
| `daily-staleness-sweep` | `0 6 * * *` | `POST /…/daily-staleness-sweep` → [internalJobs.ts:103](backend/functions/src/routes/internalJobs.ts#L103) → `refreshStalenessFlagsDaily()` | **Yes** | reads `products` where `completion_state == "complete"`; writes per-product `cadence_age_days` / `staleness_indicator` / `staleness_refreshed_at`, `admin_settings/system_health`, and overwrites `executive_projections/neglected_inventory` | same |
| **`neglected-inventory-nightly`** | `0 2 * * *` | **`POST /…/neglected-inventory`** | **NO — the route does not exist** | — | **404 on every firing.** See below |
| `weekly-snapshots` | `0 3 * * MON` | `POST /…/weekly-snapshots` → [internalJobs.ts:118](backend/functions/src/routes/internalJobs.ts#L118) → `writeWeeklySnapshots()` | **Yes** | writes `metric_snapshots` rows + `executive_projections/weekly_snapshots_provenance` | same |

### M1-1 — A documented scheduled job has no route

`internalJobs.ts` has exactly three `router.post` handlers. There is no `/neglected-inventory`. `computeNeglectedInventory()` exists ([executiveProjections.ts:183-262](backend/functions/src/services/executiveProjections.ts#L183-L262)) but is reachable only as a side-effect of `daily-staleness-sweep`.

The runbook even reasons about the interaction between the two ("*`daily-staleness-sweep` (06:00 LA) re-runs `computeNeglectedInventory()` … This unsets the `computed_by:"scheduler"` stamp placed by the 02:00 LA job*") — reasoning about a job that cannot run. If it was provisioned per the runbook, it has been 404-ing nightly.

### Live provenance — `executive_projections/scheduler_runs`

| Job key | ok | last_run_at | duration_ms |
|---|---|---|---|
| `weekly_snapshots` | true | **2026-04-23T08:14:42Z** | 255 |
| `neglected_inventory` | true | **2026-04-23T09:00:25Z** | 326 |
| `promote_scheduled` | true | **2026-04-23T12:55:09Z** | 738 |
| `daily_staleness_sweep` | true | **2026-04-23T13:00:46Z** | 849 |

**All four last ran on 2026-04-23 — four months before this audit (2026-08-25).** Every job is stamped `ok: true`, so the record shows success, not failure. Combined with M4 (no alerting), the most likely reading is that the scheduler jobs are **not currently firing at all** and nothing has reported it in four months. A `neglected_inventory` entry does exist, which means the missing route was once reachable or the entry was written by another path.

`admin_settings/system_health` exists live and is the sweep's stamp target; it is written but never read as config.

---

## M2 — Cloud Functions

| Function | Trigger | Effect | Failure behaviour |
|---|---|---|---|
| **`onAttributeRegistryWrite`** | `onDocumentWritten("attribute_registry/{fieldId}")` ([:25-26](backend/functions/src/functions/onAttributeRegistryWrite.ts#L25-L26)) | Guarded at [:32-34](backend/functions/src/functions/onAttributeRegistryWrite.ts#L32-L34) — fires only when `required_for_completion` actually flips. Then `listDocuments()` over **all** products and recomputes + stamps completion in batches of 25 ([:51-65](backend/functions/src/functions/onAttributeRegistryWrite.ts#L51-L65)) | **Per-product `catch` → `console.error` only** ([:59-62](backend/functions/src/functions/onAttributeRegistryWrite.ts#L59-L62)). A product that fails to recompute is skipped silently; the function still reports success. **No `audit_log` entry at all** — this is one of the two files in `functions/` with no audit writer |
| **`onProductDeletedCleanupCadenceAssignment`** | `onDocumentDeleted("products/{productId}")` ([:32-33](backend/functions/src/functions/onProductDeletedCleanupCadenceAssignment.ts#L32-L33)) | Deletes the sibling `cadence_assignments/{productId}`. Join is by **doc id**, deliberately not MPN ([:11-13](backend/functions/src/functions/onProductDeletedCleanupCadenceAssignment.ts#L11-L13)) | **Correct** — logs and **rethrows** on delete failure so Cloud Functions retries ([:20](backend/functions/src/functions/onProductDeletedCleanupCadenceAssignment.ts#L20)), and emits one `audit_log` summary per execution. This is the best-behaved background component in the repo |

**Risk on `onAttributeRegistryWrite`:** P2-1b (registry reseed) writes all 96 docs. Every write that flips `required_for_completion` triggers a full-catalog fan-out. A reseed run doc-by-doc could trigger it repeatedly, each time recomputing 81 products — with per-product failures visible only in Cloud Run logs.

---

## M3 — Silent failure catalogue

**301 `catch` blocks across `backend/functions/src`; 250 of them log via `console.warn`/`console.error` and continue.** The catalogue below lists the ones where the silence has a consequence for a human.

| # | What fails silently | file:line | Who would never know |
|---|---|---|---|
| **M3-1** | **All outbound launch email.** Missing `SENDGRID_API_KEY` → log + `{sent:false}`; missing template id → same; non-2xx from SendGrid → same. **The three callers ignore the return value** (bare `await` at `launches.ts:526`, `:645`, `:730`) | [launchNotifier.ts:57-63](backend/functions/src/services/launchNotifier.ts#L57-L63), [:64-67](backend/functions/src/services/launchNotifier.ts#L64-L67), [:89-93](backend/functions/src/services/launchNotifier.ts#L89-L93) | **The operator who published the launch, and every subscriber.** No `audit_log` entry, no notification, no UI signal. Publish reports success either way. **No deploy script sets any SendGrid env var** (K4), so this is likely the live state |
| **M3-2** | **AI config resolution.** Five distinct miss-paths — routing doc missing, `is_active: false`, `provider_key`/`model_key` missing, provider doc missing, provider inactive — each falls back to the hardcoded `SEEDED_DEFAULT` with a `console.warn` | [aiConfig.ts:166](backend/functions/src/lib/aiConfig.ts#L166), [:175](backend/functions/src/lib/aiConfig.ts#L175), [:184](backend/functions/src/lib/aiConfig.ts#L184), [:196](backend/functions/src/lib/aiConfig.ts#L196), [:202](backend/functions/src/lib/aiConfig.ts#L202) | **The admin who configured routing.** They can point a workflow at any model and silently get `claude-opus-4-7` instead |
| **M3-3** | **Smart rule target not in registry.** `console.error` + skip; the rule is counted as evaluated but writes nothing | [smartRules.ts:244-249](backend/functions/src/services/smartRules.ts#L244-L249) | **The admin who built the rule.** Live instance: any rule targeting `brand_key`, since `attribute_registry/brand_key` does not exist |
| **M3-4** | **`search_tokens` reindex after an attribute save.** `catch` → `console.warn("search_tokens_reindex_failed")` | [products.ts:1369-1371](backend/functions/src/routes/products.ts#L1369-L1371) | The operator — the edit saves, search silently goes stale |
| **M3-5** | **Completion stamp after 7 different actions.** Every one of the 7 call sites wraps `stampCompletionOnProduct` in `try/catch` → `console.warn("completion_stamp_failed")` | `aiContent.ts:208-210`, `importWeeklyOperations.ts:490-495`, `importFullProduct.ts:948-953`, `siteVerificationReview.ts:247-249`/`:329-331`/`:419-421`, `products.ts:1404-1406` | Everyone — `completion_percent` silently stops tracking reality |
| **M3-6** | **`audit_log` writes themselves.** The standard helper pattern is `try { …add(…) } catch (err) { console.error("audit_log write failed:", err.message) }` — repeated in **~12 routers** | e.g. [brandRegistry.ts:41-43](backend/functions/src/routes/brandRegistry.ts#L41-L43), [departmentRegistry.ts:44-46](backend/functions/src/routes/departmentRegistry.ts#L44-L46), [attributeRegistry.ts:73-75](backend/functions/src/routes/attributeRegistry.ts#L73-L75) | **Auditors.** The audit trail can have holes with no record of the holes |
| **M3-7** | **Completion-state transition audit** — `.catch(e => console.warn("audit_log write failed"))` on a fire-and-forget promise | [completionCompute.ts:342-356](backend/functions/src/services/completionCompute.ts#L342-L356) | same |
| **M3-8** | **`operator_throughput` write and `checkHighPriorityFlag`** — both fire-and-forget with `.catch(console.error)` | [completionCompute.ts:362-364](backend/functions/src/services/completionCompute.ts#L362-L364), [:377-379](backend/functions/src/services/completionCompute.ts#L377-L379) | Report consumers. Compounded by the missing-`opts` defect: 432 of 441 rows are `{operator_uid: "system", department: "Unknown"}` |
| **M3-9** | **Dashboard tiles.** Five separate `catch` blocks each set the tile to `[]` or `0` and continue | [dashboard.ts:113-116](backend/functions/src/routes/dashboard.ts#L113-L116), [:171-174](backend/functions/src/routes/dashboard.ts#L171-L174), [:191-194](backend/functions/src/routes/dashboard.ts#L191-L194), [:233-236](backend/functions/src/routes/dashboard.ts#L233-L236) | **Every user.** An empty tile is indistinguishable from "no data". The launch-alerts tile is permanently empty because it queries a non-existent collection (`collection("launches")`, Task I6-2) — inside one of these `catch` blocks |
| **M3-10** | **Export eligibility conditions.** A product blocked from export is recorded only in the response's `blocked` array | [exportEligibility.ts:71-75](backend/functions/src/services/exportEligibility.ts#L71-L75) | Whoever expected the product to export, if they don't read the response |
| **M3-11** | **Export `.99` rounding fallback.** `catch { exportRicsOffer = apply99Rounding(p.rics_offer \|\| 0) }` — an empty catch that silently substitutes an un-approved price when the `buyer_actions` composite index is missing | [exportSerializer.ts:215-218](backend/functions/src/services/exportSerializer.ts#L215-L218) | **Nobody.** The comment says "Fallback if composite index not yet built"; there is no log at all. **The exported price can differ from the buyer-approved price with zero trace** |
| **M3-12** | **Buyer performance `catch { /* composite index missing — continue with empty set */ }`** | [buyerPerformanceMatrix.ts:230](backend/functions/src/services/buyerPerformanceMatrix.ts#L230) | Buyers — an index failure looks like zero recent actions |
| **M3-13** | **`buyer_assignments` and `launches` wrong-collection reads** — both wrapped in `try` and falling through to an empty/secondary path | [aiWeeklyAdvisory.ts:94-102](backend/functions/src/services/aiWeeklyAdvisory.ts#L94-L102), [buyerPerformanceMatrix.ts:144](backend/functions/src/services/buyerPerformanceMatrix.ts#L144), [dashboard.ts:201-205](backend/functions/src/routes/dashboard.ts#L201-L205) | Everyone. See Task I6 |
| **M3-14** | **Orphan brand / department / site_owner at import.** `console.warn` per row + a set collected into `import_batches.summary.orphans` | [importFullProduct.ts:341](backend/functions/src/routes/importFullProduct.ts#L341), [:629](backend/functions/src/routes/importFullProduct.ts#L629), [:474](backend/functions/src/routes/importFullProduct.ts#L474), [:1104-1108](backend/functions/src/routes/importFullProduct.ts#L1104-L1108) | **The importer.** `grep -rn "orphans" frontend/src` → **no matches**. The summary is written and rendered nowhere. Live consequence: 8 products with a brand and no `brand_key` |
| **M3-15** | **New-site coverage warning.** `console.log("[TALLY-079] New site_key added … Review prompt_templates.match_site_owner for coverage.")` | [siteRegistry.ts:128](backend/functions/src/routes/siteRegistry.ts#L128) | The admin who added the site. No admin surface, no notification, no audit entry |
| **M3-16** | **Orphaned `site_verification` map keys.** `console.warn("[review] orphaned site_verification key on mpn=…")` | [siteVerificationReview.ts:107-109](backend/functions/src/routes/siteVerificationReview.ts#L107-L109) | Nobody. `mark-live` and `flag` can create them freely (no FK check) and there is no cleanup path |
| **M3-17** | **Role lookup failure in `requireRole`.** `catch (err) { /* fall through */ }` with a comment claiming "permissive mode" — the code actually falls through to the **deny** at `:58` | [roles.ts:53-55](backend/functions/src/middleware/roles.ts#L53-L55) | Nobody. Behaviour is correct (fail-closed); the comment is wrong |
| **M3-18** | **`getAdminSetting` swallows every read error** — `catch { return fallback }`, no log | [emailService.ts:24-26](backend/functions/src/services/emailService.ts#L24-L26) | Anyone relying on a configured setting. A Firestore outage silently reverts every setting to its code default |
| **M3-19** | **`getStalenessThresholdDays` falls back to 14** with a `console.warn` | [staleness.ts:68-74](backend/functions/src/lib/staleness.ts#L68-L74) | Site-verification reviewers |
| **M3-20** | **Every registry-driven dropdown in the editor** — `catch { setRegistryError("fetch-fail") }` | [AttributeField.tsx:109-113](frontend/src/components/AttributeField.tsx#L109-L113) | **Nobody — this one is handled well.** It disables the control and shows a red border + explicit message. Recorded as the counter-example |

**Silent-failure count: 20 catalogued classes** (19 genuine, 1 counter-example), spanning 250 log-and-continue `catch` blocks.

---

## M4 — Alerting

**NONE.**

`grep -rn -iE "slack|pagerduty|webhook|alert\(|sentry|opsgenie|notifyAdmin|notifyOps"` across `backend/functions/src` returns **zero matches**.

What exists instead:
- **`console.log` / `console.warn` / `console.error`** → Cloud Run logs. No log-based alert policy is defined in the repo.
- **`executive_projections/scheduler_runs.<job>.{ok,error}`** — a provenance record, not an alert. Nothing reads it; `docs/scheduled-jobs.md` tells a human to check it with `gcloud`.
- **The `notifications` collection** — 11 writers ([exports.ts:207](backend/functions/src/routes/exports.ts#L207), [products.ts:1591](backend/functions/src/routes/products.ts#L1591), [mapReview.ts:226](backend/functions/src/routes/mapReview.ts#L226), [pricingDiscrepancy.ts:256](backend/functions/src/routes/pricingDiscrepancy.ts#L256), [pricingResolution.ts:325](backend/functions/src/services/pricingResolution.ts#L325), [aiWeeklyAdvisory.ts:364](backend/functions/src/services/aiWeeklyAdvisory.ts#L364), [importJobRunner.ts:135](backend/functions/src/services/importJobRunner.ts#L135)/[:166](backend/functions/src/services/importJobRunner.ts#L166)). These are **business-event** notifications (loss-leader review needed, MAP conflict, import finished) — **not failure alerts**. `importJobRunner.ts:166` is the closest thing to a failure notification in the system, and it fires on import-job completion, not on the silent failures above.
- **`admin_settings/notification_slack`** exists live — `{enabled: false, webhook_url: "", channel: "#ropi-alerts", on_deploy: true, on_error: true}` — and **nothing reads it**. `admin_settings/notification_email.recipients = ["admin@ropi.io"]`, also unread.

**So: no import failure, no export failure, no scheduler job failure, and no AI call failure notifies any human.** The four scheduler jobs last stamped a run on 2026-04-23; four months of non-execution produced no signal.

---

## M5 — Audit-log coverage

**39,669 `audit_log` documents live. 43 of 81 source files write to it.**

### Top event types (live)

| event_type | Count |
|---|---|
| `field_created` | 11,332 |
| `smart_rule_execution` | 7,187 |
| **`site_targets.orphaned_reference`** | **5,875** |
| `pricing_resolution` | 3,084 |
| `product_created` | 2,213 |
| `product_deleted` | 2,194 |
| `map_policy_imported` | 2,185 |
| `cadence_evaluated` | 1,625 |
| `field_edited` | 586 |
| `attribute_values.website_desuffix` | 477 |
| `completion_state.changed` | 462 |
| `product.site_owner_desuffix` | 435 |
| `site_verification.map_key_desuffix` | 428 |
| `product.site_owner_backfilled` | 428 |
| `buyer_action` | 102 |
| `loss_leader_review_initiated` | 55 |
| `pricing_discrepancy_flagged` | 53 |
| `ai_describe_generated` | 46 |

**`site_targets.orphaned_reference` at 5,875 events is the third-largest class in the log** — an error condition that was audited 5,875 times. `siteVerificationReview.ts:133-136` records that the emitting branch was *removed* by TALLY-128 Task 6 as "a historical artifact, not a runtime defect", so these are backlog.

### **M5-1 — The audit log has FOUR incompatible field shapes**

| Actor / timestamp shape | Docs |
|---|---|
| `acting_user_id` + `created_at` | 21,724 |
| `acting_user_id` + `created_at` + `timestamp` | 7,164 |
| `actor_uid` + `created_at` | 5,876 |
| `created_at` only (**no actor at all**) | 2,558 |
| `timestamp` only (**no actor**) | 1,395 |
| `actor_uid` + `timestamp` | 490 |
| **`changed_by` + `changed_at`** | 462 |

**Three different actor field names** (`acting_user_id`, `actor_uid`, `changed_by`) and **three different timestamp field names** (`created_at`, `timestamp`, `changed_at`). **3,953 documents have no actor field at all.** Any "who changed this" query must union three field names, and will still miss 10% of the log.

The `changed_by`/`changed_at` shape is the one used by `completionCompute.ts:342-356`; the `actor_uid` shape is the registry-router helper (`brandRegistry.ts:36-43`, `departmentRegistry.ts:36-43`, `attributeRegistry.ts:65-72`); `acting_user_id`/`created_at` is the majority convention.

### Write paths with NO audit coverage

**38 source files never write `audit_log`.** The ones where that matters:

| File | What goes unaudited |
|---|---|
| **`routes/adminSettings.ts`** | **`PUT /api/v1/admin/settings/:key`** — every settings change, by anyone, with no key allowlist and no type check (H5). **No audit entry** |
| **`routes/promptTemplates.ts`** | All 5 CRUD handlers on AI prompt templates — create, update, delete |
| **`routes/importWeeklyOperations.ts`** | The entire Weekly Ops import (`importFullProduct.ts` does audit; its sibling does not) |
| **`routes/importSales.ts`** | The entire Sales import |
| **`routes/aiEnrichment.ts`** | All 3 AI enrichment routes — which write root `products.name` and `attribute_values` |
| **`routes/adminCadence.ts`** | Manual cadence-evaluation trigger |
| **`functions/onAttributeRegistryWrite.ts`** | A full-catalog completion recompute |
| **`services/pricingDomainReflow.ts`** | Pricing-state reflow across products |
| **`services/stalenessRefresh.ts`** | Per-product staleness writes |
| **`services/executiveProjections.ts`** | Snapshot and projection writes |
| `routes/users.ts`, `routes/notifications.ts` | User self-service preference writes |

**The single most important gap is `adminSettings.ts`**: the least-validated write path in the system (H5) is also one of the least-audited.

---

## Summary

| Item | Result |
|---|---|
| Documented scheduled jobs | **4** |
| Implemented scheduler routes | **3** — `neglected-inventory` is documented but **does not exist** |
| Last successful scheduler run (all four) | **2026-04-23** — four months before this audit |
| Cloud Functions | **2** — one exemplary (`onProductDeletedCleanupCadenceAssignment`), one silent (`onAttributeRegistryWrite`) |
| `catch` blocks in backend | **301**, of which **250** log-and-continue |
| Catalogued silent-failure classes | **20** (19 genuine + 1 counter-example) |
| **Alerting mechanisms** | **NONE** — zero matches for slack/pagerduty/webhook/sentry/alert |
| Unread alerting settings | 2 (`notification_slack`, `notification_email`) |
| `audit_log` documents | **39,669** |
| Files writing `audit_log` | **43 of 81** |
| **Distinct audit field shapes** | **7**, using **3 actor names** and **3 timestamp names**; **3,953 docs have no actor** |

### The three worst

1. **No alerting exists, and the four scheduler jobs last ran four months ago while stamped `ok: true`.** Nothing in the system can tell a human that background work stopped. The provenance record makes it look healthy.
2. **All outbound email fails silently and its callers discard the result** (M3-1), on a code path whose required env vars are set by **no deploy script**. A launch publishes, subscribers are read, zero emails send, and the operator sees success.
3. **The audit log cannot answer "who changed this"** without unioning three field names, and 3,953 of 39,669 entries have no actor at all (M5-1) — while the least-validated write path in the system, `PUT /admin/settings/:key`, writes no audit entry whatsoever.
