#!/usr/bin/env bash
# Release the API safely: build -> migrate (expand-only) -> deploy WITHOUT traffic -> readiness gate on that exact
# revision -> promote that exact revision. Any failure stops the release; production traffic is never moved to an
# unverified revision.
#
#   deploy/release.sh                    # release to production (service paperaid-api)
#   SERVICE=paperaid-api-staging MIGRATE_JOB=paperaid-migrate-staging deploy/release.sh   # staging
set -euo pipefail

PROJECT="${PROJECT:-paperaid}"
REGION="${REGION:-europe-west4}"
SERVICE="${SERVICE:-paperaid-api}"
MIGRATE_JOB="${MIGRATE_JOB:-paperaid-migrate}"
REPO="${REPO:-europe-west4-docker.pkg.dev/paperaid/cloud-run-source-deploy}"
PYTHON="${PYTHON:-python}"  # needs alembic installed (e.g. PYTHON=backend/.venv/Scripts/python)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
IMAGE="$REPO/paperaid-api:$SHA"
TAG="rc-$SHA"

if [[ -n "$(git -C "$ROOT" status --porcelain -- backend)" ]]; then
  echo "Refusing to release: backend/ has uncommitted changes." >&2
  exit 1
fi

EXPECTED_SCHEMA="$(cd "$ROOT/backend" && "$PYTHON" - <<'PY'
from alembic.config import Config
from alembic.script import ScriptDirectory
config = Config()
config.set_main_option("script_location", "alembic")
print(ScriptDirectory.from_config(config).get_current_head())
PY
)"
echo "Releasing $IMAGE to $SERVICE (expected schema $EXPECTED_SCHEMA)"

echo "1/5 build"
gcloud builds submit --project "$PROJECT" --region "$REGION" --tag "$IMAGE" "$ROOT/backend"

echo "2/5 migrate (expand-only; the running revision keeps working)"
gcloud run jobs update "$MIGRATE_JOB" --project "$PROJECT" --region "$REGION" --image "$IMAGE" --quiet
gcloud run jobs execute "$MIGRATE_JOB" --project "$PROJECT" --region "$REGION" --wait

echo "3/5 deploy without traffic"
# EXTRA_DEPLOY_FLAGS: optional settings that ride through the same gate, e.g.
#   EXTRA_DEPLOY_FLAGS="--update-env-vars=DB_POOL_SIZE=3,DB_MAX_OVERFLOW=2"
# shellcheck disable=SC2086
gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" --image "$IMAGE" \
  --no-traffic --tag "$TAG" --quiet ${EXTRA_DEPLOY_FLAGS:-}
REVISION="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --format='value(status.latestCreatedRevisionName)')"
URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --format=json | "$PYTHON" -c "import json,sys; d=json.load(sys.stdin); print(next(t['url'] for t in d['status']['traffic'] if t.get('tag')=='$TAG'))")"

echo "4/5 readiness gate on $REVISION ($URL)"
READY="$(curl -fsS --retry 5 --retry-delay 3 --retry-all-errors "$URL/api/v1/ready")"
"$PYTHON" - "$READY" "$EXPECTED_SCHEMA" <<'PY'
import json, sys
body, expected = json.loads(sys.argv[1]), sys.argv[2]
if body.get("status") != "ready" or body.get("schema") != expected:
    sys.exit(f"Readiness gate failed: {body} (expected schema {expected})")
print("ready, schema", body["schema"])
PY
curl -fsS "$URL/api/v1/health" >/dev/null

echo "5/5 promote exactly $REVISION"
gcloud run services update-traffic "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --to-revisions "$REVISION=100" --quiet
gcloud run services update-traffic "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --remove-tags "$TAG" --quiet || true
echo "Released $REVISION ($IMAGE)."
