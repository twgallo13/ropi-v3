# TALLY-128 Task 5 — §10 Gate Evidence

**Status:** Complete · **Project:** `ropi-aoss-dev`
**Commits:** `1d9d6cf` (5a + 5b) · `<post-gate>` (execute evidence)
**Contract:** Path C — diff-contract cleanup (create / delete / preserve) on
`products/{mpn}/site_targets/*` subcollection, using tolerant derivation
from `attribute_values/website` via the Task 2 unit-tested helper.

---

## 1. Script commit SHA
`1d9d6cf` — `scripts/tally-128-task5-site-targets-cleanup.js`
Reuses `buildActiveRegistryView` + `deriveSiteTargetKeys` from
`backend/functions/lib/lib/brandRegistry.js` (Task 2). No re-implementation.

## 2. Subtask 5b — Schema verification: **Outcome 2A**
- Existing `site_targets` docs scanned: **1,175** (all 672 products)
- Docs with fields outside observed schema: **0**
- Observed schema: `site_id` (string), `domain` (string), `active` (bool),
  `updated_at` (timestamp)
- Task 5 create writes conform exactly, plus sentinel
  `site_targets_source: "tally-128-task5"` (5 fields total).

## 3. Subtask 5a — Dry-run category breakdown
File: `evidence/tally-128-task5/dry-run.log` (timestamp 22:28:52Z)

```
Total products scanned:                    672
Active registry sites:                     [karmaloop, mltd, shiekh]

Gap bucket (empty Active Websites):        177   (preserved unchanged per R2-Q2)

Mutation-candidate bucket:
  No change (current == expected):         130
  Create-only:                               5
  Delete-only:                             340
  Mixed:                                     1
  Fully deleted (expected empty):            6   ← Guardrail 1
  No-op (current empty + expected empty):   13   (non-registry-only AW)
  Mutation-candidate total:                495

Operation totals:
  Docs to create:    7
  Docs to delete:  592
  Docs to preserve untouched: 470
```

### Fully-deleted (all 6)

| MPN             | Active Websites      | Current site_targets        | Non-registry |
|-----------------|----------------------|-----------------------------|--------------|
| BB9076          | `[plndr]`            | `[plndr, shiekh]`           | `plndr`      |
| BY9961          | `[plndr]`            | `[plndr, shiekh]`           | `plndr`      |
| CQ2118-VNDS     | `[vnds.com]`         | `[trendswap]`               | `vnds.com`   |
| FBRK133072-TINT | `[fbrkclothing.com]` | `[fbrk]`                    | `fbrkclothing.com` |
| IY9664          | `[fbrkclothing.com]` | `[fbrk, karmaloop, mltd, shiekh]` | `fbrkclothing.com` |
| M20324          | `[plndr]`            | `[plndr]`                   | `plndr`      |

### Non-registry Active Websites audit (informational)
`vnds.com` ×13 · `plndr` ×3 · `fbrkclothing.com` ×2 · `shoes.com` ×1

## 4. Lisa + PO ack record
- Lisa recommendation: GO (approve 6 fully_deleted + 7 creates / 592 deletes / 470 preserves)
- PO ruling: **GO** (one-line approval to proceed to --execute)
- Timestamp: 2026-04-20 (conversation-thread record)

## 5. Subtask 5d — Execute summary
File: `evidence/tally-128-task5/execute.log` (timestamp 22:32:49Z)

```
Products with diff: 352 (chunked at 100/batch)
  batch 1: 100 products (running 100/352)
  batch 2: 100 products (running 200/352)
  batch 3: 100 products (running 300/352)
  batch 4:  52 products (running 352/352)

Products touched:      352
Docs created:            7
Docs deleted:          592
Docs preserved:        470
Gap products skipped:  177
Errors:                  0
```

## 6. Post-execute idempotency re-run
File: `evidence/tally-128-task5/dry-run-idempotent.log`

```
No change:                     476
Create-only:                     0
Delete-only:                     0
Mixed:                           0
Fully deleted:                   0
No-op (both empty):             19
Gap:                           177
Docs to create / delete:      0 / 0
Docs to preserve:              477
```

Steady state confirmed.

**Schema verification outcome on re-run: 2B (cosmetic, expected).** The 7
newly-created docs legitimately contain the `site_targets_source` sentinel,
which is outside the `OBSERVED_SCHEMA_FIELDS` constant (that constant
captures the pre-Task-5 4-field baseline). The re-run 2B output listed
exactly the 7 expected writes (6 MPNs — `206991-6SW`, `341-921CRM`,
`A00-43435BLK` ×2, `SD1009-BLK`, `STEP22-ADIDAS-003`, `STEP22-NIKE-001`).
Execute is a no-op anyway (0 writes), so the guardrail gate is inert here.
Not a real schema violation; will be reset in any future Task-5-like pass
by either updating the constant or rotating the sentinel.

