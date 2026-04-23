## Local Development Setup

One-time setup:

1. Clone the repo.
2. Populate `frontend/.env` (copy from `frontend/.env.example`; ask John for values).
3. Populate `backend/functions/.env` (copy from `backend/functions/.env.example`; ask John for values).
4. Install dependencies:
```bash
   cd backend/functions && npm install && cd ../..
   cd frontend && npm install && cd ..
```
5. Authenticate CLIs:
```bash
   firebase login
   gcloud auth application-default login
```

## Running Locally

Backend (runs on port 8080):
```bash
cd backend/functions
npm run dev
```

Frontend (runs on port 5173 by default):
```bash
cd frontend
npm run dev
```

## Environment Variables

### Frontend (`frontend/.env`)

Vite inlines these at build time. Missing values produce a broken frontend (Firebase auth will fail).

| Variable | Purpose |
|----------|---------|
| `VITE_FIREBASE_API_KEY` | Firebase web client API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase Cloud Messaging sender |
| `VITE_FIREBASE_APP_ID` | Firebase web app ID |
| `VITE_API_BASE_URL` | Backend API base URL |

### Backend (`backend/functions/.env`)

Local-dev only. Production values live in Cloud Run env/secrets.

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key for AI content features |
| `SENDGRID_API_KEY` | SendGrid API key for email delivery |
| `SMTP_PASSWORD` | SMTP password for email fallback |

**DO NOT** create `.env` at repo root. Only the two locations above are used.

## Deployment

Dev deploys happen via the canonical script:

```bash
./scripts/deploy-dev.sh
```

This handles backend build + frontend build + Cloud Run deploy + Firebase deploy in one sequence. See `scripts/deploy-dev.sh` for full details.

### Prerequisites

- `frontend/.env` and `backend/functions/.env` populated (see above)
- `firebase` CLI logged in, or `GOOGLE_APPLICATION_CREDENTIALS` set
- `gcloud` CLI authenticated

### DO NOT use these commands directly

These will fail or produce broken state. Always use `scripts/deploy-dev.sh`.

```bash
# ✗ Missing backend deploy, and --only functions references a target
#   that doesn't exist in firebase.json
firebase deploy

# ✗ Wrong source path (needs ./backend/functions, not repo root)
gcloud run deploy ropi-aoss-api --source .

# ✗ The "development" alias doesn't exist in .firebaserc
firebase use development
```

### What `deploy-dev.sh` deploys

| Component | Deployed |
|-----------|----------|
| Cloud Run backend (`ropi-aoss-api`) | ✓ |
| Firestore rules | ✓ |
| Firestore indexes | ✓ |
| Storage rules | ✓ |
| Firebase Hosting (frontend) | ✓ |
| Cloud Scheduler jobs | Manual — see `docs/scheduled-jobs.md` |

## Scheduled Jobs

See `docs/scheduled-jobs.md` for the Cloud Scheduler job runbook (promote-scheduled, daily-staleness, neglected-inventory, weekly-snapshots).

## Seed Data

Initial seed data for registries (attributes, brands, departments) lives in `scripts/seed-*.js`. Run from the repo root with:
```bash
cd scripts && npm install  # one-time
GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
  node scripts/seed-attribute-registry.js
```

## For AI Assistants

If you are an AI assistant asked to work on this repo, **read `CONTRIBUTING.md` first**. It has specific rules for AI assistants including source-of-truth order, agent roles, deploy discipline, and common pitfalls.

## Build Supervision

This project operates with a multi-agent AI team. Agent definitions live in `.github/agents/`. The Product Owner (John) retains decision authority on business rules and scope; AI agents execute build tasks under named roles (Lisa = Lead Build Supervisor, Homer = Builder, Frink = Repo Auditor, Matt = Visual QA).

## Key Rules for Contributors

1. Never commit `.env` files.
2. Never commit `backend/functions/lib/` or `frontend/dist/`.
3. Always use `scripts/deploy-dev.sh` for deploys.
4. If you need to deploy something the script doesn't cover, update the script — don't work around it.
5. For any non-trivial change, open a PR; don't commit directly to `main`.

---

## Key Rules for Contributors

1. **Collection names are `snake_case` only** — `site_registry`, not `siteRegistry`
2. **Backend is Cloud Run, not Firebase Functions** — no exceptions
3. **Only one database: Firestore** — no PostgreSQL, no Redis, no SQLite
4. **Secrets never touch the repo** — GitHub Secrets and Secret Manager only
5. **Every hardcoded threshold is a bug** — configurable values belong in `admin_settings`
6. **When in doubt, stop and ask** — do not invent behavior

See `SPEC.md` for the complete builder reference.
