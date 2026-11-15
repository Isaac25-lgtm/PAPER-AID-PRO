#!/usr/bin/env bash
# Release the API safely: lock -> build -> pin the image digest -> migrate (expand-only) -> deploy WITHOUT traffic
# under a unique candidate tag -> readiness gate on that exact revision (it must report its own name) -> promote
# that exact revision. Any failure stops the release; production traffic is never moved to an unverified revision.
#
#   DEPLOY_ENV=production deploy/release.sh
#   DEPLOY_ENV=staging    deploy/release.sh
#
# The environment is ONE required choice (profiles in deploy/release_checks.py). The service, migration job,
# database secret, runtime identity, bucket, Firebase project and the complete Cloud Tasks routing come from it.
# The live service and migration job are checked against that profile before anything is changed, and the exact
# candidate revision (its bindings and image digest) is checked again before any traffic moves. SERVICE and
# MIGRATE_JOB cannot be set separately, and EXTRA_DEPLOY_FLAGS may only tune allowlisted settings.
#
# Releases to the same environment are serialized by a lock object in Cloud Storage (created only if absent). If a
# release was killed and left its lock, check nobody is releasing, then remove it:
#   gcloud storage rm gs://$LOCK_BUCKET/release-locks/$SERVICE.lock
set -euo pipefail

if [[ -n "${SERVICE:-}" || -n "${MIGRATE_JOB:-}" ]]; then
  echo "Refusing to release: SERVICE and MIGRATE_JOB are derived from DEPLOY_ENV; unset them." >&2
  exit 1
fi
PYTHON="${PYTHON:-python}"  # needs alembic installed (e.g. PYTHON=backend/.venv/Scripts/python)
CHECKS="$(cd "$(dirname "$0")" && pwd)/release_checks.py"   # the environment profiles and every check
PROFILE_VARS="$("$PYTHON" "$CHECKS" shell "${DEPLOY_ENV:-}" | tr -d '\r')"
eval "$PROFILE_VARS"   # SERVICE and MIGRATE_JOB
# Extra settings may only tune the service; nothing that says which environment a revision belongs to.
EXTRA_DEPLOY_FLAGS="${EXTRA_DEPLOY_FLAGS:-}" "$PYTHON" "$CHECKS" flags "$DEPLOY_ENV"

PROJECT="${PROJECT:-paperaid}"
REGION="${REGION:-europe-west4}"
REPO="${REPO:-europe-west4-docker.pkg.dev/paperaid/cloud-run-source-deploy}"
LOCK_BUCKET="${LOCK_BUCKET:-${PROJECT}_cloudbuild}"
GCLOUD="${GCLOUD:-gcloud}"   # overridable for the fake-cloud tests
CURL="${CURL:-curl}"
GIT="${GIT:-git}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHA="$("$GIT" -C "$ROOT" rev-parse --short HEAD)"
STAMP="$(date -u +%Y%m%d%H%M%S)"
IMAGE="$REPO/paperaid-api:$SHA-$STAMP"
# Unique per release, even for the same commit (one release per service at a time, by the lock). Cloud Run limits
# the tag plus the service name to 46 characters, so the tag is kept short: commit + Unix time in seconds.
TAG="rc-$SHA-$(date -u +%s)"
if (( ${#TAG} + ${#SERVICE} > 46 )); then
  echo "Refusing to release: tag '$TAG' and service '$SERVICE' exceed Cloud Run's 46-character limit." >&2
  exit 1
fi
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

echo "check: $SERVICE and $MIGRATE_JOB belong to $DEPLOY_ENV (read-only)"
SERVICE_JSON="$("$GCLOUD" run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format=json)"
JOB_JSON="$("$GCLOUD" run jobs describe "$MIGRATE_JOB" --project "$PROJECT" --region "$REGION" --format=json)"
export SERVICE_JSON JOB_JSON
"$PYTHON" "$CHECKS" live "$DEPLOY_ENV"

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
# EXTRA_DEPLOY_FLAGS: optional tuning that rides through the same gate (allowlisted in release_checks.py), e.g.
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

# The exact revision that would receive traffic must itself carry this environment's bindings and this build: the
# deploy step can change settings, so the check made before it says nothing about the candidate.
REVISION_JSON="$("$GCLOUD" run revisions describe "$REVISION" --project "$PROJECT" --region "$REGION" --format=json)"
export REVISION_JSON
"$PYTHON" "$CHECKS" candidate "$DEPLOY_ENV" "$IMAGE_REF"

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
