# PaperAid Pro (Silver) — handoff

**Status: 14 November 2026.** Live and in a private, invite-only test. Code on GitHub `main`. Original app preserved
at tag `legacy-v1`.

| | |
|---|---|
| App | https://paperaid.web.app |
| API | https://paperaid-api-307658066472.europe-west4.run.app/api/v1/health |
| Running revision | `paperaid-api-00012-zor`, database schema `e5f3a8c1d927` |
| Google Cloud / Firebase project | `paperaid` (main Google account) |
| Start reading | this file → `docs/DEPLOYMENT.md` (operations) → `docs/ARCHITECTURE.md` → `AGENTS.md` (for coding agents) |

## 1. What the product does today

| Area | What a user can do |
|---|---|
| **Sign-in and consent** | Invite-only. Email/password or Google, verified email required. Before anything else, accept the Terms, Privacy Notice and AI notice and confirm 18+. Optional emails and analytics are off by default. Each choice is recorded with its policy version. |
| **Home** | Dashboard with a getting-started checklist (from real activity), recent documents and questions, and an optional 1-minute tour. |
| **Guidance** | Every section has a one-line "New here? How X works" guide that opens into steps and tips (remembered on the account). Help centre in the top bar: section guides, editor shortcuts, how sources and evidence work. Empty sections explain what to do next. |
| **Discover** | One search across OpenAlex, Crossref, Semantic Scholar and DOAJ, plus PubMed and Europe PMC for health and life sciences. CORE joins when its key is added; arXiv is used only on request. Subject filter: health, life, physical sciences & engineering, social sciences (incl. education, business, law), arts & humanities. Duplicates merged safely. |
| **Library** | Save from Discover; import by DOI, PMID, PMCID or arXiv ID; upload PDFs (private); import BibTeX or RIS (identifiers verified at the registries); **enter books, chapters, reports, theses, court cases, statutes, web pages, datasets and interviews manually** (ISBN pre-fill; private and labelled "User-supplied details"). Collections, tags, notes, paging, complete export (BibTeX, RIS, CSL-JSON). |
| **Papers** | Details, citation in 18 styles, open-access full-text retrieval or upload, passage search, AI summary and Q&A (when AI is on). |
| **Documents** | Guided templates by research approach (quantitative, qualitative, mixed methods, humanities, law, engineering, business, reviews, proposals and concept notes, theses, reports). Editor with **cite while writing** (type `/cite`: one search over the library and every index; any result is imported and cited in one step), a **selection menu** (find a source; with AI on also rewrite, shorten, check against my sources), the **PDF beside the draft** (select words on a page to cite that page or quote them), **grey AI suggestions** when you pause (Tab accepts, Esc dismisses; AI on), automatic reference list, 18 styles grouped by discipline, version history and restore, Word and PDF export. |
| **Research** | Ask across chosen papers. Every statement quotes its source; the supporting words are highlighted. Conversations are saved. |
| **Citation tools** | Format identifiers in any style; check reference lists against Crossref, with title, first author and year each marked matched, mismatched or not checked. |
| **Account** | Edit name, change password, download all my data (ZIP), opt in or out of optional choices, delete my account. |
| **Admin** | Stats, users and roles (audited), processing jobs and retry, run maintenance, delete papers (audited). |

