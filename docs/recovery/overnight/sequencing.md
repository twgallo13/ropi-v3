# TASK D — Sequencing violations

Repo @ `2698e48`. Frozen items per Appendix B: **`department_key` model · site model (`site_owner` / `website` / `site_registry`) · buyer routing (`portfolio_*`, `owner_buyer_id`)**. Any Phase 1 touch of these is a sequencing violation.

---

## (1) Tallies that depend on something a LATER tally provides

| # | Tally | Depends on | Provided by | Evidence |
|---|---|---|---|---|
| **D1** | **P1-2** (TALLY-107 auto-promotion) | A product reaching `completion_state == "complete"` — the trigger for "auto-promote to Export Ready" | **P2-1b** (registry reseed) and/or **P2-7** (conditional required), which are the only tallies that can make the required set satisfiable | **0 of 81 live products are `complete`.** Three of the 14 `required_for_completion` fields are structurally unfillable: `sub_category` (0 `attribute_values` docs), `ai_seo_title` / `ai_seo_meta` (0 docs), and `department` (`active: false`, hidden from the editor by [attributeRegistry.ts:93](backend/functions/src/routes/attributeRegistry.ts#L93)/[:98-100](backend/functions/src/routes/attributeRegistry.ts#L98-L100) yet still counted by [completionCompute.ts:212-215](backend/functions/src/services/completionCompute.ts#L212-L215), which has no `active` filter). Ceiling is 79%. P1-2 cannot be smoke-tested in Phase 1. |
| **D2** | **P1-4** (Workflow Routing admin page) | A nav entry to reach the new page | **P5-4 / the pillar-page work** owns `AIAutomationPillarPage.tsx` and `Sidebar.tsx` | The page's natural home is the AI & Automation pillar, whose surface list is [AIAutomationPillarPage.tsx:4-9](frontend/src/pages/AIAutomationPillarPage.tsx#L4-L9) and [Sidebar.tsx:93-100](frontend/src/components/Sidebar.tsx#L93-L100). Neither is in P1-4's declared surface ("new FE page + route + api.ts functions only"). Reachable-by-URL-only otherwise. |
| **D3** | **P2-4** (Classification layers — "smart rules as DATA, no code") | Smart-rule writes reaching **root** `department_key` | **P2-3a** (taxonomy model + backend) is the only tally with `products.ts` save-path scope; **no** tally has `smartRules.ts` scope | [smartRules.ts:252](backend/functions/src/services/smartRules.ts#L252) writes `attribute_values/{target_field}` only. The 13 live `Taxonomy: *` rules set `attribute_values/department_key` and nothing mirrors it to root. Root is written only by import ([importFullProduct.ts:636](backend/functions/src/routes/importFullProduct.ts#L636), *before* rules fire at [:898](backend/functions/src/routes/importFullProduct.ts#L898)) and by the interactive editor ([products.ts:1183-1197](backend/functions/src/routes/products.ts#L1183-L1197)). P2-4's stated no-code constraint cannot deliver its stated outcome. |
| **D4** | **P2-6** (Export columns) | The export's `department` source being re-pointed off the quarantined legacy doc | **P2-5** (re-point consumers) — except P2-5's surface does **not** name `exportSerializer.ts` | [exportSerializer.ts:232](backend/functions/src/services/exportSerializer.ts#L232) reads `attrs["department"]`, built at [:163-167](backend/functions/src/services/exportSerializer.ts#L163-L167) with no `quarantined` filter. Live: blank for 56 of 81 products, wrong for 1. Editing the column *list* at `:101-126` (P2-6's whole surface) does not fix the column *source*. Neither tally owns it. |
| **D5** | **P4-2** (One email system + base URL setting) | An `admin_settings` read/seed/edit path for the new base-URL key | **P5-1 / P5-3 era settings work** owns `SystemVariablesPage.tsx`; the seed is `scripts/seed/seed-admin-settings.js` | P4-2's surface is `launchNotifier.ts` → `emailService.ts` + "admin_settings key". The generic reader `getAdminSetting` is in `emailService.ts` (in surface), but nothing in the surface seeds or edits the key. |
| **D6** | **P5-4** (Completion Rules) | A "blocking vs warning" severity model | **Nothing provides it.** No tally does | [completionCompute.ts:154](backend/functions/src/services/completionCompute.ts#L154)/[:158](backend/functions/src/services/completionCompute.ts#L158) have exactly one severity: satisfied or blocker. The `ai_blockers` split ([:167-174](backend/functions/src/services/completionCompute.ts#L167-L174)) is a *source* distinction, not a severity. P5-4's placeholder promises a model that no earlier tally builds. |

---

## (2) Tallies whose edit surfaces overlap in a conflicting way

| # | Tallies | Shared file | Conflict |
|---|---|---|---|
| **D7** | **P1-2** ∩ **P2-7** | `services/completionCompute.ts` | P1-2 edits the stamp path (~:329-380) for auto-promotion; P2-7 edits the `depends_on` predicate (:129-135) and, to be useful, the required-set query (:212-215). Both also plausibly touch `getRequiredFieldKeys`. Same file, two phases apart. |
| **D8** | **P1-2** ∩ **P1-5** | `services/completionCompute.test.ts` | P1-2's surface says "one unit test"; P1-5's surface *is* `completionCompute.test.ts`. The file currently fails 4 of 34 assertions and exits 0. Whichever lands second inherits a suite the other already rewrote. |
| **D9** | **P2-2** ∩ **P2-3a** ∩ **P2-5** | `routes/products.ts` save path | P2-2 declares `:1155-1226` (the `site_owner` mirror). P2-3a declares "`products.ts` save path (remove department mirror/quarantine)" — the `department_key` mirror at `:1174-1197`, i.e. **inside the same `if/else if` chain** (`:1165-1226`). Two tallies editing adjacent branches of one conditional. P2-5 then re-points readers that depend on what those branches write. |
| **D10** | **P2-1a** ∩ **P2-1b** | `scripts/seed/` | P2-1a deletes the `material` registry doc; P2-1b reseeds the whole collection from "one script of record". If P2-1b's script still contains `material`, P2-1a is silently reverted. Ordering is stated (P2-1b "after P2-0/2/3") but P2-1a is not in that after-list. |
| **D11** | **P2-2i** ∩ **P2-3i** | `firebase/firestore.indexes.json` + `firebase/firestore.rules` | Both tallies edit the same two files. 4 of the 20 `department_key` indexes are **composite with `site_owner`** (`department_key + site_owner + {first_received_at, updated_at ASC/DESC, completion_percent ASC/DESC}` — 6 entries in total). Those entries belong to both tallies; whichever lands second rebases on the other. |
| **D12** | **P2-3b** ∩ **P2-1b** | `attribute_registry` `field_type` values | P2-3b adds a `tree` field type, which requires widening `ALLOWED_FIELD_TYPES` at [attributeRegistry.ts:30-39](backend/functions/src/routes/attributeRegistry.ts#L30-L39) — outside its declared surface. P2-1b reseeds the registry and would need to know the new type exists. |
| **D13** | **P3-3** ∩ **P4-2** | `launch_subscribers` | P3-3 declares all three `launch_subscribers` touchpoints, one of which is `launchNotifier.ts:39`. P4-2 declares `launchNotifier.ts` wholesale. Same file, same collection, two phases. |
| **D14** | **P4-3** ∩ **P3-3** | `routes/launches.ts` | P4-3 edits the create path at `:363` and the field allowlists; P3-3 edits `:202`/`:233` (subscribe/unsubscribe) in the same router. Non-overlapping line ranges, but the same file and the same `LAUNCH_EDITOR_ROLES` constant at `:45` that P3-3's role work would touch. |
| **D15** | **P5-2** ∩ **P5-3** | `frontend/src/App.tsx` | P5-2 removes `:170` (`/pricing-discrepancy-legacy`); P5-3 changes gating around `:175` (`/executive`). Adjacent lines in the same route block. |

---

## (3) Phase 1 tallies that touch a frozen item

This is the section the freeze exists for. **Three of the seven Phase 1 tallies touch frozen ground.**

| # | Tally | Frozen item touched | Evidence | Severity |
|---|---|---|---|---|
| **D16** | **P1-1** (Auth on import + enrichment routes) | **site model** and **`department_key` model** — indirectly but unavoidably | The declared surface is "router-level middleware lines in `importFullProduct.ts` … OR their mounts in `index.ts`". A *router-level* `router.use(requireAuth)` in `importFullProduct.ts` sits above the file that performs **every** frozen-model write: root `department`/`department_key` at [:631-636](backend/functions/src/routes/importFullProduct.ts#L631-L636), `attribute_values/department_key` at [:845](backend/functions/src/routes/importFullProduct.ts#L845), root `site_owner` at [:485](backend/functions/src/routes/importFullProduct.ts#L485), `attribute_values/site_owner` at [:500-512](backend/functions/src/routes/importFullProduct.ts#L500-L512), and `site_targets` at [:443-464](backend/functions/src/routes/importFullProduct.ts#L443-L464). **Mitigation available:** taking the `index.ts` mount option instead (`:78-80`, `:165`) touches no frozen code at all. **Recommend the mount option.** | Low if mounted at `index.ts`; Medium if router-level |
| **D17** | **P1-2** (TALLY-107 auto-promotion) | **none directly** — but its declared surface includes `services/pricingDomainReflow.ts:69`, and the reflow's callers include the import path. No frozen field is read or written. | Verified: `grep -n "department\|site_owner\|brand_key\|portfolio_" pricingDomainReflow.ts exportEligibility.ts` → no matches. | **None** |
| **D18** | **P1-6** (Housekeeping — "is `Hold` fully retired") | **buyer routing** — the answer forces a decision on `cadence_assignments` | Answering FR-25 truthfully (see `gate2-phase1.md`) surfaces that `products.cadence_hold` is written at [buyerActions.ts:101](backend/functions/src/routes/buyerActions.ts#L101) and **read by nothing**, and that [cadenceEngine.ts:515](backend/functions/src/services/cadenceEngine.ts#L515) unconditionally re-queues held products. Fixing that means editing the cadence engine — frozen buyer-routing territory. P1-6 is scoped "no code", so the *finding* is in scope and the *fix* is not. | **Medium — must not be fixed in Phase 1** |
| **D19** | **P1-4** (Workflow Routing admin page) | none | `ai_workflow_routing` / `ai_provider_registry` are untouched by the freeze. | **None** |
| **D20** | **P1-0, P1-3, P1-5** | none | New script; no code; test file only. | **None** |

### The one that matters

**D16 is the live sequencing decision.** P1-1's surface offers two implementations and they differ in freeze exposure:

- **`index.ts:78-80` / `:165` mounts** — `app.use("/api/v1/imports/full-product", requireAuth, importFullProductRouter)`. Touches four lines in a file that contains no frozen field. **No violation.**
- **Router-level middleware inside the four route files** — puts a Phase 1 edit inside `importFullProduct.ts`, the single largest writer of both frozen models (department: 5 write sites; site: 4 write sites). Any conflict, revert, or follow-up in Phase 2 (P2-2 and P2-3a both edit this file) rebases on a Phase 1 change.

The Build Plan already permits the safe option. Recording the recommendation, not changing the plan.

---

## Summary

| Category | Count |
|---|---|
| Tallies depending on a later tally | **6** (D1–D6) |
| Conflicting edit-surface overlaps | **9** (D7–D15) |
| Phase 1 tallies touching a frozen item | **2** (D16 conditional, D18) — of 7 Phase 1 tallies |
| **Total sequencing violations** | **17** |

Highest-risk, in order:
1. **D1** — P1-2's acceptance criterion is unreachable until a Phase 2 tally makes completion possible. This is the one that will look like a P1-2 bug during smoke.
2. **D16** — P1-1 can be implemented safely (`index.ts` mounts) or unsafely (router-level in the frozen import file). One-line decision, large blast-radius difference.
3. **D9** — three tallies editing adjacent branches of one `if/else if` chain in `products.ts:1165-1226`, across two phases.
