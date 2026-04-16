#!/usr/bin/env bash
# deploy-staging.sh — Deploy all services to ropi-aoss-staging-v3
set -euo pipefail

PROJECT="ropi-aoss-staging-v3"
echo "▶ Deploying to $PROJECT (staging)..."

firebase use "$PROJECT"
firebase deploy --only firestore:rules,firestore:indexes,storage,functions,hosting

echo "✅ STAGING deployment complete."
