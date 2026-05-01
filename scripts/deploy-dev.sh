#!/usr/bin/env bash
# deploy-dev.sh — Deploy all services to ropi-aoss-dev
#
# What this script does (in order):
#   1. Preflight checks (.env files present, CLI tools installed)
#   2. Build backend TypeScript
#   3. Build frontend (Vite inlines VITE_* env vars at build time)
#   4. Deploy Cloud Run backend (gcloud run deploy)
#   5. Deploy Firebase (firestore rules + indexes + storage + hosting)
#
# Requirements (one-time setup per developer/Codespace):
#   - frontend/.env populated (see frontend/.env.example)
#   - backend/functions/.env populated (see backend/functions/.env.example)
#   - firebase CLI logged in, OR GOOGLE_APPLICATION_CREDENTIALS
#     env var set to a service account JSON with Firebase Admin
#     + Cloud Run Admin roles
#   - gcloud CLI authenticated

set -euo pipefail

PROJECT="ropi-aoss-dev"
REGION="us-central1"
SERVICE="ropi-aoss-api"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "▶ Preflight checks..."

if [ ! -f "$REPO_ROOT/frontend/.env" ]; then
  echo "✗ Missing $REPO_ROOT/frontend/.env"
  echo "  See frontend/.env.example for required VITE_* vars"
  exit 1
fi

if [ ! -f "$REPO_ROOT/backend/functions/.env" ]; then
  echo "✗ Missing $REPO_ROOT/backend/functions/.env"
  echo "  See backend/functions/.env.example for required vars"
  exit 1
fi

command -v firebase >/dev/null || \
  { echo "✗ firebase CLI not installed"; exit 1; }
command -v gcloud >/dev/null || \
  { echo "✗ gcloud CLI not installed"; exit 1; }
command -v npm >/dev/null || \
  { echo "✗ npm not installed"; exit 1; }

echo "✓ Preflight checks passed"
echo ""

echo "▶ Building backend TypeScript..."
cd "$REPO_ROOT/backend/functions"
npm ci
npm run build
echo "✓ Backend build complete"
echo ""

echo "▶ Building frontend..."
cd "$REPO_ROOT/frontend"
npm ci
npm run build
echo "✓ Frontend build complete"
echo ""

echo "▶ Deploying Cloud Run backend ($SERVICE) to $PROJECT..."
cd "$REPO_ROOT"
gcloud run deploy "$SERVICE" \
  --source ./backend/functions \
  --project "$PROJECT" \
  --region "$REGION" \
  --update-env-vars "FIREBASE_PROJECT_ID=$PROJECT,FIREBASE_STORAGE_BUCKET=${PROJECT}-imports" \
  --remove-env-vars="ANTHROPIC_API_KEY,OPENAI_API_KEY,GEMINI_API_KEY,SMTP_PASSWORD" \
  --set-secrets "ANTHROPIC_API_KEY=anthropic-api-key:latest,OPENAI_API_KEY=openai-api-key:latest,GEMINI_API_KEY=gemini-api-key:latest,SMTP_PASSWORD=smtp-password:latest" \
  --quiet
echo "✓ Cloud Run deploy complete"
echo ""

echo "▶ Deploying Firebase (firestore rules + indexes + storage + hosting)..."
firebase use "$PROJECT"
firebase deploy \
  --only firestore:rules,firestore:indexes,storage,hosting \
  --project "$PROJECT"
echo ""

echo "✅ DEV deployment complete."
echo "   Cloud Run: https://$SERVICE-719351392467.$REGION.run.app"
echo "   Hosting:   https://$PROJECT.web.app"