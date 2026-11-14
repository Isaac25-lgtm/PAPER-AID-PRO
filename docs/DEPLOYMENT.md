# Deployment & operations

Google Cloud / Firebase project: **`paperaid`** (owned by the main Google account), region **europe-west4**.
Always pass `--project paperaid` (the gcloud default project on the maintainer's machine is a different project).

| Resource | Name |
|---|---|
| Frontend | Firebase Hosting site `paperaid` → https://paperaid.web.app |
| API | Cloud Run service `paperaid-api` (europe-west4), runs as `paperaid-api@paperaid.iam.gserviceaccount.com`; max 4 instances × 40 requests, 1 CPU / 1 GiB |
| Migrations | Cloud Run job `paperaid-migrate` (same image, runs `alembic upgrade head`) |
| Database | Cloud SQL `paperaid-db` (PostgreSQL 16, db-f1-micro ≈ 25 connections, daily backups ×7, deletion protection), DB `paperaid`, user `paperaid_app`. API pools: `DB_POOL_SIZE=3`, `DB_MAX_OVERFLOW=2` (≤ 20 connections at 4 instances) |
| Files | Bucket `gs://paperaid-papers-307658066472` (private, uniform access, public-access prevention) |
| Jobs | Cloud Tasks queue `paper-processing` (europe-west1; 3 attempts, 30s–10min backoff), OIDC as `paperaid-tasks@paperaid.iam.gserviceaccount.com` |
| Secrets | Secret Manager `paperaid-database-url` (+ AI / CORE / Semantic Scholar keys when added) |
| Budget | “PaperAid Pro - Silver monthly” alert on the billing account |

Capacity today is sized for the **testing phase (30–50 concurrent users)**. The launch upgrades (database tier,
high availability, worker split, Redis) are in the recommendations report and HANDOFF.md.

## Release the API (gated)

```bash
PYTHON="$PWD/backend/.venv/Scripts/python.exe" deploy/release.sh
# optional settings that should ride through the same gate:
PYTHON=... EXTRA_DEPLOY_FLAGS="--update-env-vars=KEY=value" deploy/release.sh
```

`deploy/release.sh` (fail-fast, `set -euo pipefail`) refuses to run with uncommitted backend changes, then:

0. takes a per-service **release lock** (`gs://paperaid_cloudbuild/release-locks/<service>.lock`, created only if
   absent) so two releases can never interleave; the lock is removed when the script exits;
1. builds the image (Cloud Build) and **pins its digest** — the migration job and the revision both run
   `…/paperaid-api@sha256:…`, which cannot move;
2. runs the migration job with that image — migrations are **expand-only**, so the live revision keeps working;
3. deploys a new revision **without traffic** under a **unique** tag `rc-<sha>-<time>-<n>`, and reads the
   revision name and URL from the **same** traffic entry (the one with that tag);
4. checks `/api/v1/ready` on that URL: it must return `{"status":"ready","schema":"<head>","revision":"<that
   revision>"}` — the instance reports its own name (`K_REVISION`), so the gate proves it probed the revision it
   is about to promote; the release stops here on any failure;
5. moves 100 % of traffic to **exactly that revision** and removes the tag.

The control flow is tested against a fake `gcloud`/`curl` (`backend/tests/test_release_audit.py`), including a
second release interleaving, a probe that reaches a different revision, and a held lock. If a killed release
left its lock: make sure nobody is releasing, then `gcloud storage rm gs://paperaid_cloudbuild/release-locks/paperaid-api.lock`.

Contracting changes (dropping a column) ship in a later release, after no running revision uses it.
Rollback: `gcloud run services update-traffic paperaid-api --project paperaid --region europe-west4 --to-revisions <previous>=100`.

Before releasing, CI must be green on the commit: it runs the test suites **and** a smoke test inside the built
production image (`backend/scripts/smoke_container.py`: fonts, all citation styles, migrations, readiness).

## Deploy the frontend

```bash
cd frontend && npm ci && npm run build && cd .. && firebase deploy --only hosting --project paperaid
```

`frontend/.env.production` holds the public Firebase web config, `VITE_API_BASE_URL`, and (to add)
`VITE_PRIVACY_CONTACT_EMAIL` — the contact address shown on the Terms and Privacy pages.

## Pending infrastructure (prepared; needs the maintainer's go-ahead)

These were not created automatically because they add standing infrastructure. Run them when ready.

**Scheduled maintenance (every 15 minutes)** — finishing interrupted account closures, storage cleanup with
backoff (never deleting an object a paper points to; every PDF write has its own key), rate-limit purge,
stuck-job recovery. Until this exists, maintenance runs when an instance starts and from Admin → Maintenance.
```bash
gcloud services enable cloudscheduler.googleapis.com --project paperaid
gcloud scheduler jobs create http paperaid-maintenance --project paperaid --location europe-west1 \
  --schedule "*/15 * * * *" --time-zone Etc/UTC --http-method POST \
  --uri https://paperaid-api-307658066472.europe-west4.run.app/internal/maintenance \
  --headers Content-Type=application/json --message-body '{}' \
  --oidc-service-account-email paperaid-tasks@paperaid.iam.gserviceaccount.com \
  --oidc-token-audience https://paperaid-api-307658066472.europe-west4.run.app --attempt-deadline 300s
```

**Uptime check + alert** (email to the project owner when `/ready` fails):
```bash
gcloud monitoring uptime create paperaid-api-ready --project paperaid \
  --resource-type uptime-url --resource-labels host=paperaid-api-307658066472.europe-west4.run.app \
  --path /api/v1/ready --protocol https --period 5
# then: Cloud Console → Monitoring → Alerting → create a policy on that check with an email channel.
```
Errors logged with stack traces already appear in **Cloud Console → Error Reporting** (service `paperaid-api`).

**Staging — isolated from production.** Staging must not be able to reach production data, sign-ins or
keys. Nothing is copied from the production service; staging is defined from its own allowlist.

Recommended: a **separate Google Cloud project with its own Firebase project** (e.g. `paperaid-staging`), so
identity, database, bucket, queue and service accounts are separate by construction. Creating a project and
linking billing is the maintainer's decision; the steps are:

1. Create the project and a Firebase project on it (Authentication → email/password and Google). Add only test
   accounts to its allowlist.
2. Create its own resources: a `db-f1-micro` Cloud SQL instance (or a database on a staging-only instance), a
   database user that owns only that database, a bucket, a Cloud Tasks queue,
   and service accounts `paperaid-api` and `paperaid-migrate` **in the staging project**.
3. Store `DATABASE_URL` for that user in the staging project's Secret Manager.
4. Deploy with an explicit allowlisted configuration — nothing else is set:

   | Variable | Staging value |
   |---|---|
   | `ENV` | `production` (the same safety checks as production; isolation comes from the separate project) |
   | `FIREBASE_PROJECT_ID` | the staging Firebase project |
   | `DATABASE_URL` | secret in the staging project |
   | `STORAGE_BACKEND` / `GCS_BUCKET` | `gcs` / the staging bucket |
   | `TASKS_BACKEND`, `TASKS_PROJECT`, `TASKS_TARGET_URL`, `TASKS_SERVICE_ACCOUNT` | `cloud_tasks` with the staging queue, staging URL and staging service account |
   | `ALLOWED_EMAILS`, `ADMIN_EMAILS` | test accounts only |
   | `CORS_ORIGINS` | the staging Hosting site |
   | `CONTACT_EMAIL` | the public contact for the scholarly APIs |
   | AI and provider keys | **unset** (AI off) unless a restricted test key is created for staging |

5. Release with `PROJECT=paperaid-staging REPO=<staging registry> SERVICE=paperaid-api MIGRATE_JOB=paperaid-migrate
   deploy/release.sh`, and deploy the frontend to a staging Hosting site built with the staging Firebase config.
6. Verify isolation before use: the staging service account has **no** role in the `paperaid` project
   (`gcloud projects get-iam-policy paperaid | grep staging` returns nothing), and a staging sign-in token is
   rejected by the production API.

Cheaper alternative (same project): only with a separate database principal that can connect to the staging
database alone (`REVOKE CONNECT ON DATABASE paperaid FROM PUBLIC`; grant the staging user `CONNECT` on
`paperaid_staging` only), a separate bucket and queue, separate service accounts with access to only those, and a
separate Firebase project for sign-in. Do not reuse the production database URL, migration identity, bucket,
queue, Firebase project or keys.

## Turning on AI (when keys are available)

```bash
printf '%s' "sk-ant-..." | gcloud secrets create anthropic-api-key --data-file=- --project paperaid
gcloud run services update paperaid-api --project paperaid --region europe-west4 \
  --update-secrets ANTHROPIC_API_KEY=anthropic-api-key:latest \
  --update-env-vars AI_PROVIDER=anthropic            # default model: claude-opus-5-5; override with AI_MODEL
```

Recommended order: enable for a small tester group first with a spending cap on the provider account, run the
grounding checks on real papers from your testers' fields, then widen. Support verification is on
(`AI_VERIFY_CLAIMS=true`). OpenAI / Gemini work the same way (`AI_PROVIDER=openai|gemini`; `AI_MODEL` required).
Optional semantic search: `EMBEDDING_PROVIDER=openai` with `OPENAI_API_KEY` (1536 dimensions).

## Free API keys worth adding

| Key | Effect |
|---|---|
| `SEMANTIC_SCHOLAR_API_KEY` | Stops Semantic Scholar's frequent HTTP 429 without a key |
| `CORE_API_KEY` | Enables CORE (open-access papers in every discipline) as a default source |
| `NCBI_API_KEY` | Raises PubMed's limit from 3 to 10 requests/second |

Add each as a secret and `--update-secrets NAME=secret:latest` (through `deploy/release.sh` via `EXTRA_DEPLOY_FLAGS`).

## Policies and consent

- Policy text lives in `frontend/src/pages/Static.tsx` (Terms, Privacy, AI notice); the version in
  `backend/app/policy.py` (`POLICY_VERSION`) and `Static.tsx`. **Changing either document materially → bump both
  versions together**: every account is then asked to review and accept again.
- Every acceptance is stored in `consent_records` (document, version, granted, time). Records are kept without
  the user link after account deletion, as evidence.

## Routine operations

- **Logs:** Cloud Logging → `cloud_run_revision` / `paperaid-api` (JSON, `request_id`); errors → Error Reporting.
- **Make someone admin:** Admin page → Users → role, or add their email to `ADMIN_EMAILS` (only applies to accounts
  whose role an admin has not changed).
- **Invite testers:** add emails to `ALLOWED_EMAILS` (comma-separated; use `--update-env-vars ^|^ALLOWED_EMAILS=a@x,b@y`).
- **Failed full-text jobs:** Admin → Processing jobs → Retry. Jobs whose worker died or whose task was lost are
  failed automatically when their lease expires (16 min running / 30 min queued).
- **Maintenance:** Admin → Maintenance (or the scheduler above).
- **Account closure:** users delete their own account in Account → Delete my account. Operators can run
  `python scripts/delete_user.py someone@example.com --yes` as a Cloud Run job. Either way the identity is refused
  first (tombstone), then the Firebase account, data and stored PDFs are deleted.
- **Re-link an account to a new Firebase identity** (after verifying the person):
  `python scripts/relink_user.py someone@example.com <new-uid> --yes`.
- **Backups:** automatic daily; restore with `gcloud sql backups restore`.
- **Scale up the DB:** `gcloud sql instances patch paperaid-db --tier db-custom-2-8192 --project paperaid` (brief
  restart), then raise `DB_POOL_SIZE` accordingly.
- **Rollback frontend:** Firebase console → Hosting → release history → Rollback.

## Data from the original (legacy-v1) app

v2 starts from a fresh schema; nothing is migrated from the original Supabase database (different IDs, different
auth system). Decide whether anything there (accounts, documents, uploads) must carry over before retiring it.
If so, write a separate, tested one-off migration: map each legacy user to a Firebase UID, re-resolve papers by
DOI/PMID through the registries (never copy legacy metadata into the shared catalog), re-upload private PDFs
through the API, and verify ownership and storage objects before switching.
