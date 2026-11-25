# Response to Silver's feedback (25 November 2026)

Branch `fix/silver-feedback`. Commits: `015fd7e` (search), `2aaa9b1` (navigation), `08d96b0` and `d02edf5` (citations),
`af8f5d7` (documents). Each item below says what changed, where, and how it is tested.

## A. Spelling correction notice

Kept as it was. "Search instead for …" re-runs the exact words typed with correction switched off (verified in the
browser before the changes and covered by `discoverStream.test.tsx`).

## 1. Search reliability and speed

**What changed**
- Results arrive **as each database answers**. `GET /api/v1/discovery/search/stream` sends NDJSON events: `query`
  (the query used, any correction), `results` once per database (merged list so far plus that database's status and
  the ones still `pending`), `suggestion` (exact mode), `done`. Discover shows a chip per database: "searching…",
  "N results" or "unavailable".
- **A failed database never hides the others.** "Retry unavailable" re-runs the same search. Each database's answer is
  cached for 5 minutes (`aggregator.RESULT_CACHE_SECONDS`), so the retry only waits for the databases that failed.
- **Identifiers are exact.** A DOI, PMID (at least 6 digits when bare), PMCID or arXiv ID is looked up directly
  (`identifiers.exact_identifier`). It is never spell-corrected and never searched as free text. The page says
  "Looked up PubMed ID … exactly".
- The spelling check waits up to 3 s. If it is slow the search goes ahead with the words as typed. If a correction finds
  nothing, the typed query is used instead.

**Queries tested** (backend `test_search_stream.py`, 6 tests; frontend `discoverStream.test.tsx`, 4 tests; plus the
browser):

| Query | Behaviour |
|---|---|
| Correctly spelled ("mobile money savings") | No correction; results stream in per database |
| Misspelled ("malria vacine") | Corrected to "malaria vaccine", with "Search instead for …" |
| Ambiguous or rare real word | Kept as typed unless the correction has at least 50× more matching papers |
| DOI `10.1126/science.aah5309` | Exact lookup, single result, no databases queried |
| A PubMed ID (6+ digits, or "PMID: …") | Exact lookup; short numbers like "2016" are treated as words |
| One database down | Other results shown; that chip says "unavailable"; Retry re-asks only the failed one |

**Code:** `backend/app/api/routes/discovery.py`, `services/scholarly/aggregator.py` (`search_progressively`, result
cache), `services/scholarly/identifiers.py`, `frontend/src/lib/searchStream.ts`, `frontend/src/lib/api.ts`
(`api.stream`), `frontend/src/pages/Discover.tsx`.

## 2. Research navigation

**The three areas, explained**
- **Research: Ask my papers.** Answers a question using only papers in your library, quoting the passages.
- **Research: Deep research.** Searches the scholarly databases (web search optional, off for now) for new sources and
  writes a report on what it found.
- **Find papers** (was Discover and Catalog). "All databases" searches the external indexes. "Already in PaperAid"
  browses papers anyone has already brought into PaperAid.

**Sidebar now:** Home · Library · Documents · **Research** › Ask my papers, Deep research · **Find papers** (tabs: All
databases | Already in PaperAid) · Citations.

**Handover between modes**
- Ask my papers → "Search further with Deep research" opens Deep research with the same question.
- Deep research → "Ask my papers about these sources" adds the report's scholarly sources to the library (importing
  any not yet in PaperAid, up to 8), then opens Ask my papers with the question and those papers selected.
- Links: `/research?q=…&papers=id1,id2` and `/research/deep?q=…`.

**Code:** `components/Workspace.tsx`, `components/FindPapersTabs.tsx`, `pages/Research.tsx`, `pages/DeepResearch.tsx`.
**Tests:** `workspace.test.tsx`, `deepResearch.test.tsx`, `researchHandover.test.tsx`.

## 3. Research accuracy demo

**Not done: it needs an AI key.** AI answers are switched off until one is added. Without AI, PaperAid shows "AI not
connected" and never a made-up answer. The next step is to turn AI on for staging only, run the demo there, and keep
production off.

## 4. Citations

- **Clicking an in-text citation** in the editor opens "Cited source". It shows each cited paper's title, authors,
  year and page or locator, with **Open paper** and **Open DOI** links, both opening in a new tab. Escape or a click
  outside closes it. (`components/editor/CitationPopover.tsx`, `pages/Editor.tsx`.)
- **DOI and web addresses in reference lists** are links that open in a new tab. This covers the editor's reference
  list, Citation tools and the Cite dialog (`lib/format.ts` `linkifyReferences`). A full stop or comma after an address
  stays outside the link; a bracket that is part of the address stays in it. Only http(s) addresses are linked.
- **Word and PDF exports:** addresses in the References section are clickable links (`services/export.py`
  `split_links`).

