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

## Verification

- Backend: 385 passed. ruff and mypy clean.
- Frontend: 179 passed. `tsc` and `vite build` clean.
- CI green on the branch.

## Still open

- Items 3 and 5 (autocomplete) need an AI key.
- Seen once, not yet reproduced: the same paper listed twice with different DOIs (probably preprint and published
  versions), and the staging editor stuck on "Loading…".
