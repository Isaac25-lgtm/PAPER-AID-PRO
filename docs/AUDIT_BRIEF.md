# Audit brief: Silver's feedback (streamed search, research navigation, citations, documents), after `6acf3e3`

**For:** Codex (independent reviewer). Read `AGENTS.md` first.

**Scope:** everything on `main` after `6acf3e3` (the docs commit that closed the Deep research audit, release of
`20068c2`), up to the commit that adds this brief. In total: 41 files, about 1,860 lines added and 220 removed. The
previous brief (Deep research and browser-test fixes, after `90e4880`) is in git history at `6acf3e3:docs/AUDIT_BRIEF.md`.

**Background:** Silver, the product owner, tested the live app and asked for five things on 25 November 2026:
1. search that is reliable and fast, with exact identifier lookups;
2. clearer research navigation, with the question and papers carried between modes;
3. an accuracy demo (needs AI; not in scope, AI is still off);
4. citations that open their source;
5. a way to write without the template.

`docs/SILVER_FEEDBACK_RESPONSE.md` records what was built, the staging check, and a production browser run that
found and fixed five more problems.

**Ask:** is this safe to keep in production, and ready for AI keys to be added?
1. Verify each item below at its real entry point (route, hook or component), not only through its tests.
2. Look for new defects, especially security (XSS through the new HTML rendering), privacy, cost (calls to
   external APIs per search) and resource use (connections, tasks, memory).
3. Look hard at the **streamed search** (section 3.1): concurrency, cancellation, DB session use, the per-instance
   cache, and what happens when a client disconnects mid-stream.
4. **Code integrity:** run every suite and the build yourself, then flag spaghetti code: duplicated logic,
   business logic in route handlers, long functions doing several jobs, hidden coupling, dead code. Start with the
   hotspots in section 5, but do not limit yourself to them. For each, say whether it is a real risk and what the
   simplest clean structure would be.

**Report:** use the format of `docs/PAPERAID_V2_DEEP_RESEARCH_AUDIT.md`, saved as
`docs/PAPERAID_V2_SILVER_FEEDBACK_AUDIT.md`. Give each finding an ID, severity, file and line, a failing scenario,
and the fix you recommend. Say plainly what you checked and found sound.

## 1. Commits in scope

| Commit | What |
|---|---|
| `015fd7e` | **Search:** results streamed per database (NDJSON), failed databases retried, identifiers looked up exactly |
| `2aaa9b1` | **Navigation:** Research › Ask my papers / Deep research; Find papers (two tabs); question and papers handed between modes |
| `08d96b0` | **Citations:** clicking an in-text citation opens "Cited source"; reference-list addresses become new-tab links |
| `af8f5d7` | **Documents:** Blank document first and created directly; "Include writing guidance" switch |
| `d02edf5` | **Exports:** reference addresses become hyperlinks in Word and PDF |
| `c018f5a` | Docs: `SILVER_FEEDBACK_RESPONSE.md` |
| `24b76d3` | Staging fix: popover opens above the citation when there is no room below; pages read "p. 12" |
| `de59dec` | Staging fix: Retry keeps results already found and the databases that answered |
| `6a9633b`, `530d457` | Docs: staging check; production release |
| `21ff8ea` | Production fix: reference links styled as links (`.reference-link`); identifier note without a repeated "PMID" |
| `97c608d` | Production fix: the opening screen's code downloads alongside sign-in (`App.tsx` `FIRST_SCREEN`) |
| `ea5e7db` | Production fix: spelling words that ESpell merges or splits are rechecked one at a time; bare identifier in the note |
| `9cd97fe` | Docs: production browser run and release recorded |
| latest | This brief |

## 2. Releases

All went through `deploy/release.sh`, with its environment check, candidate check and readiness gate. No schema
change in this round: the schema is still `b3d7e1a9c4f2`.

| Environment | Revision (commit) |
|---|---|
| Staging | `paperaid-api-staging-00026-xax` (`c018f5a`); frontend redeployed at `24b76d3` and `de59dec` |
| Production | `paperaid-api-00039-kof` (`6a9633b`), then `paperaid-api-00042-wom` (`ea5e7db`); frontend at `ea5e7db` |

## 3. What changed, and what to check

### 3.1 Streamed search (Silver item 1)

**Backend**
- `app/api/routes/discovery.py`
  - New `GET /discovery/search/stream`: a `StreamingResponse` of NDJSON events (`query`, `results`, `suggestion`,
    `done`).
  - `/search` and the stream share these helpers: `_start` (rate limit, then commit so no DB connection is held
    while providers are queried), `_lookup` (identifier path), `_results`, and `_provider_list`.
  - The generator opens a short-lived session per `results` event (`shown()`) because the request's own session
    has been released.
  - Spelling runs as a task, awaited at most `STREAM_SPELLING_WAIT_SECONDS = 3.0` (shielded), then cancelled in
    `finally`.
  - If a correction finds nothing, the typed words are streamed instead.
  - In exact mode a suggestion is offered, never applied (waits up to `SPELLING_GRACE_SECONDS = 1.5`).
