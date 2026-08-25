# PROGRESS — Overnight Gate 2 Audit

Run started: 2026-08-25T13:28:08Z (UTC). Role: Homer. Mode: READ-ONLY, repo-only (no Notion).

## Baseline (§2)

| Item | Value |
|---|---|
| `git rev-parse HEAD` | `2698e48340b0f309bafdf9a5a4ced0645b8f160c` |
| `git status --porcelain` | (empty output — working tree CLEAN) |
| Branch | `main` |
| Firestore project | `ropi-aoss-dev` (via `GCP_SA_KEY_DEV`, reads only) — connection verified, 35 collections listed |

### Build

| Target | Command | Result |
|---|---|---|
| backend/functions | `npm run build` (`tsc`) | **PASS** (exit 0, no output) |
| frontend | `npm install` then `npm run build` (`tsc -b && vite build`) | **PASS** (exit 0, built in 5.17s; `node_modules/` was absent, install required) |

### Tests

There is **no `test` script** in `backend/functions/package.json`, `scripts/package.json`, or `scripts/seed/package.json`, and there is no root `package.json`. Test files are hand-rolled assertion scripts run as compiled JS (per the header of `backend/functions/src/services/completionCompute.test.ts:1-8`). All five were run individually from `backend/functions/` after `npm run build`:

| Test file (compiled) | Result |
|---|---|
| `lib/services/completionCompute.test.js` | **30 passed, 4 failed** — failures: `2b all-AI ai_blockers cnt`, `2c all-AI hint prefix`, `4a mixed ai_blockers cnt`, `4c mixed hint = AI first` |
| `lib/lib/brandRegistry.test.js` | 33 passed, 0 failed |
| `lib/lib/departmentRegistry.test.js` | 38 passed, 0 failed |
| `lib/lib/parseAdditionalImageUrls.test.js` | 10 passed, 0 failed |
| `lib/middleware/requireSchedulerOIDC.test.js` | 18 passed, 0 failed |

Note: every test harness exits 0 regardless of failures (no non-zero exit on failure) — recorded as a finding.

## Task checkpoints

| Task | Status | Timestamp (UTC) |
|---|---|---|
| §2 Setup + baseline | DONE | 2026-08-25T13:28:08Z |
| TASK B1 — deep-map-department | DONE | 2026-08-25T13:37:32Z |
| TASK B2 — deep-map-site | DONE | 2026-08-25T13:43:27Z |
| TASK B3 — deep-map-brand | DONE | 2026-08-25T13:49:05Z |
| TASK A — gate2-phase1 | DONE | 2026-08-25T13:55:13Z |
| TASK A — gate2-phase2 | DONE | 2026-08-25T18:05:43Z |
| TASK A — gate2-phase3 | DONE | 2026-08-25T18:10:11Z |
| TASK A — gate2-phase4 | DONE | 2026-08-25T18:12:02Z |
| TASK A — gate2-phase5 | DONE | 2026-08-25T18:13:42Z |
| TASK C — contradictions | DONE | 2026-08-25T18:17:28Z |
| TASK D — sequencing | DONE | 2026-08-25T18:18:33Z |
| TASK E — open-questions | DONE | 2026-08-25T18:21:03Z |
| TASK G — ux-defects | DONE | 2026-08-25T18:24:20Z |
| TASK H — security | DONE | 2026-08-25T18:26:56Z |
| TASK I — dead-ends | DONE | 2026-08-25T18:33:15Z |
| TASK J — workflows | DONE | 2026-08-25T18:36:00Z |
| TASK K — settings-and-hardcoding | DONE | 2026-08-25T18:38:05Z |
| TASK L — data-integrity | DONE | 2026-08-25T18:40:36Z |
| TASK M — background-and-silent-failures | DONE | 2026-08-25T18:43:06Z |
| TASK N — tests-and-dependencies | DONE | 2026-08-25T18:45:25Z |
| TASK O — contracts-and-roles | DONE | 2026-08-25T18:48:19Z |
| TASK F — self-check + SUMMARY | DONE | 2026-08-25T18:49:40Z |
