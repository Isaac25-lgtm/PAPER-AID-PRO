# Response to the Deep Research audit

This responds to [PAPERAID_V2_DEEP_RESEARCH_AUDIT.md](PAPERAID_V2_DEEP_RESEARCH_AUDIT.md), Codex's review of `2d8b8b5`.

**What changed:**
- All 15 findings are fixed, each with regression tests through the real entry point.
- The provider decision (Semantic Scholar) is applied.
- Six of the twelve code-quality items are done and the rest are explained.
- The three maintenance items are done.

**Branch and gates:**
- The work is on branch `fix/deep-research-audit`. It is **not merged and not deployed**: merging, and any release,
  are the maintainer's decision.
- Tavily and AI report writing stay switched off.

## Results

| Check | Before | After |
|---|---|---|
| Backend tests (PostgreSQL) | 345 | **378** passed |
| Frontend tests | 156 | **166** passed (22 files); type-check and build pass |
| Ruff lint and format | pass | pass |
| mypy 2.4.1 | not in CI | **in CI**: 11 modules, no issues |

## Findings

| # | Sev. | Fix | Commit | Entry point checked | Tests |
|---|---|---|---|---|---|
| F01 | High | **The checkbox and the request share one value**, `webChosen` (connected and chosen). It is off while the status is loading or has failed, and off by default. The API's `include_web` now defaults to `false`. | `7271c13` | The Deep Research form at submit (5 states); `POST /research/deep` | `deepResearch.test.tsx` (pending, failed, not connected, chosen, unchecked again); `test_deep_research_audit.py` (field omitted or unchecked makes 0 Tavily calls; chosen but not connected makes none) |
| F02 | Med | A DOI that resolves with nothing beside it gets the verdict **`registered`**, with every field "not checked". A DOI beside a conflicting title is still a mismatch. A DOI with author and year but no title is a likely match. | `8e6ecd2` | `POST /citations/verify` | `test_reference_checker.py` (bare DOI and URL; conflicting title; no title) |
| F03 | Med | List labels (`1.` `12)` `[12]` `(3)`) are removed before comparing. The badge names the real problem ("DOI points to a different work" only for a disagreeing title, otherwise "Wrong year" / "Wrong first author"). | `8e6ecd2` | HTTP and `lib/referenceChecks.ts` | 1, 10, [12] and (3) give identical fields; a wrong year without a DOI; badge unit tests |
| F04 | Med | Registries are asked independently, and each title segment separately. An outage keeps the other registry's match and says which one was unreachable. A Crossref outage on a DOI still tries OpenAlex. If the result is inconclusive because of an outage, the verdict is `error`, never `not_found`. | `8e6ecd2` | `POST /citations/verify` | OpenAlex 429 keeps Crossref; one failing segment; DOI outage in one direction; total outage |
| F05 | Med | **A catalogue miss calls no outside service.** It retries once with words from the catalogue titles the caller may see (another account's private titles are never a hint). `exact=true` is offered. | `1b1aead` | `GET /papers`, signed out and signed in | `test_local_search.py` (registry call count unchanged; private titles never leak; exact) |
| F06 | Med | Any planner failure falls back to searching the question, with an honest `planned_by_ai`, also when the plan cleans to nothing. Any report failure saves the search as `ai_failed`, and cancellation still stops the run. The OpenAI and Gemini adapters now raise application errors for transport problems and malformed bodies. | `7271c13` | `POST` / `GET /research/deep` with history | Planner 429; report `UpstreamError` and a raw `httpx.ConnectError`; empty plan |
| F07 | Med | Web pages are kept only inside the requested years (inclusive). Undated pages are left out when years are set; the number left out is saved (`excluded_by_date`) and shown. | `7271c13` | `POST /research/deep` | 1999, 2015, 2025 and an undated page; a 1999 page never reaches the writer's prompt |
| F08 | Med | The spelling cache key is the query exactly as typed, capitals included. | `1712fdc` | `suggest_correction` | Both arrival orders; a rare correct term is left alone |
| F09 | Med | The library returns the effective query in `X-Matched-Query` (percent-encoded, exposed to the browser) and accepts `exact=true`. Every picker (Research, the editor's sources, `/cite`) and **a new title search on the Library page** show "No title has … Showing …" with "Search exactly". | `1b1aead` | `GET /library` and the picker hook | fetal/metal substitution shown and refusable; typo; paging; `librarySearch.test.tsx` |
| F10 | Med | At most 1,500 characters per reference and 40,000 per request, validated in the schema before rate limiting or any registry call. Each candidate is assessed once. The page names the oversized reference. | `8e6ecd2` | `POST /citations/verify` | Over the limits gives 422 with no registry call; exactly at the limit gives 200 |
| F11 | Med | Checked read-only: production's database (Cloud SQL), files and API are in europe-west4. Staging's API and files are in europe-west4, its queue in europe-west1, and its database is Neon us-east-2 (Ohio). **A staging build now says so**; the production wording is unchanged, so no one re-accepts. | `9267761` | Staging and production builds | `privacyNotice.test.tsx`; the bundles were compared |
| F12 | Low | A closing bracket is kept when it belongs to the DOI; prose punctuation and unbalanced wrapping brackets are removed. | `570bb50` | The parser shared by import, verification and formatting | `test_scholarly_input.py` |
| F13 | Low | An ESpell refusal raises `SpellingUnavailable` and is never cached. Healthy answers expire: "no change" after 1 hour, a correction after 24 hours. | `1712fdc` | `suggest_correction` | 503 then recovery; expiry with a fake clock |
| F14 | Low | The question is whitespace-normalised and must still contain words. This is validated in the schema before any quota or provider call. | `7271c13` | `POST /research/deep` | Spaces, markup and numbers, punctuation give 422 and no history; the shortest valid question passes, normalised |
| F15 | Low | The export writes `DeepResearchOut`, the same fields the page shows, and keeps the `searches` and `at` aliases. | `7271c13` | `GET /me/export` | Every field of the detail response equals the archived JSON |

## Provider decision

**Semantic Scholar** leaves the defaults until it has a key (`8dd8c6b`). It still works when chosen explicitly and for
identifier lookups, where its failures stay visible. The Discover empty-state text was updated, and Deep Research's
status list follows `default_providers()` automatically.

## Code quality (Q1-Q12)

| Q | Status |
|---|---|
| Q6 | **Done** (`8e6ecd2`). Each reference is parsed once (`ParsedReference`) and each candidate assessed once (`assess` returns an `Assessment`). |
| Q2 | **Done** (`1b1aead`). The search and correction policy lives in `services/fuzzy.py` (`search_with_correction`); the routes only supply their count and vocabulary queries. |
| Q4 | **Done** (`7271c13`). The work is split into `make_plan`, `collect`, `read_evidence`, `write_report` and the save step. Each source is paired with its record (`Listed`), so no index bookkeeping remains. |
| Q7 | **Done** with F08 and F13. |
| Q1 | **Done** (`1b1aead`). Passages, library and catalogue use one matcher (`correct_from_vocabulary`, ties broken by frequency). The registry evidence check remains a separate policy. |
| Q3 | **Done** (`0fac7a2`). A finished search waits at most 1.5 s more for spelling, and a correction that finds nothing keeps the typed results. |
| Q10 | **Done** (`4ae4784`). mypy 2.4.1 is pinned and runs in CI on 11 modules. Paper-only evidence consumers narrow `Paper \| WebPage` explicitly. The library and paper routes still have older type errors and join the list later. |
| Q8 | **Done** (`297678b`). `prepare_for_export` returns the rendered tree together with its labels; tested with guidance and a citation inside a table, in Word and PDF. |
| Q11 | **Done** (`1712fdc`). Tests are split into `test_spelling.py`, `test_reference_checker.py`, `test_local_search.py`, `test_scholarly_input.py`, `test_guidance_export.py` and `test_deep_research_audit.py`. |
| Q9 | Not changed. The new behaviour went into `DeepResearch.tsx` and `Library.tsx` without growing new state owners. A split by state ownership is left for when a feature needs it, as the audit advises. |
| Q12 | Not changed. A bare number is still read as a PMID in the explicit identifier tools, which is intended. Mixed search fields (Discover, catalogue, library) do not parse identifiers. |
| Q5 | Not changed. Web and paper citations each have tests in the Deep Research suites. |

## Maintenance

| Item | Change | Commit |
|---|---|---|
| Node versions | CI uses Node 24 for both jobs. The frontend declares `node >=24.15 <25` (Firebase needs 24.12 or later; jsdom needs 24.15 or later on the 24 line). `.nvmrc` is added. Local Node 24.11.1 should be upgraded. | `a01cd06` |
| Credentials in release flags | Provider keys are accepted only through `--update-secrets`; a refused value is never echoed. | `0dd1ce7` |
| CI on fix branches | CI now also runs on `fix/**` branches. | `4d842e4` |

## Decisions left to the maintainer

1. **Merge and release** this branch: staging first, then production. One staging check is still open: a real
   signed-in phone run of the Deep Research form.
2. **Staging consent version:** the staging notice changed but its consent version did not. Every staging account is
   a maintainer test account.
3. **Before Tavily:** add it to the Privacy Notice, bump `POLICY_VERSION`, and do a keyed staging run with year limits
   set (see `docs/DEPLOYMENT.md`).
4. **Before AI writing:** do a keyed staging run covering a provider failure, unsupported claims, quote alignment and
   saved history.
5. **Known limit:** old "SICI" DOIs containing `<` are cut at the `<`. This behaviour is older than this round and
   such DOIs are rare.