- `app/services/scholarly/aggregator.py`
  - `search_progressively` yields `(ProviderStatus, works)` as each provider finishes (`asyncio.as_completed`) and
    cancels the remaining tasks in `finally`.
  - Per-provider result cache: `_result_cache`, an LRU of 256 entries with a 5-minute TTL, keyed on provider,
    casefolded query, limit, years, open-access flag and subject. `merged_results` is factored out.
  - The cache is per Cloud Run instance, so a retry that lands on another instance re-queries every provider.
- `app/services/scholarly/identifiers.py`: `exact_identifier()` treats a bare number as a PMID only with at least 6
  digits (so "2016" stays a word).
- `app/services/scholarly/spelling.py` (latest change): `unaligned_words()` plus `_single_word()`. When ESpell's
  whole-query suggestion merges or splits words, up to `MAX_WORD_RECHECKS = 3` of them are sent to ESpell one at a
  time, then confirmed against OpenAlex exact word counts as before.

**Frontend**
- `src/lib/api.ts`: `api.stream()` / `readEvents()` read NDJSON, honour `AbortSignal`, and respect session changes.
- `src/lib/searchStream.ts`: `useSearchStream` keeps per-database states.
  - `retry()` re-runs with `exact: true` on the effective query.
  - While retrying, earlier results and answered databases are kept until each has answered again; one that
    answered before never turns "failed".
- `src/pages/Discover.tsx`: database chips, "Retry unavailable", correction, exact-mode and identifier notes;
  `bareIdentifier()`.

**Please check**
- **Client disconnect mid-stream:** are provider tasks, the spelling task and the short sessions all released? Is
  anything left running or leaking?
- **Load:** one short-lived DB session per `results` event, so up to about 5 per search. Is that acceptable for
  pool size (`DB_POOL_SIZE`), or should `_results` be resolved once per provider batch, or differently?
- **Upstream cost per search, worst case:**
  - ESpell: 1 + 3 calls;
  - OpenAlex counts: 2 per changed word;
  - the providers themselves;
  - the "correction found nothing" fallback, which runs the providers a second time.
  - Is it bounded? Are NCBI's 3 requests/second without a key, and the OpenAlex key's budget, respected under
    concurrent users?
- **Cache correctness:** can a cached entry leak across users or filters? Is the key complete?
- **Timeouts:** every search waits for Europe PMC's 12 s provider timeout before `done` (it was down on
  25 November). Should `done` be sent earlier, or slow providers given a separate state?
- **Hook state machine:** does the retry merge in `useSearchStream` have races with a new search started during a
  retry, or with stale closures (`kept`, `again`)?

### 3.2 Research navigation and handover (item 2)

- **Navigation** (`src/components/Workspace.tsx`): nested sidebar items (`children`, `alsoOn`).
- **Find papers tabs** (`FindPapersTabs.tsx`) on `Discover` and `Catalog`. Public header renamed in `Layout.tsx`.
- **`Research.tsx`:** initial question from `?q=` and selected papers from `?papers=`; a "Search further with Deep
  research" link.
- **`DeepResearch.tsx`:** `?q=` prefill. `AskAboutSources` (`HANDOVER_LIMIT = 8`):
  - `POST /library` for catalogued sources, ignoring 409;
  - `POST /papers/import` for identifier-only sources;
  - then navigates to `/research?q=…&papers=…`.

**Please check**
- `?papers=` ids come from the URL. Confirm the server never shows, or answers from, a paper the user cannot see.
- Partial failure in `AskAboutSources`: some imports fail, or the user leaves mid-way. Is the outcome clear, and is
  nothing duplicated?
- Should the handover be one server call instead of N sequential ones?

### 3.3 Citations open their source (item 4)

- **`src/components/editor/CitationPopover.tsx`:**
  - loads `/documents/{id}/citations` and each `/papers/{paper_id}`;
  - positioned fixed, flips above the citation when there is no room below;
  - closes on Escape or an outside mousedown;
  - `pageLabel()` turns "12" into "p. 12".
- **`pages/Editor.tsx`:** a click wrapper around `EditorContent` finds `.citation-chip` and reads
  `data-citation-ids`.
- **`src/lib/format.ts`:** `linkifyReferences()` runs `sanitizeHtml()` first, then wraps http(s) URLs found in text
  nodes in `<a class="reference-link" target="_blank" rel="noopener noreferrer">`. `trimUrl()` keeps a balanced
  closing bracket and drops trailing punctuation. Used through `dangerouslySetInnerHTML` in:
  - the Editor's reference list;
  - `CitationTools.tsx`;
  - the `papers.tsx` Cite dialog.
