#!/usr/bin/env bash
# Build the website for one environment, check the exact artifact, and only then publish it (audit SF09).
#
#   DEPLOY_ENV=production deploy/deploy-frontend.sh     # paperaid.web.app      (Firebase project paperaid)
#   DEPLOY_ENV=staging    deploy/deploy-frontend.sh     # paperaid-staging.web.app (via deploy-staging-frontend.sh)
#
# deploy/frontend_preflight.py refuses to publish when the bundle, its build stamp or the Hosting
# Content-Security-Policy belong to another environment, or (production) when the working tree is not committed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="${PYTHON:-python}"
case "${DEPLOY_ENV:-}" in
  production) ;;
  staging) exec "$ROOT/deploy/deploy-staging-frontend.sh" ;;
  *) echo "Set DEPLOY_ENV=production or DEPLOY_ENV=staging." >&2; exit 2 ;;
esac

cd "$ROOT/frontend"
npx vite build --mode production --outDir dist --emptyOutDir
cd "$ROOT"
"$PYTHON" deploy/frontend_preflight.py production
firebase deploy --only hosting --project paperaid --config firebase.json
