# ropi-v3

> **ropi-aoss** — monorepo v3  
> Three environments: `dev` · `staging` · `prod` (all Blaze plan)

---

## Repository structure

```
ropi-v3/
├── backend/
│   └── functions/          # Firebase Cloud Functions (TypeScript / Node 20)
│       ├── src/index.ts
│       ├── package.json
│       └── tsconfig.json
├── frontend/               # Next.js 14 + React 18 client
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── lib/firebase.ts
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
├── firebase/               # Firebase project configuration
│   ├── firestore.rules
│   ├── firestore.indexes.json
│   └── storage.rules
├── scripts/                # CI / deployment helpers
│   ├── deploy-dev.sh
│   ├── deploy-staging.sh
│   ├── deploy-prod.sh
│   └── emulator-start.sh
├── firebase.json           # Hosting, Functions, Firestore, Storage, Emulators config
├── .firebaserc             # Project aliases (dev / staging / prod)
├── SCHEMA.md               # Firestore data model documentation
└── README.md               # This file
```

---

## Firebase projects

| Alias     | Project ID                  | Purpose            |
|-----------|-----------------------------|--------------------|
| `dev`     | `ropi-aoss-dev`             | Local dev / CI     |
| `staging` | `ropi-aoss-staging-v3`     | QA / pre-release   |
| `prod`    | `ropi-aoss-prod`            | Live production    |

Switch active project:

```bash
firebase use dev        # or staging / prod
```

---

## Prerequisites

| Tool           | Version  | Install                              |
|----------------|----------|--------------------------------------|
| Node.js        | 20 LTS   | `nvm install 20`                     |
| Firebase CLI   | latest   | `npm install -g firebase-tools`      |
| Google Cloud   | optional | for service-account key management   |

---

## Local development

```bash
# 1. Install dependencies
cd backend/functions && npm install && cd ../..
cd frontend && npm install && cd ..

# 2. Copy and fill in env vars
cp frontend/.env.example frontend/.env.local
# edit frontend/.env.local with your Firebase web config

# 3. Start emulators (Firestore, Auth, Functions, Hosting, Storage)
./scripts/emulator-start.sh
```

Emulator UI: http://localhost:4000

---

## Deployment

```bash
./scripts/deploy-dev.sh       # → ropi-aoss-dev
./scripts/deploy-staging.sh   # → ropi-aoss-staging-v3
./scripts/deploy-prod.sh      # → ropi-aoss-prod  (requires confirmation)
```

---

## Security notes

- **Never commit** `.env`, `.env.local`, or `service-account*.json` files — all are git-ignored.
- Firestore rules default to **deny-all** for undeclared collections.
- Storage rules default to **deny-all** until per-path rules are added.
- Deploy credentials are managed via GitHub Actions secrets or Workload Identity Federation (see Step 2 brief).

---

## Data model

See [SCHEMA.md](SCHEMA.md) for the full Firestore collection schema.
