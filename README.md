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
   ├── Scholarly APIs: OpenAlex, Crossref, PubMed, Semantic Scholar, arXiv, Unpaywall
   └── AI provider (Anthropic / OpenAI / Gemini) — optional, off until keys are added
```

The frontend never touches the database or storage; everything goes through the versioned REST API
(`/api/v1`, OpenAPI at `/api/v1/openapi.json`, interactive docs at `/api/v1/docs` outside production).

| Layer | Technology |
|---|---|
| Backend | FastAPI, SQLAlchemy 2 (async, psycopg 3), Alembic, Pydantic v2 |
| Database | PostgreSQL 16 + pgvector (HNSW cosine index), Postgres full-text search |
| Citations | citeproc-js (reference CSL engine) via a pinned Node runner; 10 official CSL styles |
| Documents | TipTap/ProseMirror JSON, sanitised server-side; DOCX (python-docx) and PDF (fpdf2) export |
| Frontend | React 18, Vite, TypeScript, TanStack Query, React Router 7, Tailwind CSS |
| Auth | Firebase Authentication; tokens verified server-side; roles live in Postgres |

## Repository layout

```
backend/    FastAPI service, Alembic migrations, tests (pytest), Dockerfile
frontend/   React SPA, tests (vitest)
docs/       ARCHITECTURE.md, DEPLOYMENT.md, HANDOFF.md
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

Signing in locally uses the real Firebase project (`paperaid`); local accounts and production accounts are the same
Firebase users, but each environment has its own database.

## Tests

```bash
cd backend && .venv/Scripts/python -m pytest          # 102 tests against real PostgreSQL + pgvector
cd backend && .venv/Scripts/python -m pytest -m live  # 5 checks against the real scholarly APIs
cd frontend && npx vitest run && npx tsc -b --noEmit  # 16 tests + type-check
```

## Configuration

All backend settings are environment variables (see `backend/.env.example` and `backend/app/config.py`).
Production refuses to start if critical settings are missing (`Settings.validate_for_production`).

Key settings: `DATABASE_URL`, `FIREBASE_PROJECT_ID`, `ADMIN_EMAILS`, `STORAGE_BACKEND`/`GCS_BUCKET`,
`TASKS_*`, `CONTACT_EMAIL`, `AI_PROVIDER`/`AI_MODEL`/`*_API_KEY`, `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`.

See **docs/DEPLOYMENT.md** for operations and **docs/HANDOFF.md** for status and next steps.
