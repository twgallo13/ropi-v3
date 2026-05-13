#!/usr/bin/env bash
# deploy-dev.sh — Deploy all services to ropi-aoss-dev
#
# What this script does (in order):
#   1. Preflight checks (.env files present, CLI tools installed)
#   2. Build backend TypeScript
#   3. Build frontend (Vite inlines VITE_* env vars at build time)
#   4. Deploy Cloud Run backend (gcloud run deploy)
#   5. Deploy Firebase (firestore rules + indexes + storage + hosting)
#   6. Smart-deploy Firebase Functions if backend/functions or firebase.json
#      changed since the last successful dev functions deploy
#      (TALLY-INFRA-DEV-SMART-FUNCTIONS-DEPLOY).
#
# Flags:
#   --force-functions    Always deploy Firebase Functions, ignore marker.
#   --skip-functions     Never deploy Firebase Functions this run.
#                        Warns if backend/functions changed.
#   --no-functions       Alias for --skip-functions.
#   --plan-only          Print the smart-deploy decision and exit 0
#                        without running any deploy commands.
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

# ── TALLY-INFRA-DEV-SMART-FUNCTIONS-DEPLOY: smart functions deploy ──
# Marker is local-only (gitignored). Each developer/CI host tracks its own
# last-successful dev functions deploy SHA. Committing this would push
# environment-specific mutable state into source control.
FUNCTIONS_MARKER_DIR="$REPO_ROOT/.deploy-state"
FUNCTIONS_MARKER_FILE="$FUNCTIONS_MARKER_DIR/dev-functions-last-deployed-sha"
FUNCTIONS_PATHS=("backend/functions" "firebase.json")

FORCE_FUNCTIONS=0
SKIP_FUNCTIONS=0
PLAN_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --force-functions) FORCE_FUNCTIONS=1 ;;
    --skip-functions|--no-functions) SKIP_FUNCTIONS=1 ;;
    --plan-only) PLAN_ONLY=1 ;;
    -h|--help)
      sed -n '2,25p' "$0"
      exit 0
      ;;
    *)
      echo "✗ Unknown flag: $arg"
      echo "  Supported: --force-functions, --skip-functions (alias --no-functions), --plan-only"
      exit 1
      ;;
  esac
done

if [[ "$FORCE_FUNCTIONS" == "1" && "$SKIP_FUNCTIONS" == "1" ]]; then
  echo "✗ --force-functions and --skip-functions are mutually exclusive."
  exit 1
fi

# ── TALLY-INFRA-DEV-SMART-FUNCTIONS-DEPLOY — plan-only short-circuit ──
# Must run BEFORE preflight, builds, Cloud Run deploy, and Firebase deploy so
# that --plan-only can never trigger any side effect. Only operations allowed
# here are pure git reads against the local repo.
if [[ "$PLAN_ONLY" == "1" ]]; then
  cd "$REPO_ROOT"
  if ! command -v git >/dev/null; then
    echo "✗ --plan-only requires git on PATH."
    exit 1
  fi
  HEAD_SHA="$(git rev-parse HEAD)"

  if [[ "$FORCE_FUNCTIONS" == "1" ]]; then
    DECISION="force"
  elif [[ "$SKIP_FUNCTIONS" == "1" ]]; then
    DECISION="skip"
  elif [[ ! -f "$FUNCTIONS_MARKER_FILE" ]]; then
    DECISION="first-deploy"
  else
    marker_sha="$(tr -d '[:space:]' < "$FUNCTIONS_MARKER_FILE")"
    if [[ -z "$marker_sha" ]]; then
      DECISION="first-deploy"
    elif ! git cat-file -e "${marker_sha}^{commit}" 2>/dev/null; then
      DECISION="marker-stale"
    else
      diff_out="$(git diff --name-only "$marker_sha" "$HEAD_SHA" -- "${FUNCTIONS_PATHS[@]}" || true)"
      if [[ -n "$diff_out" ]]; then
        DECISION="changed"
      else
        DECISION="unchanged"
      fi
    fi
  fi

  echo "▶ --plan-only: smart functions deploy decision = $DECISION"
  case "$DECISION" in
    force)         echo "  Would deploy: --force-functions set." ;;
    skip)          echo "  Would skip:   --skip-functions/--no-functions set." ;;
    first-deploy)  echo "  Would deploy: no functions deploy marker found." ;;
    marker-stale)  echo "  Would deploy: marker SHA not reachable in current git history." ;;
    changed)
      echo "  Would deploy: backend/functions or firebase.json changed since last functions deploy."
      echo "  Changed paths:"
      printf '%s\n' "$diff_out" | sed 's/^/    /'
      ;;
    unchanged)     echo "  Would skip:   no functions changes since last functions deploy." ;;
  esac
  echo "  HEAD: $HEAD_SHA"
  if [[ -f "$FUNCTIONS_MARKER_FILE" ]]; then
    echo "  Marker: $(tr -d '[:space:]' < "$FUNCTIONS_MARKER_FILE") ($FUNCTIONS_MARKER_FILE)"
  else
    echo "  Marker: <missing>"
  fi
  echo "✅ Plan-only complete. No preflight, build, or deploy commands executed."
  exit 0
