# Audit brief — PaperAid Pro v2 (`platform-v2`)

**Audience:** an independent coding agent (e.g. Codex) asked to audit the rebuild. Read `AGENTS.md` first.
**Deliverable:** a findings report (format at the end). Do **not** modify production resources. Code fixes are
welcome as a separate branch/PR after the report, one finding per commit, with tests.

## 1. Background

The original app (still on `main`) was a Next.js 14 monolith: TypeScript server code mixed with UI, Prisma +
Supabase (Postgres + Storage), NextAuth credentials auth. A review found, among other problems:

- **Fabricated output:** the "AI Research Snapshot" returned a fixed medical-imaging paragraph for every query,
  with invented page numbers; the "agent" metric verifier contained hard-coded results for one benchmark paper;
  citation validators had breast-imaging-specific rules; a homepage "evidence sandbox" showed invented papers and
  statistics.
- Security/ops: Next.js critical advisory + 13 vulnerable deps, weak sign-up (6-char passwords, no verification,
  account enumeration), in-memory rate limits, fire-and-forget background work, no security headers.

The maintainer asked for a production-grade rebuild with a **separate Python backend**, everything fake removed,
and parity with the original's genuine features.

## 2. What v2 is

| Layer | Implementation |
|---|---|
| API | FastAPI on Cloud Run (`backend/`), async SQLAlchemy + Alembic, PostgreSQL 16 + pgvector (Cloud SQL) |
| Auth | Firebase Authentication; backend verifies ID tokens (`app/security/auth.py`, google-auth); roles in DB; verified email required; **invite-only allowlist** via `ALLOWED_EMAILS` |
| Files | Private Cloud Storage bucket via JSON API (`services/storage.py`); PDFs streamed by the API |
| Jobs | Cloud Tasks → `POST /internal/tasks/run-job` (OIDC-verified) → `services/processing.py` |
| Discovery | OpenAlex, Crossref, PubMed, Semantic Scholar, arXiv (`services/scholarly/*`); merge/dedupe; RRF ranking |
| Full text | SSRF-safe fetch with IP pinning (`security/url_safety.py`), pypdf extraction, section detection, chunking |
| Search | Hybrid Postgres FTS + pgvector with reciprocal-rank fusion (`services/search.py`) |
| Citations | citeproc-js runner, 10 official CSL styles; BibTeX/RIS/CSL-JSON; Crossref reference verification |
| Documents | TipTap JSON sanitised server-side, optimistic concurrency (`base_version` → 409), revisions, DOCX/PDF export |
| AI | Provider-neutral adapters (Anthropic SDK / OpenAI / Gemini REST); grounded answers validated in `services/ai/grounding.py`; **no provider configured yet** |
| Frontend | React SPA on Firebase Hosting; calls the Cloud Run URL directly (CORS allow-list) |

Tests: 104 backend (real Postgres + pgvector), 5 live, 17 frontend. CI: `.github/workflows/ci.yml`.

## 3. Change log (`git log main..platform-v2`)

1. Rebuild: separated backend/frontend, removal of fabricated features, new infra, tests, CI.
2. Lockfile compatibility for npm 10/11.
3. Handoff docs.
4. Invite-only tester allowlist (`ALLOWED_EMAILS`, 403 `NOT_INVITED`, UI message).
5. Google sign-in button; `scripts/delete_user.py` (account deletion with storage cleanup).
6. (in progress) Guided document templates restored from the original (`frontend/src/lib/templates.ts`).

## 4. Known gaps vs the original (parity work in progress — verify and extend this list)

Missing or reduced in v2: signed-in **dashboard** + onboarding checklist; **authors** and **categories** pages;
**admin paper create/edit** forms, CSL catalog admin, backfill tools; editor **inline ghost autocomplete**,
**selection popover**, **evidence-summary panel** (backend `summarize_evidence` was not re-implemented);
**onboarding tour / help guides**; homepage **FAQs** and tools showcase; **agent workspace** (to be rebuilt as a
real grounded evidence-table extractor); **table extraction** (Docling sidecar removed); CitedEvidence
"scholar tools"/MCP proxy (third-party, needs an API key).

Please do a **parity audit**: walk every page, server action and API route on `main` (`src/app/**`, `src/lib/**`)
and list each genuine capability as present / partial / missing in v2, with the v2 file that implements it.
Flag anything on `main` that is fabricated so it is not restored as-is.

## 5. Deliberate decisions (flag only if you think they are wrong, with reasons)

- Frontend calls Cloud Run directly instead of a Hosting rewrite (Hosting proxy has a 60 s limit).
- Cloud Tasks queue in `europe-west1` (not available in `europe-west4`).
- citeproc-js via a Node subprocess (citeproc-py produced incorrect output for several styles).
- Embeddings fixed at 1536 dimensions (`vector(1536)`).
- Rate limits are fixed-window in Postgres.
- Scanned PDFs are rejected (no OCR).

## 6. Audit scope (priority order)

1. **Security** — authN/authZ on every route (IDOR, role checks, invite-only bypass, private-paper leakage via
   search/citations/exports/conversations/summaries), token verification, SSRF (`url_safety.py` + every
   outbound fetch), upload handling, XSS (all `dangerouslySetInnerHTML` + `sanitizeHtml`, TipTap content
   sanitiser), CSP/CORS, secrets handling, internal task endpoint, rate-limit coverage, dependency CVEs.
2. **Correctness** — grounding validator (can an answer pass with unsupported claims?), citation clustering and
   bibliography ordering, document concurrency/revision logic, processing job state machine and retries,
   federated search merge/dedupe edge cases, BibTeX/RIS parsing, identifier parsing.
3. **Data integrity** — migrations vs models drift (`alembic check`), cascades, unique/partial indexes,
   transaction boundaries (commit/rollback in long flows), orphaned storage objects.
4. **Reliability & performance** — N+1 queries, missing indexes, unbounded queries/payloads, timeouts, async
   blocking calls, Cloud Run concurrency/pool sizing, cold starts.
5. **Frontend** — error/loading states, auth edge cases (unverified, not invited, token refresh), editor
   autosave races, accessibility basics.
6. **Tests & CI** — meaningful gaps, brittle tests, untested branches.
7. **Parity** — section 4.

## 7. Report format

For each finding:

```
[SEVERITY: critical|high|medium|low|info] Title
Where: path/to/file.py:LINE (and related lines)
What: one-sentence defect statement
Impact / failure scenario: concrete inputs → wrong outcome
Evidence: code excerpt or a failing test you wrote
Fix: specific change (and test to add)
```

End with: a parity table (capability | main | v2 status | v2 file), a list of verified-OK areas you checked,
and the exact commands you ran with their results (tests, lint, `npm audit`, `pip-audit` if available).