**Tests:** `citationLinks.test.tsx` (3), `test_guidance_export.py::test_reference_addresses_are_links_in_word_and_pdf`.

## 5. Writing without the template; autocomplete

- **Blank document** is the first choice in New document and the first card on Home under "Start something new". It
  is created straight away as an empty page: no objectives, outline or guidance.
- The outline step has **"Include writing guidance under each heading"**, on by default. Turned off, you get the
  headings alone (`lib/templates.ts` `guidedContent({ guidance })`).
- Home "Start something new" also offers Report, so the cards fill the grid evenly.
- **Autocomplete** (grey suggestions; Tab accepts, Esc dismisses) is built but needs the AI key, like item 3.

**Tests:** `blankDocument.test.tsx` (4), `workspace.test.tsx`.

## Staging check (25 November 2026)

Released to staging: API `paperaid-api-staging-00026-xax` (`c018f5a`), frontend `de59dec`. Checked in the browser:

- **Search:** each database's chip changed from "searching…" to its result count as it answered. Europe PMC was
  down for part of the check (its own API returned 503 or took over 26 s). The page marked it "unavailable", kept the
  other four databases' results and offered "Retry unavailable".
  - Fixed after the check: the retry used to clear the results and set every database back to "searching". Now
    the results stay and only the failed database searches again (`de59dec`, test in `discoverStream.test.tsx`).
- **Typos on the live API:** "malria vacine", "educaton policy", "climte change adaptation", "teacher motivaton" and
  "povrty reduction" were all corrected.
  - "mobile mony" was not corrected. PubMed's speller, our suggestion source, has no suggestion for "mony",
    probably because "Mony" is a real name. A typo that is itself a real word or name needs a second suggestion
    source (a general English word list); not done yet.
- **Identifiers:** a DOI and "PMID: …" each returned exactly one record, and no database was searched.
- **Citations:** clicking "(Vaswani et al., 2017, p. 1)" showed the paper with Open paper and Open DOI (new tab). The
  reference list's DOI is a new-tab link.
  - Fixed after the check: in a short window the box ran off the bottom; it now opens above the citation when there
    is no room. The page reads "p. 1" instead of a bare "1" (`24b76d3`).
- **Documents and navigation:** Blank document is first in New document and on Home, and creates directly. The outline
  step shows the guidance switch (on by default). The sidebar reads Research › Ask my papers, Deep research ·
  Find papers. The Find papers tabs are "All databases" and "Already in PaperAid".

## Production browser run (25 November 2026)

Every item was run again in the browser on production (paperaid.web.app, signed in) and passed. Five problems
the run found were fixed and released (API `paperaid-api-00042-wom`, commit `ea5e7db`, plus the website):

- **"malria vacine in children" was not corrected.** For that phrase PubMed's speller suggests "malaria vac n in
  children", and the split word made the whole suggestion unusable. Words the speller merges or splits are now
  checked one at a time (at most 3), then confirmed against OpenAlex as before. The query now corrects to "malaria
  vaccine in children", as does "povrty and fod insecurity in rural househlds".
- **Reference-list DOIs worked but looked like plain text** (the CSS reset removed link styling). They now show as
  links (`.reference-link`): in the editor, Citation tools and the Cite dialog.
- **The identifier note repeated its label:** "PubMed ID PMID: 27940873" and "DOI https://doi.org/…". It now shows
  the bare identifier.
- **The first load of a draft could sit on "Loading…" for a long time.** Measured: about 22 s after a deploy, about
  5 s warm. Causes:
  - an API cold start (production keeps no idle instance);
  - this PC's slow connection (8 s just to connect to Google);
  - the page's code waiting for sign-in to finish.

  The code now downloads alongside sign-in. Cold starts remain until a minimum instance is set, which is a billing
  decision.
- **Retry used to clear results.** This was fixed before the run and confirmed live: during a retry the results
  stay and only Europe PMC searches again.

Europe PMC was down for most of the run: its own API returned 503 or timed out. PaperAid marked it "unavailable",
showed the other databases' results at once, and offered Retry.

## Verification

- Backend: 385 passed. ruff and mypy clean.
- Frontend: 180 passed. `tsc` and `vite build` clean.
- CI green on the branch.

## Still open

- Items 3 and 5 (autocomplete) need an AI key.
- A typo that is itself a real word or name ("mony") is not corrected (see the staging check).
- Production: released 25 November 2026 as `paperaid-api-00039-kof` (`6a9633b`), with the website. Checked live: `/ready`, an exact DOI lookup, a corrected typo, and all five databases answering.
- Seen once, not yet reproduced: the same paper listed twice with different DOIs (probably preprint and published
  versions), and the staging editor stuck on "Loading…".
