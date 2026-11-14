# PaperAid Pro (Silver)

Research platform for academics: federated literature discovery, a personal research library, a citation-aware
document editor, reference verification, and grounded AI answers where every claim links to its source passage.

**Live:** https://paperaid.web.app · **API:** https://paperaid-api-307658066472.europe-west4.run.app/api/v1/health

## Architecture

```
Browser ──► Firebase Hosting (React SPA, static)          frontend/
   │  Firebase Authentication (email/password; Google optional)
   │  Authorization: Bearer <Firebase ID token>
   ▼
Cloud Run: paperaid-api (Python 3.12, FastAPI)             backend/
   ├── Cloud SQL PostgreSQL 16 + pgvector  (all data, full-text + vector search)
   ├── Cloud Storage (private bucket)      (PDFs; streamed only to authorised users)
   ├── Cloud Tasks queue                   (PDF retrieval/extraction jobs, OIDC-authenticated)
   ├── Secret Manager                      (database URL, AI keys)
   ├── Scholarly APIs: OpenAlex, Crossref, Semantic Scholar, DOAJ, PubMed, Europe PMC, CORE (key), arXiv,
   │                   Unpaywall, Open Library (ISBN)
   └── AI provider (Anthropic / OpenAI / Gemini) — optional, off until keys are added
```

The frontend never touches the database or storage; everything goes through the versioned REST API
(`/api/v1`, OpenAPI at `/api/v1/openapi.json`, interactive docs at `/api/v1/docs` outside production).

| Layer | Technology |
|---|---|
| Backend | FastAPI, SQLAlchemy 2 (async, psycopg 3), Alembic, Pydantic v2 |
| Database | PostgreSQL 16 + pgvector (HNSW cosine index), Postgres full-text search |
| Citations | citeproc-js (reference CSL engine) via a pinned Node runner; 18 official CSL styles across disciplines |
| Documents | TipTap/ProseMirror JSON, sanitised server-side; DOCX (python-docx) and PDF (fpdf2) export |
| Frontend | React 18, Vite, TypeScript, TanStack Query, React Router 7, Tailwind CSS |
| Auth | Firebase Authentication; tokens verified server-side; roles live in Postgres |

## Repository layout

```
backend/    FastAPI service, Alembic migrations, tests (pytest), Dockerfile
frontend/   React SPA, tests (vitest)
docs/       HANDOFF.md (start here), ARCHITECTURE.md, DEPLOYMENT.md, audit reports and responses
deploy/     release.sh (gated production/staging release)
firebase.json / .firebaserc   Firebase Hosting config (security headers, SPA routing)
.github/workflows/ci.yml      Lint, type-check, tests, audit and build on every push
```

## Local development

Requirements: Python 3.12, Node 20+. No Docker needed (an embedded PostgreSQL + pgvector is started for you).

```bash
# Backend
cd backend
python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt   # (bin/ on macOS/Linux)
(cd app/services/citations/engine && npm ci)
.venv/Scripts/python scripts/dev.py            # API on http://127.0.0.1:8000  (docs: /api/v1/docs)

# Frontend (second terminal)
cd frontend
npm ci
npm run dev                                    # http://localhost:5173 (proxies /api to the backend)
```

Signing in locally uses the Firebase project in `frontend/.env.development`. Identity administration is
production-only: outside `ENV=production` the API never deletes Firebase sign-ins (closing an account locally deletes
the local data and skips the identity step). To exercise identity deletion locally, run the Firebase Auth emulator
(`firebase emulators:start --only auth`) and set `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` for the API; or use a
dedicated development Firebase project. Never point a development setup at production credentials.

## Tests

```bash
cd backend && .venv/Scripts/python -m pytest          # 205 tests against real PostgreSQL + pgvector
cd backend && .venv/Scripts/python -m pytest -m live  # 7 checks against the real scholarly APIs
cd frontend && npx vitest run && npx tsc -b --noEmit  # 44 tests + strict type-check
```

CI (`.github/workflows/ci.yml`) runs the backend suite on PostgreSQL + pgvector, the frontend suite, `npm audit`,
and a **container** job that builds the production image and runs `scripts/smoke_container.py` inside it
(fonts, citation engine, migrations, readiness). Tests never call production Google services.

## Configuration

All backend settings are environment variables (see `backend/.env.example` and `backend/app/config.py`).
Production refuses to start if critical settings are missing (`Settings.validate_for_production`).

Key settings: `DATABASE_URL`, `FIREBASE_PROJECT_ID`, `ADMIN_EMAILS`, `ALLOWED_EMAILS`, `STORAGE_BACKEND`/`GCS_BUCKET`,
`TASKS_*`, `CONTACT_EMAIL`, `SEMANTIC_SCHOLAR_API_KEY`, `CORE_API_KEY`, `AI_PROVIDER`/`AI_MODEL`/`*_API_KEY`,
`EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`, `DB_POOL_SIZE`/`DB_MAX_OVERFLOW`. Frontend: `VITE_API_BASE_URL`,
`VITE_PRIVACY_CONTACT_EMAIL` (shown on the Terms and Privacy pages).

See **docs/DEPLOYMENT.md** for operations and **docs/HANDOFF.md** for status and next steps.
