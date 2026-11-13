# PaperAid Pro (Silver) — v2 handoff

Status as of 13 Nov 2026. Branch `platform-v2` on GitHub (CI green). `main` still holds the old Next.js code
until the branch is merged.

## What changed and why

The original app was a Next.js monolith (TypeScript server code + Prisma + Supabase) with several features that
returned **fabricated output**. v2 is a rebuild with a separated, tested Python backend.

| Area | Before | After |
|---|---|---|
| Backend | Next.js server actions/API routes in TypeScript, mixed with UI | Standalone FastAPI service (Python 3.12) on Cloud Run |
| Frontend | Next.js pages calling Prisma directly | React SPA on Firebase Hosting; talks only to the API |
| Data | Supabase Postgres via Prisma | Cloud SQL PostgreSQL 16 + pgvector via SQLAlchemy/Alembic |
| Files | Supabase Storage | Private Cloud Storage bucket, streamed by the API |
| Auth | NextAuth credentials (6-char passwords, no verification, no lockout) | Firebase Auth (verified email required, Google-managed password security); roles in DB |
| Jobs | Fire-and-forget promises inside requests | Cloud Tasks queue with retries, OIDC-authenticated worker endpoint |
| Rate limits | In-memory per instance | Postgres-backed, shared by all instances |
| “AI research snapshot” | Hard-coded medical-imaging paragraph + fake page numbers | Grounded synthesis from real abstracts; answers citing unknown evidence are discarded |
| “Agent” metric verifier | Hard-coded results for one benchmark paper | Removed; replaced by generic grounded multi-paper research Q&A |
| Citation formatting | citeproc-js in the Next.js server | citeproc-js (same reference engine) behind the Python API; Chicago labels corrected to 18th ed. |
| Next.js critical CVE, 13 other vulnerable deps | — | 0 known vulnerabilities (npm audit); pinned Python deps |

## Verified

- **Backend:** 102 automated tests on real PostgreSQL + pgvector (auth/roles, visibility isolation, SSRF guards,
  rate limits, PDF pipeline, search, library/collections, BibTeX/RIS, documents/conflicts/revisions/export,
  all 10 citation styles, reference verification, AI grounding/validation) + 5 live tests against the real APIs.
- **Frontend:** 16 tests, strict TypeScript, production build.
- **Production smoke tests:** health/readiness, live federated search, citation formatting, reference checks,
  auth enforcement, CORS allow-list, security headers, hidden internal endpoint.

## Remaining (only these)

1. **Enable sign-in (one-time, Firebase console)** — Authentication → Get started → Email/Password → Enable.
   Optional: enable Google, then set `VITE_ENABLE_GOOGLE_SIGNIN=true` in `frontend/.env.production` and redeploy hosting.
2. **AI keys** — see DEPLOYMENT.md “Turning on AI”. Until then every AI feature shows an honest “not switched on yet”.
   Default model when Anthropic is configured: `claude-opus-5-5` (override with `AI_MODEL`).
3. **Semantic Scholar API key (free)** — anonymous access is frequently rate-limited (HTTP 429); search still works
   from the other four sources. Add as secret + `SEMANTIC_SCHOLAR_API_KEY`.
4. **Merge** `platform-v2` into `main` once you are happy.

## Known limitations (deliberate, documented)

- Scanned (image-only) PDFs are rejected with a clear message; OCR is not implemented.
- Table extraction (old Docling sidecar) was removed; tables are searchable as text only.
- Semantic (vector) search activates when an embedding provider is configured; until then retrieval is
  Postgres full-text search, which is reliable for keyword-style questions.
- Cloud SQL `db-f1-micro` is a shared-core instance: right for launch; upgrade with one command when usage grows.

## Costs (approximate, from the free-trial credit)

Cloud SQL ~$10/month; Cloud Run, Cloud Tasks, Storage and Hosting scale to zero and cost cents at low traffic.
The “PaperAid Pro - Silver monthly” budget alert is $10, so it will notify every month once the database runs —
raise it to ~$20 in Billing → Budgets if you prefer quieter alerts.
