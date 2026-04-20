# TALLY-128 Task 4 — §10 Gate Evidence (Path A — create-only)

**Status:** Complete · **Commit:** `8a1368f` · **Project:** `ropi-aoss-dev`
**Contract:** Option B + Path A (create-only, never touch existing subcoll docs)

---

## 1. Reader-verification (Step 1)
**Outcome A** — Details-tab Site Owner dropdown reads from
`products/{mpn}/attribute_values/site_owner`. Source: prior pass; documented
in script header.

## 2. Schema-verification (Step 2)
**Outcome 2A** — conform to existing 8-field canonical `attribute_values/*`
schema (`value`, `verification_state`, `origin_type`, `origin_detail`,
`origin_rule`, `field_name`, `written_at`, `updated_at`).

## 3. Contract decision (PO ruling)
**Option B** — `verification_state="Unverified"` on all mirror writes.
**Path A** — pre-existing subcoll docs are NEVER touched (preserves
Human-Verified data); the `will_update` bucket is contract-blocked to 0.

## 4. UI rendering check
Canary `JS4967` written 2026-04-20T16:44:55.143Z; Details-tab dropdown
renders `shiekh` selected (UI-A). Doc unchanged on this pass — see §9.

## 5. Dry-run distribution
File: `evidence/tally-128-task4/dry-run.log` (timestamp 17:43:22.238Z)

| bucket        | count | note                                            |
|---------------|------:|-------------------------------------------------|
| will_create   |  571  | primary action set                              |
| will_update   |    0  | contract-blocked (Path A: never)                |
| skip          |    3  | pre-existing subcoll docs preserved             |
| **total**     |  574  | products with non-empty `data.site_owner`       |

**Variance vs. dispatch (expected 571/0/4):** the 4th expected MPN
(`HTG230493wht`) has `data.site_owner = undefined` at top-level (only the
subcoll doc holds the value). It is therefore structurally outside the
dry-run target filter (`p.site_owner || ""`.trim()) and never appears in
the bucket counts. The doc is still preserved by Path A because nothing
ever touches it. This is exactly the **TALLY-130 canonical-writer
divergence** carry-forward Lisa flagged — surfaced here, not fixed.

Pre-existing subcoll docs at execute time (3):
- `206991-6SW` — sub.value="Shiekh", top="shiekh", Human-Verified
- `JQ8354`     — sub.value="shiekh", top="shiekh", Human-Verified
- `JS4967`     — sub.value="shiekh", top="shiekh", Unverified (canary)

Plus 1 orphan invisible to the dry-run:
- `HTG230493wht` — sub.value="mltd", Human-Verified, top=undefined

## 6. Execute summary
File: `evidence/tally-128-task4/execute.log` (timestamp 17:44:14.218Z)

```
Writes queued: 571 (chunked at 500/batch)
  batch 1: 500 written, 0 failed (running 500/571)
  batch 2:  71 written, 0 failed (running 571/571)
Total writes attempted:  571
Total writes succeeded:  571
Total writes failed:     0
```

All 571 creates landed in 2 batches (500 + 71). Zero failures.

## 7. Idempotency re-run
File: `evidence/tally-128-task4/dry-run-idempotent-final.log` (21:38:09.726Z)

| bucket        | count |
|---------------|------:|
| will_create   |    0  |
| will_update   |    0  |
| skip          |  574  |

Steady state confirmed; no further writes possible under Path A contract.

## 8. JS4967 canary unchanged spot-check
File: `evidence/tally-128-task4/named-mpns-state.log`
```
JS4967:
  attribute_values/site_owner exists: true
    value:              "shiekh"
    verification_state: "Unverified"
    origin_type:        "Backfill"
    origin_rule:        "tally-128-task4-attrval-mirror"
    field_name:         "site_owner"
    written_at:         "2026-04-20T16:44:55.143Z"   ← unchanged from canary
    updated_at:         "2026-04-20T16:44:55.143Z"   ← unchanged
```
`written_at` matches the original canary write timestamp from
`spot-check.log`. Path A preservation verified for the canary.

## 9. 5-MPN random spot-check on new writes
File: `evidence/tally-128-task4/spot-check.log`
- `KI5720`        — 8-field + sentinel OK
- `JQ2006`        — 8-field + sentinel OK
- `AF5836`        — 8-field + sentinel OK
- `HQ6998 600`    — 8-field + sentinel OK
- `206990-001`    — 8-field + sentinel OK
- `JQ4730`        — 8-field + sentinel OK
- `5161841-JL4448`— 8-field + sentinel OK
- `EF5398`        — 8-field + sentinel OK

All show `verification_state="Unverified"`, `origin_type="Backfill"`,
`origin_rule="tally-128-task4-attrval-mirror"`, `field_name="site_owner"`.

## 10. Hard-rule compliance
- ✅ Create-only — `will_update=0` in both dry-runs
- ✅ Zero `not_verified` literal anywhere (only `Unverified` value writes)
- ✅ Dry-run BEFORE execute (`dry-run.log` precedes `execute.log` by ~52s)
- ✅ Chunked at 500/batch (500 + 71)
- ✅ 3 Human-Verified docs untouched (206991-6SW, JQ8354, HTG230493wht)
- ✅ JS4967 canary untouched (written_at 16:44:55.143Z preserved)

## 11. Carry-forward (NOT in Task 4 scope)
- **TALLY-129** candidate — UI-write casing bug on Details-tab Save
  (`display_name` vs `site_key`)
- **TALLY-130** candidate — canonical writer divergence (Task 3 writes
  top-level, UI writes subcoll); surfaces as `HTG230493wht` orphan
- **TALLY-131** candidate — casing normalization policy (deferred)

## 12. Matt / Theo handoff note
Task 4 is Gate-complete on `ropi-aoss-dev`. The mirror subcollection
`products/{mpn}/attribute_values/site_owner` now exists for all 574
top-level-owner products plus the 1 orphan, with the canonical 8-field
schema. Reader (Details-tab dropdown) is unblocked. No backend / Cloud
Run / Hosting redeploy required (data-only migration via Firestore REST).
TALLY-129 / TALLY-130 / TALLY-131 are independent follow-ups and do not
gate Task 4 closure.
