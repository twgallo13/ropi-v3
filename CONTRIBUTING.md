# Contributing to ROPI V3

## For AI Assistants

If you are an AI assistant asked to work on this repo, read this section first. It will save you time and prevent deploy mistakes that have happened before.

### Source of truth (in order)

1. **Master Blueprint** — canonical feature specs (Notion workspace)
2. **Change Tally Log** — approved build tasks (Notion workspace)
3. **Active task pages / AI Task Tracker** — Lisa's dispatch briefs
4. **Repo evidence** — this repo at `twgallo13/ropi-v3`, branch `main`
5. Archived chats are NOT authoritative.

### Agent roles

This project operates with named AI agents. Definitions live in `.github/agents/`.

- **Lisa** (Claude) — Lead Build Supervisor. Writes dispatches. Does not write code.
- **Homer** (Copilot/Codespaces) — Executes dispatches. Writes code. Read-write.
- **Frink** (ChatGPT + GitHub) — Repo auditor. Read-only. Verifies Lisa's dispatch claims and Homer's output against repo state.
- **Matt** (Gemini) — Visual QA. Tests deployed frontend against spec.

### Deploying

**ALWAYS use `./scripts/deploy-dev.sh`.** Never run `gcloud run deploy` or `firebase deploy` directly.

The script handles the full sequence (preflight checks + backend build + frontend build + Cloud Run deploy + Firebase deploy) deterministically. Partial manual deploys have been the root cause of every deploy-related outage in this project.

See `README.md` → Deployment for prerequisites and details.

### Required local files (gitignored)

- `frontend/.env` — 7 VITE_* vars (see `frontend/.env.example`)
- `backend/functions/.env` — server-side secrets (see `backend/functions/.env.example`)

These are **not committed**. Values come from the team's shared secret channel (ask John).

**Do not create `.env` files at repo root.** Only the two paths above are used.

### Before making deploy-related changes

Ask Frink to audit first. Deploy configuration has multiple interacting files (`backend/functions/Dockerfile`, `firebase.json`, `.firebaserc`, `scripts/deploy-*.sh`). Changes in one place often require corresponding changes elsewhere.

### Common pitfalls (learned through experience)

1. **Fresh clones don't have .env.** Builds from `/tmp` clones produce broken frontends with empty Firebase config. Build from the canonical workspace (which has `.env`) or copy `.env` into the fresh clone before building.

2. **Dockerfile builds from source.** Don't commit `backend/functions/lib/` compiled output. It's gitignored. The Dockerfile runs `npm run build` during image build.

3. **`firebase deploy` alone does not deploy the backend.** The backend runs on Cloud Run, not Firebase Functions. `firebase.json` has no `functions` block. Deploys must include `gcloud run deploy`.

4. **Hosting is the frontend only.** `firebase deploy --only hosting` only deploys `frontend/dist`. Backend changes require Cloud Run deploy separately. `scripts/deploy-dev.sh` does both.

5. **Vite inlines env vars at build time.** Frontend `.env` values get baked into the bundle when `npm run build` runs. Changing `.env` after a build requires rebuilding. Production secrets are not kept here; `.env` holds the Firebase web config, which is client-side by design.

### Reporting format

When executing dispatches, report with this structure:

1. Step 0 tree state
2. Files created / modified
3. Test output (if applicable)
4. Commit SHA + PR link (if applicable)
5. Deploy log + Cloud Run revision + Firebase Hosting release timestamp (if applicable)
6. Any deviations from the dispatch

Follow STOP-and-report discipline: if anything surprises you, stop and report before attempting recovery autonomously.

## For Humans

Standard contributing guidelines:

1. Never commit `.env` files.
2. Never commit `backend/functions/lib/` or `frontend/dist/`.
3. Open a PR for non-trivial changes; don't commit directly to `main`.
4. If you update the deploy script, update `README.md` and this file to match.