#!/usr/bin/env bash
# Release the API safely: lock -> build -> pin the image digest -> migrate (expand-only) -> deploy WITHOUT traffic
# under a unique candidate tag -> readiness gate on that exact revision (it must report its own name) -> promote
# that exact revision. Any failure stops the release; production traffic is never moved to an unverified revision.
#
#   deploy/release.sh                    # release to production (service paperaid-api)
#   SERVICE=paperaid-api-staging MIGRATE_JOB=paperaid-migrate-staging deploy/release.sh   # staging
#
# Releases to the same service are serialized by a lock object in Cloud Storage (created only if absent). If a
# release was killed and left its lock, check nobody is releasing, then remove it:
#   gcloud storage rm gs://$LOCK_BUCKET/release-locks/$SERVICE.lock
set -euo pipefail

PROJECT="${PROJECT:-paperaid}"
REGION="${REGION:-europe-west4}"
SERVICE="${SERVICE:-paperaid-api}"
MIGRATE_JOB="${MIGRATE_JOB:-paperaid-migrate}"
REPO="${REPO:-europe-west4-docker.pkg.dev/paperaid/cloud-run-source-deploy}"
LOCK_BUCKET="${LOCK_BUCKET:-${PROJECT}_cloudbuild}"
GCLOUD="${GCLOUD:-gcloud}"   # overridable for the fake-cloud tests
CURL="${CURL:-curl}"
GIT="${GIT:-git}"
PYTHON="${PYTHON:-python}"  # needs alembic installed (e.g. PYTHON=backend/.venv/Scripts/python)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHA="$("$GIT" -C "$ROOT" rev-parse --short HEAD)"
STAMP="$(date -u +%Y%m%d%H%M%S)"
IMAGE="$REPO/paperaid-api:$SHA-$STAMP"
TAG="rc-$SHA-$STAMP-$((RANDOM % 1000))"   # unique per release, even for the same commit
LOCK="gs://$LOCK_BUCKET/release-locks/$SERVICE.lock"

if [[ -n "$("$GIT" -C "$ROOT" status --porcelain -- backend)" ]]; then
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
EXPECTED_SCHEMA="$(printf '%s' "$EXPECTED_SCHEMA" | tr -d '\r')"   # Windows Python ends lines with CR

echo "0/6 lock $SERVICE"
LOCKFILE="$(mktemp)"
echo "$TAG $(date -u +%FT%TZ)" > "$LOCKFILE"
if ! "$GCLOUD" storage cp --if-generation-match=0 "$LOCKFILE" "$LOCK" --project "$PROJECT" --quiet 2>/dev/null; then
  echo "Refusing to release: another release of $SERVICE holds $LOCK." >&2
  exit 1
fi
release_lock() { "$GCLOUD" storage rm "$LOCK" --project "$PROJECT" --quiet >/dev/null 2>&1 || true; rm -f "$LOCKFILE"; }
trap release_lock EXIT
echo "Releasing $SHA to $SERVICE as $TAG (expected schema $EXPECTED_SCHEMA)"

echo "1/6 build"
"$GCLOUD" builds submit --project "$PROJECT" --region "$REGION" --tag "$IMAGE" "$ROOT/backend"

echo "2/6 pin the image digest (tags can move; digests cannot)"
DIGEST="$("$GCLOUD" artifacts docker images describe "$IMAGE" --project "$PROJECT" --format='value(image_summary.digest)')"
[[ "$DIGEST" == sha256:* ]] || { echo "Could not resolve the digest of $IMAGE" >&2; exit 1; }
IMAGE_REF="$REPO/paperaid-api@$DIGEST"

echo "3/6 migrate (expand-only; the running revision keeps working)"
"$GCLOUD" run jobs update "$MIGRATE_JOB" --project "$PROJECT" --region "$REGION" --image "$IMAGE_REF" --quiet
"$GCLOUD" run jobs execute "$MIGRATE_JOB" --project "$PROJECT" --region "$REGION" --wait

echo "4/6 deploy without traffic"
# EXTRA_DEPLOY_FLAGS: optional settings that ride through the same gate, e.g.
#   EXTRA_DEPLOY_FLAGS="--update-env-vars=DB_POOL_SIZE=3,DB_MAX_OVERFLOW=2"
# shellcheck disable=SC2086
"$GCLOUD" run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" --image "$IMAGE_REF" \
  --no-traffic --tag "$TAG" --quiet ${EXTRA_DEPLOY_FLAGS:-}
# The revision and its URL come from the SAME traffic entry: the one carrying this release's unique tag.
read -r REVISION URL < <("$GCLOUD" run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --format=json | "$PYTHON" -c "
import json, sys
entries = [t for t in json.load(sys.stdin)['status'].get('traffic', []) if t.get('tag') == sys.argv[1]]
if len(entries) != 1 or not entries[0].get('revisionName') or not entries[0].get('url'):
    sys.exit('No unique traffic entry for tag ' + sys.argv[1])
print(entries[0]['revisionName'], entries[0]['url'])
" "$TAG" | tr -d '\r')

echo "5/6 readiness gate on $REVISION ($URL)"
READY="$("$CURL" -fsS --retry 5 --retry-delay 3 --retry-all-errors "$URL/api/v1/ready")"
"$PYTHON" - "$READY" "$EXPECTED_SCHEMA" "$REVISION" <<'PY'
import json, sys
body, expected, revision = json.loads(sys.argv[1]), sys.argv[2], sys.argv[3]
if body.get("status") != "ready" or body.get("schema") != expected:
    sys.exit(f"Readiness gate failed: {body} (expected schema {expected})")
if body.get("revision") != revision:
    sys.exit(f"Readiness gate failed: the probed instance is {body.get('revision')!r}, not {revision!r}")
print("ready, schema", body["schema"], "revision", body["revision"])
PY
"$CURL" -fsS "$URL/api/v1/health" >/dev/null

echo "6/6 promote exactly $REVISION"
"$GCLOUD" run services update-traffic "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --to-revisions "$REVISION=100" --quiet
"$GCLOUD" run services update-traffic "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --remove-tags "$TAG" --quiet || true
echo "Released $REVISION ($IMAGE_REF)."
