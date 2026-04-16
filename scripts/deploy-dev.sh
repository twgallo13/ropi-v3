#!/usr/bin/env bash
# deploy-dev.sh — Deploy all services to ropi-aoss-dev
set -euo pipefail

PROJECT="ropi-aoss-dev"
echo "▶ Deploying to $PROJECT (dev)..."

firebase use "$PROJECT"
firebase deploy --only firestore:rules,firestore:indexes,storage,functions,hosting

echo "✅ DEV deployment complete."
