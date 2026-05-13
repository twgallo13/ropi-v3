# TALLY-INFRA-DEV-SMART-FUNCTIONS-DEPLOY — Stop-Anomaly + Recovery Summary

## Tally
TALLY-INFRA-DEV-SMART-FUNCTIONS-DEPLOY

## Branch
`tally-infra-dev-smart-functions-deploy` (off `main` @ `8ed081a85eb79c75a8157324df749f09d641f4c5`)

## Anomaly (initial patch attempt)
First version of the `deploy-dev.sh` patch placed the `--plan-only`
short-circuit *after* preflight, npm builds, and `gcloud run deploy`.
Running `bash scripts/deploy-dev.sh --plan-only` therefore executed:

- `npm ci` + backend `tsc` build
- `npm ci` + frontend `vite build`
- `gcloud run deploy ropi-aoss-api --source ./backend/functions --project ropi-aoss-dev ...`

Terminal hit the 60s tool timeout while Cloud Run was building; the
terminal was killed via `kill_terminal`. Halted per "STOP on anomaly" rule.

## Cloud Run state verification (read-only)
Commands run after stop:

```
gcloud run services describe ropi-aoss-api --project ropi-aoss-dev --region us-central1 \
  --format="value(status.latestReadyRevisionName,status.url,status.conditions[0].lastTransitionTime)"

gcloud run revisions list --service ropi-aoss-api --project ropi-aoss-dev --region us-central1 --limit 5
```

Result:

| Active revision | Deployed (UTC) | Deployed by |
|---|---|---|
| **`ropi-aoss-api-00207-szp`** | **2026-05-12T22:19:48Z** | `firebase-adminsdk-fbsvc@ropi-aoss-dev.iam.gserviceaccount.com` |
| ropi-aoss-api-00206-9ms | 2026-05-12T20:44:39Z | (same) |
| ropi-aoss-api-00205-slx | 2026-05-12T10:28:56Z | (same) |
| ropi-aoss-api-00204-p9s | 2026-05-12T00:43:41Z | (same) |
| ropi-aoss-api-00203-9xx | 2026-05-12T00:14:21Z | (same) |

Last-transition timestamp: `2026-05-12T22:20:08.992933Z`.
Unintended `gcloud run deploy` invocation occurred at ~`2026-05-13T02:18Z`,
≈4 hours **after** rev 00207 went live. **No new revision was created.**
The aborted build did not produce or activate a new revision.
**Conclusion: no accidental dev deploy completed; Cloud Run state unchanged.**

## Remediation (path B applied)
Relocated the `--plan-only` decision + exit block to immediately after the
mutex guard, **before** preflight checks, npm installs, builds, Cloud Run
deploy, and Firebase deploy. Only operations executed when `--plan-only` is
set are pure local-git reads (`git rev-parse HEAD`, `git cat-file -e`,
`git diff --name-only`).

Structure (line numbers in patched script):
- L47 `PLAN_ONLY=0`
- L51-63 arg parser
- L67 mutex check
- **L75-126 plan-only block (ends in `exit 0`)**
- L128 `▶ Preflight checks...`
- L154/L161 `npm ci`
- L168 `gcloud run deploy`
- L181 `firebase deploy --only firestore:rules,...,hosting`
- L191-217 smart-deploy decision (executed only on real runs)
- L255 `firebase deploy --only functions --project ropi-aoss-dev`

## Validation
- `bash -n scripts/deploy-dev.sh` → OK (syntax clean).
- 8 plan-only scenarios captured in this directory:
  1. `scenario-1-marker-missing.txt` → `first-deploy`
  2. `scenario-2-functions-changed.txt` → `changed` (plus diff list)
  3. `scenario-3-no-changes.txt` → `unchanged`
  4. `scenario-4-force.txt` → `force`
  5. `scenario-5-skip.txt` → `skip`
  6. `scenario-6-no-functions-alias.txt` → `skip`
  7. `scenario-7-marker-stale.txt` → `marker-stale`
  8. `scenario-8-mutex-error.txt` → mutex error, exit=1
- Every plan-only output ended with the proof line:
  `✅ Plan-only complete. No preflight, build, or deploy commands executed.`
- No `npm`, `gcloud`, or `firebase` invocation occurred in any of the
  plan-only runs.

## Files changed (uncommitted, on branch)
- `scripts/deploy-dev.sh` — smart functions deploy + flags + plan-only.
- `.gitignore` — added `.deploy-state/` (gitignored per-host marker dir).
- `evidence/tally-infra-dev-smart-functions-deploy/` — this summary + 8 scenario logs.

## Marker strategy (kept)
Local gitignored file: `.deploy-state/dev-functions-last-deployed-sha`.
Committing a `deploy-state/...` file to source control was rejected because
the marker is per-host mutable state (different developers / CI hosts have
different last-deployed SHAs). The marker is created/updated only after a
successful `firebase deploy --only functions`.

## Status
`dry-run-complete-awaiting-go` — script is structurally safe; awaiting Lisa's
go-ahead to commit + open PR with the relocated patch.
