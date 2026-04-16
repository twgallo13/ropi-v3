# ROPI AOSS V3
**Retail Operations Product Intelligence — AI-Optimized Sourcing System**
**Shiekh Shoes | Build Phase**

---

## What This Is

ROPI AOSS V3 is an internal operational platform for Shiekh Shoes that manages
the full lifecycle of product data across three ecommerce channels:
Shiekh.com, Karmaloop.com, and MLTD.com.

The system handles product import and enrichment, AI-assisted content generation,
pricing cadence and markdown management, MAP enforcement, launch calendar
coordination, and daily web export — all governed by a role-based access model
for a named team of buyers, product ops specialists, and operations staff.

---

## Architecture

| Layer | Technology |
|---|---|
| Frontend | React + Vite (PWA), Firebase Hosting |
| Backend | Express (Node.js), Google Cloud Run |
| Database | Firebase Firestore (only — no SQL) |
| Auth | Firebase Auth (Email/Password) |
| Storage | Firebase Storage |
| AI | Anthropic API (`claude-sonnet-4-20250514`) |
| Email | SendGrid |
| Secrets | Google Cloud Secret Manager |

---

## Environments

| Environment | Firebase Project ID | Purpose |
|---|---|---|
| Development | `ropi-aoss-dev` | Feature work — seeded test data only |
| Staging | `ropi-aoss-staging-v3` | Pre-production UAT — synthetic data |
| Production | `ropi-aoss-prod` | Live system — real operational data |

**Environments are strictly isolated. Data never crosses between them.**

---

## Repo Structure

```
ropi-v3/
  backend/             Express app — deploys to Cloud Run
  frontend/            React + Vite — deploys to Firebase Hosting
  firebase/            Firestore rules, indexes, project config
  scripts/
    seed/              Idempotent seed scripts for dev/staging/prod
    migrations/        Schema evolution scripts (additive only)
  SPEC.md              Builder reference — Homer reads this before every task
  README.md            This file
```

---

## Local Development Setup

### Prerequisites

- Node.js 18+
- Firebase CLI (`npm install -g firebase-tools`)
- Google Cloud SDK (`gcloud`)
- Access to `ropi-aoss-dev` Firebase project
- Service account key injected as `GCP_SA_KEY_DEV` in Codespace Secrets

### Backend

```bash
cd backend
npm install
npm run dev
```

Health check: `GET http://localhost:3000/api/v1/health`

Expected response:
```json
{
  "status": "ok",
  "environment": "development",
  "project": "ropi-aoss-dev",
  "timestamp": "..."
}
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## Environment Variables

Never commit secrets. All secrets are managed via Google Cloud Secret Manager
and injected at deploy time. For local development, use Codespace Secrets.

```
NODE_ENV                  development | staging | production
FIREBASE_PROJECT_ID       Must match the project for the current NODE_ENV
FIREBASE_AUTH_DOMAIN
FIREBASE_STORAGE_BUCKET
ANTHROPIC_API_KEY
SENDGRID_API_KEY
CLOUD_RUN_SERVICE_URL
```

The app validates environment on startup and **refuses to start** if
`FIREBASE_PROJECT_ID` doesn't match the expected value for `NODE_ENV`.

---

## Seed Data

Seeds populate `ropi-aoss-dev` with the canonical starting data.
All scripts are idempotent — safe to re-run.

```bash
cd scripts/seed

# Run all seeds against dev
export NODE_ENV=development
export FIREBASE_PROJECT_ID=ropi-aoss-dev

node run-all-seeds.js
```

**Expected counts after a clean seed:**

| Collection | Documents |
|---|---|
| `attribute_registry` | 66 |
| `site_registry` | 7 |
| `smart_rules` | 3 |
| `admin_settings` | 21 |

**Never run seed scripts against staging or production
without explicit authorization from Lisa (Build Supervisor).**

---

## Deployment

### Development

```bash
firebase use development

# Deploy rules and indexes first
firebase deploy --only firestore:rules,firestore:indexes

# Deploy backend to Cloud Run
gcloud run deploy ropi-backend \
  --source ./backend \
  --project ropi-aoss-dev \
  --region us-central1

# Deploy frontend
firebase deploy --only hosting
```

### Always deploy in this order:
1. Firestore rules
2. Firestore indexes (wait for READY)
3. Seed scripts
4. Backend (Cloud Run)
5. Frontend (Firebase Hosting)
6. Verify health check

---

## Build Supervision

This project is built under active supervision.

- **Build Supervisor:** Lisa (AI Lead Architect)
- **Builder:** Homer (AI, GitHub Codespaces)
- **Product Owner:** John (Shiekh Shoes)

Homer reads `SPEC.md` before every task.
When `SPEC.md` doesn't answer a question, Homer stops and asks Lisa.
Lisa audits all output before it is cleared for the next step.

**The blueprint has 101 locked architectural decisions.
Nothing in this repo should contradict them.**

Full blueprint: ROPI AOSS V3 Master Blueprint (Notion — internal)
Change log and decision tally: V3 Review Session — Change Tally Log (Notion — internal)

---

## Phase 1 Build Status

| Step | Description | Status |
|---|---|---|
| 1.1 | Firestore Foundation | ✅ Complete |
| 1.2 | Seed Data | 🔄 In Progress |
| 1.3 | Full Product Import | ⏳ Pending |
| 1.4 | Product List + Completion Queue | ⏳ Pending |
| 1.5 | Pricing Resolution | ⏳ Pending |
| 1.6 | Basic Buyer Markdown Grid | ⏳ Pending |
| 1.7 | Daily Export | ⏳ Pending |

---

## Key Rules for Contributors

1. **Collection names are `snake_case` only** — `site_registry`, not `siteRegistry`
2. **Backend is Cloud Run, not Firebase Functions** — no exceptions
3. **Only one database: Firestore** — no PostgreSQL, no Redis, no SQLite
4. **Secrets never touch the repo** — GitHub Secrets and Secret Manager only
5. **Every hardcoded threshold is a bug** — configurable values belong in `admin_settings`
6. **When in doubt, stop and ask** — do not invent behavior

See `SPEC.md` for the complete builder reference.
