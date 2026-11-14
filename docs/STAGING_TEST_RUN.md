# Signed-in staging run (2026-11-14)

The signed-in scenarios that the hardening audit could not cover in unit tests, run in a real browser against the
isolated staging environment (https://paperaid-staging.web.app, API `paperaid-api-staging`, Neon database, staging
bucket and queue). Test accounts only (`*@staging.paperaid.test`); production was not touched.

## Results

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Sign-in and first consent | Pass | Consent screen shown; accepted; dashboard loads. |
| 2 | Draft redaction in "Find a source" (audit H1 / hardening #1) | Pass | Network capture: opening from a draft selection sent **no** `/discovery/search`; editing the query sent none; "Search all sources" sent only the edited text (`q=mobile money household savings`); a further edit sent nothing. |
| 3 | Unsaved work during re-consent (hardening #2) | Pass | Policy version withdrawn in the staging DB while the editor had unsaved text. Autosave got 403, the consent overlay opened, and the editor stayed mounted (`inert`) with the text. After accepting, the pending save went out by itself (PATCH 200, "Saved"). |
| 4 | PDF: import, retrieve full text, quote and cite | Pass | arXiv:1706.03762 imported; Cloud Tasks (OIDC) → worker → arXiv → staging bucket → extraction, ready in under 20 s. Quote and cite inserted `“Attention Is All You Need” (Vaswani et al., 2017, p. 1)` at the bookmarked position. |
| 5 | Word and PDF export | Pass | `.docx` 37.7 KB and `.pdf` 51 KB with correct names and types. A PDF export requested while the Word export was still running was refused with "Another export or restore is still running" (exclusive gate, hardening #4). |
| 6 | Account closure racing an upload (hardening #3) | Pass | 9 MB upload started in one tab and the account deleted in another: `DELETE /me` 204, the upload refused ("This account has been closed"). Afterwards: no user row, no papers, closure completed in 3 s with empty `pending_keys`, nothing in `storage_deletions`, no objects left in the bucket for the account (an earlier completed upload was deleted too). |
| — | Anchor-lost guard (hardening #5) | Pass | Citation chosen after its target paragraph had been replaced: refused with a clear message; nothing inserted or imported. |
| — | Restore a version | Pass | Restored v1; the previous state was kept as "before restore". |
| — | PDF picker shows only papers with a PDF (hardening #12) | Pass | |

## Bugs found and fixed (frontend, with tests)

1. **"Find a source" left the keyboard in the draft.** The palette focused its search box while still
   `visibility: hidden` (browsers refuse that; jsdom does not), so focus stayed in the editor **with the passage still
   selected**. Typing to refine the search would replace the writer's text. Now the box is focused once the palette
   is placed and visible. Test: focus happens exactly once, after the palette is visible (fails on the old code).
2. **Paper page showed "Save to library" for a saved paper after a reload.** Public pages fired their first request
   before Firebase had restored the saved session, so it went out anonymously (`in_library: false`), and the button
   kept its first value. The API client now waits for `auth.authStateReady()` before deciding whether a request is
   signed in (fixes this race for every public page), and the button follows the server's value. Tests for both.
3. **Quote inserted with no space after the preceding text** (`evidence.“Attention…”`). Insertions now add a space
   when they follow a word or punctuation (not after a space, an opening bracket or quote, or at a paragraph start).

All 108 frontend tests pass; the fixed build is deployed to staging and re-verified there.

## Notes, not fixed

- **Staging has no `CONTACT_EMAIL`**, so it never asks Unpaywall for open-access PDFs (production does). For the
  PLOS paper (10.1371/journal.pmed.0020124) the only candidate was Europe PMC's PDF renderer, which refused (403
  from Cloud Run, 520 from elsewhere). Setting `CONTACT_EMAIL` on staging is the maintainer's decision, since the
  address is sent to Unpaywall, Crossref and OpenAlex.
- While the consent overlay is open, the editor retries its failed save every ~10 s (each a 403 plus a profile
  reload). Harmless and bounded, but it could pause retries until consent is given.
- The first Cloud Tasks delivery of a new job can get a 503 "retry" before the job row is visible; the next delivery
  (≈2–5 s later) runs it. Expected behaviour.
- `tester-b` was deleted by scenario 6 (its Firebase identity too). Recreate it to repeat that scenario.
- The Restore and delete-upload confirmations use the browser's native `confirm()`; automation cannot click those, so
  a future in-app dialog would make them testable end to end.