fi

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

# ── TALLY-INFRA-DEV-SMART-FUNCTIONS-DEPLOY: compute + execute decision ──
cd "$REPO_ROOT"
HEAD_SHA="$(git rev-parse HEAD)"

if [[ "$FORCE_FUNCTIONS" == "1" ]]; then
  DECISION="force"
elif [[ "$SKIP_FUNCTIONS" == "1" ]]; then
  DECISION="skip"
elif [[ ! -f "$FUNCTIONS_MARKER_FILE" ]]; then
  DECISION="first-deploy"
else
  marker_sha="$(tr -d '[:space:]' < "$FUNCTIONS_MARKER_FILE")"
  if [[ -z "$marker_sha" ]]; then
    DECISION="first-deploy"
  elif ! git cat-file -e "${marker_sha}^{commit}" 2>/dev/null; then
    DECISION="marker-stale"
  else
    diff_out="$(git diff --name-only "$marker_sha" "$HEAD_SHA" -- "${FUNCTIONS_PATHS[@]}" || true)"
    if [[ -n "$diff_out" ]]; then
      DECISION="changed"
    else
      DECISION="unchanged"
    fi
  fi
fi

should_deploy_functions=0
case "$DECISION" in
  force)
    echo "▶ --force-functions set; deploying Firebase Functions to $PROJECT..."
    should_deploy_functions=1
    ;;
  skip)
    if [[ -f "$FUNCTIONS_MARKER_FILE" ]]; then
      marker_sha="$(tr -d '[:space:]' < "$FUNCTIONS_MARKER_FILE")"
      if git cat-file -e "${marker_sha}^{commit}" 2>/dev/null; then
        diff_out="$(git diff --name-only "$marker_sha" "$HEAD_SHA" -- "${FUNCTIONS_PATHS[@]}" || true)"
        if [[ -n "$diff_out" ]]; then
          echo "⚠ --skip-functions set, but backend/functions or firebase.json changed since marker $marker_sha:"
          echo "$diff_out" | sed 's/^/    /'
          echo "  Functions will NOT be deployed this run. Marker NOT updated."
        else
          echo "▶ --skip-functions set; no functions changes detected (marker in sync). Skipping."
        fi
      else
        echo "⚠ --skip-functions set; marker SHA $marker_sha not reachable. Skipping deploy. Marker NOT updated."
      fi
    else
      echo "⚠ --skip-functions set; no marker found. Skipping deploy. Marker NOT created."
    fi
    ;;
  first-deploy)
    echo "▶ No functions deploy marker found; deploying functions once to $PROJECT..."
    should_deploy_functions=1
    ;;
  marker-stale)
    echo "▶ Functions deploy marker SHA not reachable in current git history; deploying functions to $PROJECT..."
    should_deploy_functions=1
    ;;
  changed)
    echo "▶ Functions changed since last deploy; deploying functions to $PROJECT..."
    should_deploy_functions=1
    ;;
  unchanged)
    echo "▶ No functions changes detected; skipping functions deploy."
    ;;
esac

if [[ "$should_deploy_functions" == "1" ]]; then
  firebase deploy --only functions --project "$PROJECT"
  mkdir -p "$FUNCTIONS_MARKER_DIR"
  printf '%s\n' "$HEAD_SHA" > "$FUNCTIONS_MARKER_FILE"
  echo "✓ Functions deploy succeeded; marker updated → $FUNCTIONS_MARKER_FILE ($HEAD_SHA)"
  echo ""
fi

echo "✅ DEV deployment complete."
echo "   Cloud Run: https://$SERVICE-719351392467.$REGION.run.app"
echo "   Hosting:   https://$PROJECT.web.app"