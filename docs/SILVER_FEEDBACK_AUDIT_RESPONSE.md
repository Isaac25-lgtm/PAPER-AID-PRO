# Response to the Silver-feedback audit (SF01–SF15)

**Branch `fix/silver-feedback-audit`, from the audited head `ae4aee5`.** There is one commit per finding, each with a
regression test at its real entry point. Every regression was run against the unfixed code first and failed there,
except where noted. Nothing was deployed: staging and production are untouched. Hosted AI, embeddings and Tavily
stay off.

Findings record: `docs/PAPERAID_V2_SILVER_FEEDBACK_AUDIT.md`. Backend regressions are in
`backend/tests/test_silver_feedback_audit.py` unless another file is named.

## Findings

| ID | Severity | Fix commit | Cause | Fix | Regression and result |
|---|---|---|---|---|---|
| SF01 | high | `d28d154` | Ingestion and passage search picked an embedder from global settings and never checked who owned the text or who was searching. | A private paper is embedded only if its owner is in the AI cohort (`processing.embedding_allowed`, using the same `ai_allowed_for` as the AI routes); public catalog records may be embedded. `search_evidence(_corrected)` takes a required `use_embeddings`: the passages route passes `ai_allowed_for(user)`, and AI features (behind `AIUser`) pass `True`. Everyone else gets keyword search. DEPLOYMENT.md says so. | `test_sf01_*`: a real upload and passage search through the API, with a recording embedder. A non-pilot user makes **0** embedder calls and keyword hits still return; a pilot user's document and query are embedded. Failed on the old code (the embedder received the chunks). |
| SF02 | medium | `7ec6775` | Both handover directions put the question (and paper IDs) in `?q=` / `?papers=`. | `lib/handover.ts`: an in-memory handover, bound to the account and read once. It is cleared on sign-out or identity change (`auth.tsx`). Nothing goes into the address, history, a reload or a referrer. | `researchHandover.test.tsx` covers both directions through the real pages: the address is exactly `/research` or `/research/deep`, and another account receives nothing. `auth.test.tsx` checks an account switch drops the handover. |
| SF03 | medium | `1677cc3` | PDF text went through fpdf2's markdown parser, whose escaping cannot neutralise `[x](y)`, `--` or `~~`. | PDF export writes literal text segments, each with its own style. Only verified http(s) addresses get an explicit link; this covers the body, tables and references. Link detection (Python and TypeScript) keeps `<…>` inside an address (SICI DOIs) and drops an unbalanced trailing `)`, `>` or `]`. | `test_sf03_*` parses the real PDF annotations and DOCX relationships: bracketed notes, tildes, `--`, `**`, a query string, a SICI DOI and Unicode. The first case raised "Invalid reference to non-existing page 2" on the old code. Shared fixtures run in Python and in `citationLinks.test.tsx`. |
| SF04 | medium | `17130da` | `search_progressively` sent `open_access_only=False` upstream and filtered afterwards. | The flag is passed to every database, as `federated_search` already did. The final filter stays as a guard. | `test_sf04`: a database whose open paper comes back only when asked. Streamed and one-shot results agree, with cold and warm caches. The old stream returned nothing. |
| SF05 | medium | `8b3479f` | The hook kept old results until every former success answered again, and could discard a recovered database's papers. | `useSearchStream` is now a reducer with an attempt ID. While retrying, it shows the server's list plus earlier papers from any database that has not answered again (matched by each paper's `sources`). A former success that fails reads "unavailable, earlier results shown" and can be retried. Late events from a replaced search are ignored. | `discoverStream.test.tsx`: swapped successes on retry, and a stale event after a new search. Both failed on the old hook; the stale-event case was a real bug too. |
| SF06 | medium | `ddb9dbd` | Rate limits counted PaperAid operations only, with no shared pace per service; aligned spelling replacements were uncapped. | `pacing.py`: a token bucket per process for NCBI (3/s, 9/s with a key) and OpenAlex (8/s). Searches wait at most 2 s, then fail as busy; spelling waits at most 0.8 s, then skips. A `Retry-After` blocks the service; waits over 3 s fail at once instead of being slept in a request. Spelling confirms each distinct change once, at most 4 per search, and word counts are cached for a day. Identical cold provider searches share one request. | `test_sf06_*`: fake-clock pacer; five simultaneous searches make **1** request; a typo-heavy query makes at most 2 × 4 counts, with the repeated typo counted once; spelling yields when the allowance is spent and is not cached; a long `Retry-After` fails fast and blocks others. |
| SF07 | medium | `5779d2a` | Identifier resolution collapsed outages and genuine misses into `None`, and the stream sent no statuses. | `resolve_identifier_reporting` returns each registry's outcome (found, no record, unreachable). Both routes send these. Discover says "The registries could not be reached", "Not found yet" (naming who answered and who could not) or "No registry has a record". The first two offer Retry. | `test_sf07`: all down, partial, all miss, and found, through both routes. `discoverStream.test.tsx`: the three wordings and Retry. |
| SF08 | medium | `2734d8a` | The handover saved sources one by one and stopped at the first failure without reporting what was saved; navigation was not tied to the view still being open. | Each source's outcome is kept and the loop continues past failures. The library is refreshed after any save. The page shows "Saved N of M", each failure and its reason, "Continue with the N saved", and "Retry the K that failed" (no repeat saves). A late finish after leaving never navigates. | `researchHandover.test.tsx`: partial success then retry (`/library` posted once); continue with the saved set; leaving mid-transfer. All three failed on the old page. |
| SF09 | medium | `0f39855` | The website release published whatever the local build compiled in; nothing checked the artifact against its target. | `vite.config.ts` stamps `build-info.json` (commit, mode, API origin, Firebase project and auth domain). `deploy/frontend_preflight.py` checks the env file, the stamp and commit, the compiled bundle (target values present, other environment's absent), the Hosting CSP, and (production) a clean tree. `deploy/deploy-frontend.sh` (`DEPLOY_ENV`) and the staging script run it before `firebase deploy`. | `backend/tests/test_frontend_preflight.py`: correct builds pass for both targets; refused are a production build with staging settings compiled in, a wrong mode, a wrong commit, a CSP for the other site, and an unstamped build. Also checked by hand: a real production-mode build with synthetic staging values was refused with 6 specific problems. |
| SF10 | medium | `8a8be54` | The hook only finished on a `done` event or an error, so a clean end of the body without `done` left it searching. | The end of the body, a cut-off line, or an empty body finishes the search. Papers received are kept, databases still searching become retryable failures, and Discover says the search stopped (with Retry). Raw parser errors are never shown, and "No results" is never claimed after an interruption. An intentional abort stays silent. | `discoverStream.test.tsx`: end of body after one result; a cut-off body; a replaced search. The first two failed on the old hook. |
| SF11 | low | `b11c10a` | The popover trusted a 30-second citation cache that the insert paths never updated, and had no error state for a paper fetch. | `rememberCitation` puts each new citation into the cache from all three insert paths (cite palette, Sources panel, PDF quote). A missing ID triggers one refresh before "no longer available". A failed fetch offers Retry; a 404/403 paper is said to be gone. | `citationLinks.test.tsx`: a stale pre-insert cache; the insert helper (no extra request); failed versus missing paper. All four failed on the old popover. |
| SF12 | low | `f01cd89` | The search box used the free-text extractor, so any input containing a DOI became a lookup. | `exact_identifier` needs the whole input to be the identifier: optionally labelled, written as its link, or wrapped in quotes or brackets. `parse_identifier`, used for imports and reference lists, is unchanged. | `test_sf12`: a sentence containing a DOI is a keyword search through both routes; 7 identifier forms stay exact; years and embedded tokens do not. |
| SF13 | low | `71ca494` | The source panel opened only from a mouse click, and was flipped only if the whole panel fitted above. | The citation node owns an Enter shortcut (open the source instead of replacing the citation). The panel takes focus when opened by keyboard; Escape or Close returns focus to the editor. It opens on the side with more room and scrolls within a window-bounded height. | `citationLinks.test.tsx` with a real TipTap editor: Enter on a selected citation opens it and leaves the document unchanged; Enter elsewhere still splits; focus, Tab and Escape; a short viewport. All three failed on the old code. |
| SF14 | low | `7733839` | The route announced the requested providers before unavailable ones were filtered out, and no event closed them. | `_provider_list` returns (runnable, not configured) once. Only runnable databases are announced; skipped ones get an `ok:false` "not configured" status in both routes. Discover labels them and does not offer Retry. | `test_sf14`: CORE alone and mixed, through both routes. `discoverStream.test.tsx` covers the label and the absent Retry. |
| SF15 | low | `36f5a6d` | A single-word ESpell refusal became "no suggestion", and the answer was cached as healthy. | `_suggest` reports whether every upstream answer it used was healthy: the whole-query ESpell, each recheck, each count. An incomplete answer is used for that search but never cached. | `test_spelling.py`: refusal, then a partial correction, then recovery, all for the same query; the next request corrects fully. A failed count leaves nothing cached. |

**Stream lifecycle** (from the report's lifecycle section; not a numbered finding): `ecb887d`.
- `search_progressively` now joins cancelled tasks instead of only signalling them.
- A shared upstream request counts how many searches are waiting on it. When the last one leaves, it is cancelled and finishes before returning. Testing this exposed that the SF06 shielding would otherwise have left it running until its 12 s timeout.
- `/search` cancels its spelling task in a `finally`.

## Verification (25 November 2026, local)

| Check | Result |
|---|---|
| Backend suite (embedded PostgreSQL) | **407 passed** (386 at the audit + 21 new regressions), 7 live deselected, 0 failed |
| Frontend | `tsc` clean; **203 passed** (26 files); `vite build` passes; frontend preflight passes for production |
| Backend static | ruff, format (102 files) and mypy (11-file baseline) all clean |
| `pip-audit` (requirements, `--no-deps`) | no known vulnerabilities |
| `npm audit` (citation engine) | **0 vulnerabilities** |
| `npm audit` (frontend, `--omit=dev`) | **0 vulnerabilities** (the first attempt hit the same endpoint error as the audit; the retry succeeded) |
| Live scholarly checks (`-m live`, public registries only) | **6 of 7 passed**. The seventh failed on this PC's DNS: `getaddrinfo failed` for `www.ebi.ac.uk` (Europe PMC). In an earlier run, Crossref and arXiv were also unreachable straight from `curl`, and they passed on the re-run; nothing in that path is paced by SF06. |
| CI including the container job | after push; see below |

## Remaining blockers (owner)

1. **Alerting:** confirm an uptime alert actually reaches its owner.
2. **Restore evidence:** rehearse restoring the database plus a representative private PDF in isolation, and record
   the measured recovery time and data-loss window.
3. **Provider spend limits:** set a provider-side spend ceiling before any AI pilot. Embeddings and Tavily keep their
   own activation gates; SF01 is now in place for embeddings, but the privacy notice must describe indexing before
   they are enabled.
4. **Capacity:** run a small concurrency test on staging measuring database pool wait, time to first result and
   provider refusals. Pacing is per instance (`pacing.py`); a pace shared across instances would need a shared store.

## Staging acceptance checklist (for the owner to authorise)

- [ ] Ask my papers to Deep research and back. The address bar never shows the question or paper IDs. Sign out and
      in as another tester: nothing carries over.
- [ ] A handover where one source cannot be imported shows "Saved N of M", and Continue/Retry both work.
- [ ] Discover with "Open access only": streamed results match the one-shot search for the same query.
- [ ] Retry after a database failure keeps earlier papers, and a recovered database adds its own.
- [ ] Look up a DOI and a PMID; a question that mentions a DOI searches as words.
- [ ] In a draft, select a citation with the keyboard, press Enter, Tab to "Open paper", then Escape to resume.
- [ ] Download Word and PDF for a draft whose references include brackets, `--` and a long DOI. Both open, the text
      is literal and the DOI is clickable.
- [ ] Frontend release on staging: `DEPLOY_ENV=staging deploy/deploy-frontend.sh` passes the preflight.
- [ ] A small concurrency run (pool wait, first-result latency, provider 429s).

Release approval (staging, then production) stays with the owner.
