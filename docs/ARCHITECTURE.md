# Architecture

## Principles

1. **Separation.** The SPA is static; all logic and data access live in the Python API. The browser holds only a
   Firebase ID token.
2. **Nothing fabricated.** Shared metadata comes only from scholarly registries. Sources a person types in are
   private and labelled "user-supplied". Citations are formatted by citeproc-js. An AI statement is shown only if it
   quotes its evidence verbatim, its numbers (with sign and unit) appear in that quote, and a support check passes;
   otherwise it is removed (and the user is told), or the answer is discarded (HTTP 502 `AI_OUTPUT_INVALID`). With no
   AI provider configured, AI endpoints return 503 `AI_NOT_CONFIGURED`.
3. **Private by default.** Uploads, manual sources, notes, documents and conversations are visible only to their
   owner, on every route (no administrator bypass; moderation goes through audited `/admin` endpoints).
4. **Stateless API, durable side effects.** Rate limits, jobs, storage-cleanup intents and consent records live in
   Postgres, so any number of Cloud Run instances behave identically and no external write is ever orphaned.
5. **Consent before use.** Every account accepts the current Terms, Privacy Notice and AI notice (and confirms age)
   before any feature works; every choice is recorded with the policy version.

## Backend modules (`backend/app`)

| Module | Responsibility |
|---|---|
| `main.py` | App factory, request IDs, security headers, CORS (exposes paging headers), error envelope, startup maintenance |
| `config.py`, `policy.py` | Typed settings and production validation; current policy version and consent items |
| `security/auth.py` | Firebase ID-token verification, UID-bound accounts (no email takeover), closed-account tombstones, invite + verification + consent gates, roles |
| `security/rate_limit.py` | Fixed-window limits in Postgres; per-caller (hashed last X-Forwarded-For hop) plus global anonymous ceilings |
| `security/url_safety.py` | SSRF-safe PDF fetching: per-hop DNS validation, IP pinning, size/type checks |
| `services/scholarly/*` | OpenAlex, Crossref, Semantic Scholar, DOAJ, PubMed, Europe PMC, CORE (with key), arXiv; subject routing; union-find dedupe |
| `services/papers.py`, `manual.py` | Visibility rules, provenance (`metadata_source`), race-safe registry upserts, CSL mapping; manual sources + ISBN pre-fill |
| `services/pdf.py`, `processing.py` | Extraction and chunking; job state machine with leases, fencing tokens, retry classification |
| `services/search.py` | Hybrid retrieval (Postgres FTS + pgvector, RRF); embeddings fetched before SQL; vector failures fall back |
| `services/citations/*` | citeproc-js (18 bundled styles), BibTeX/RIS/CSL-JSON, Crossref reference verification |
| `services/documents.py`, `export.py` | Schema-based sanitiser, row-locked saves/restores, revisions, node-keyed citation rendering, DOCX/PDF |
| `services/ai/*` | Provider adapters; claim + quote + quantity checks, support verification, quote-centred excerpts |
| `services/accounts.py`, `identity.py` | Consent records, data export (ZIP), account closure (tombstone → Firebase identity → data → objects) |
| `services/maintenance.py` | Upload intents, durable deletions with backoff, rate-bucket purge, abandoned-job reclaim |
| `services/storage.py`, `tasks.py` | Cloud Storage (owned streams) / Cloud Tasks via REST (local equivalents for dev/tests) |

## Data model (PostgreSQL)

`users` (+ `accepted_policy_version`, `preferences`), `consent_records`, `closed_accounts`, `papers` (public registry
records, private uploads and manual sources; `metadata_source`, `csl_extra`), `authors`/`paper_authors`,
`paper_chunks` (text, section, pages, tsvector, `vector(1536)`), `paper_summaries`, `processing_jobs` (lease,
attempt token; one active job per paper), `library_items`, `collections`/`collection_papers`, `documents`,
`document_sources`, `document_citations`, `document_revisions`, `conversations`/`messages` (turn index, evidence
status), `storage_deletions`, `rate_limit_buckets`, `audit_events`.

## Key flows

- **Discovery:** subject → default sources for that subject (PubMed/Europe PMC only for health and life sciences;
  arXiv only on request) → parallel queries with timeouts → union-find merge (strong identifiers transitively;
  title + year only when corroborated and never across conflicting identifiers) → explainable ranking.
- **Import:** identifier → registries → public record (an unverified record is overwritten with registry data).
  Reference files resolve each identifier first; anything unresolved becomes a private, user-supplied record.
- **Full text:** job (with lease) → Cloud Tasks → `/internal/tasks/run-job` (OIDC) → claim with a fresh fencing
  token → fetch/read PDF → extract → publish chunks + paper status + job outcome in ONE transaction that checks the
  token → embeddings best-effort. Transient failures retry (503 to Cloud Tasks, capped at 3 attempts).
- **Uploads:** upload intent committed → object written → paper row, pointer and library entry committed together
  (clearing the intent). Any failure leaves the intent; maintenance deletes the object after a grace period.
- **Grounded answer:** retrieval → numbered evidence → model returns claims with verbatim quotes → deterministic
  checks → support check → answer assembled only from surviving claims; citations carry the verified quote spans.
- **Documents:** row-locked saves with `base_version` (409 on conflict); restores require the current version;
  the editor's save queue drains all pending edits and freezes editing during export and restore.
- **Writing tools (editor):** `/cite` (input rule) or the Cite button opens the cite palette: library search plus
  `GET /discovery/search`; a result outside the library is imported (`POST /papers/import`, registry metadata) and
  then cited (`POST /documents/{id}/citations`). Ghost suggestions are ProseMirror widget decorations (never in the
  saved document) requested from `/ai/complete` after a pause, one request at a time (aborted on the next
  keystroke) and shown only if the text and cursor are unchanged; 429/503 pause them for a minute. Rewrites from the
  selection menu replace the passage only if it is unchanged and keep its citation nodes. "Check against my
  sources" is `POST /documents/{id}/check` (the document's sources, else the library; the same grounded-answer
  validation). The PDF panel lazy-loads pdf.js (same-origin worker, no CSP change) and cites the PDF page.
- **Design system (Graphite):** colours are CSS variables in `frontend/src/theme.css` (generated light and dark
  palettes; Tailwind's `slate`, `white`, `brand` (orange accent), `red`, `amber` and `emerald` map to them), so
  Night mode is a single `html.dark` class. `public/theme-init.js` applies the saved choice before first paint (no
  inline scripts under the CSP); `src/lib/theme.tsx` stores it in the browser and on the account (`theme`
  preference). Fonts are self-hosted via @fontsource.
- **Accounts:** consent gate → recorded choices; self-service export (ZIP) and deletion (identity refused first).
- **Maintenance:** on instance start, on demand (`POST /api/v1/admin/maintenance`) and, once scheduled, every
  15 minutes via `POST /internal/maintenance` (OIDC).
