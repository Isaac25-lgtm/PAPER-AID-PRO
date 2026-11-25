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
DEPLOY_ENV=production PYTHON="$PWD/backend/.venv/Scripts/python.exe" deploy/release.sh
DEPLOY_ENV=staging    PYTHON="$PWD/backend/.venv/Scripts/python.exe" deploy/release.sh
# optional tuning that rides through the same gate (allowlisted settings only, see deploy/release_checks.py):
DEPLOY_ENV=production PYTHON=... EXTRA_DEPLOY_FLAGS="--update-env-vars=DB_POOL_SIZE=3" deploy/release.sh
```

`deploy/release.sh` (fail-fast, `set -euo pipefail`) refuses to run with uncommitted backend changes, then:

- **one explicit environment:** `DEPLOY_ENV` is required (`production` or `staging`). The profiles live in
  `deploy/release_checks.py`: service, migration job, database secret, runtime service account, bucket, Firebase
  project and the complete Cloud Tasks routing (project, location, queue, target URL, OIDC sender). `SERVICE` and
  `MIGRATE_JOB` cannot be set separately. Before any change, it reads the live service and migration job and
  refuses on any mismatch, so a staging release can never run the production migration;
- **allowlisted overrides:** `EXTRA_DEPLOY_FLAGS` accepts only `--update-env-vars` / `--update-secrets` for tuning
  settings (pool sizes, log level, tester lists, API keys, AI settings). Anything that decides which environment a
  revision belongs to is refused before any cloud call;
- **candidate check:** after deploying without traffic, it describes the exact tagged revision and refuses to move
  traffic unless that revision has this environment's bindings and runs the image digest just built;
- **no credentials in logs:** an inline `DATABASE_URL` is reported only as "an inline value";

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
stuck-job recovery. **Active since 14 November 2026** (job `paperaid-maintenance`, europe-west1; first run returned
200). Check it with `gcloud scheduler jobs describe paperaid-maintenance --location europe-west1 --project paperaid`.
It also runs when an instance starts and from Admin → Maintenance.
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

**Staging (live since 14 November 2026, test phase).** The billing account allows only three projects, so the
test-phase staging uses free tiers and the production project's billing for the server only:

| Piece | Where |
|---|---|
| Website | https://paperaid-staging.web.app (Firebase Hosting on `paperaid-staging`, Spark plan); deploy with `PYTHON=... bash deploy/deploy-staging-frontend.sh` (uses `frontend/.env.staging`) |
| Sign-in | Firebase Authentication on `paperaid-staging` (separate users; email/password only) |
| API | Cloud Run `paperaid-api-staging` in `paperaid` (europe-west4), service account `paperaid-staging-api` |
| Database | Neon free tier (Postgres 16 + pgvector), URL in secret `paperaid-staging-database-url`; migrations via job `paperaid-migrate-staging` |
| Files / jobs | bucket `paperaid-staging-files-307658066472`, queue `paper-processing-staging` (europe-west1) |
| Test accounts | three verified `@staging.paperaid.test` accounts; credentials only in the git-ignored `deploy/staging-testers.local.txt` |

Isolation (verified): in `paperaid` the staging service account holds only `roles/logging.logWriter` plus access to
its own secret, bucket and queue; it has no binding on the production database secret, bucket or queue. Staging
sign-in tokens are rejected by the production API (401). To release the API to staging, deploy the image digest that
production runs (or a candidate) with `DEPLOY_ENV=staging deploy/release.sh`, which migrates with
`paperaid-migrate-staging` and checks every staging binding first. The staging frontend deploy refuses to publish
if any production origin survives in its generated Content-Security-Policy. At launch,
replace this with the full separate-project setup below.

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

5. Add a `DEPLOY_ENV` profile for the new project in `deploy/release.sh` (service, job, secret, identity, bucket,
   queue, Firebase project) and release with it; deploy the frontend to a staging Hosting site built with the
   staging Firebase config.
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

AI is limited to a pilot group by default: `AI_ACCESS=pilot` (default) with `AI_PILOT_EMAILS=a@x.org,b@y.org`
(administrators always included); `AI_ACCESS=everyone` opens it to every verified tester. Inline writing suggestions
have their own switch, `AI_AUTOCOMPLETE_ENABLED=true` (default off), and each person must also turn them on in the
editor. Adding a key therefore changes nothing for anyone outside the pilot list.

Recommended order: enable for a small tester group first with a spending cap on the provider account, run the
grounding checks on real papers from your testers' fields, then widen. Support verification is on
(`AI_VERIFY_CLAIMS=true`). OpenAI / Gemini work the same way (`AI_PROVIDER=openai|gemini`; `AI_MODEL` required).
Optional semantic search: `EMBEDDING_PROVIDER=openai` with `OPENAI_API_KEY` (1536 dimensions). Embeddings follow the same
cohort: a private paper's passages are embedded only when its owner is in the AI cohort, and a passage search sends
the query to the embedding provider only for people in the cohort. Everyone else keeps keyword search, and their
text never leaves PaperAid (audit SF01). Public catalog records (registry metadata and open-access text) may be
embedded for everyone. Before enabling embeddings, describe this indexing in the privacy notice.

## Turning on web search for Deep research (optional)

Deep research always searches the scholarly databases. With a Tavily key it also searches the general web; web
pages are cited by address and labelled "not peer-reviewed". The key is sent only to Tavily, in a header.

```bash
printf '%s' "tvly-..." | gcloud secrets create tavily-api-key --data-file=- --project paperaid
# then release with:
EXTRA_DEPLOY_FLAGS="--update-secrets TAVILY_API_KEY=tavily-api-key:latest --update-env-vars WEB_SEARCH_PROVIDER=tavily"
```

**Before switching it on:** add Tavily to the Privacy Notice's list of services that receive search terms (`frontend/src/pages/Static.tsx`) and bump `POLICY_VERSION`, so every account accepts the updated notice.

Runs are limited per person (`RATE_LIMIT_DEEP_RESEARCH_PER_HOUR`, default 12). Each run with AI makes about three
model calls (plan, report, support check).

## Free API keys worth adding

| Key | Effect |
|---|---|
| `OPENALEX_API_KEY` | **Required in practice.** OpenAlex's own budget (about 1,000 searches a day free) instead of a tiny shared per-IP budget. Set in both environments |
| `SEMANTIC_SCHOLAR_API_KEY` | Stops Semantic Scholar's frequent HTTP 429 without a key |
| `CORE_API_KEY` | Enables CORE (open-access papers in every discipline) as a default source |
| `NCBI_API_KEY` | Raises PubMed's limit from 3 to 10 requests/second |

Add each as a secret, grant `roles/secretmanager.secretAccessor` to the environment's service account, and release with
`EXTRA_DEPLOY_FLAGS="--update-secrets=NAME=secret-name:latest"` (the `=` form is required by the flag check).
`OPENALEX_API_KEY` is set this way in both environments (secret `openalex-api-key`); without it OpenAlex answers
429 once a small per-IP daily budget is spent.

## Local development and identity

Outside `ENV=production` the API never deletes Firebase sign-ins (closing an account locally deletes the local data
only). Use the Firebase Auth emulator (`FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`) to exercise identity deletion,
or a dedicated development Firebase project. Never give a development setup production credentials.

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
