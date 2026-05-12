# Frink Pre-Audit — TALLY-D3-E-CADENCE-RESIDUE

**Mode:** Reconnaissance only. No code written. No Firestore writes/deletes. No deploy.
**Date:** 2026-05-12
**Auditor:** Frink

---

## 1. Tally ID

`TALLY-D3-E-CADENCE-RESIDUE` — non-urgent dev cleanup parked at Phase 3.13 closure.

## 2. Repo baseline HEAD

- Repo: `twgallo13/ropi-v3`, branch `main`
- HEAD: `5e9493c45da812a22de4d52b34ed21438ec409a9` ("TALLY-146B: reject legacy brand department rule fields (#125)")
- Working tree: clean except for two read-only Frink probes (this tally + the import-date-backfill tally run earlier this session).

## 3. Dev runtime context

- Project: `ropi-aoss-dev` (SA project_id verified at runtime)
- Backend: Cloud Run service `ropi-aoss-api` — not relevant to this read-only probe.
- No CI auto-deploy on this repo (per memory rule 1b). Not relevant; nothing to deploy here.
- **Catalog rebuild is in progress.** See §7.1 stability flag.

## 4. Files inspected

- [backend/functions/src/services/cadenceEngine.ts](backend/functions/src/services/cadenceEngine.ts) — `writeAssignment` ([L375-L548](backend/functions/src/services/cadenceEngine.ts#L375-L548)), `writeUnassigned` ([L342-L370](backend/functions/src/services/cadenceEngine.ts#L342-L370)), `writeConflictAssignment` ([L309-L340](backend/functions/src/services/cadenceEngine.ts#L309-L340)), `runCadenceEvaluation` ([L552+](backend/functions/src/services/cadenceEngine.ts#L552))
- [backend/functions/src/services/mpnUtils.ts](backend/functions/src/services/mpnUtils.ts) — `mpnToDocId(mpn) = mpn.replace(/\//g, "__")`. The only sanitization is forward-slash replacement.
- [backend/functions/src/routes/cadenceReview.ts](backend/functions/src/routes/cadenceReview.ts) — admin/buyer cadence review endpoints reading `cadence_assignments`
- [backend/functions/src/routes/buyerReview.ts](backend/functions/src/routes/buyerReview.ts) — buyer-facing review pulls `cadence_assignments` then re-queries `products` by id
- [backend/functions/src/routes/buyerActions.ts](backend/functions/src/routes/buyerActions.ts) — buyer actions read/write `cadence_assignments`
- [backend/functions/src/services/buyerPerformanceMatrix.ts](backend/functions/src/services/buyerPerformanceMatrix.ts) — chunked `in` queries over `cadence_assignments` for performance matrix
- [backend/functions/src/services/aiWeeklyAdvisory.ts](backend/functions/src/services/aiWeeklyAdvisory.ts#L107-L130) — weekly advisory joins by rule id
- [scripts/d3d-fixture-inject.ts](scripts/d3d-fixture-inject.ts), [scripts/d3e-signal-augment.ts](scripts/d3e-signal-augment.ts), [scripts/d3e-full-sweep.ts](scripts/d3e-full-sweep.ts), [scripts/d3e-sweep-smoke.ts](scripts/d3e-sweep-smoke.ts) — D3D/D3E fixture writers (write **products**, not directly cadence_assignments — cadence docs were created via the engine sweep over those products)
- [scripts/cleanup-cadence-old-field.ts](scripts/cleanup-cadence-old-field.ts), [scripts/backfill-cadence-rename.ts](scripts/backfill-cadence-rename.ts) — closest stylistic precedent (auth pattern, dry-run flag, audit emission)
- [scripts/step22-verify.js](scripts/step22-verify.js#L57) — historical reference: prior step-verify scripts directly `.delete()`ed cadence_assignments docs by MPN.

Probe: [scripts/_frink-d3-e-cadence-residue-probe.js](scripts/_frink-d3-e-cadence-residue-probe.js)
Probe output JSON: [evidence/tally-d3-e-cadence-residue/probe-2026-05-12T21-06-54-295Z.json](evidence/tally-d3-e-cadence-residue/probe-2026-05-12T21-06-54-295Z.json)

## 5. Current cadence assignment write semantics

**Single canonical key:** every write path stores by `db().collection("cadence_assignments").doc(mpnToDocId(mpn))`. Verified at the three write sites:

- [cadenceEngine.ts L313-L314](backend/functions/src/services/cadenceEngine.ts#L313-L314) — `writeConflictAssignment`
- [cadenceEngine.ts L347-L348](backend/functions/src/services/cadenceEngine.ts#L347-L348) — `writeUnassigned`
- [cadenceEngine.ts L376-L377](backend/functions/src/services/cadenceEngine.ts#L376-L377) — `writeAssignment`
- [routes/cadenceReview.ts L179](backend/functions/src/routes/cadenceReview.ts#L179) — manual rule-assignment endpoint

`mpnToDocId` only replaces `/` with `__`; no other transformation. Since the same helper is used to derive both `products/{docId}` and `cadence_assignments/{docId}`, **doc-id equality is the canonical join.** The probe confirmed zero drift: `matchedByMpnToDocId(mpn) only = 0` — there are no docs where doc id and `mpnToDocId(mpn)` disagree (§7.3).

**No delete path.** A repo-wide search for `cadence_assignments.*delete` / `deleteDoc.*cadence_assignments` returns zero matches in `backend/`. The only deletes anywhere are in the `step22-verify.js` test cleanup (a historical fixture script, not production code) and prior backfill scripts. The cadence engine **never** removes assignment docs, even when the product they reference no longer exists. This is the structural cause of orphan accumulation.

**`runCadenceEvaluation(importedMpns: string[])`** ([cadenceEngine.ts L552+](backend/functions/src/services/cadenceEngine.ts#L552)) iterates only the MPNs supplied by the calling import. It checks `productSnap.exists` (skipping with `continue` if not) but never sweeps `cadence_assignments` to GC docs whose product is gone. So a Full Product Import that drops MPN X does not remove `cadence_assignments/X`.

## 6. Read surfaces impacted by ghost docs

Anywhere `cadence_assignments` is queried, ghost docs are visible to the runtime:

| Surface | File | Symptom |
|---|---|---|
| Cadence Review — Buyer queue | [routes/cadenceReview.ts L55-L57](backend/functions/src/routes/cadenceReview.ts#L55-L57) | `where("in_cadence_review_queue", "==", true)` returns ghost-product rows |
| Cadence Review — Unassigned tab | [routes/cadenceReview.ts L124-L125](backend/functions/src/routes/cadenceReview.ts#L124-L125) | `where("cadence_state", "==", "unassigned")` returns ghost rows |
| Buyer Review queue | [routes/buyerReview.ts L77-L100](backend/functions/src/routes/buyerReview.ts#L77-L100) | Iterates assignments, then attempts product fetch — non-existent products surface as 404 / blanks |
| Buyer Performance Matrix | [services/buyerPerformanceMatrix.ts L160-L170](backend/functions/src/services/buyerPerformanceMatrix.ts#L160-L170) | Per-rule counts inflated by ghost docs |
| AI Weekly Advisory | [services/aiWeeklyAdvisory.ts L107-L130](backend/functions/src/services/aiWeeklyAdvisory.ts#L107-L130) | Buyer/global advisory rows reference dead MPNs |
| Buyer Actions endpoints | [routes/buyerActions.ts L239-L346](backend/functions/src/routes/buyerActions.ts#L239) | Action posts against ghost docs no-op silently |

Magnitude on dev right now (§7): 87 ghost docs carry `primary_user_id` and 109 carry `cadence_state == "assigned"` — these are actively visible in buyer review surfaces.

## 7. Live dev data findings (read-only probe, 2026-05-12T21:06 UTC)

Full probe output: [evidence/tally-d3-e-cadence-residue/probe-2026-05-12T21-06-54-295Z.json](evidence/tally-d3-e-cadence-residue/probe-2026-05-12T21-06-54-295Z.json).

### 7.1 Catalog stability — **flag for PO/Lisa**

- `import_batches` snapshot: 47 full_product batches; **0 processing**, 6 pending (likely abandoned uploads — none with timestamps from the last hour), 35 complete, 6 cancelled.
- Most recent committed batch: `6363ebf0` at 2026-05-12T01:39:05Z, committed 205 of 205 rows.
- Counts stable across two snapshots 8 s apart: products = 50, cadence_assignments = 809.

**However — earlier this same session (2026-05-12T20:45 UTC, ~21 min before this probe)** the import-date-backfill probe observed `products = 286`. **236 products were deleted between 20:45 and 21:06.** This is consistent with PO actively wiping the catalog, exactly as the dispatch context describes. The 8-second snapshot stability check passed only because PO paused (or finished a wipe burst) inside this 21-minute window.

The dispatch's own STOP language is relevant:
> *If the product count is zero or import appears mid-flight: STOP and report "catalog import not stable yet." Do not produce cleanup recommendations based on transient state.*

I am not strictly hitting that condition (count is non-zero, no import is `processing`), but the catalog is clearly mid-rebuild. **My read: reconnaissance findings stand for analysis, but any cleanup execution should wait for PO to confirm "fresh import is complete and final."**

### 7.2 Counts

| Metric | Snapshot 1 | Snapshot 2 (8 s later) |
|---|---|---|
| products | **50** | 50 |
| cadence_assignments | **809** | 809 |

For comparison, D3-E observed 622 / 115 (orphan ratio 81%). Current state is 759 / 809 = **94% orphan**. The wipe has *increased* the orphan ratio, exactly as predicted by §5 (no GC path).

### 7.3 Orphan classification

| Class | Count | % of 809 |
|---|---|---|
| Matched product by doc_id (canonical join) | **50** | 6.2% |
| Matched only by `mpnToDocId(mpn)` (would imply join-key drift) | **0** | 0% |
| **Orphan — no product match by either method** | **759** | **93.8%** |
| ↳ orphan + primary_user_id or assigned_user_id set | **87** | |
| ↳ orphan + no user assignment | 672 | |
| Stale: `cadence_state == "assigned"` AND `primary_user_id` null/empty | **109** | (population-wide) |
| Fixture-marked (`is_fixture` / `fixture_tally` / `tally`) | **0** | |
| Doc id matches known test prefix (D3D-/D3E-/STEP-/D2A-/TEST-/DEV-) | **1** | |

Notes:

- The zero `matchedByMpnToDocId-only` count is the strongest possible confirmation that doc-id equality is sufficient (Rule 6 — disambiguation done). Both products and cadence_assignments were keyed via the same helper, no historical rename, no slash-handling drift.
- Zero fixture-marked cadence docs is expected: D3D/D3E scripts wrote *products* with `is_fixture: true`. The cadence assignment docs were then created by the engine sweep, which copies only its own fields (no fixture marker propagation). Strategy "delete by fixture marker" therefore won't work.
- The single test-prefixed doc id is the D3D Tier 4 synthetic (`D3D-T4-FIXTURE-001` family) — also now an orphan because PO wiped the synthetic product.
- The 109 stale-assigned-with-null-primary docs are a **pre-existing bug surface**, not strictly orphan-related. They overlap with the 759 orphans in some unknown subset. Cleaning orphans will reduce that count, but a residual population (assigned-but-null-primary on **valid** products) likely remains and is in scope for `TALLY-D3-E-STATE-PERSISTENCE`, not this tally.

### 7.4 Sample orphans (25 of 759)

From probe Section 5. Pattern: orphan MPNs span the catalog (`10001-001`, `1003868`, `1004438`, `101405-CHRM`, `120029-CHRMWHTNVY`, `152-518-SH-BLK`, etc.) — a mixture of states. Three carry an active primary user assignment (same buyer uid; raw uid redacted) and `in_cadence_review_queue = true`. Those three are currently visible in that buyer's review queue pointing at deleted products.

### 7.5 Linkage to most-recent committed import

All 50 surviving products carry `import_batch_id == 6363ebf0` (the 2026-05-12T01:39 batch). Of the 50, all 50 also have a current `cadence_assignments` doc — i.e. the cadence engine has already swept the surviving catalog at least once. So the live, valid 50 are already clean.

## 8. Orphan-detection method comparison

| # | Method | Correctness | Safety on dev | Reversibility | Auditability | Risk to legitimate assignments | Cockpit/Buyer view effect |
|---|---|---|---|---|---|---|---|
| **A** | Delete `cadence_assignments` where `doc_id` ∉ existing product doc_ids | **Highest.** Doc id is the canonical join (§5, §7.3 corroborated). Zero false positives observed. | High — pure delete on cadence_assignments only; no product writes. | Reversible only via Firestore PITR/export; doc contents would be lost otherwise (mitigated by audit-log dump). | High — per-doc audit_log entry trivial. | Zero (under Method A's invariant). | Removes 759 ghosts immediately; 50 valid stay. |
| **B** | Delete where `mpnToDocId(mpn)` ∉ existing product doc_ids | Equivalent to A in the current state (§7.3 shows zero docs differ). Slightly **less safe** because it depends on the `mpn` field being trustworthy on every doc. | Medium — one extra failure mode (missing/blank `mpn` field would cause delete of an otherwise valid doc). | Same as A. | Same as A. | Higher than A — depends on `mpn` data quality. | Same as A. |
| **C** | Delete only docs matching known test prefixes / fixture markers | **Wrong.** §7.3 shows fixture markers do not exist on cadence_assignments. Would catch 1 of 759 orphans. | High but useless. | n/a | n/a | Zero, but does not solve the problem. | Negligible. |
| **D** | Delete *all* cadence_assignments and let next sweep rebuild | Functionally equivalent to A on the current dev state (the 50 valid would be rebuilt on the next import / scheduled sweep). However: rebuild requires a sweep to actually run, and `runCadenceEvaluation` is invoked by the importer with `importedMpns` — so it only re-creates docs for products in the *next* import. If no further import runs, the 50 valid docs are also lost until then. | Lower than A — destroys current valid state. | Low. | Easy to log. | High — destroys the 50 valid assignments. | Buyer review queues empty until next sweep. |
| **E** | Do nothing — wait for next sweep to clean up | **Won't work.** §5 confirms there is no GC code path. The next sweep will only *create* / *update* docs for MPNs in the next import; orphans persist forever. | High (zero action). | n/a | n/a | None, but problem is unresolved. | 759 ghosts remain visible. |

## 9. Recommended cleanup strategy

**Strategy A** — delete `cadence_assignments` where `doc_id` is not present in the current `products` collection.

Rationale:

- Doc-id join is the canonical invariant in code; probe confirmed zero drift.
- Method B's `mpn`-derivation adds a failure mode (blank `mpn`) for no extra coverage on this data set.
- Methods C, D, E either fail to clean or destroy valid state.
- Strategy A is the *minimum surgical* change consistent with the legacy Carry-Forward "smallest safe path" rule.

**Conditional on PO confirming the catalog wipe + fresh import are final.** While the catalog is mid-flux (§7.1), any execution would risk deleting cadence docs for products PO is about to re-import.

## 10. Proposed Homer implementation shape (not yet a dispatch)

A single script, modelled on [scripts/cleanup-cadence-old-field.ts](scripts/cleanup-cadence-old-field.ts) and [scripts/backfill-product-name-uuid-drift.ts](scripts/backfill-product-name-uuid-drift.ts):

- File: `scripts/cleanup-cadence-orphans.ts`
- Auth: `GCP_SA_KEY_DEV` env (no `applicationDefault()` fallback; explicit project_id assertion against `ropi-aoss-dev` — refuse to run otherwise; no staging/prod path).
- Phase 1 (always): build `Set<string>` of all `products` doc ids. Stream `cadence_assignments` and classify each doc as `valid` / `orphan`. Print counts.
- Phase 2 (`--apply` only): batch-delete orphans in chunks of 250 via `firestore.WriteBatch.commit()`, with per-chunk audit_log emission (single summary entry per chunk to avoid 1000+ writes — see §12).
- Hard stops baked in the script:
  - `if (productCount === 0) abort` — catalog wipe in progress.
  - `MAX_DELETE = 1500` — sanity ceiling. `if (orphanCount > MAX_DELETE) abort with --i-mean-it flag required`.
  - `if (orphanCount / cadenceCount > 0.99) abort` — defensive against having loaded a wrong project.
  - `if (orphan that carries primary_user_id !== "" && --skip-active-assignments not given) abort` — see §14 PO ruling #4. Default opinion: such docs *should* be deleted because they reference dead products, but PO should consciously waive.
- Idempotent: re-running after apply finds 0 orphans → no writes.
- Output: JSON evidence file under `evidence/tally-d3-e-cadence-residue/` matching the probe's schema (before/after counts + per-doc summary).
- **No product writes. No cadence engine code changes. No deploy required.**

## 11. Proposed dry-run / apply contract

Per Carry-Forward "Dry-Run Gate":

- Default mode = dry-run; `--apply` flag required for any write.
- Dry-run output must include:
  - SA `project_id` echo + assertion result
  - products count, cadence_assignments count
  - classification: valid / orphan-with-active-assignment / orphan-without-assignment
  - sample 25 of each class (doc_id, mpn, cadence_state, primary_user_id, in_cadence_review_queue)
  - exact count that *would* be deleted on `--apply`
  - exact count that *would* be skipped (with reason)
  - SHA-256 of the sorted-orphan-id list (audit pin so the apply step can re-verify)
  - explicit final line: `=== DRY-RUN COMPLETE — zero writes performed ===`
- Apply mode must additionally:
  - Re-build the orphan set, re-compute the SHA-256, and **abort** if it differs from the dry-run hash. Concurrent writes during the gap = stop.
  - Print actual deletes per chunk + final total.
  - Persist the JSON evidence file with `mode: "apply"`, `started_at`, `completed_at`, before/after counts, per-doc deleted manifest.

## 12. Audit logging requirements

Two-layer:

1. **Per-chunk summary entry** in `audit_log` (avoid emitting 759 individual writes):
   ```
   event_type: "cadence_assignment_orphan_cleanup"
   tally_id: "TALLY-D3-E-CADENCE-RESIDUE"
   chunk_index: <n>
   chunk_size: <k>
   doc_ids: [<up to 250 ids>]
   acting_user_id: "system:tally-d3-e-cadence-residue"
   created_at: serverTimestamp()
   project_id: "ropi-aoss-dev"
   ```

2. **Run-summary entry** (one per `--apply` invocation):
   ```
   event_type: "cadence_assignment_orphan_cleanup_run"
   tally_id: "TALLY-D3-E-CADENCE-RESIDUE"
   total_before: <N>
   total_deleted: <K>
   total_after: <N - K>
   evidence_path: <path>
   evidence_sha256: <hex>
   ```

The dry-run produces no audit_log entries. Apply mode produces ⌈orphans/250⌉ + 1 entries.

## 13. Stop conditions

Dispatch must stop and return to Lisa if any of the following hold:

1. PO has not confirmed the fresh Full Product Import is **final** (see §7.1 — catalog dropped 286→50 mid-session).
2. Probe shows products count = 0 at execution time.
3. Probe shows any `import_batches` doc with `family == "full_product"` and `status == "processing"`.
4. Orphan count differs by more than ±5% between the dispatch dry-run and Frink's pre-dispatch probe (concurrent activity — pause and reassess).
5. Any orphan with `manual_assignment == true` exists. (Probe sample shows zero, but a final scan is required — manual buyer assignments should never be silently deleted.)
6. Orphans-as-a-fraction-of-total > 99% (would suggest accidentally pointing at a wrong project where products is empty).
7. Apply step encounters a write failure on more than 1% of intended deletes.
8. Any attempt to write outside `cadence_assignments` (other than the audit_log entries enumerated in §12). Scope creep is a stop.

## 14. Open PO rulings needed

These must be resolved before Homer is dispatched:

1. **Catalog finality.** Is the current dev catalog (50 products, last imported as batch `6363ebf0` on 2026-05-12T01:39 UTC) the **final** post-wipe state, or is PO still mid-rebuild? If still rebuilding, defer execution.
2. **Strategy confirmation.** Accept Strategy A (doc-id-based delete) over B/C/D/E?
3. **Fate of orphans carrying `primary_user_id` (87 docs) and `manual_assignment` (count unknown — to be scanned).** Default Frink opinion: delete (they reference dead products and inflate buyer queues), but PO should confirm rather than have the script silently nuke buyer-touched records.
4. **`TALLY-D3-E-STATE-PERSISTENCE` separation.** The 109 stale-assigned-with-null-primary count overlaps the 759 orphans. Confirm that *non-orphan* stale-assigned cleanup is out of scope for this tally and remains in `TALLY-D3-E-STATE-PERSISTENCE`. (My read of the dispatch question 7 says yes — defer.)
5. **Reusability.** One-shot or repeatable script? Recommend repeatable + committed (the structural cause — no GC path — persists). Future imports that drop MPNs will create new orphans on the next sweep gap. A long-term fix is to add GC inside `runCadenceEvaluation`, but that is **out of scope** for this tally and should be a separate Tally if PO wants it.
6. **Audit detail.** Per-chunk summary (Frink default, §12) vs per-doc audit entries (more detail, 759× writes)?
7. **Environment scope.** Dev only, per dispatch. Confirm no staging/prod authorization — script must hard-refuse non-dev project IDs.
8. **Backup.** Before delete, dump the orphan docs to a JSON file in the evidence dir for recoverability? Frink default: yes (small data, big safety upside).

---

## Verdict on the dispatch as written

**Conditional Pass.** Reconnaissance is complete and clean; implementation is **blocked on PO ruling #1** (catalog finality) at minimum. The strategy comparison, the join-key analysis (Rule 6), and the no-GC structural finding (§5) are firm.

- Probe found: 759 of 809 cadence_assignments are orphans (94%); doc-id join is canonical and uncontested; no fixture markers exist on cadence docs (Strategy C is dead); cadence engine has no delete code path anywhere (Strategy E is dead).
- Probe also found a transient-state risk: products dropped 286→50 within this session. Counts are stable on the 8-s scale but the catalog is being actively rebuilt.

No code changes proposed. No Firestore writes performed. The probe script is committed-but-untracked and read-only.

---

## Addendum — re-verification probe at 2026-05-12T21:29 UTC

User re-issued the dispatch ~25 min after the original probe; a `bash scripts/deploy-dev.sh` was observed in the terminal context between turns (initiated outside this audit; flagging for awareness — not run by Frink). Re-ran the read-only probe to confirm findings are still current.

Probe JSON: [evidence/tally-d3-e-cadence-residue/probe-2026-05-12T21-29-50-364Z.json](evidence/tally-d3-e-cadence-residue/probe-2026-05-12T21-29-50-364Z.json)

| Metric | 21:06 probe | 21:29 probe | Δ |
|---|---|---|---|
| products | 50 | **25** | −25 |
| cadence_assignments | 809 | 809 | 0 |
| matched by doc_id | 50 | 25 | −25 |
| matched by mpnToDocId only | 0 | 0 | 0 |
| **orphans** | 759 | **784** | +25 |
| orphan ratio | 93.8% | **96.9%** | +3.1pp |
| stale assigned + null primary | 109 | 109 | 0 |
| fixture-marked | 0 | 0 | 0 |
| test-prefixed doc_id | 1 | 1 | 0 |
| `import_batches` status=processing | 0 | 0 | 0 |
| Most recent committed batch | `6363ebf0` (01:39 UTC, 205 rows) | **`d57fb35d` (21:25 UTC, 24 rows)** | new batch |
| Counts stable across two 8-s snapshots? | YES | YES | — |

**Interpretation:** The catalog is still actively being rebuilt by PO. A new full_product import committed 24 rows at 21:25 UTC, and the active product set shrank — meaning PO either re-wiped between batches or the new batch is a smaller subset. No `processing` status was caught in either probe, but the 8-second stability window is too small to certify finality across PO's manual workflow.

### STOP condition (now firmly tripped)

§13 stop condition #1 ("PO has not confirmed the fresh Full Product Import is final") is now actively in effect. §13 stop condition #4 ("orphan count differs by more than ±5% between dry-runs") is also tripped if you treat the two probes as a dry-run pair (Δ orphans = +3.3% of total cadence_assignments, +3.3% of cadence count, +3.3pp absolute).

**No execution dispatch should be drafted until PO declares the dev catalog rebuild complete.** Strategy A's logic does not change — doc-id is still canonical, no GC path still exists, no fixture markers still exist on cadence docs. But running it against a moving catalog would delete cadence docs for products PO is about to re-import.

### What is unchanged

- §5 cadence write semantics: still single-key via `mpnToDocId(mpn)`; no delete path.
- §7.3 join-key analysis: still zero `mpnToDocId-only` drift (Rule 6 disambiguated).
- §8 strategy comparison verdicts: A still recommended; C/D/E still rejected.
- §9 recommended strategy: A.
- §10–§12 implementation shape, dry-run/apply contract, audit logging: all unchanged.
- §14 PO rulings: ruling #1 (catalog finality) is now the undisputed gate.

### Verdict (updated)

**Conditional Pass — execution blocked pending PO sign-off that the dev catalog is final.** Reconnaissance is complete; recommendation stands. Re-probe required immediately before any Homer dispatch is drafted.

---

*Frink, 2026-05-12 (initial 21:08 UTC, addendum 21:30 UTC)*
