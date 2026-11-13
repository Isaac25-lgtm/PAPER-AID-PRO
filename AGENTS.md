# AGENTS.md — guidance for coding agents (Codex, Claude Code, etc.)

PaperAid Pro ("Silver") is a research platform for academics: federated literature discovery, a personal
library, a citation-aware document editor, reference verification, and evidence-grounded AI answers.
Read `README.md` and `docs/ARCHITECTURE.md` first; `docs/AUDIT_BRIEF.md` holds the current audit request.

## Layout

- `backend/` — Python 3.12, FastAPI, SQLAlchemy 2 (async, psycopg 3), Alembic, PostgreSQL 16 + pgvector.
  Entry `app/main.py`; settings `app/config.py`; routes `app/api/routes/*`; logic `app/services/*`;
  security `app/security/*`; schema `app/db/models.py`; migrations `alembic/versions/*`.
  Citation formatting shells out to a pinned citeproc-js runner: `app/services/citations/engine/format.cjs`.
- `frontend/` — React 18 + Vite + TypeScript SPA (TanStack Query, React Router 7, TipTap, Tailwind).
  API client `src/lib/api.ts`; auth `src/lib/auth.tsx` (Firebase Auth); pages `src/pages/*`.
- `firebase.json` — Firebase Hosting config (CSP and security headers). `.github/workflows/ci.yml` — CI.
- `main` = the v2 rebuild (this code). The ORIGINAL Next.js/Prisma/Supabase app is preserved at tag
  `legacy-v1` (reference for feature parity: `git checkout legacy-v1` or `git show legacy-v1:<path>`).

## Commands

```bash
# backend (from backend/)
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt     # Windows: .venv/Scripts/
(cd app/services/citations/engine && npm ci)
.venv/bin/python -m pytest -q                 # embedded Postgres via pgserver; or set TEST_PG_URL=postgresql://user:pw@host:5432
.venv/bin/python -m pytest -m live -q         # opt-in: real scholarly APIs (network)
.venv/bin/ruff check app tests alembic scripts && .venv/bin/ruff format --check app tests alembic scripts
.venv/bin/python scripts/dev.py               # local API on :8000 (docs at /api/v1/docs)

# frontend (from frontend/)
npm ci && npx tsc -b --noEmit && npx vitest run && npx vite build
```

## Rules

- **Never fabricate.** No hard-coded "example" research outputs, invented citations, papers, statistics or page
  numbers anywhere (UI demos included). AI answers must pass `services/ai/grounding.py` validation; when AI is
  not configured, endpoints return 503 `AI_NOT_CONFIGURED` — never a canned fallback.
- **The browser never touches the DB or storage.** All data access goes through `/api/v1`.
- **Authorization is server-side.** Use `CurrentUser`/`VerifiedUser`/`AdminUser` dependencies and
  `services/papers.get_paper_for_user` (returns 404 for invisible papers — no enumeration). Roles come from the DB.
- **Metadata comes from registries, not clients.** Imports resolve identifiers server-side.
- **No secrets in the repo.** Production config lives in Cloud Run env vars and Secret Manager.
  `frontend/.env.production` contains only public Firebase web identifiers.
- **Do not run commands against production** (Cloud Run, Cloud SQL, Firebase project `paperaid`) unless the
  maintainer explicitly asks. Tests use local/embedded databases only.
- Schema changes need an Alembic migration (expand → deploy → contract) and must keep tests passing.
- Keep the AI layer provider-neutral (`services/ai/providers.py`); Anthropic uses the official `anthropic` SDK.
- Every change ships with tests; keep backend and frontend suites green.
