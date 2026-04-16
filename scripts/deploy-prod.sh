#!/usr/bin/env bash
# deploy-prod.sh — Deploy all services to ropi-aoss-prod
# CAUTION: This deploys to production. Confirm before running.
set -euo pipefail

PROJECT="ropi-aoss-prod"

read -r -p "⚠️  You are about to deploy to PRODUCTION ($PROJECT). Type 'yes' to continue: " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
  echo "Aborted."
  exit 1
fi

echo "▶ Deploying to $PROJECT (production)..."

firebase use "$PROJECT"
firebase deploy --only firestore:rules,firestore:indexes,storage,functions,hosting

echo "✅ PRODUCTION deployment complete."
