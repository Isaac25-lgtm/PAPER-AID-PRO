# Architecture

## Principles

1. **Separation.** The SPA is static; all logic and data access live in the Python API. The browser holds only a
   Firebase ID token.
2. **Nothing fabricated.** Metadata comes from scholarly registries; citations are formatted by citeproc-js; AI
   output is accepted only if every claim cites real evidence passages, otherwise it is discarded (HTTP 502
   `AI_OUTPUT_INVALID`). With no AI provider configured, AI endpoints return 503 `AI_NOT_CONFIGURED`.
3. **Private by default.** Uploaded PDFs are private papers owned by the uploader; PDFs are never public objects.
4. **Stateless API.** Rate limits, jobs and sessions are in Postgres/Cloud Tasks, so any number of Cloud Run
   instances behave identically.

## Backend modules (`backend/app`)

| Module | Responsibility |
|---|---|
| `main.py` | App factory, request IDs, security headers, CORS, uniform error envelope |
| `config.py` | Typed settings; production configuration validation |
| `security/auth.py` | Firebase ID-token verification (google-auth), user upsert, role dependencies |
| `security/rate_limit.py` | Fixed-window limits in Postgres (shared across instances) |
| `security/url_safety.py` | SSRF-safe PDF fetching: per-hop DNS validation, IP pinning, size/type checks |
| `services/scholarly/*` | Provider clients, identifier parsing, federated search, merge/dedupe, ranking |
| `services/papers.py` | Paper persistence, visibility rules, CSL-JSON mapping |
| `services/pdf.py`, `processing.py` | Page-aware extraction, section detection, chunking, ingestion jobs |
| `services/search.py` | Hybrid retrieval (Postgres FTS + pgvector) with reciprocal-rank fusion |
| `services/citations/*` | citeproc-js formatting, BibTeX/RIS/CSL-JSON interchange, Crossref verification |
| `services/documents.py`, `export.py` | Editor content sanitisation, optimistic concurrency, revisions, DOCX/PDF |
| `services/ai/*` | Provider adapters, grounding + citation validation, AI features |
| `services/storage.py`, `tasks.py` | Cloud Storage / Cloud Tasks via REST (local equivalents for dev/tests) |

## Data model (PostgreSQL)

`users`, `papers` (public registry records or private uploads), `authors`/`paper_authors`, `paper_chunks`
(text, section, pages, tsvector, `vector(1536)` embedding), `paper_summaries`, `processing_jobs`,
`library_items`, `collections`/`collection_papers`, `documents`, `document_sources`, `document_citations`,
`document_revisions`, `conversations`/`messages`, `rate_limit_buckets`, `audit_events`.
Public papers are unique by DOI/PMID/arXiv ID (partial unique indexes); private uploads may duplicate them.

## Key flows

- **Import:** identifier → registries (Crossref/PubMed/arXiv authoritative, OpenAlex/S2 enrichment) → upsert.
  Client-supplied metadata is never trusted.
- **Full text:** API creates a job → Cloud Tasks calls `/internal/tasks/run-job` with an OIDC token → worker
  fetches the OA PDF (SSRF-safe) or reads the upload from Storage → extracts, chunks, (embeds) → paper `ready`.
- **Grounded answer:** retrieve passages (or abstracts) → numbered evidence blocks → model returns structured
  JSON with `[E#]` markers → validator rejects unknown ids / uncited answers → citations built from DB rows.
- **Documents:** editor saves `{base_version, content}`; a stale version gets 409 and the UI offers
  keep-mine / load-theirs. Revisions are snapshotted (≤1 per version, every 10 min or on demand).