## 7. 5-MPN spot-check (mixed kinds)
File: `evidence/tally-128-task5/spot-check.log`

| MPN           | Kind          | Current site_targets | Expected | Match |
|---------------|---------------|----------------------|----------|-------|
| 206991-6SW    | create-only   | `[shiekh]`           | `[shiekh]` | ✅ (new doc has sentinel + 2026-04-20T22:32:49.495Z) |
| 101639C       | delete-only   | `[karmaloop]`        | `[karmaloop]` (was `[karmaloop,mltd,shiekh]`) | ✅ |
| JS4967        | delete-only   | `[karmaloop]`        | `[karmaloop]` (was `[karmaloop,mltd,shiekh]`) | ✅ *(spot-check script labeled this "no-change" in error; AW is single-value `"karmaloop"`)* |
| IY9664        | fully-deleted | `[]`                 | `[]`     | ✅  |
| BB9076        | fully-deleted | `[]`                 | `[]`     | ✅  |
| 1003868       | gap           | `[]`                 | (untouched) | ✅ |

All matches verified. New doc on `206991-6SW`:
```
shiekh: { site_id:"shiekh", domain:"shiekh.com", active:true,
          updated_at:"2026-04-20T22:32:49.495Z",
          site_targets_source:"tally-128-task5" }
```

## 8. Stale-key deletion confirmation (Task 1 keys: plndr, shiekhshoes, fbrk, trendswap)

Full-catalog scan post-execute vs. pre-execute counts from the per-product
log:

| Stale key    | Pre-execute | On gap products | Post-execute | Deleted |
|--------------|------------:|----------------:|-------------:|--------:|
| plndr        |          47 |              16 |           16 |      31 |
| shiekhshoes  |           8 |               3 |            3 |       5 |
| fbrk         |           5 |               2 |            2 |       3 |
| trendswap    |           2 |               1 |            1 |       1 |
| **total**    |          62 |              22 |           22 |      40 |

Post-execute residual exactly equals gap-product-residual (22 = 22). All
40 stale-key docs on mutation-candidate products were deleted. The 22
remaining stale-key docs sit on gap products (empty Active Websites) and
are preserved per R2-Q2 — **correct behavior**.

## 9. Non-registry Active Websites value audit (informational)
`vnds.com` ×13 · `plndr` ×3 · `fbrkclothing.com` ×2 · `shoes.com` ×1

These values never produced writes (tolerant matcher routed them to
`nonRegistryValues`); they are logged here for Matt/Theo visibility
against any future registry activation (e.g. if `plndr` or `fbrk` is
reactivated, 3/2 products respectively will resolve).

## 10. Data-quality anomalies — LOGGED, NOT FIXED (dev-mode efficiency rule)

- **177 gap products with stale site_targets** (22 stale-key docs total,
  plus legitimate active-key docs on gap products preserved). Example:
  `32051035-GRN` has `cur=[karmaloop,plndr,shiekh]` with `aw=[]`. Per
  R2-Q2: untouched by Task 5.
- **1 mixed-diff product** (per per-product log): observed but executed
  correctly — logged by virtue of the category bucket.
- **`IY9664`**: AW is `[fbrkclothing.com]` (non-registry-only) with 4
  current site_targets including 3 active keys. Task 5 deleted all 4 per
  the strict diff contract; whether this reflects data drift or
  legitimate AW change is not Task 5's concern.
- **`CQ2118-VNDS`**: AW=`[vnds.com]` (non-registry), `cur=[trendswap]`
  (inactive). Fully deleted. VNDS is not in `site_registry` at all —
  potential registry-seed candidate, logged for follow-up.
- **13 no-op products** with non-registry-only AW + empty current — these
  would have been fully-deleted if their subcollections were non-empty.
  Logged; AW values are the 17 `vnds.com/plndr/fbrkclothing.com/shoes.com`
  occurrences on products with nothing to delete.
- **`206991-6SW` previously had no `site_targets` docs** (observed during
  Task 4 and confirmed here as a pure create). Task 5 seeded the correct
  single `shiekh` doc. Consistent with the Task 4 finding that this
  product's canonical data was thin.

## 11. Guardrail 2 compliance
- `audit_log` never queried during Task 5.
- `orphaned_reference` events never inspected.
- `data.site_owner` never consulted for derivation (Layer 1 ⊥ Layer 3).
- No doc IDs normalized; no casing rewrites.
- The 5,875 historical `orphaned_reference` events remain a Task 6
  Subtask 6a concern.

## 12. Carry-forward reminders (NOT Task 5 scope)
- TALLY-129 — UI-write casing bug on Details-tab Save
- TALLY-130 — canonical writer divergence (`HTG230493wht`)
- TALLY-131 — casing normalization policy (deferred)
- **TALLY-132 candidate (new)** — `vnds.com` registry-seed candidate
  (13 products reference it; no registry entry exists)
- Task 6 Subtask 6a — 5,875 orphaned_reference events
