# Lisa handoff — Overnight Audit → Recovery Roadmap

Paste everything below the line into a fresh Lisa session. It is self-contained.
Works as-is for a ChatGPT-based agent (Frink/Linguo) with GitHub read access.

---

## Context: what the audit was and why it exists

The ROPI V3 recovery roadmap was built on a Build Plan whose blast-radius markers were
mostly unverified — every "?" meant "we think this change touches X, but nobody checked."
Planning on top of that produced dispatches that kept discovering scope mid-build.

An overnight read-only audit was commissioned to convert those "?" markers into verified
facts, and to sweep the whole application for what would otherwise be found the hard way.
It is **complete**: all 15 tasks (B, A, C, D, E, G, H, I, J, K, L, M, N, O, F).

**Your job now is not to re-audit. It is to turn this evidence into a corrected roadmap.**

## Where it is

- **Commit:** `f169797` on `main` (pushed, visible to any clone)
- **Location:** `docs/recovery/overnight/` — 23 reports, ~500 KB
- **Dispatch that produced it:** `docs/recovery/overnight/OVERNIGHT-AUDIT.md`
- **Read first:** `SUMMARY.md` (40 lines), then `FINDINGS-LOG.md` (87 findings, tagged)

Per-task files: `deep-map-{department,site,brand}.md` · `gate2-phase1..5.md` ·
`contradictions.md` · `sequencing.md` · `open-questions.md` · `ux-defects.md` ·
`security.md` · `dead-ends.md` · `workflows.md` · `settings-and-hardcoding.md` ·
`data-integrity.md` · `background-and-silent-failures.md` ·
`tests-and-dependencies.md` · `contracts-and-roles.md`

**Citations are valid against current `main`.** The audit ran at `2698e48`, which differs
from the prior `main` (`33ebbad`) only by `.claude/settings.json`, `.vscode/mcp.json`,
two one-line agent-file edits, and the dispatch doc. **No application code changed.**
Every `file:line` in those reports can be opened on `main` as written.

## What it established

Verified: 29 of 29 tallies mapped · 25 "?" markers converted (23 CONFIRMED, 1 NOT FOUND,
1 N/A-external) · E1–E9 all answered · self-check 5/5 re-verified, 0 corrections.

Found: 12 contradictions · 17 sequencing violations · ~163 consumers outside declared
edit surfaces across 18 of 29 tallies · 51 UX defects · 13 ungated routes · 11 stuck or
unreachable workflow states · 17 orphan references · 20 silent-failure classes ·
32 hardcoded values that should be settings.

**Correction to SUMMARY.md:** it reports UX defects as 16/20/13 = 49. The table in
`ux-defects.md` actually contains **22** Misleads rows, so the total is **51**, not 49.
Blocks work (16) and Cosmetic (13) are correct. Fix the summary line when you touch it.

## The four findings that break the current roadmap

These are structural — they invalidate phase order, not just individual tallies.

1. **D1 — Phase 1 cannot be completed as sequenced.** P1-2 (TALLY-107 auto-promotion)
   fires when a product reaches `completion_state == "complete"`. **0 of 81 live products
   are complete, and the ceiling is 79%** — three of 14 required fields are structurally
   unfillable (`sub_category`, `ai_seo_title`/`ai_seo_meta` have 0 docs; `department` is
   `active: false`, hidden from the editor yet still counted by `completionCompute.ts:212-215`,
   which has no active filter). P1-2 cannot be smoke-tested until a **Phase 2** tally
   (P2-1b or P2-7) makes the required set satisfiable.

2. **D3 — P2-4's stated no-code constraint cannot deliver its stated outcome.**
   Smart rules write `attribute_values` only (`smartRules.ts:252`). The 13 live
   `Taxonomy: *` rules set `attribute_values/department_key`; nothing mirrors to root.
   No tally has `smartRules.ts` in scope.

3. **D4 / D6 — work nobody owns.** The export's `department` source
   (`exportSerializer.ts:232`, blank for 56 of 81 products) sits between P2-5 and P2-6 and
   is in neither surface. P5-4 promises a blocking-vs-warning severity model that no tally
   builds — the code has exactly one severity.

4. **~163 out-of-surface consumers across 18 of 29 tallies.** Edit surfaces were drawn too
   narrowly across most of the plan. Each is a scope risk that would surface mid-build.

## Out of band — do not roadmap this, escalate it

`security.md` documents a live privilege escalation on `main`: `firestore.rules:22`
lets any signed-in user write **any** field of their own `users/{uid}` doc including
`role`; `roles.ts:38-45` reads that role back and admits them; `roles.ts:30` appends
`admin`/`owner` to every gate. Any authenticated user can self-assign admin and pass
every `requireRole` gate, on an `allUsers`-invokable Cloud Run service with CORS
reflecting any origin. Independently re-verified against `main`, not only the audited commit.

Also live: all four Cloud Scheduler jobs last ran **2026-04-23**, stamped `ok:true`,
with no alerting anywhere.

## Known limits — do not treat absence as evidence

- `docs/recovery/RECOVERY-ANCHOR.md` and `docs/recovery/PRE-BUILD-PROTOCOL.md`
  **do not exist** in the repo or its history. Task C therefore swept **Appendix B only**;
  the Findings Register was explicitly out of scope. Task A used the dispatch's own
  §3 template in place of the missing Gate 2 definition.
- Not verified: whether the 4 scheduler jobs are still provisioned in GCP (needs `gcloud`);
  whether `/admin/ai-automation/completion-rules` renders as a dead link (runtime question);
  RetailOps' tolerance for extra CSV columns (external); staging/prod state (dev only).

## What to produce

Use your standard return format — **Current state / Blocker / Next action / Dispatch brief
/ Acceptance criteria** — and apply your core rules: distinguish verified from inferred,
cite evidence for every claim, flag conflicts rather than resolving them silently.

Deliver:

1. **A re-sequenced phase plan.** The current Phase 1 → 5 order is broken at D1. Decide
   whether the fix is moving P1-2 into Phase 2, pulling a Phase 2 tally forward, or
   splitting P1-2. State the trade-off; do not pick silently.
2. **Corrected edit surfaces** for the 18 tallies with out-of-surface consumers, from the
   Gate 2 maps in `gate2-phase1..5.md`.
3. **New tallies for orphaned work** — at minimum the export `department` source (D4) and
   the severity model (D6).
4. **A triage of the 51 UX defects** against roadmap phases — which are already covered by
   a planned tally, which need new ones, which are acceptable to defer.
5. **The dispatchable list** — which of the 29 tallies now have a complete Gate 2 map and
   can go to Homer, and what blocks each of the rest.

Do not dispatch anything to Homer until the PO approves the re-sequenced plan.
