# TALLY-144-2E — Ownership at Import (Strategy C)

## Tally
TALLY-144-2E

## Strategy
**C — Stamp ownership during Full Product Import on `cadence_assignments/{productId}` only.**
- No product root ownership writes.
- No `buyer_assignments` writes.
- No `runCadenceEvaluation` trigger from this code path.
- No frontend / smart_rules / cadence_rules / attribute_values / department_key / site_key changes.

## Files inspected
- `backend/functions/src/routes/importFullProduct.ts` (full product import path; canonical fields stamped during row write at L~336/L~411/L~615)
- `backend/functions/src/routes/importWeeklyOperations.ts` (sole `runCadenceEvaluation` caller; reference pattern)
- `backend/functions/src/services/cadenceEngine.ts` (module-private `resolveBuyerForProduct` at L174; `cadence_assignments` writers at L314/L348/L377)
- `backend/functions/src/lib/portfolioFilter.ts` (already exports `buildBuyerPortfolio` + `productMatchesBuyerPortfolio` mirroring the cadenceEngine predicate)
- `backend/functions/src/types/cadence.ts` (`BuyerPortfolio`, `BuyerResolution` shared types)

## Resolver source selected
- **Lifted resolver into `lib/portfolioFilter.ts`** as new exports: `pickPrimary`, `resolveBuyerForProduct`, `loadAllBuyerPortfolios`.
- Mirrors `cadenceEngine.resolveBuyerForProduct` exactly (4-tier hierarchy, exclusions veto + 6-dimension AND-match, deterministic uid tie-break).
- **`cadenceEngine.ts` left untouched** — its module-private resolver is preserved; live cadence semantics are not changed. Strategy chosen to avoid the broad-cadence-refactor STOP condition.

## Files changed
- `backend/functions/src/lib/portfolioFilter.ts` — additive: imported `BuyerResolution`; added `pickPrimary`, `resolveBuyerForProduct`, `loadAllBuyerPortfolios`. No existing exports changed.
- `backend/functions/src/routes/importFullProduct.ts` — additive imports of the new helpers; new post-loop block (after pricing-projection block, before "Step 6 — Update batch record") that resolves ownership per committed MPN and merges onto `cadence_assignments/{productId}`.

## Ownership write target
- `cadence_assignments/{productId}` (sibling doc; same `mpnToDocId(mpn)` keying as cadenceEngine).

## Fields written (merge-only)
- `primary_user_id` — `string | null`
- `assigned_user_id` — same as primary (mirrors cadenceEngine display alias)
- `support_user_ids` — `string[]`
- `ownership_source: "import"`
- `ownership_updated_at: serverTimestamp()`
- `ownership_import_batch_id: <batch_id>`
- `mpn` (idempotent re-stamp; same value cadenceEngine writes)

## Fields NOT touched (preserved through merge)
- `cadence_state`
- `in_cadence_review_queue`
- `manual_assignment`
- `matched_rule_id`
- `matched_rule_version`
- `conflict_rule_ids`
- `last_evaluated_at`
- `recommendation`
- `current_step`, `step_first_matched_at`, `days_at_current_step`
- `buyer_queue_entered_at`, `days_in_queue`

## Build result
- `npm --prefix backend/functions run build` — **PASS** (no errors / warnings).

## Probe result (read-only, dev)
- Script: `scripts/_homer-tally-144-2e-resolver-probe.js` (gitignored — `_homer-*` convention).
- Project guard: `ropi-aoss-dev`. Writes nothing.
- Output: `evidence/tally-144-2e-ownership-at-import/resolver-probe-2026-05-15T00-57-49-484Z.json`
- Numbers:
  - buyer_count = **6**
  - sampled_products = **25** (all active)
  - resolved_count = **24** (would receive `primary_user_id`)
  - no_buyer_match_count = **1** (`new_balance / footwear / shiekh`)
  - support_user_ids distribution: `{ "0": 24 }` — every resolution is single-buyer
- Known limitation (acknowledged in dispatch): `support_user_ids` stays empty under current portfolio data because no product matches more than one buyer. Will populate organically once portfolio overlap exists.

## Confirmations
- **No product root ownership writes.** Single touchpoint is `firestore.collection("cadence_assignments").doc(docId).set(..., { merge: true })` inside the new block.
- **No `buyer_assignments` collection writes.** Repo-wide grep confirms zero writers in `backend/functions/src/`.
- **No frontend changes.** No edits under `frontend/`.
- **No `smart_rules`, `cadence_rules`, `attribute_values`, `department_key`, or `site_key` changes.**
- **No deploy.** This dispatch is BACKEND IMPLEMENTATION ONLY. Cloud Run `ropi-aoss-api` rev `00211-v49` (live as of 2C.2 deploy) remains the latest.
- **No live import smoke run.** Only the read-only resolver probe was executed.

## Anomalies
None. Frink pre-audit numbers were corroborated:
- `cadenceEngine.resolveBuyerForProduct` is module-private (reachable only via `runCadenceEvaluation`).
- `importFullProduct.ts` makes no ownership write today.
- `importWeeklyOperations.ts` is the sole `runCadenceEvaluation` caller (L434).
- `lib/portfolioFilter.ts` already had the matching predicate.

## Status
`ready-for-review`