- **`backend/app/services/export.py`:**
  - `split_links()` and `_trim_url()` duplicate the frontend logic;
  - Word: `_add_hyperlink()` builds `w:hyperlink` with an external relationship;
  - PDF: markdown `[url](url)` links, falling back to plain text when the URL contains brackets or markdown markers.

**Please check**
- **XSS:** can any CSL output, user-supplied metadata (titles of manual entries are user text), or a crafted URL
  get script, `javascript:`, event handlers or attribute injection through `linkifyReferences` or the popover?
  Is `sanitizeHtml`'s allow-list still right?
- **Word:** a URL containing characters that need escaping in a relationship target. **PDF:** markdown injection
  through reference text (`escape()` covers `**`, `__` and `\` only).
- **Popover:** stale `["citations", documentId]` cache right after inserting a citation (it worked in the browser,
  but confirm why); several ids in one citation; deleted papers.

### 3.4 Documents (item 5)

- `src/lib/templates.ts`: "Blank document" first in `DOC_TYPE_LABELS`; `GuidedConfig.guidance` (default on; off
  gives headings only).
- `src/pages/Documents.tsx`: a blank document is created directly from step 1; the outline step has the switch.
- `src/pages/Dashboard.tsx`: Blank document and Report cards.

**Please check:** the `draft` branches removed from step 2 are now unreachable. Is any behaviour lost? Does the
backend accept everything these flows send?

### 3.5 First-load speed

`src/App.tsx`: the `load` map plus `FIRST_SCREEN` start importing the matching route chunk at module load,
alongside Firebase sign-in.

**Please check:** do the patterns match every route correctly? Are there side effects on public pages or in tests?

## 4. Verified so far

- **Backend:** 386 passed (`pytest`, embedded Postgres); ruff and format clean; mypy clean (module list in
  `pyproject.toml`).
- **Frontend:** 181 passed (`vitest`); `tsc -b` and `vite build` clean.
- **CI:** green on every pushed commit, including `ea5e7db`.
- **Browser, on staging and then on production (signed in):**
  - misspelled, correct, ambiguous and identifier queries;
  - progressive chips, and Retry during a real Europe PMC outage;
  - both research handovers;
  - citation popover and its links (opened real new tabs);
  - reference links in the editor, Citation tools and the Cite dialog;
  - Blank document, and the guidance switch.
- **Not run in the browser:** Word and PDF export downloads. These are covered by
  `test_guidance_export.py::test_reference_addresses_are_links_in_word_and_pdf`.

## 5. Known hotspots and open items (please judge)

1. **`discovery.py` route size:** `search_stream` holds an inner generator with nested `stream()` and the
   correction fallback. Should the orchestration move into a service (e.g. `services/scholarly/search_flow.py`)
   shared with `/search`?
2. **Duplicated URL logic:** `trimUrl`/`linkifyReferences` (TypeScript) and `_trim_url`/`split_links` (Python)
   must agree.
3. **Three caches with different policies:** spelling (`spelling._cache`), aggregator results (`_result_cache`)
   and React Query. Is that coherent?
4. **`useSearchStream`:** a hand-written reducer inside `setState`. Would a real `useReducer` be clearer and safer?
5. **Cold starts:** production runs with min-instances 0. The first request after a quiet spell took about 5 s on
   the API (about 22 s end to end on a slow connection). Setting a minimum instance is a billing decision for the
   owner; please note any code-side start-up cost worth cutting.
6. **Spelling gaps:** a typo that is itself a real word or name ("mobile mony") is not corrected, because ESpell
   has no suggestion. Is a second suggestion source worth it, and what would you use?
7. **Duplicates:** once, the same paper appeared twice with different DOIs (probably preprint and published
   versions). Is the merge in `merged_results` sound?
8. **Flaky tests:** frontend tests that time out under load (`deepResearch.test.tsx`, `editorIsolation.test.tsx`
   hit 5 s once on a busy machine). Should their timeouts be raised, or the tests made lighter?

## 6. How to run

```bash
# backend (from backend/)
.venv/bin/python -m pytest -q
.venv/bin/ruff check app tests alembic scripts && .venv/bin/ruff format --check app tests alembic scripts
.venv/bin/python -m mypy
# frontend (from frontend/)
npx tsc -b --noEmit && npx vitest run && npx vite build
```

**Rules:**
- Do not run anything against production or staging (Cloud Run, Firebase `paperaid` or `paperaid-staging`, Neon).
- Tests use local or embedded databases only.
- No secrets in the repo or in your report.
- AI, Tavily and web search stay off.

## 7. After the audit

Fixes go on a branch `fix/silver-feedback-audit`, with a regression test for each finding, and are answered in
`docs/SILVER_FEEDBACK_AUDIT_RESPONSE.md`. Then they are released to staging, checked in the browser, and released
to production with the owner's approval.
