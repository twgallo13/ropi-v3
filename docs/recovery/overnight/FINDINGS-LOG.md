# FINDINGS-LOG — append-only

Tags: `[FINDING]` `[RECOMMENDATION]` `[CONCERN]` `[BLOCKER]`

---

## BLOCK-01 — [BLOCKER] — §1 / Task C — `docs/recovery/RECOVERY-ANCHOR.md` missing

Evidence: `ls docs/` returns only `scheduled-jobs.md`. Confirmed absent on all 11
remote branches and in full history (`git log --all --diff-filter=A`).

Impact: Task C sweeps specific-value claims in Appendix B **and** in
RECOVERY-ANCHOR.md. Half of Task C's declared input does not exist. Task C will run
against Appendix B only; the RECOVERY-ANCHOR half is reported NOT FOUND, not inferred.

---

## BLOCK-02 — [BLOCKER] — §1 — `docs/recovery/PRE-BUILD-PROTOCOL.md` missing

Evidence: same as BLOCK-01.

Impact: this file defines what a Gate 2 blast-radius map must contain. Per §1 the run
proceeds from Appendix B alone, using the Task A template in §3 as the Gate 2 shape.
Any Gate 2 completeness criterion that lives only in PRE-BUILD-PROTOCOL.md is unverified.

---

## BLOCK-03 — [BLOCKER] — Tasks B1–B3, E3, E4, G3, G7, L (all) — no Firestore credentials

Evidence: `GCP_SA_KEY_DEV` unset; no GCP/GOOGLE/FIREBASE env vars present in container.

Impact: every live-Firestore read is impossible. Specifically blocked:
- B1/B2/B3 closing live doc counts (docs carrying / docs non-empty)
- E3 (which live `cadence_rules` filter on department_key et al.)
- E4 (do the three site descriptions exist as registry attributes)
- G3 (empty dropdowns — needs live `dropdown_options`)
- G7 (duplicate `display_label` — needs live registry docs)
- **Task L in its entirety** (L1–L6 are all live-data integrity)
Static/code-side portions of B1–B3, G and E proceed normally. No value is inferred.

---

## SETUP-01 — [CONCERN] — §2 / Appendix A — dispatch file and safety config were never created

Evidence: `docs/recovery/OVERNIGHT-AUDIT.md` absent (PO setup step 1);
`.claude/settings.json` absent (PO setup step 2); `GCP_SA_KEY_DEV` unset (step 3).
None of the three one-time setup steps were completed before this run.

Impact: the Appendix A deny-list (no commit/push/deploy, no writes outside
`docs/recovery/overnight/`) is NOT in force as a mechanical guard. §0's read-only rule
is being self-enforced instead. Recorded so the PO knows the safety net was absent.

---

## N-01 — [FINDING] — Task N1 — no test runner is configured

Evidence: `backend/functions/package.json` has scripts `build`, `build:watch`, `start`,
`dev`, `lint` — **no `test` script**. devDependencies contain no jest, vitest, or mocha.
`frontend/package.json` has no test script and no test files.

The five backend test files are standalone Node scripts, self-documenting their
invocation, e.g. `src/lib/brandRegistry.test.ts:4`:
`Run: cd backend/functions && npx tsc && node lib/lib/brandRegistry.test.js`

`node --test lib/` does NOT work — it hangs and was killed at 300s (exit 143). Each
compiled test must be invoked individually.

Consequence: nothing runs these in CI or on demand as a suite; a contributor running
`npm test` gets "Missing script: test". This confirms the P1-5 edit surface, which
lists `package.json` test script as a file that tally must create.

---

## N-02 — [CONCERN] — Task N / K4 — Node runtime mismatch between repo pin and container

Evidence: `backend/functions/package.json` declares `engines: {"node": "24"}`.
Container runs `node v22.22.2`. Running `npm install` silently rewrote
`package-lock.json` `engines.node` from `"20"` to `"24"` (1-line diff), i.e. the
committed lockfile still carried the older `20` pin while package.json says `24`.

The lockfile edit was reverted (`git checkout --`) to preserve §0 read-only.

Impact: three different Node versions are in play — lockfile `20`, package.json `24`,
build/test host `22`. Builds and the 129/133 test result in this baseline were produced
on Node 22, which is not the declared deployment runtime. Cloud Functions runtime not
verified from the repo.
