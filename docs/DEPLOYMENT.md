# Deployment & operations

Google Cloud / Firebase project: **`paperaid`** (owned by the main Google account), region **europe-west4**.

| Resource | Name |
|---|---|
| Frontend | Firebase Hosting site `paperaid` → https://paperaid.web.app |
| API | Cloud Run service `paperaid-api` (europe-west4), runs as `paperaid-api@paperaid.iam.gserviceaccount.com` |
| Migrations | Cloud Run job `paperaid-migrate` (same image, runs `alembic upgrade head`) |
| Database | Cloud SQL `paperaid-db` (PostgreSQL 16, db-f1-micro, daily backups ×7, deletion protection), DB `paperaid`, user `paperaid_app` |
| Files | Bucket `gs://paperaid-papers-307658066472` (private, uniform access, public-access prevention) |
| Jobs | Cloud Tasks queue `paper-processing` (europe-west1; 3 attempts, 30s–10min backoff), OIDC as `paperaid-tasks@…` |
| Secrets | Secret Manager `paperaid-database-url` (+ AI keys when added) |
| Budget | “PaperAid Pro - Silver monthly” alert on the billing account |

## Deploy the API (release order: build → migrate → deploy without traffic → verify → switch)

Migrations are expand-only (additive), so they run **before** the new code receives traffic and the running
revision keeps working while they apply. `/api/v1/ready` returns 503 `SCHEMA_NOT_READY` unless the database is
at exactly the Alembic revision the new code expects, so it is the release gate.

```bash
cd backend
IMAGE=europe-west4-docker.pkg.dev/paperaid/cloud-run-source-deploy/paperaid-api:$(git rev-parse --short HEAD)
gcloud builds submit --project paperaid --region europe-west4 --tag "$IMAGE" .

# 1. Expand the schema with the NEW image.
gcloud run jobs update paperaid-migrate --region europe-west4 --image "$IMAGE"
gcloud run jobs execute paperaid-migrate --region europe-west4 --wait

# 2. Deploy the new revision WITHOUT traffic, under a test tag.
gcloud run deploy paperaid-api --project paperaid --region europe-west4 --image "$IMAGE"   --service-account paperaid-api@paperaid.iam.gserviceaccount.com   --add-cloudsql-instances paperaid:europe-west4:paperaid-db   --set-secrets DATABASE_URL=paperaid-database-url:latest   --env-vars-file run-env.yaml --no-traffic --tag candidate   # current values: gcloud run services describe paperaid-api

# 3. Release gate: must print {"status":"ready","schema":"<head revision>"}.
curl -fsS "$(gcloud run services describe paperaid-api --region europe-west4   --format='value(status.traffic[?tag=candidate].url)' | head -n1)/api/v1/ready"

# 4. Switch traffic (roll back with update-traffic to the previous revision).
gcloud run services update-traffic paperaid-api --region europe-west4 --to-latest
```

Contracting changes (dropping a column) ship in a later release, after no running revision uses it.

## Deploy the frontend

```bash
cd frontend && npm ci && npm run build && cd .. && firebase deploy --only hosting --project paperaid
```

## Turning on AI (when keys are available)

```bash
printf '%s' "sk-ant-..." | gcloud secrets create anthropic-api-key --data-file=- --project paperaid
gcloud run services update paperaid-api --region europe-west4 \
  --update-secrets ANTHROPIC_API_KEY=anthropic-api-key:latest \
  --update-env-vars AI_PROVIDER=anthropic            # default model: claude-opus-5-5; override with AI_MODEL
# Optional semantic search (embeddings, 1536-dim):
#   --update-secrets OPENAI_API_KEY=openai-api-key:latest --update-env-vars EMBEDDING_PROVIDER=openai
```

OpenAI / Gemini work the same way (`AI_PROVIDER=openai|gemini`, and `AI_MODEL` is required for them).
Existing full-text papers are embedded the next time they are processed (“Retry” on the admin Jobs list).

## Routine operations

- **Logs:** Cloud Logging → resource `cloud_run_revision` / service `paperaid-api` (JSON logs with `request_id`).
- **Make someone admin:** Admin page → Users → role, or add their email to `ADMIN_EMAILS`.
- **Failed full-text jobs:** Admin page → Processing jobs → Retry. Jobs whose worker died or whose task was lost
  are marked failed automatically when their lease expires (16 min running / 30 min queued), so Retry is offered.
- **Maintenance:** runs ~30 s after each instance starts (pending storage deletions, expired rate-limit buckets,
  abandoned jobs). Run it on demand with `POST /api/v1/admin/maintenance` (admin).
- **Close an account:** `python scripts/delete_user.py someone@example.com --yes` (as a Cloud Run job with the
  API image). Deletes the Firebase sign-in identity first (ending all sessions), then the data; stored PDFs are
  recorded in `storage_deletions` in the same transaction, so a storage failure is retried, never orphaned.
- **Re-link an account to a new Firebase identity:** the API refuses (409 `ACCOUNT_CONFLICT`) when a different
  Firebase UID presents an email that already has an account. After verifying the person:
  `python scripts/relink_user.py someone@example.com <new-uid> --yes` (requires that UID's email to be verified).
- **Client addresses for rate limits:** in production only the last `X-Forwarded-For` hop (added by Google's
  front end) is trusted (`TRUST_FORWARDED_FOR`, automatic in production).
- **Backups:** automatic daily; restore with `gcloud sql backups restore`.
- **Scale up the DB:** `gcloud sql instances patch paperaid-db --tier db-g1-small` (brief restart).
- **Rollback API:** `gcloud run services update-traffic paperaid-api --to-revisions REVISION=100 --region europe-west4`.
- **Rollback frontend:** Firebase console → Hosting → release history → Rollback.

## Data from the original (legacy-v1) app

v2 starts from a fresh schema; nothing is migrated from the original Supabase database (different IDs, different
auth system). Decide whether anything in the original Supabase project (accounts, documents, uploads) must carry
over before retiring it. If so, write a separate, tested one-off migration: map each legacy user to a Firebase UID, re-resolve papers by
DOI/PMID through the registries (never copy legacy metadata into the shared catalog), re-upload private PDFs
through the API, and verify ownership and storage objects before switching.
