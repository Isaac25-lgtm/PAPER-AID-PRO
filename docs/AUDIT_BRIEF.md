# Audit brief: Deep research, and the signed-in browser test fixes (after `90e4880`)

**For:** Codex (independent reviewer). Read `AGENTS.md` first.
**Scope:** everything on `main` after `90e4880`, the commit you last reviewed (workspace follow-up), up to the commit
that adds this brief.
**Ask:** is this ready for production and for adding AI keys?
1. Review the reinstated **Deep research** feature end to end: data model, migration, grounding, web evidence,
   rate limits, timeouts, privacy, export, account closure.
2. Verify that each fix from the **signed-in browser test** (section 3) closes its failure at the real entry point.
3. Look hard at the **messy-input** work (spelling correction, fuzzy matching, identifier parsing, reference checker):
   it must help real users without ever changing a correct query, inventing a match or accusing a real reference.
4. Look for new defects, especially security, privacy and cost.
5. **Code integrity and maintainability:** run every test suite and the build yourself; then flag spaghetti code,
   meaning duplicated logic, business logic in route handlers, long functions doing several jobs, hidden coupling
   and dead code. Start with the hotspots we already know of (section 7); do not limit yourself to them. For each,
   say whether it is a real risk and what the simplest clean structure would be.

Report in the format of `docs/PAPERAID_V2_WORKSPACE_AUDIT.md`, as `docs/PAPERAID_V2_DEEP_RESEARCH_AUDIT.md`.

## Commits in scope

| Commit | What |
|---|---|
| `1f24245` | Docs only: production release of `90e4880` recorded (`paperaid-api-00027-dar`) |
| `f212c15` | Deep research reinstated (backend, migration `b3d7e1a9c4f2`, frontend, tests) |
| `4440e81` | Browser-test fixes, round 1: misspelled searches, Europe PMC PDFs, AI buttons while AI is off |
| `94a467e` | Browser-test fixes, round 2: typo-tolerant search everywhere, identifiers, reference checker, entities, guidance italics |
| `9537ec5` | OpenAlex exact word counts for spelling; OpenAlex API key support; this brief and the browser-test record |
| `29ebdba` | `.gitignore`: `*.local.txt` (local-only secret files) |
| `c876f1b` | Docs: production release `paperaid-api-00033-toj` and the OpenAlex key recorded |
| latest | This brief extended: code-quality review, everything tested on 21 November |

**Releases on 21 November** (all through `deploy/release.sh`, with environment check, candidate check and readiness
gate):

| Environment | Revisions, in order |
|---|---|
| Staging | `00014-nam` (`94a467e`), `00017-kug` (`9537ec5`), `00020-nay` (`29ebdba` + OpenAlex key) |
| Production | `00030-xey` (`9537ec5`, migration `b3d7e1a9c4f2` run by `paperaid-migrate`), `00033-toj` (`29ebdba` + OpenAlex key) |

The production frontend was deployed from `9537ec5`. The OpenAlex key is in Secret Manager as `openalex-api-key`,
with `roles/secretmanager.secretAccessor` for `paperaid-api@` and `paperaid-staging-api@`, attached with
`EXTRA_DEPLOY_FLAGS="--update-secrets=OPENALEX_API_KEY=openalex-api-key:latest"`.

## Deployed state (at the time of writing)

| | Production | Staging |
|---|---|---|
| API | `paperaid-api-00033-toj` = `29ebdba`, schema `b3d7e1a9c4f2` | `paperaid-api-staging-00020-nay` = `29ebdba` |
| Frontend | `9537ec5` (no frontend change since) | `94a467e` (no frontend change since) |
| Deep research | live | live |
| AI | not configured | not configured |
| Web search (Tavily) | not configured | not configured |
| OpenAlex key | set (secret `openalex-api-key`, shared) | set (same key) |

