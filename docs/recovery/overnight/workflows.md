# TASK J — Workflow state machines

Repo @ `2698e48`; live reads against `ropi-aoss-dev` (81 products, 76 cadence_assignments, 9 launch_records, 92 buyer_actions).

---

## J1 — Completion (`completion_state`)

**States in code: 2.** `"complete" | "incomplete"` — the union is declared at [completionCompute.ts:66](backend/functions/src/services/completionCompute.ts#L66).

| From → To | Writer | Trigger |
|---|---|---|
| (unset) → `incomplete` | [importFullProduct.ts:947](backend/functions/src/routes/importFullProduct.ts#L947) via `stampCompletionOnProduct` | first import |
| `incomplete` → `complete` | [completionCompute.ts:329-339](backend/functions/src/services/completionCompute.ts#L329-L339) | every required field satisfied; derived at `:176-177` |
| `complete` → `incomplete` | same writer | a required field becomes empty/unverified, or a new required field is added |

The state is **purely derived** — there is no manual setter. It is recomputed and stamped from 7 call sites: `aiContent.ts:207`, `importWeeklyOperations.ts:489`, `importFullProduct.ts:947`, `siteVerificationReview.ts:246`/`:328`/`:418`, `products.ts:1403`, `onAttributeRegistryWrite.ts:58`.

**Stuck states: `incomplete` — for every product.** Not because of a missing transition, but because the predicate can never be satisfied: 3 of the 14 `required_for_completion` fields are unfillable (`sub_category` 0 live docs; `ai_seo_title`/`ai_seo_meta` 0 docs; `department` `active: false` and hidden from the editor while still counted, because `getRequiredFieldKeys` has **no `active` filter**, [:212-215](backend/functions/src/services/completionCompute.ts#L212-L215)). Ceiling 79%.
**Unreachable states: `complete`.**
**Live-only values: none.** `completion_state` = `{incomplete: 81}`.

**A second, contradicting completion field exists.** Root `status` and `attribute_values/status` (the RO Status column) hold `{Complete: 61, Incomplete: 15}` on the same 81 products, and `status` is emitted on the detail wire at [products.ts:910](backend/functions/src/routes/products.ts#L910) next to `completion_state` at `:918`. **61 products are simultaneously "Complete" and "incomplete".** `status` is not in `attribute_registry`, so it renders nowhere in the editor — but it is on the wire.

---

## J2 — Pricing domain (`pricing_domain_state`)

**States in code: 8.** `Pricing Pending` · `Pricing Current` · `Pricing Incomplete` · `Pricing Discrepancy` · `Loss-Leader Review Pending` · `Export Ready` · `Scheduled` · `Buyer Denied` · `Exported` — 9 counting `Exported`.

| From → To | Writer | file:line | Trigger |
|---|---|---|---|
| → `Pricing Pending` | default read fallback | [products.ts:314](backend/functions/src/routes/products.ts#L314), [:919](backend/functions/src/routes/products.ts#L919) | never written; only a read-side default |
| → `Pricing Current` | `resolvePricing` result mirror | [pricingResolution.ts:261](backend/functions/src/services/pricingResolution.ts#L261), [:382](backend/functions/src/services/pricingResolution.ts#L382), [:416](backend/functions/src/services/pricingResolution.ts#L416) | all pricing checks pass |
| → `Pricing Discrepancy` | `routeToPricingDiscrepancy` | [pricingResolution.ts:283](backend/functions/src/services/pricingResolution.ts#L283); also [importFullProduct.ts:910](backend/functions/src/routes/importFullProduct.ts#L910) | channel price mismatch |
| → `Pricing Incomplete` | import | [importFullProduct.ts:916](backend/functions/src/routes/importFullProduct.ts#L916) | missing pricing inputs |
| → `Loss-Leader Review Pending` | `routeToLossLeaderReview` | [pricingResolution.ts:308](backend/functions/src/services/pricingResolution.ts#L308) | below-cost |
| → `Export Ready` | MAP conflict resolve | [mapReview.ts:357](backend/functions/src/routes/mapReview.ts#L357) | operator resolves |
| → `Export Ready` | discrepancy resolve ×2 | [pricingDiscrepancy.ts:212](backend/functions/src/routes/pricingDiscrepancy.ts#L212), [:302](backend/functions/src/routes/pricingDiscrepancy.ts#L302) | operator resolves |
| → `Export Ready` | scheduled promotion | [scheduledPromotion.ts:53](backend/functions/src/services/scheduledPromotion.ts#L53), [:63](backend/functions/src/services/scheduledPromotion.ts#L63) | `effective_date` reached (scheduler) |
| → `Export Ready` \| `Scheduled` | buyer price override | [buyerPriceOverride.ts:302](backend/functions/src/services/buyerPriceOverride.ts#L302), [:351](backend/functions/src/services/buyerPriceOverride.ts#L351) | buyer sets a custom price |
| → `Buyer Denied` | buyer markdown deny | [buyerMarkdownAction.ts:199](backend/functions/src/services/buyerMarkdownAction.ts#L199), [:249](backend/functions/src/services/buyerMarkdownAction.ts#L249) | buyer denies |
| → step-derived | buyer markdown approve | [buyerMarkdownAction.ts:312](backend/functions/src/services/buyerMarkdownAction.ts#L312), [:374](backend/functions/src/services/buyerMarkdownAction.ts#L374) | buyer approves |
| → `Exported` | export marking | [exports.ts:96](backend/functions/src/routes/exports.ts#L96) | daily export completes |

**14 writers across 8 files. No single state machine owns this field.**

**Stuck states:**
- **`Pricing Current` — the big one.** Nothing promotes `Pricing Current` → `Export Ready`. Only four paths write `Export Ready`, and all four require an operator action or a scheduler firing on a `Scheduled` row. **Live: 64 of 81 products (79%) sit in `Pricing Current`.** This is exactly the gap P1-2 exists to close, and it is real, not theoretical.
- **`Exported`** — no writer moves a product out of it. Terminal by design, but re-import does not reset it (`importFullProduct.ts` writes only `Pricing Discrepancy` / `Pricing Incomplete`).
- **`Buyer Denied`** — the only exit is a fresh `resolvePricing` run, which happens on import or reflow. Live: 1 product.

**Unreachable states:**
- **`Pricing Incomplete`** — written only at `importFullProduct.ts:916`; **0 live products**.
- **`Scheduled`** — written only by `buyerPriceOverride.ts:351`; **0 live products** (3 `buyer_actions` rows have `pricing_domain_state_after: "Scheduled"`, but no product doc currently holds the state).
- **`Pricing Pending`** — never written by anything; it exists only as a read-side `||` default at `products.ts:314`/`:919`. A product can display "Pricing Pending" while its stored field is absent.

**Live-only values (in `buyer_actions.pricing_domain_state_after`, not `products`):**
`{Export Ready: 78, Buyer Denied: 9, Scheduled: 3, **export_ready: 1**, **buyer_denied: 1**}`.
**The two snake_case rows are live residue from `scripts/migrate-pricing-current-to-export-ready.js:26`** (Task C, C10). `scheduledPromotion.ts:26` queries `.where("pricing_domain_state_after","==","Scheduled")` with exact matching, so any snake_case row is permanently invisible to it.

**Live `products.pricing_domain_state`:** `{Pricing Current: 64, Export Ready: 8, Pricing Discrepancy: 1, Buyer Denied: 1, Loss-Leader Review Pending: 1, Exported: 1}` — 76 products carry the field; 5 (the D3SMOKE fixtures) do not.

---

## J3 — Cadence (`cadence_state` + `cadence_assignments` lifecycle)

**States in code: 4.** Declared as a union at [types/cadence.ts:7-11](backend/functions/src/types/cadence.ts#L7-L11): `"assigned" | "unassigned" | "rule_conflict" | "excluded"`.

| From → To | Writer | file:line | Trigger |
|---|---|---|---|
| → `assigned` | `writeAssignment` | [cadenceEngine.ts:506](backend/functions/src/services/cadenceEngine.ts#L506) | exactly one rule matches + a buyer resolves. Also sets `in_cadence_review_queue: true` ([:515](backend/functions/src/services/cadenceEngine.ts#L515)) |
| → `unassigned` | `writeUnassigned` | [cadenceEngine.ts:351](backend/functions/src/services/cadenceEngine.ts#L351) | `no_rule_match` or `no_buyer_match` |
| → `rule_conflict` | conflict writer | [cadenceEngine.ts:317](backend/functions/src/services/cadenceEngine.ts#L317) | two rules tie on specificity |
| → `excluded` | operator exclude | [cadenceReview.ts:137](backend/functions/src/routes/cadenceReview.ts#L137) | `POST /cadence-assignments/:mpn/exclude` |
| → `assigned` (manual) | operator assign | [cadenceReview.ts:92](backend/functions/src/routes/cadenceReview.ts#L92) | `POST /cadence-assignments/:mpn/assign` |

Secondary lifecycle fields: `in_cadence_review_queue` (bool), `last_buyer_action` (`hold` / `save-for-season` / `postpone-review` / …), `manual_assignment`, `conflict`, `unassigned_reason`, `current_step`, `days_at_current_step`, `buyer_queue_entered_at`, `days_in_queue`.

**Stuck states:**
- **`excluded`** — [cadenceReview.ts:137](backend/functions/src/routes/cadenceReview.ts#L137) is the only writer of the value, and **nothing writes a product back out of `excluded`**. The engine's `matched.length === 0` path writes `unassigned`, and the manual-assignment branch at [cadenceEngine.ts:599-631](backend/functions/src/services/cadenceEngine.ts#L599-L631) keys on `isManual && lockedRuleId`, not on `excluded`. **Terminal with no exit.**
- **`rule_conflict`** — written at `:317`; the only escape is an operator manually assigning a rule, or the rule set changing so the tie disappears. **0 live products.**

**Unreachable states:** none of the four is unreachable, but `rule_conflict` and `excluded` are both **0 live**.

**Live values:** `cadence_state` = `{unassigned: 66, assigned: 10}` across 76 assignment docs. `unassigned_reason` = `{no_rule_match: 66, null: 10}`. `in_cadence_review_queue` = `{false: 69, true: 7}`. `conflict` = `{false: 76}`. `manual_assignment` = **`undefined` on all 76**.

**Two structural findings:**
1. **66 of 76 products are `no_rule_match`** despite 12 live rules carrying `department_key` filters that match live lowercase values. The rules also require `trigger_conditions` (45-day zero-sales signals) to pass — `matchesTargetFilters(...) && matchesTriggerConditions(...)` at [cadenceEngine.ts:633-637](backend/functions/src/services/cadenceEngine.ts#L633-L637) — so the target filters matching is necessary but not sufficient. The `no_rule_match` reason does not distinguish the two halves.
2. **`Hold` is not a `cadence_state`.** It is `products.cadence_hold`, written at [buyerActions.ts:101](backend/functions/src/routes/buyerActions.ts#L101) and **read by nothing**. Live, 3 assignment docs carry `last_buyer_action: "hold"` — and [cadenceEngine.ts:515](backend/functions/src/services/cadenceEngine.ts#L515) will set `in_cadence_review_queue: true` on all three at the next run. **Hold is a stuck non-state.**

---

## J4 — Launch (`launch_records`)

**There is no `status` field.** Live: `status` is `undefined` on **all 9** docs. The state is carried by **five** independent fields.

| Field | Code values | Writer | Live |
|---|---|---|---|
| `launch_status` | `draft` / `published` | [launches.ts:363](backend/functions/src/routes/launches.ts#L363) (create → draft), [:606-645](backend/functions/src/routes/launches.ts#L606) (publish) | `{published: 4, draft: 5}` |
| `published_at` | timestamp / null | [launches.ts:606-645](backend/functions/src/routes/launches.ts#L606) | `{set: 4, null: 5}` — **consistent with `launch_status`** |
| `archived_at` | timestamp / null | [launches.ts:748](backend/functions/src/routes/launches.ts#L748) (DELETE = soft archive) | `{null: 9}` — **never used** |
| `token_status` | `Set` / `Not Set` | [launches.ts:658](backend/functions/src/routes/launches.ts#L658) | `{Set: 6, Not Set: 3}` |
| `date_change_badge_expires_at` | timestamp / null | [launches.ts:448-526](backend/functions/src/routes/launches.ts#L448) (PATCH on date change) | present |

Transitions: create → `draft` ([:363](backend/functions/src/routes/launches.ts#L363)) · `draft` → `published` ([:606](backend/functions/src/routes/launches.ts#L606), also fires `notifyNewLaunch` at `:645`) · `published` + date change → `date_change_log` append + badge expiry + `notifyDateChanged` ([:526](backend/functions/src/routes/launches.ts#L526)) · any → archived ([:748](backend/functions/src/routes/launches.ts#L748)).

**Stuck states:** **`published`** — no writer moves a record back to `draft`. Unpublishing is not implemented; the only exit is archive.
**Unreachable states:** **archived** — `archived_at` is `null` on all 9 live docs, so the DELETE path has never been exercised.
**Live-only values:** **`status` (undefined ×9)** — Task J's own brief names a field that does not exist. And `token_status` uses Title Case (`"Set"` / `"Not Set"`) while `launch_status` uses lowercase — two conventions in one document.

**Readiness** is not a stored state: it is computed. `services/launchHighPriority.ts` (`checkHighPriorityFlag`) is called fire-and-forget from [completionCompute.ts:362-364](backend/functions/src/services/completionCompute.ts#L362-L364) on incomplete→complete promotion — which, per J1, **never fires**, so `is_high_priority` is never recomputed by that path.

---

## J5 — Site verification (`site_verification[site_key].verification_state`)

**States in code: 4.** `unverified` · `verified_live` · `mismatch` · `stale`.

`stale` is **derived, never stored** — [staleness.ts:87-97](backend/functions/src/lib/staleness.ts#L87-L97):
```ts
const state = storedState || "unverified";
if (state === "verified_live" && deriveStaleness(lastVerifiedAt, thresholdDays)) return "stale";
return state;
```
Threshold from `system_config/site_verification.staleness_threshold_days`, fallback 14 ([staleness.ts:10](backend/functions/src/lib/staleness.ts#L10)).

| From → To | Writer | file:line |
|---|---|---|
| (absent) → `unverified` | read-side default | [staleness.ts:92](backend/functions/src/lib/staleness.ts#L92), [products.ts:852](backend/functions/src/routes/products.ts#L852) |
| any → `verified_live` | `POST /:mpn/mark-live` | [siteVerificationReview.ts:224](backend/functions/src/routes/siteVerificationReview.ts#L224) |
| any → `mismatch` | `POST /:mpn/flag` | [siteVerificationReview.ts:289](backend/functions/src/routes/siteVerificationReview.ts#L289) |
| `verified_live` → `stale` | **derived only**, on read | [staleness.ts:93-94](backend/functions/src/lib/staleness.ts#L93-L94) |
| `stale` → `verified_live` | `POST /:mpn/reverify` | [siteVerificationReview.ts:395](backend/functions/src/routes/siteVerificationReview.ts#L395) |
| any → `verified_live` \| `mismatch` | bulk import | [siteVerificationImport.ts:212](backend/functions/src/routes/siteVerificationImport.ts#L212), [:215](backend/functions/src/routes/siteVerificationImport.ts#L215), [:218](backend/functions/src/routes/siteVerificationImport.ts#L218) |

**Stuck states:** none — every state has an exit.
**Unreachable states:** none in principle. `stale` is unreachable in practice today: the one live entry was verified recently.
**Live-only values:** none. **Live: exactly 1 product carries a `site_verification` map, with one entry (`karmaloop`) in `verified_live`.** The workflow is fully built and essentially unused: 81 products, 62 with `site_targets`, 1 with any verification.

**Defect carried from B2:** `mark-live` and `flag` write `site_verification[site_key]` with **no registry FK check** ([:209-233](backend/functions/src/routes/siteVerificationReview.ts#L209-L233), [:274-297](backend/functions/src/routes/siteVerificationReview.ts#L274-L297)); only `reverify` validates ([:363-368](backend/functions/src/routes/siteVerificationReview.ts#L363-L368)). Orphan keys are permanent and surface only as `console.warn` at `:107-109`.

---

## J6 — Export

**Two independent job collections with two different vocabularies.**

### `export_jobs` (daily RetailOps export)
Code values: `processing` ([exports.ts:59](backend/functions/src/routes/exports.ts#L59)) → `complete` \| `complete_with_errors` ([exports.ts:128](backend/functions/src/routes/exports.ts#L128)) \| `failed` ([:167](backend/functions/src/routes/exports.ts#L167), [:174](backend/functions/src/routes/exports.ts#L174)). A separate `status: "success"` literal appears at [:228](backend/functions/src/routes/exports.ts#L228) — on the **`promote-scheduled`** response, not a job doc.
**Live (24 docs):** `{complete: 19, complete_with_errors: 1, processing: 2, failed: 2}`.
**Stuck states: `processing` ×2.** Neither has a timeout, a retry, or a sweeper — `grep` finds no code that transitions a stale `processing` job. Two jobs are stuck forever.

### `pricing_export_jobs`
Code values: `processing` ([pricingExport.ts:64](backend/functions/src/routes/pricingExport.ts#L64)) → `complete` ([:124](backend/functions/src/routes/pricingExport.ts#L124), [:141](backend/functions/src/routes/pricingExport.ts#L141)) \| `failed` ([:150](backend/functions/src/routes/pricingExport.ts#L150)).
**Live (3 docs):** `{complete: 3}`.

### `pricing_export_queue`
**Live (176 docs): `status` is `undefined` on all 176.** The queue writer ([pricingExportQueue.ts](backend/functions/src/services/pricingExportQueue.ts)) never sets a `status` field. Whatever consumes the queue does not filter on it.

**Product-level export state** is `pricing_domain_state`: `Export Ready` → `Exported` ([exports.ts:96](backend/functions/src/routes/exports.ts#L96)). See J2 — `Exported` is terminal with no reset.

**Live-only values:** none, but **3 collections use 3 different status vocabularies** (`complete` vs `success` vs absent).

---

## J7 — Content versions (AI Describe)

**States in code: 4.** `pending` · `review_pending` · `approved` · `rejected`.

| From → To | Writer | file:line |
|---|---|---|
| (new) → `pending` | generation | [aiDescribe.ts:283](backend/functions/src/services/aiDescribe.ts#L283) |
| (new) → `pending` | regenerate | [aiContent.ts:370](backend/functions/src/routes/aiContent.ts#L370) |
| `pending` → `approved` | approve | [aiContent.ts:156](backend/functions/src/routes/aiContent.ts#L156) |
| `pending` → `rejected` | reject | [aiContent.ts:245](backend/functions/src/routes/aiContent.ts#L245) |
| any → `review_pending` | **edit** | [aiContent.ts:133](backend/functions/src/routes/aiContent.ts#L133) |

**Restore** ([aiContent.ts:321-360](backend/functions/src/routes/aiContent.ts#L321)) does **not** set a state value — it creates a *new* version doc from an old one, so the restored copy enters at `pending`. "restored" is an action, not a state.

**Stuck states:** **`approved`** and **`rejected`** — neither has an outgoing transition. Once approved, a version is frozen (correct for an append-only history). **`review_pending`** is the concerning one: written at `:133` by the edit path, and **nothing transitions out of it** — approve (`:156`) and reject (`:245`) are separate handlers that write their own values, but nothing in the code moves `review_pending` → `approved`. Whether that is reachable depends on whether the FE offers approve on an edited version.
**Unreachable states:** **`review_pending`** and **`approved`** and **`rejected`** are all unreachable *in live data* — the entire collection is **1 document**, in `pending`.
**Live-only values:** none. **Live: 1 `content_versions` doc across all 81 products.** The AI Describe pipeline — 8 gated routes, a template matcher, a provider registry, a version history UI — has produced one version.

---

## J8 — MAP

**Three sub-workflows, all flag-based rather than enum-based.**

### Conflict
`map_conflict_active: boolean` + `map_conflict_reason` + `map_conflict_flagged_at`.
Set true: [pricingResolution.ts:422-425](backend/functions/src/services/pricingResolution.ts#L422-L425). Cleared: [mapReview.ts:125-126](backend/functions/src/routes/mapReview.ts#L125-L126), [:170-171](backend/functions/src/routes/mapReview.ts#L170-L171) on resolve. Note [mapReview.ts:211](backend/functions/src/routes/mapReview.ts#L211) documents a resolve path that deliberately leaves `map_conflict_active` **true** ("the conflict still exists").
**Live:** `{false: 76, undefined: 5}` — **0 active conflicts**.

### Removal
`map_removal_proposed: boolean` + `map_removal_proposed_at` + `map_removal_source_batch` + `map_removal_review_after`.
Set true: [mapImport.ts:572-573](backend/functions/src/routes/mapImport.ts#L572-L573). Cleared: [mapReview.ts:348-350](backend/functions/src/routes/mapReview.ts#L348-L350) (`approve_removal`), [mapImport.ts:529-530](backend/functions/src/routes/mapImport.ts#L529-L530).
Resolve actions ([mapReview.ts:317-450](backend/functions/src/routes/mapReview.ts#L317)): `approve_removal` (`:340`) · `keep_map` (`:407`) · `defer` (`:429`, sets `map_removal_review_after = today + defer_days`, **default 7**).
**Live:** `map_removal_proposed` is **`undefined` on all 81 products** — the removal workflow has never run.

### Exit / protection
`is_map_protected: boolean` — **`undefined` on all 81 live products**, yet it is queried by [executive.ts:167](backend/functions/src/routes/executive.ts#L167) (`.where("is_map_protected","==",true)`) for the MAP-promo channel-disparity panel. That panel returns empty on every request.

**Stuck states:** the deferred-removal state. `map_removal_review_after` is a date string compared with `String(i.map_removal_review_after) <= today` at [mapReview.ts:306-307](backend/functions/src/routes/mapReview.ts#L306-L307) — a **lexicographic string comparison on ISO dates**, which happens to be correct for `YYYY-MM-DD`, but there is no sweeper that re-surfaces a deferred item; it reappears only when an operator loads the queue after the date passes.
**Unreachable states:** removal-proposed and map-protected — both `undefined` across all live products.
**Live-only values:** none.

---

## Summary table

| Workflow | States (code) | Stuck states | Unreachable states | Live-only values |
|---|---|---|---|---|
| **J1 Completion** | 2 (`complete`, `incomplete`) | **`incomplete` — all 81 products; predicate unsatisfiable** | **`complete`** | root `status` = `{Complete: 61, Incomplete: 15}` contradicting `completion_state` = `{incomplete: 81}` |
| **J2 Pricing domain** | 9 | **`Pricing Current` (64 products), `Exported`, `Buyer Denied`** | **`Pricing Incomplete` (0), `Scheduled` (0), `Pricing Pending` (never written)** | `buyer_actions.pricing_domain_state_after` holds **`export_ready`** ×1 and **`buyer_denied`** ×1 — snake_case migration residue |
| **J3 Cadence** | 4 | **`excluded` — no exit path exists**; `cadence_hold` is a stuck non-state | `rule_conflict` (0 live), `excluded` (0 live) | `manual_assignment` `undefined` on all 76 |
| **J4 Launch** | 2 (`draft`, `published`) + 4 parallel fields | **`published` — no unpublish** | **archived (`archived_at` null ×9)** | **`status` = `undefined` ×9 — the field J4's brief names does not exist** |
| **J5 Site verification** | 4 (1 derived) | none | `stale` (not live) | none — only 1 product has any verification at all |
| **J6 Export** | 4 + 3 + 0 across 3 collections | **`processing` ×2 in `export_jobs` — no timeout, no sweeper** | `complete_with_errors` (1 live) | **`pricing_export_queue.status` `undefined` on all 176 docs** |
| **J7 Content versions** | 4 | **`approved`, `rejected` (by design); `review_pending` has no outgoing transition** | all but `pending` — **1 live doc total** | none |
| **J8 MAP** | flag-based (3 booleans) | deferred-removal has no sweeper | **removal-proposed and `is_map_protected` `undefined` on all 81** | none |

### The four that matter

1. **J1 — `complete` is unreachable and `incomplete` is stuck**, for every product, because the required set contains three unsatisfiable fields. Everything gated on completion (auto-promotion, `checkHighPriorityFlag`, `operator_throughput`) is therefore dead code in practice.
2. **J2 — `Pricing Current` holds 64 of 81 products with no automated exit.** This is P1-2's entire reason for existing, confirmed live. Compounded by two snake_case `buyer_actions` rows that `scheduledPromotion.ts:26`'s exact-match query can never see.
3. **J3 — `excluded` is terminal.** An operator who excludes a product from cadence has no way to un-exclude it; no writer ever moves a doc out of that state.
4. **J6 — two `export_jobs` are stuck in `processing` with no timeout or sweeper**, and `pricing_export_queue` (176 docs) has no `status` field at all despite the collection being modelled as a queue.
