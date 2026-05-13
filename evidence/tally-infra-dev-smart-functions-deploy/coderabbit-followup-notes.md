# TALLY-INFRA — fail-closed git checks (CodeRabbit follow-up on PR #130)

Two CodeRabbit findings on `scripts/deploy-dev.sh` addressed.

## Fix 1 — Drop `|| true` on smart-deploy `git diff`
Three call sites previously suppressed git failures with `|| true`, which
could turn a real git error into an empty diff and silently flip the smart
decision to `unchanged` (skipping a needed Functions deploy). Replaced with
explicit:

```bash
if ! diff_out="$(git diff --name-only "$marker_sha" "$HEAD_SHA" -- "${FUNCTIONS_PATHS[@]}")"; then
  echo "✗ git diff failed comparing $marker_sha..$HEAD_SHA ..."
  exit 1
fi
```

Sites patched:
- plan-only path (former line ~96)
- main deploy decision (former line ~203)
- `--skip-functions` warn check (former line ~220)

## Fix 2 — Fail-closed git preflight before any side effects
Moved git availability + repo-validity checks to run immediately after the
top-level `cd "$REPO_ROOT"`, BEFORE preflight, builds, Cloud Run, or Firebase
deploys. Both `--plan-only` and full-deploy paths now share this preflight.

Checks added:
- `command -v git`
- `git rev-parse --is-inside-work-tree`
- `git rev-parse --verify HEAD`

Removed the now-redundant inline `command -v git` check inside the
plan-only branch.

## Validation (no deploy)
- `bash -n scripts/deploy-dev.sh` → no syntax errors.
- `grep -c '|| true' scripts/deploy-dev.sh` → `0`.
- `bash scripts/deploy-dev.sh --plan-only` → `first-deploy`, exit 0, no
  npm/gcloud/firebase invoked. See `plan-only-default.log`.
- `bash scripts/deploy-dev.sh --plan-only --force-functions` → `force`, exit 0.
  See `plan-only-force.log`.
- `bash scripts/deploy-dev.sh --plan-only --skip-functions` → `skip`, exit 0.
  See `plan-only-skip.log`.
- Temp marker (HEAD~5) plan-only → `changed` decision with non-empty diff_out
  (exercises the no-longer-suppressed git diff capture). Marker file removed
  after test. See `plan-only-changed.log`.
- Fail-closed proof: pointed `REPO_ROOT` at a non-git directory; script
  aborted with exit 1 and message `✗ /tmp/not-a-repo is not a git work tree.`
  before any preflight, build, or deploy step ran.

## Confirmations
- No `bash scripts/deploy-dev.sh` (full deploy) executed.
- No `firebase deploy` executed.
- No `gcloud run deploy` executed.
- No Firestore writes.
- No runtime smoke.
- No staging/prod scripts modified.
- No functions exports or backend code changed.
