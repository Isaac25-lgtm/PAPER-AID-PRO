# Signed-in browser test, 21 November 2026

**Where:** staging (`https://paperaid-staging.web.app`), in real Chrome, signed in as the staging account
`tester-a`.

**Why:** before AI keys are added, check every function a researcher uses, with input as messy as real users
type it.

**How:**
- Each section was driven through the user interface.
- Where a file would otherwise be downloaded (Word and PDF export, data export), the request was made from the
  page and its type and size checked instead.
- Problems were fixed and re-checked on staging after release.

**Releases tested:**
- Before the fixes: API `paperaid-api-staging-00008`/`00011` (`f212c15`).
- After the fixes: `paperaid-api-staging-00014-nam` (`94a467e`) and the matching frontend.

## Results by section

| Section | What was done | Result |
|---|---|---|
| Sign-in | Email typed with capitals and a trailing space; wrong password | Works (2.6 s to Home); "Incorrect email or password." The first sign-in after an idle period took over 13 s: a staging cold start. |
| Home | Loaded the dashboard | Greeting, continue writing, start something new, library counts, checklist |
| Discover | "school feeding programmes learning outcomes" | 25 relevant results; 5 of 6 databases answered (Semantic Scholar: 429 without key) |
| Discover, typos | "malria preventon in scools" | **Before:** papers containing the typos ("Ocular Toxemia Malria"). **After:** "Showing results for malaria prevention in schools", all results on topic, "Search instead for" offered |
| Discover, AI overview | Clicked "Generate overview" with AI off | **Before:** no reaction, then "not enabled". **After:** not offered |
| Save to library | From Discover | Imported, opened the paper page |
| Paper page | Cite (APA and Vancouver), Retrieve open-access PDF | Citations correct. **Before:** BMJ Open paper "Full text unavailable" (Europe PMC address retired). **After:** 71 passages from 14 pages |
| Add paper | `  https://doi.org/10.1126/science.aah5309  ` (URL form, spaces) | Imported correctly |
| Search inside a paper | "attention heads"; then "atention heds" | **Before:** the typo gave no passages. **After:** two passages, "Showing passages for attention heads" |
| Library | List, filter | **Before:** the filter needed the exact phrase. **After:** words in any order, typos corrected ("atention" finds *Attention Is All You Need*) |
| Documents | New document (manuscript, RCT design), outline, create | Works. Wording "a original" corrected to "an original" |
| Editor | Typed after the template guidance; cited from the library | **Before:** typed text was italic. **After:** plain text, and the guidance stays styled after a reload. Citations "(Locke et al., 2025)", "(Suri & Jack, 2016)", reference list built automatically |
| Editor, AI | "AI assist" with AI off | **Before:** offered "Suggest next sentence". **After:** hidden |
| Export | Word and PDF | `200`; a 38 KB `.docx` and a 53 KB `.pdf` with correct signatures |
| Research (my papers) | Page, paper filter with a typo | Page loads. The filter uses the library search, so it is typo-tolerant after the fix |
| Deep research | "does mobile money improve household savings in east africa"; then "efect of scool feding on atendance in ghana" | The status panel is clear (databases on, AI and web off); 25 sources and a plain "no written report: AI not connected". The misspelled question was searched as "efect of school feding on attendance in ghana": on-topic Ghana school-feeding sources. "efect" was not suggested by ESpell. "feding" was rejected by the stemmed count, and accepted after the exact-count change (verified in tests and by the measured counts) |
| Citation tools | Identifiers: `doi: …`, PubMed URL, arXiv URL, `PMID 27940873`, rubbish | **Before:** "PMID 27940873" not found. **After:** all real ones formatted, the rubbish rejected |
| Reference checker | A real reference; Vaswani with the wrong year; a made-up paper | **Before:** *Attention Is All You Need* reported "Not found". **After:** real → verified; wrong year → "exists, but the reference gets its year wrong"; made-up → not found; a DOI-only reference → likely match |
| Catalog | "mobile money", "mobil mony" | **After:** the typo finds the paper ("Showing results for mobile money") |
| Account | Page; Download my data | Correct; a ZIP of 85 KB. The text now mentions Deep research reports |

## Findings not fixed in code

1. **OpenAlex needs a free API key** (`OPENALEX_API_KEY`). Without one, its small per-IP daily budget runs out (seen
   during this test). Both environments currently have none.
2. **Semantic Scholar needs its free key** (`SEMANTIC_SCHOLAR_API_KEY`): 429 in both environments.
3. **Staging is slow** because its database is in the US and its server in Europe. Recreating the staging Neon
   project in an EU region is the maintainer's decision.
4. **Template wording:** the RCT outline uses clinical section names for any field; they are editable suggestions.
