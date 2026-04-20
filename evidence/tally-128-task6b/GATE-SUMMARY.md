# TALLY-128 Task 6 — §13 Gate Evidence

**Subtask:** 6b — Detection Removal + Deploy + Verify
**Date:** 2026-04-20
**Operator:** Homer

---

## Subtask 6b.1 — Code removal

**Commit:** `01ae171954e601f4284257df854d94343f6673f7`
**Branch:** `main` (pushed to `origin/main`)
**File:** `backend/functions/src/routes/siteVerificationReview.ts`
**Diff:** `1 file changed, 5 insertions(+), 21 deletions(-)`

Removed:
- `orphanedAuditWrites: Promise<unknown>[]` declaration (was L79).
- `if (!reg) { audit_log.add({ event_type: "site_targets.orphaned_reference", … }); continue; }` block (was L139–151) → replaced by `if (!reg) continue;`.
- Trailing `Promise.allSettled(orphanedAuditWrites).catch(() => {});` cleanup (was L180).
- Stale comment lines describing the orphan-logging path; replaced with note pointing to TALLY-128 Task 5 cleanup + Task 6a INV-A classification.

Preserved (per dispatch hard rules):
- `loadRegistry()` unchanged — no `is_active` query filter refactor.
- `if (!reg.is_active) continue;` silent-skip branch retained.
- All other review endpoint logic intact.

**Original introduction SHA:** `d11fd1c` — *feat(site-verification): rewrite review queue with registry joins, coverage gaps, reviewer attribution, /reverify (TALLY-123 Tasks 3-6)*

---

## Subtask 6b.2 — Deploy

**Cloud Run revision:** `ropi-aoss-api-00114-7lm`
**Project:** `ropi-aoss-dev`
**Region:** `us-central1`
**Service URL:** `https://ropi-aoss-api-719351392467.us-central1.run.app`
**Traffic:** 100% on new revision
**Deploy command:** `cd backend/functions && gcloud run deploy ropi-aoss-api --source . --project ropi-aoss-dev --region us-central1 --quiet`
**Result:** Deploy succeeded. No cache flags needed (TS source changed; `npx tsc` ran clean pre-deploy; Cloud Build picked up fresh `lib/` artifacts).

---

## Subtask 6b.3 — Typecheck + build

- `cd backend/functions && npx tsc --noEmit` → **clean** (no output, exit 0).
- `cd backend/functions && npx tsc` → **clean** (no output, exit 0). `lib/` regenerated.
- Frontend `npx tsc --noEmit` → pre-existing errors **unrelated** to this change. Frontend has uncommitted in-progress edits from prior sessions in `App.tsx`, `Layout.tsx`, `lib/api.ts`, `pages/*.tsx` (231 insertions / 3850 deletions across 9 files, not authored by this dispatch). Backend orphan removal does not import or affect frontend. No frontend imports were broken by this change (backend-only diff).

**Grep confirmation** (per dispatch):
```
$ grep -rn "orphaned_reference" backend/functions/src/
backend/functions/src/routes/siteVerificationReview.ts:130:        //   by TALLY-128 Task 5 (commit 38ed25e). The orphaned_reference
```
Only remaining hit is the **explanatory comment** documenting the removal. Zero hits in executable code.

```
$ grep -rn "orphanedAuditWrites" backend/functions/src/
(no matches)
```

---

## Subtask 6b.4 — Immediate post-deploy spot-check

**Cutoff:** 2026-04-20T23:04:00Z (commit `01ae171` author timestamp)
**Method:** `audit_log` query via Firestore REST `:runQuery` for `event_type == "site_targets.orphaned_reference" AND created_at >= cutoff`.
**Result:** **0 events.** ✅

```
cutoff: 2026-04-20T23:04:00Z
orphaned_reference events since cutoff: 0
OK: zero events.
```

Note: direct `/api/v1/site-verification/review` HTTPS hits with a `gcloud auth print-access-token` returned HTTP 401 (endpoint correctly enforces Firebase Auth ID token, not GCP access token — unchanged behavior, not introduced by this PR). The audit_log delta is the authoritative signal. Per Task 6a activity-check, the system has live `/review` traffic and reviewer mutations from authenticated UI sessions; any such traffic post-deploy will exercise the new code path.

**Throwaway helper:** `scripts/tally-128-task6b-spotcheck.js` was used for the audit query and removed after evidence capture.

---

## Subtask 6b.4 (24h addendum) — Pending

Re-run the audit_log query at ~2026-04-21T23:00Z with the same cutoff (2026-04-20T23:04Z). Expected: 0 events across the full 24h window.

If non-zero: STOP and report — would indicate either (a) removal didn't fully land in the deployed binary, or (b) another code path writes these events that 6a missed.

This addendum is **not a gate blocker** — delivered as a follow-up note when the window elapses.

---

## Hard rules — compliance

- ✅ Minimum work: only the orphan branch + its supporting state were removed. `loadRegistry()`, the `is_active` silent-skip, and all other endpoint logic untouched.
- ✅ Dev-mode efficiency rule observed.
- ✅ Zero `not_verified` literal in diff (verified: `git diff backend/functions/src/routes/siteVerificationReview.ts | grep not_verified` → no matches).
- ✅ No new fixture seeding.
- ✅ No retry-without-investigation: deploy succeeded first try; spot-check passed first try.

---

## Closure

TALLY-128 Task 6b complete pending 24h addendum. With 6b closed, **TALLY-128 is done** and Pass 5 Dashboard KPIs are unblocked.

**Carry-forwards (unchanged from prior gates):**
- TALLY-129 — UI casing bug (206991-6SW Details-tab Save).
- TALLY-130 — Canonical writer divergence (HTG230493wht subcoll-only `site_owner`).
- TALLY-131 — Casing normalization policy (deferred).
- TALLY-132 candidate — `vnds.com` registry-seed (13 products).
- Future refactor tally — `loadRegistry()` could add `is_active` query filter (noted in 6a, deferred per dispatch).
