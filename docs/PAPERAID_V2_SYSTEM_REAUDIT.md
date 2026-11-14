# PaperAid Pro system re-audit

14 November 2026. Reviewed `6db03b0` on `main`, including the fixes in `b7332a6`, writing tools in `611c569`, Graphite and Night mode in `d46312e`, and the landing demo added while this review was in progress. The earlier audit contains the original app inventory. This review traces the changed flows across frontend, API, data, storage and release tooling, and rechecks the earlier findings at their normal entry points. The repository and GitHub CI are the evidence for this snapshot. The handoff reports the deployed backend as `paperaid-api-00012-zor`, schema `e5f3a8c1d927`. Live state and a signed-in production browser session were outside this review.

The release fixes materially improved owner-scoped exports, storage write isolation and revision promotion. Three current findings warrant attention before expanding the beta. Two affect the new non-AI editor workflow and one affects development environments sharing the production Firebase identity namespace. Keep live AI disabled pending an explicit opt-in and claim-level citation work.

## Findings

### [SEVERITY: high] Find a source forwards unpublished draft text to scholarly providers

- **Where:** [Editor.tsx:566](../frontend/src/pages/Editor.tsx#L566), [CitePalette.tsx:38](../frontend/src/components/editor/CitePalette.tsx#L38), [CitePalette.tsx:64](../frontend/src/components/editor/CitePalette.tsx#L64), [discovery.py:65](../backend/app/api/routes/discovery.py#L65), [Static.tsx:83](../frontend/src/pages/Static.tsx#L83).
- **What:** The selection action automatically uses up to the first 14 words or 200 characters of the selected draft as a federated search query.
- **Impact / failure scenario:** A researcher selects an unpublished sentence with identifying or confidential details and clicks “Find a source.” Opening the palette immediately submits the prefilled wording to `/discovery/search`, which passes it to the configured scholarly providers. This works with AI disabled. The Privacy Notice says scholarly providers never receive documents. Part of the draft is sent in this workflow without a separate review or submission step.
- **Evidence:** A focused Vitest check using the real `CitePalette` and a mocked API captured the outbound `q` before any input, submit or result selection. The API assigns the query to `federated_search` and configured provider adapters.
- **Fix:** Search the private library by default. Make sending an edited query to external indexes an explicit action and explain its destination before submitting. Add a test that the selection action makes only an internal search until the user confirms the external query.

### [SEVERITY: high] Quote and cite can attach the wrong page or paper to selected words

- **Where:** [PdfPanel.tsx:115](../frontend/src/components/editor/PdfPanel.tsx#L115), [PdfPanel.tsx:129](../frontend/src/components/editor/PdfPanel.tsx#L129), [PdfPanel.tsx:173](../frontend/src/components/editor/PdfPanel.tsx#L173).
- **What:** The mutation sends a paper and page, then reads the current PDF selection and draft cursor when the response arrives.
- **Impact / failure scenario:** Click “Quote and cite” on page 1, select different words on page 2 before the request finishes, and the draft receives the words from page 2 with the citation created for page 1. Changing paper or clearing the selection can also change the eventual output. A cross-page selection is independently labelled with the anchor page alone.
- **Evidence:** A focused Vitest check mounted the real panel and TipTap editor with a mocked two-page text layer and deferred API response. The captured POST cited page `1`, while the draft contained page `2` text beside that citation ID. The browser selection code inspects only `anchorNode` for page attribution. No external PDFs or sources were used in the test.
- **Fix:** Snapshot the paper, selected words, start and end pages, locator and mapped insertion target as mutation variables. Insert quote and citation atomically in one editor transaction. Reject ambiguous selections or support an accurate page range. Test selection and paper changes while a citation is in flight, reverse selections and save/export after insertion.

### [SEVERITY: high] Local account deletion can target the production Firebase identity

- **Where:** [README.md:65](../README.md#L65), [frontend/.env.development:4](../frontend/.env.development#L4), [config.py:35](../backend/app/config.py#L35), [identity.py:23](../backend/app/services/identity.py#L23), [accounts.py:126](../backend/app/services/accounts.py#L126).
- **What:** The documented local workflow uses the production Firebase project, and the account service uses that configured project for destructive identity administration regardless of the database environment.
- **Impact / failure scenario:** A developer signs into a local database with an actual PaperAid identity and tests account closure. If their Application Default Credentials can administer production Firebase, the external deletion is for the production identity even though the account rows being deleted belong to the local database. Production work could become inaccessible through its original sign-in. This is conditional on the developer's credentials. No identity deletion was attempted.
- **Evidence:** The development frontend and default API configuration use project `paperaid`. The server builds the Identity Toolkit deletion path from `firebase_project_id` and authorizes it with ADC. The local launcher changes `ENV` and database setup without isolating identity administration. The test fixture uses a separate project and mocks identity deletion, so these tests do not cover the documented development defaults.
- **Fix:** Use the Firebase emulator or a dedicated development project and fail closed on identity deletion outside the environment that owns that project. Add a test of the development configuration that verifies closure never calls the production identity provider.

### [SEVERITY: medium] Rewriting can move citations to a different claim or remove them

- **Where:** [SelectionMenu.tsx:37](../frontend/src/components/editor/SelectionMenu.tsx#L37), [SelectionMenu.tsx:133](../frontend/src/components/editor/SelectionMenu.tsx#L133), [Editor.tsx:165](../frontend/src/pages/Editor.tsx#L165), [Editor.tsx:203](../frontend/src/pages/Editor.tsx#L203).
- **What:** The selection rewrite appends all citation nodes at the end of the replacement. The toolbar's separate rewrite path replaces the selection with plain text.
- **Impact / failure scenario:** Rewriting two distinct supported claims can leave both citations beside the final claim, with the first claim uncited. The toolbar rewrite can remove selected citation nodes altogether and can apply an earlier result to a subsequently changed selection. This affects the AI-enabled editor.
- **Evidence:** A focused Vitest check passed two distinct citation nodes through `withCitations` and both appeared after the second sentence. The toolbar directly inserts `result.text` over the current range. Existing one-citation and stale-selection tests cover the new selection menu only.
- **Fix:** Share one rewrite application path. Keep unambiguous placeholders anchored to their owning spans, reject proposals with missing or reordered anchors, and preserve structure and marks where safe. Add distinct-citation, multiple-paragraph and changed-selection tests for both entry points.

### [SEVERITY: medium] Enabling the AI provider starts default-on drafting requests for all eligible accounts

- **Where:** [Editor.tsx:260](../frontend/src/pages/Editor.tsx#L260), [useAutocomplete.ts:45](../frontend/src/components/editor/useAutocomplete.ts#L45), [system.py:247](../backend/app/api/routes/system.py#L247), [tools.py:274](../backend/app/api/routes/tools.py#L274), [features.py:368](../backend/app/services/ai/features.py#L368), [Static.tsx:107](../frontend/src/pages/Static.tsx#L107).
- **What:** AI availability is global. The editor defaults suggestions to on for users with no saved preference, and initiates provider calls on a qualifying typing pause.
- **Impact / failure scenario:** Adding a live provider key for an intended pilot enables automatic requests for every verified, consenting invitee with suggestions enabled by default. The provider receives draft context and the document title without an explicit enable action for suggestions. The notice describes AI as used only when asked and describes selected text, questions and excerpts. Closing or aborting the browser request does not guarantee the API or provider stops work already in progress.
- **Evidence:** `/ai/status` reports service-level settings, `/ai/complete` uses ordinary `VerifiedUser` and checks ownership, and the hook posts up to 6,000 trailing characters automatically. `continue_text` sends up to 4,000 characters plus document type and title. Production AI is reported off, so actual provider traffic from this feature was not observed.
- **Fix:** Require a server-enforced pilot cohort and explicit autocomplete opt-in, describe transmitted data and validate provider handling before enabling live keys. Add separate feature and usage controls for autocomplete, rewrite and grounded research.

### [SEVERITY: medium] Pending account deletion is presented as finished, without a guaranteed retry schedule

- **Where:** [accounts.py:122](../backend/app/services/accounts.py#L122), [accounts.py:159](../backend/app/services/accounts.py#L159), [system.py:227](../backend/app/api/routes/system.py#L227), [DataRights.tsx:42](../frontend/src/components/DataRights.tsx#L42), [DEPLOYMENT.md:65](DEPLOYMENT.md#L65).
- **What:** A durable request and retry path exist, but the browser discards the HTTP 202 status message, and the runbook says scheduled maintenance is pending.
- **Impact / failure scenario:** Identity deletion times out. The API returns 202 and locks the account. The UI signs the user out and navigates home exactly as it does for 204. If no service starts and no admin triggers maintenance, the retry can wait indefinitely. The service also marks closure complete before object cleanup. Storage errors can leave queued PDFs while the endpoint returns 204.
- **Evidence:** The UI accepts every successful mutation without inspecting its body. Startup maintenance is once per instance. `_finish_closure` commits `completed_at` before awaiting object deletion, and storage delete failures are recorded for a later attempt without making the result pending.
- **Fix:** Wire and monitor periodic maintenance before promising automatic completion. Distinguish account lock, database cleanup and file cleanup in the state and UI. Test an interrupted closure from request through browser receipt and final completion, including object-store failure.

### [SEVERITY: medium] Editor changes can slip into a frozen export or restore

- **Where:** [Editor.tsx:111](../frontend/src/pages/Editor.tsx#L111), [Editor.tsx:403](../frontend/src/pages/Editor.tsx#L403), [Editor.tsx:550](../frontend/src/pages/Editor.tsx#L550), [PdfPanel.tsx:134](../frontend/src/components/editor/PdfPanel.tsx#L134).
- **What:** Export and restore disable ordinary typing and selected controls, but side-panel citation mutations and editor toolbar commands can still call ProseMirror commands. Pending mutations do not share the freeze state.
- **Impact / failure scenario:** Start a source citation and then an export or restore while the citation is in flight. It can insert after the save queue drains or during a restore. The downloaded document misses the visible edit, or restore replaces it. Export's single `busy` flag also does not serialize independent operations.
- **Evidence:** `frozen` sets `editor.setEditable(false)` and `busy`, then flushes. The sources and PDF panels remain mounted and their `onSuccess` handlers issue `insertContent` or `insertContentAt` without checking `busy`. TipTap editability restricts interactive input and does not block those commands.
- **Fix:** Route every mutating command through the same operation gate and drain or invalidate pending inserts before export or restore. Test a delayed citation response after the final save and a toolbar action during a frozen operation.

### [SEVERITY: medium] Late citation-render responses can overwrite newer previews

- **Where:** [Editor.tsx:318](../frontend/src/pages/Editor.tsx#L318), [Editor.tsx:330](../frontend/src/pages/Editor.tsx#L330), [citationLabels.ts:20](../frontend/src/lib/citationLabels.ts#L20).
- **What:** Citation renders run alongside later saves and can finish out of sequence. The bibliography is set before the result's applicability is checked, and the label check compares only the citation-ID sequence.
- **Impact / failure scenario:** Change style while a prior render is pending. The later result can be replaced by the old bibliography and inline labels even when Word/PDF would render the newly saved style. A stale bibliography can also appear when cluster matching correctly refuses stale labels.
- **Evidence:** `refreshCitations` calls `setRendered` unconditionally on response. `applyCitationLabels` compares only node IDs by occurrence and has no version, generation or style check.
- **Fix:** Bind render responses to a saved version/style and publish bibliography and labels together only for the latest valid response. Test out-of-order responses where the style changes with identical citation IDs.

### [SEVERITY: medium] Check against my sources silently checks a subset of the selected material

- **Where:** [Editor.tsx:215](../frontend/src/pages/Editor.tsx#L215), [documents.py:142](../backend/app/api/routes/documents.py#L142), [features.py:73](../backend/app/services/ai/features.py#L73), [features.py:196](../backend/app/services/ai/features.py#L196).
- **What:** The UI truncates selected text to 2,000 characters and the endpoint checks only up to 30 recently added document or library sources. It does not report which sources were considered or excluded.
- **Impact / failure scenario:** The strongest contradictory passage is from the thirty-first source, or the last sentence of the selection is cut off. The user reads a reassuring result labelled as a check against the document's sources. A stale source link can also occupy a slot before visibility filtering. Conversely, `gather_evidence(limit=12)` can append up to four leading chunks per uncovered ready paper, so the cap does not bound provider context.
- **Evidence:** Both limits are applied before the response states its coverage. The evidence builder adds `leading_chunks(..., 4)` for every uncovered ready source after the top results, with no final total cap.
- **Fix:** Reject or clearly preview overlong selections. Allow explicit source selection and report the scope examined, skipped sources and retrieval limits. Enforce a global evidence budget and test a large mixed library plus a source that would previously be cut off.

### [SEVERITY: medium] Grounding still presents highlights at source level rather than claim level

- **Where:** [grounding.py:293](../backend/app/services/ai/grounding.py#L293), [grounding.py:322](../backend/app/services/ai/grounding.py#L322), [grounding.py:397](../backend/app/services/ai/grounding.py#L397), [GroundedAnswerView.tsx:130](../frontend/src/components/GroundedAnswerView.tsx#L130).
- **What:** Validation now aligns quotes per claim and returns UTF-16 positions, but response markers identify the source only. The UI renders aggregated highlights and drops any later span that overlaps an earlier one.
- **Impact / failure scenario:** Two findings cite the same passage, and their quotes overlap partially. Clicking either marker opens the same excerpt. The non-overlapping tail of the second quote is unhighlighted, and the reader cannot tell which quote supports the clicked claim. Older stored answers also have no explicit offset conversion path before using browser slicing.
- **Evidence:** `citation_payload` aggregates claims' spans by evidence key. `HighlightedExcerpt` discards a span whenever `span.start < cursor` and directly slices with stored offsets. This differs from the existing test cases for separate spans and newly generated UTF-16 offsets.
- **Fix:** Return stable claim and quote IDs and use them to select the exact support for the clicked statement. Union overlapping spans for an all-source view, and version or convert historical offsets. Test overlapping spans, repeat sources and stored legacy payloads.

### [SEVERITY: medium] The Account ZIP can hold a database connection across all file downloads

- **Where:** [accounts.py:201](../backend/app/services/accounts.py#L201), [accounts.py:307](../backend/app/services/accounts.py#L307), [accounts.py:386](../backend/app/services/accounts.py#L386), [system.py:202](../backend/app/api/routes/system.py#L202), [storage.py:136](../backend/app/services/storage.py#L136).
- **What:** The request builds the entire archive before responding. It keeps a SQL transaction open during sequential full-file reads and has no per-account export throttle or concurrency cap.
- **Impact / failure scenario:** A few users with many PDFs download their data at once. Slow storage reads occupy the small API database pool while full-file reads and synchronous ZIP/DOCX work consume memory and event-loop time. A document-rendering failure aborts the entire archive rather than adding the missing file to its manifest. The 64 MB spool threshold only controls ZIP buffering.
- **Evidence:** The owned-paper query opens the transaction immediately before the storage loop. The first possible explicit transaction release within the archive builder is inside `render_citations`, after all PDFs. The endpoint builds the ZIP before returning `StreamingResponse`.
- **Fix:** Snapshot owner-scoped metadata in a short transaction, use a bounded archive job with per-account concurrency, stream file data in chunks and keep partial-render failures visible in the manifest. Test a delayed or missing object and a failed document render.

### [SEVERITY: medium] A timed-out dispatch can restore a stale status over a newer job

- **Where:** [processing.py:140](../backend/app/services/processing.py#L140), [processing.py:162](../backend/app/services/processing.py#L162), [tasks.py:75](../backend/app/services/tasks.py#L75).
- **What:** The dispatch error handler updates the specific job conditionally, but restores the paper status independently based only on whether it currently says `QUEUED`.
- **Impact / failure scenario:** The enqueue request is accepted but its response is lost. If the task already ran and marked itself queued for retry, the failure handler can convert that accepted job to failed. If another job has taken over the paper, the old failure can overwrite the newer job's queued status with the pre-dispatch status. Polling and retry feedback can then disagree with the actual job.
- **Evidence:** The job-specific `UPDATE` result is ignored and the subsequent `Paper` update has no attempt or job identity condition. Cloud Tasks dispatch does not supply a stable task name for confirming an ambiguous creation response.
- **Fix:** Distinguish definitive rejection from ambiguous transport outcomes. Use stable task IDs and a conditional update that proves the dispatched job still owns the queued transition. Test acceptance followed by response loss and a newer job queued before the first handler restores status.

### [SEVERITY: medium] Essential editor instructions have low contrast in both themes

- **Where:** [theme.css:5](../frontend/src/theme.css#L5), [theme.css:68](../frontend/src/theme.css#L68), [PdfPanel.tsx:178](../frontend/src/components/editor/PdfPanel.tsx#L178), [PdfPanel.tsx:197](../frontend/src/components/editor/PdfPanel.tsx#L197).
- **What:** Normal-size PDF citation instructions use the weak `slate-400` token on the white surface in both modes.
- **Impact / failure scenario:** In the PDF panel, a user can miss the instruction to correct the locator when the printed page differs from the PDF page. Measured contrast is approximately **2.52:1** in Graphite and **2.54:1** in Night, below 4.5:1 for normal-size text. [WCAG contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- **Evidence:** Calculated relative contrast from the declared color tokens. The three theme tests cover toggling, the device preference and persistence rather than visual readability.
- **Fix:** Use a higher-contrast text role for instructions, locator hints, focus and status. Add automated contrast and keyboard checks for the editor, consent screen and main navigation in both modes.

### [SEVERITY: medium] The landing demo plays scripted results without a label or pause control

- **Where:** [Home.tsx:10](../frontend/src/pages/Home.tsx#L10), [LiveDemo.tsx:17](../frontend/src/components/LiveDemo.tsx#L17), [LiveDemo.tsx:149](../frontend/src/components/LiveDemo.tsx#L149), [LiveDemo.tsx:282](../frontend/src/components/LiveDemo.tsx#L282).
- **What:** The demo is a loop of static search results, suggestion text and check states presented in the live UI style. It auto-plays for over five seconds and exposes no pause or stop control.
- **Impact / failure scenario:** A visitor can read the animated “Checking” and “Matched” states as current service behavior or assume AI is enabled for their account. The animation persists beside other landing-page content. A reduced-motion setting shows a finished frame. Visitors without that setting still have no in-page way to pause the demo. [WCAG pause, stop, hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
- **Evidence:** The component advances only through timers and hard-coded values. No application API drives the displayed results. The Aker & Mbiti reference is a real publication, and the demo can cite the specific primary study for the Niger trader claim instead of treating a bibliographic match as evidence for that sentence. [Aker study](https://www.aeaweb.org/articles?id=10.1257/app.2.3.46), [Aker and Mbiti review](https://www.aeaweb.org/articles?id=10.1257/jep.24.3.207)
- **Fix:** Label it as an illustrative walkthrough with real sources, describe what “Matched” checks, and provide a keyboard-accessible Play/Pause control or a static default. Use a bounded single timer instead of retaining every completed timeout over a long session.

### [SEVERITY: low] The PDF reader accumulates every page canvas and cannot search the full library

- **Where:** [PdfPanel.tsx:26](../frontend/src/components/editor/PdfPanel.tsx#L26), [PdfPanel.tsx:61](../frontend/src/components/editor/PdfPanel.tsx#L61), [PdfPanel.tsx:84](../frontend/src/components/editor/PdfPanel.tsx#L84), [PdfPanel.tsx:166](../frontend/src/components/editor/PdfPanel.tsx#L166).
- **What:** Once a page intersects the reader, its canvas and text layer stay mounted. The reader fully downloads each new PDF and offers only the first 50 library items in addition to document sources.
- **Impact / failure scenario:** A long, high-DPI PDF gets more expensive as the user scrolls. Switching papers does not abort the previous blob fetch. An older archived or uploaded paper with a PDF cannot be found in the panel unless it is already a document source. Failed source queries can also appear as an empty PDF list.
- **Evidence:** `visible` only transitions to `true`, every page has a mounted `PdfPage`, and `api.blob` does not take a signal. The picker calls `useLibrarySearch("", 50)` with no search or paging controls.
- **Fix:** Virtualize page canvases, bound rendered pixel area, abort obsolete fetches and add searchable or paginated PDF selection with clear network errors. Add a browser test with a long multipage PDF and a source outside the first library page.

## Re-check of the previous 12 findings

| Prior item | Current disposition |
| --- | --- |
| 1. Account ZIP owner scoping | Covered for stale ordinary links, collections and document citation records. Regression and owner filtering are in place. |
| 2. Stale PDF worker | Covered for the original identical-object-key race. Each write gets a distinct key, and the live-object guard is present. Dispatch status handling is a different residual race. |
| 3. Revision promotion | Covered for the reported mismatch. The same tagged entry supplies the endpoint and revision, readiness reports the instance's Cloud Run revision name for the gate to verify, and CI runs fake-cloud checks. |
| 4. Closure recovery | Partial operationally. Durable retry is implemented and tested. Delivery, completion status and the absent reported schedule are open. |
| 5. Data export and policy gate | Covered for collections, history, citation records, unlinked uploads, prior consent and former testers. Large-archive behavior remains open. |
| 6. Displayed consent version | Covered for outdated and missing policy versions. |
| 7. Optional consent vs preferences | Covered for reserved keys and concurrent updates to distinct preference keys. |
| 8. Private access before re-consent | Covered for optional-principal reads. Account-rights access is intentionally separate. |
| 9. Grounded excerpts | Improved. Quote count and UTF-16 offsets are repaired for new answers. Claim selection and overlapping highlights remain partial. |
| 10. Upload deduplication and recovery | Covered for identical owner-and-digest uploads and explicit private retry. Ambiguous dispatch still needs handling. |
| 11. Staging configuration | Documented separate resources and identities. Actual staging isolation was not verified. Development identity configuration is a separate confirmed gap. |
| 12. Identical citation occurrences | Covered. A different race remains when renders for two identical ID sequences finish out of order. |

## Feature parity changes

The [previous inventory](PAPERAID_V2_REAUDIT.md#legacy-to-v2-feature-parity) covers unchanged capabilities, including intentionally retired sample AI output. This table checks the editor features and new release behavior against it.

| Capability | Legacy v1 | Current status | V2 implementation |
| --- | --- | --- | --- |
| Cite while writing | Library-backed cite-at-cursor | Present and expanded to scholarly search. External query needs a review step. | [CitePalette](../frontend/src/components/editor/CitePalette.tsx) |
| Selection menu | Contextual editing features | Present. Rewrite placement, source query disclosure and evidence coverage require fixes. | [SelectionMenu](../frontend/src/components/editor/SelectionMenu.tsx) |
| Inline autocomplete | Ghost suggestions | Present in source, conditional on service-level AI. Pilot gating and explicit user opt-in are missing. | [useAutocomplete](../frontend/src/components/editor/useAutocomplete.ts), [Editor](../frontend/src/pages/Editor.tsx) |
| Read PDF beside the draft | PDF access and evidence features | New viewer present. Page attribution and delayed response defect are release blockers for quoting. | [PdfPanel](../frontend/src/components/editor/PdfPanel.tsx) |
| Account privacy | Profile and privacy page | Expanded to data rights and versioned consent. Retry visibility and environment isolation remain open. | [DataRights](../frontend/src/components/DataRights.tsx), [accounts.py](../backend/app/services/accounts.py) |
| Graphite and Night | Earlier visual theme | Present. Contrast and a keyboard-accessible pause for the demo require follow-up. | [theme.css](../frontend/src/theme.css), [LiveDemo](../frontend/src/components/LiveDemo.tsx) |
| Sharing and comments | Planned for the rebuild | Missing. Owner-only document and paper checks remain in place. | [documents API](../backend/app/api/routes/documents.py) |

## Verification and boundaries

| Command or evidence | Result |
| --- | --- |
| `git diff --check 691c6c0 6db03b0` | Clean. Verified the landing demo as the additional commit after the initial Graphite review. |
| `npm test` and `npm run build` in `frontend` | **73 tests passed** in nine files. TypeScript and the production build passed. The new browser logic used jsdom tests. A real browser's PDF rendering was not independently verified. |
| `npm test -- src/test/auditProbe.test.tsx` in `frontend` | Three focused offline checks confirmed the draft text disclosure at the frontend API boundary, delayed PDF quote attribution, and multi-claim rewrite citation movement. The temporary test file was removed after verification. |
| `python -m pytest -q --tb=short --maxfail=1` in `backend` | The local PostgreSQL fixture could not connect to `127.0.0.1:6423` (Windows sandbox error 10013). PostgreSQL integration was verified with GitHub logs. |
| `python -m pytest --noconftest -q tests/test_release_audit.py -k 'supporting_quote or highlight_offsets or cited_source_without'` and `python -m alembic upgrade head --sql` in `backend` | Three targeted grounding tests passed. Offline migration SQL generated through `e5f3a8c1d927`, including the storage path index. |
| `ruff check app tests alembic scripts` and `ruff format --check app tests alembic scripts` | Passed. Format check covered 80 files. |
| [GitHub Actions log for `6db03b0`](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/actions/runs/43571339082) | **235 PostgreSQL tests passed**, seven live tests deselected, **73 frontend tests passed**. The container job passed font, nested Word/PDF citation, all 18 styles, migration and readiness checks. The frontend npm audit logged zero known vulnerabilities. |
| `npm audit --omit=dev --audit-level=high --fetch-retries=0` in the citation engine and `python -m pip_audit --disable-pip --no-deps --timeout 5 --progress-spinner off -r requirements.txt` in `backend` | Registry lookups blocked by local DNS. The Python/citation-engine advisory claims were not independently verified. |
| Production, hosting and external providers | No production resources were accessed or changed. No live scholarly requests or AI calls were sent. No signed-in staging session or scheduled maintenance deployment was verified. |

## Release recommendation

Fix the non-AI editor's draft-text disclosure and wrong-page quoting first. Isolate the development Firebase configuration before developers exercise deletion. Verify the fixes in an isolated, signed-in browser flow that covers consent, selecting a passage, citing a real source, exporting Word/PDF and requesting deletion. Wire and monitor the maintenance scheduler so the closure retry promise can be exercised end to end. Keep AI disabled until the intended testers opt in under server-side cohort controls and the rewrite, evidence coverage and claim-to-quote behavior are verified. The redesign can continue in parallel.