Both environments run every change in scope (released 21 November after the maintainer's approval); migration
`b3d7e1a9c4f2` (expand-only: one new table) has run in both.

**Tests:** backend 345, frontend 156, all passing locally; CI green on each pushed commit. Details in section 8.

---

## 1. Deep research (`f212c15`)

A second research mode beside "Research on my papers". The person asks a question; PaperAid finds the sources.

**Flow** (`backend/app/services/deep_research.py`, `run_deep_research`):
1. **Plan.** With AI: 2-4 keyword searches from the model (`SearchPlan`, structured output), cleaned by
   `clean_plan` (markup and quotes stripped, duplicates removed, at most `MAX_QUERIES`). Without AI: the question
   itself (`fallback_queries`), spelling-corrected (section 4).
2. **Search.** Each search runs through the existing `federated_search` (the same as Discover), two at a time
   (`SEARCH_CONCURRENCY`). With a Tavily key, the first two searches also run on the web (`services/web_search.py`).
3. **Rank.** `merge_and_dedupe` and `rank` from the aggregator (reciprocal-rank fusion, no topic rules).
4. **Read.** Up to 14 scholarly works with an abstract and an identifier are upserted as public catalogue records
   (`upsert_public_paper`) and become abstract evidence; up to 6 web results become `kind="web"` evidence.
5. **Report.** `grounded_answer` (the standard grounding pipeline: ids, verbatim quotes, numbers, support check).

**Outcomes** (`report_status`): `complete`; `ai_not_connected` (sources listed, no report); `withheld` (the report
failed the citation checks: `AIOutputInvalid`); `ai_failed` (any other `AppError` from the model). The search
results are saved in every case.

**Web evidence** (`services/ai/grounding.py`): `WebPage` dataclass; `EvidenceItem.paper` is `Paper | WebPage`.
`short_ref` labels it "site (web page, year)", `render_evidence` labels it "Web page excerpt", and `citation_payload`
emits `paper_id: null`, `url`, `site`, `kind: "web"`. `web_search.parse_results` keeps only http(s) URLs with at
least 40 characters of text, removes `<evidence>`-like tags from page text, and replaces `"` in titles, so a page
cannot open or close an evidence block. The Tavily key is sent only as a Bearer header, and errors never echo the
response body.

**Data:** table `deep_research_runs` (`db/models.py` `DeepResearchRun`; migration
`alembic/versions/20261115_b3d7e1a9c4f2_deep_research_runs.py`, expand-only). The FK to `users` cascades, so account
closure removes runs. Export: `services/accounts.py` writes `research/deep/<id>.json`, and the README line is
updated.

**API** (`api/routes/deep_research.py`, all `VerifiedUser`):

| Endpoint | Behaviour |
|---|---|
| `GET /research/deep/status` | What this account can use: databases, `ai`, `web_search` |
| `POST /research/deep` | Runs; 12 per hour per person (`RATE_LIMIT_DEEP_RESEARCH_PER_HOUR`), plus the AI per-minute limit when AI is used; bounded at 240 s (`RUN_TIMEOUT_SECONDS`, inside Cloud Run's 300 s) with a clear 502 |
| `GET /research/deep` | History |
| `GET`, `DELETE /research/deep/{id}` | One run; owner-only, 404 for anyone else |

**Config:**
- `WEB_SEARCH_PROVIDER` (`none` / `tavily`) and `TAVILY_API_KEY`.
- `RATE_LIMIT_DEEP_RESEARCH_PER_HOUR`.
- `deploy/release_checks.py` `ALLOWED_SETTINGS` gains those three plus `OPENALEX_API_KEY`.

**Frontend:**
- `pages/DeepResearch.tsx`: connection status, form, honest progress list, report, sources read and also found, save to library.
- `components/ResearchModes.tsx`: the "My papers / Deep research" switch on both research pages.
- Sidebar item "Deep research" (`Workspace.tsx`; Research is now `end`-matched).
- Route `/research/deep`.
- `GroundedAnswerView` renders web citations as external links labelled "Web page · not peer-reviewed".
- `lib/format.ts` `safeHref` allows http(s) links only.

**Tests:** `backend/tests/test_deep_research.py` (13): report, history, owner-only, web pages, prompt injection,
outage, withheld, rate limit, auth, export, timeout, plan bounds, malformed web payloads.
`frontend/src/test/deepResearch.test.tsx` (5).

**Please scrutinise:**
- The upsert of up to 14 public catalogue records per run: catalogue growth, and the metadata trust model.
- The request held open for up to 240 s on Cloud Run, which is synchronous (no Cloud Tasks).
- `asyncio.wait_for` cancelling mid-transaction.
- The web evidence path, for injection.
- Whether the status endpoint leaks anything.

## 2. Pages that offered AI while AI is off (`4440e81`, `94a467e`)

These controls were offered without AI and could only fail. They are now hidden or explained, using the shared
`frontend/src/lib/ai.ts` `useAIEnabled` (from `/ai/status`):
- Discover's "Generate overview".
- A paper's "Generate summary" and "Ask this paper".
- Research's "Ask".
- The editor's "AI assist".

The server-side AI gates are unchanged. Tests: `frontend/src/test/messyInput.test.tsx`.

## 3. Fixes from the signed-in browser test (staging, tester-a)

The full record is in `docs/BROWSER_TEST_RUN.md`.

| # | Found | Fix | Where | Tests |
|---|---|---|---|---|
| 1 | Discover's AI overview offered with AI off | Hidden until AI works | `pages/Discover.tsx` | `messyInput.test.tsx` |
| 2 | Open-access PDFs from PubMed Central failed: Europe PMC retired `backend/ptpmcrender.fcgi` (403/520) | Use `https://europepmc.org/api/getPdf?pmcid=` | `services/open_access.py` | `test_open_access_pdfs_use_europe_pmcs_current_pdf_service`; live: the BMJ Open paper gave 71 passages |
| 3 | A misspelled Discover search returned papers sharing the typo | Spelling correction (section 4) | `scholarly/spelling.py`, `routes/discovery.py` (`exact` param, `corrected_from`) | `test_messy_input.py`, `messyInput.test.tsx` |
| 4 | Searching inside a paper failed on typos | Retry once, correcting against the paper's own words | `services/search.py` `correct_against_papers`, `search_evidence_corrected`; `PassageOut.matched_query` | `test_searching_inside_a_paper_forgives_typos...` |
| 5 | Text typed after template guidance was italic (the guidance was italic text, and Enter kept the mark) | Guidance is a paragraph attribute (`guidance: true`, `keepOnSplit: false`) styled by CSS. The server keeps it (`documents.py`) and export italicises it (`export.py` `_guidance_in_italics`) | `lib/guidanceParagraph.ts`, `lib/templates.ts`, `styles.css` | `guidance.test.ts`, `test_template_guidance_is_kept_and_exported_in_italics` |
| 6 | Editor "AI assist" offered with AI off | Hidden | `pages/Editor.tsx` | existing editor tests |
| 7 | Journal names showed `&amp;` | `clean_text` decodes entities after stripping tags; journals go through `clean_text` | `scholarly/models.py`, `providers.py` | `test_web_entities_...` |
| 8 | "PMID 27940873" (a space, not a colon) was not recognised | Prefixes accept spaces, `:`, `#`, `=`, `-`; PMC "PMC 123"; new PubMed Central and Europe PMC addresses | `scholarly/identifiers.py` | `test_identifiers_are_read_the_way_people_type_them` |
| 9 | The reference checker said "Not found" for *Attention Is All You Need* (not in Crossref) | When Crossref does not verify, likely titles (`title_segments`) are searched in OpenAlex and the best candidate from both is assessed. DataCite DOIs resolve via OpenAlex. Digits inside links are never read as the year (`_LINKS`) | `citations/verify.py` | `test_reference_checker_finds_real_papers...` |
| 10 | Catalog search failed on typos | Literature-confirmed correction, then catalogue title words; `PaperPage.matched_query` | `routes/papers.py` `list_papers` | `test_catalog_search_forgives_typos` |
| 11 | Library filter needed the exact phrase, and failed on typos | Every word anywhere in the title, in any order (typed `%`/`_` are plain text); typos corrected from the library's own titles | `routes/library.py`, `services/fuzzy.py` | `test_library_filter_matches_words...` |
| 12 | "Suggested for a original research manuscript" | a/an | `pages/Documents.tsx` | n/a |
| 13 | Data-rights text omitted Deep research reports | Wording | `DataRights.tsx`, `Guidance.tsx`, `Home.tsx` | n/a |

## 4. Messy input: how corrections are decided

The principle: **a correction is a suggestion, never a trap.** The person always sees what was searched and can
search exactly what they typed. No step may invent a word the sources do not contain.

**Scholarly searches** (Discover, Deep research without AI, and the catalogue first). `scholarly/spelling.py`
`suggest_correction`:
1. NCBI ESpell proposes a corrected query.
2. Each changed word is accepted only if its exact (unstemmed) count in OpenAlex titles and abstracts
   (`filter=title_and_abstract.search.exact:`) is at least `CONFIRM_RATIO` (50) times the typed word's count.
   Measured examples are in the module docstring:

   | Pair | Typed | Corrected | Outcome |
   |---|---|---|---|
   | malria / malaria | 36 | 224k | Corrected |
   | feding / feeding | 146 | 901k | Corrected |
   | postcolonial / opostcolonial | 99k | 0 | Not changed |
   | filles / files | 22k | 510k | Not changed: only 23× |
   | omics / comics | | | Not changed |

3. Acronyms, mixed case, numbers, identifiers and words under 3 letters are never checked.
4. Any failure or timeout (4 s per call, 8 s overall) means no correction.
5. Results are cached in memory (LRU, 512 entries); failures are not cached.

Discover runs the check beside the original search and searches again only when a correction is accepted. Correct
queries therefore pay no extra latency.

**Own records** (inside a paper, the library, the catalogue as a fallback). Only when nothing matched as typed, each
unknown word of 4 or more letters is replaced by the closest word (difflib ratio 0.8 or higher) that the records
contain. The vocabulary is bounded: 3,000 passages, or 5,000 titles. The result is a retry, and the response says
what was searched.

**Known limits:**
- ESpell sometimes proposes nothing (for example "efect", "mony"). Those words are left as typed.
- With AI connected, Deep research's planner also fixes spelling.

## 5. OpenAlex now needs an API key (latest commit): please assess the risk

During the test OpenAlex answered `429` with this explanation: requests without a key share a free daily budget per
IP address, of about 100 searches (10 credits each, US$0.10 a day). Cloud Run egress addresses are shared.

Discover, Deep research, open-access PDF lookup, spelling confirmation and the reference checker all call OpenAlex.

`scholarly/http.py` `_with_keys` now sends `OPENALEX_API_KEY` as `Authorization: Bearer` to `api.openalex.org` only,
never in the URL. Test: `test_the_openalex_key_is_sent_in_a_header...`.

Both environments now have the key (secret `openalex-api-key`, granted to each service account). Please check every OpenAlex call path goes through `get_json`, and that a
`429` degrades as it should:
- Discover shows OpenAlex as unavailable.
- Spelling makes no correction.
- The reference checker falls back to Crossref only.

Semantic Scholar already answers `429` without its key in both environments.

## 6. Not changed, but worth knowing

- **Staging is slow.** Its Neon database is in `us-east-2` (Ohio) and its Cloud Run service in `europe-west4`.
  Typical public requests take 1.1-2.1 s on staging against 0.5-0.7 s on production. Exports and citations take
  5-10 s on staging. This is a staging-only infrastructure fact; the code is unchanged.
- **Before switching on Tavily,** the Privacy Notice must name it and `POLICY_VERSION` must be bumped
  (`DEPLOYMENT.md`).
- The suggested RCT outline uses clinical section names ("Adverse Events") even for education trials. They are
  editable suggestions and were left as they are.

## 7. Code integrity: hotspots we already know of (please confirm, rank and propose fixes)

These grew quickly while fixing live problems. None has a known functional bug, but several are maintenance
risks. Please judge each one.

| # | Where | Concern |
|---|---|---|
| Q1 | Typo correction exists in **three** places: `services/scholarly/spelling.py` (ESpell + OpenAlex, external), `services/fuzzy.py` `correct_from_vocabulary` (library, catalogue) and `services/search.py` `correct_against_papers` (passages, its own difflib + Counter copy) | Duplicated logic. `search.py` should probably call `fuzzy.py`. Are the three thresholds (`CONFIRM_RATIO` 50, difflib 0.8 twice) consistent and justified? |
| Q2 | `api/routes/papers.py` `list_papers` (nested `matching` closure plus correction flow) and `api/routes/library.py` `list_library` (correction flow) | Search and correction business logic lives in route handlers, with a `db.commit()` mid-route before external calls. Should it move into a service, such as one shared "search with correction" helper? |
| Q3 | `api/routes/discovery.py` `search` | Nested `run` closure; the correction runs beside the search and the search repeats on correction. Is the concurrency right (the correction cannot leak into `exact=true`; there is no double counting against rate limits)? |
| Q4 | `services/deep_research.py` `run_deep_research` (about 120 lines) | Orchestration, evidence building, catalogue upserts, error-to-status mapping and persistence in one function. `sources[offset + j]` index bookkeeping couples the source list to the evidence list. |
| Q5 | `services/ai/grounding.py` `EvidenceItem.paper: Paper \| WebPage` | A union with `isinstance` branches in `short_ref` and `citation_payload`. Fine, or should web evidence be its own type? |
| Q6 | `services/citations/verify.py` | `_assess` is called several times per candidate (`_candidate_score`, the fallback decision, the final assessment); the OpenAlex fallback adds up to two requests per unverified reference. Performance and readability? |
| Q7 | `services/scholarly/spelling.py` | Module-level mutable LRU `_cache` (per process, not shared across Cloud Run instances); `asyncio.wait_for` around `_suggest`. Thread or task safety, and cache poisoning (a wrong correction cached for 512 queries)? |
| Q8 | `services/export.py` `_guidance_in_italics` | Rebuilds the content tree on each export before `citation_labels`, which keys on `id(node)`. The order of these two calls matters; is that robust? |
| Q9 | `frontend/src/pages/DeepResearch.tsx` (307 lines), `pages/Editor.tsx` (703 lines) | Large components with several sub-components inline. |
| Q10 | `# type: ignore[no-untyped-def]` on new nested helpers; CI runs `ruff` but **not `mypy`** | Type safety of the new code is unchecked. Should mypy run in CI? |
| Q11 | `backend/tests/test_messy_input.py` | One file covers spelling, identifiers, the reference checker, the library, the catalogue, passages, export and HTTP keys. Split by area? |
| Q12 | `services/scholarly/identifiers.py` | A bare number (for example `2019`) is read as a PMID (behaviour older than these changes); the prefixes are now permissive. Any false positives that matter? |

## 8. Everything tested on 21 November

**Automated, run locally on the final code** (Windows, embedded Postgres via `pgserver`):

| Suite | Command | Result |
|---|---|---|
| Backend lint and format | `ruff check app tests alembic scripts ../deploy && ruff format --check app tests alembic scripts` | clean |
| Backend tests | `python -m pytest -q` (in `backend/`) | **345 passed**, 7 deselected (live tests) |
| Frontend types | `npx tsc -b --noEmit` | clean |
| Frontend tests | `npx vitest run` | **156 passed** (17 files) |
| Frontend build | `npx vite build` | built; `DeepResearch` chunk 12.8 kB |

**CI** (GitHub Actions on Linux: ruff, pytest, `npm audit --audit-level=high`, tsc, vitest, vite build) was green on
`f212c15`, `4440e81`, `94a467e` and `9537ec5`, and on every commit released.

**New tests added today** (all fail on the code before the fix unless noted):
- `backend/tests/test_messy_input.py` (15):
  - spelling accept and reject: typos, real words, French, acronyms, identifiers, service failure, stem collision;
  - Discover `corrected_from` and `exact`;
  - Europe PMC address;
  - passages typo;
  - library words and typos, wildcards;
  - catalogue typo;
  - reference checker OpenAlex fallback and link years;
  - identifier variants;
  - entities;
  - guidance kept and exported italic;
  - OpenAlex key only in a header and only to OpenAlex.
- `backend/tests/test_deep_research.py` (13).
- `frontend/src/test/deepResearch.test.tsx` (5).
- `frontend/src/test/messyInput.test.tsx` (3).
- `frontend/src/test/guidance.test.ts` (2).
- `frontend/src/test/workspace.test.tsx` (Deep research sidebar item).

**Live checks against real services** (not in CI, done by hand):
- Spelling suggestions against NCBI ESpell and OpenAlex: 14 queries, with typo, correct, acronym, DOI and French cases.
  Measured counts are in `spelling.py`.
- Reference checker: six real, wrong-year, made-up and DOI-only references against Crossref and OpenAlex (results
  in section 3).
- Europe PMC PDF service: `getPdf` returned a 604 KB PDF; `ptpmcrender` returned 403/520.
- OpenAlex key: `200` with `X-RateLimit-Limit: 10000` on the key. Production's search consumed the key's budget, so
  production uses it.
- Production and staging latency: public catalogue request 0.5-0.7 s against 1.1-2.1 s.

**Signed-in browser test** on staging in real Chrome: every section, before and after the fixes, recorded in
`docs/BROWSER_TEST_RUN.md`.

**Not tested:**
- Anything needing AI keys: the Deep research written report, AI summaries and Q&A run on a scripted fake model in
  tests only.
- Tavily web search: mocked only.
- Production while signed in: only staging test accounts are used.
- Phone-width layouts in a real browser.

## 9. How to run everything

```bash
# backend (Postgres 16 + pgvector; tests create their own database; or set TEST_PG_URL)
cd backend && python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/ruff check app tests alembic scripts && .venv/bin/ruff format --check app tests alembic scripts
.venv/bin/python -m pytest -q
# frontend
cd ../frontend && npm ci && npx tsc -b --noEmit && npx vitest run && npx vite build
```

Staging for hands-on checks: `https://paperaid-staging.web.app` (API
`https://paperaid-api-staging-307658066472.europe-west4.run.app`). Ask the maintainer for a staging test account;
the passwords are kept only in a git-ignored local file.

## Out of scope / constraints (unchanged)

- Never touch the Firebase project `paperaid-ca172`.
- No secrets in the repository.
- Production only via `DEPLOY_ENV=production deploy/release.sh`, after the maintainer's approval.
- Tests never reach production Google services.