AI features are built and tested but **off** until a provider key is added (they show an honest "not switched on
yet").

## 2. How v2 differs from the original app

| Area | Original (`legacy-v1`) | Now |
|---|---|---|
| Backend | Next.js server actions in TypeScript, mixed with UI | Standalone FastAPI service (Python 3.12) on Cloud Run |
| Data | Supabase via Prisma | Cloud SQL PostgreSQL 16 + pgvector via SQLAlchemy/Alembic |
| Auth | 6-character passwords, no verification | Firebase Auth, verified email, invite list, consent gate, closed-account protection |
| Jobs | Fire-and-forget promises | Cloud Tasks with leases, fencing, retries, recovery |
| AI | A hard-coded medical paragraph with invented page numbers; a benchmark-specific "agent" | Only statements that quote real passages and pass checks; nothing canned |
| Coverage | Health-leaning | Every discipline: subject filter, open-access sources, manual sources, law and social-science styles, approach-based templates |
| Security | Critical Next.js CVE plus 13 vulnerable dependencies | 0 known vulnerabilities; two independent audits fixed |

## 3. What was done in this phase

- **Writing tools (Jenni-style):** cite while writing (`/cite`, searching the library and every index), a selection
  menu (find a source; with AI on: rewrite, shorten, check against my sources), the PDF beside the draft (select
  words to cite the page or quote them) and grey AI suggestions (Tab/Esc). The AI parts stay hidden until an AI key
  is added.
- **Graphite redesign + Night mode:** the chosen direction (B) is applied app-wide:
  - crisp neutrals and ink primary buttons, with one signal-orange accent for the main call to action, links and
    citation chips (no blue)
  - Inter Tight for the interface, Source Serif 4 for writing and JetBrains Mono for metadata, all self-hosted
    (no external font requests)
  - a rebuilt, compact landing page whose preview uses the real interface and real papers
  - **Appearance** setting (Light / Night / Match device) in the top bar and on the Account page, saved to the
    account and applied before the first paint
  - every colour is a theme token (`frontend/src/theme.css`, generated light and dark palettes), so all screens
    switch together
- **Release follow-up audit (Codex):** 12 findings, 3 of them high severity, all fixed with tests
  (`docs/RELEASE_AUDIT_RESPONSE.md`):
  - the account ZIP applies the privacy check and is complete
  - PDF objects are owned per write and are never deleted while in use
  - releases are locked, digest-pinned and promote only the probed revision
  - account closure finishes automatically after an outage
  - consent is bound to the version shown
  - highlights are exact for every quote
  - concurrent uploads are deduplicated, with a retry for private uploads
  - staging is defined in isolation
  - editor citation labels are applied by occurrence
- **First audit:** 28 findings fixed (`docs/AUDIT_RESPONSE.md`).
- **Codex follow-up audit:** 24 findings, 7 of them high severity, all fixed with regression tests
  (`docs/REAUDIT_RESPONSE.md`). Highlights:
  - closed accounts' tokens refused
  - historical private-paper links removed
  - exports keep every citation with its claim, including inside tables
  - job fencing and recovery
  - AI shows only verified statements, with numbers checked by sign and unit and the supporting quote highlighted
  - PDF fonts fixed in the production image
- **Privacy and consent:** consent gate and records, Terms, Privacy and AI notice pages, self-service data export
  and account deletion.
- **Every discipline:**
  - subject filter
  - DOAJ and Europe PMC (CORE with a key)
  - arXiv and health-only sources off by default outside health
  - manual sources with ISBN pre-fill
  - 18 styles, including OSCOLA and Bluebook for law, and ASA, APSA and AAA for the social sciences
  - approach-based templates
  - neutral examples
- **Guidance** made quiet: no automatic pop-up, collapsed one-line guides, optional tour, real empty states.
- **Operations:**
  - CI builds the production image and runs a smoke test inside it
  - gated release script (`deploy/release.sh`)
  - errors reach Cloud Error Reporting
  - database connection pool sized to the database's limit (3 + 2 per instance)
  - scheduled-maintenance endpoint (the schedule itself awaits your approval)

## 4. Verified

| Check | Result |
|---|---|
| Backend tests (real PostgreSQL + pgvector) | **235 passed** locally and in GitHub CI |
| Live checks against real scholarly APIs | **7 passed** (OpenAlex, Crossref, PubMed, arXiv, DOAJ, Europe PMC, Crossref verification) |
| Frontend tests + strict type-check + build | **68 passed**, clean |
| Production image smoke test (CI container job) | fonts, all 18 styles, migrations, readiness: **passed** |
| Migration on existing rows | upgrade from the previous schema with seeded legacy-policy rows; repairs verified |
| Dependency audits | npm: 0 vulnerabilities; pip-audit: no known vulnerabilities |
| Production after release | readiness gate on the exact revision; subject searches, 18 styles (OSCOLA formatted), reference checker (wrong first author → mismatch), auth on account endpoints, internal endpoints refuse unauthenticated calls, CORS paging headers |

Not verified here: a full signed-in click-through in a browser on the live site (no test account was created
in production). Please sign in once, accept the consent screen, and try each section.

## 5. Needs your decision or action

| # | Item | Why it matters | How |
|---|---|---|---|
| 1 | **Look and feel review** | Graphite and Night mode are live; the signed-in screens were checked through tests and the shared tokens, not screenshots | Sign in once in both modes and tell me anything that feels off |
| 2 | **Legal review** | The Terms, Privacy and AI notices are careful drafts, not legal advice. One data-protection lawyer can cover all your markets | Share the three pages with counsel. Bump `POLICY_VERSION` after changes. |
| 3 | **Registrations** | Uganda: register with the Personal Data Protection Office. South Africa: register an Information Officer. Kenya: confirm whether education-related services need ODPC registration regardless of size. EU: an Article 27 representative once EU use is regular | With counsel, before inviting testers from each country |
| 4 | **Scheduled maintenance, uptime alert, staging** | Commands are prepared. Maintenance now also finishes interrupted account closures, and PDF cleanup is safe to schedule. Staging is defined as a separate project, which needs your approval (it adds a project and billing) | Approve and I'll run them, or use DEPLOYMENT.md, "Pending infrastructure" |
| 5 | **Free API keys** | Semantic Scholar (stops HTTP 429), CORE (all-discipline open-access source), NCBI (faster PubMed) | Sign up and send them, or add them as secrets |
| 6 | **AI keys** | Turns on Q&A, summaries, overviews and writing help | Start with a small tester group and a spending cap |
| 7 | **Legacy data** | Nothing from the original Supabase app is migrated | Decide whether anything must carry over |
| 8 | **Landing-page claims** | "Start writing — it's free" leads to an invite-only sign-up, and AI is described before it is on | Fine for a private beta; revisit before public launch |
| 9 | **Signed-in end-to-end check** | The auditor recommends a full signed-in run in isolated staging before widening the beta | After staging exists, or sign in on production once with a test account |
| 10 | **Budget alert** | The $10/month alert will fire monthly once usage grows | Raise to about $20 in Billing → Budgets |

## 6. Known limitations (deliberate, documented)

- **Capacity:** sized for the testing phase (30–50 concurrent users) on `db-f1-micro`. Launch upgrades (database
  tier and high availability, worker split, Redis, load test) are in the recommendations report.
- **PDF text:** scanned (image-only) PDFs are rejected (no OCR). Tables are searchable only as text.
- **PDF export and scripts:** Chinese, Japanese and similar scripts give a clear "use Word export" message (Word
  handles every language).
- **Footnote-only styles:** Bluebook law review has no reference list by design.
- **Search without an embedding provider:** retrieval is full-text search, which suits keyword-style questions.
- **Not built yet** (features Jenni has): AI draft review, sharing and comments, plans and payments. Inline AI
  suggestions and AI rewrite are built but wait for an AI key and a small pilot.

## 7. Costs (approximate)

Cloud SQL about $10/month. Cloud Run, Cloud Tasks, Storage and Hosting scale to zero and cost cents at test traffic.
Staging would add $0–5. Launch-grade infrastructure is estimated at $250–500/month before AI usage.

## 8. How to work on it

```bash
cd backend && .venv/Scripts/python -m pytest -q && .venv/Scripts/ruff check app tests alembic scripts
cd frontend && npx tsc -b --noEmit && npx vitest run
# release (after CI is green on the commit)
PYTHON="$PWD/backend/.venv/Scripts/python.exe" deploy/release.sh
cd frontend && npm run build && cd .. && firebase deploy --only hosting --project paperaid
```
