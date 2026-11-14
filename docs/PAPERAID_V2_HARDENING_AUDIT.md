# PaperAid Pro hardening audit

14 November 2026. Audited `main` through `2248a45`. The four application commits from `6db03b0` through `eeff256` changed 66 files. `2248a45` adds the brief and leaves that application's code intact. Scope and severity follow [the hardening brief](AUDIT_BRIEF.md), with all 15 previous findings checked. The handoff identifies the deployed backend as `paperaid-api-00015-kaf` and the database schema as `f2a6c8e4b1d3`. This review used local code and tests, mocked failure scenarios, and GitHub Actions logs. Live deployment configuration, a signed-in production session and production data were outside the review.

## Findings

### [SEVERITY: high] Editing a draft-derived search sends the original text before confirmation

- **Where:** [CitePalette.tsx:71](../frontend/src/components/editor/CitePalette.tsx#L71), [CitePalette.tsx:83](../frontend/src/components/editor/CitePalette.tsx#L83), [CitePalette.tsx:195](../frontend/src/components/editor/CitePalette.tsx#L195), [discovery.py:63](../backend/app/api/routes/discovery.py#L63).
- **What:** Any edit switches on external search for a palette opened from selected draft text, while that search still reads the previous debounced value.
- **Impact / failure scenario:** The user tries to redact a confidential phrase as the UI suggests. The first edit can send the complete original selection to the scholarly-search API before the edited value takes effect. This path is available with AI off.
- **Evidence:** A temporary Vitest check mounted the real palette with a mocked API. Adding one character to the prefilled query caused `/discovery/search` to receive the unedited string before the separate confirmation button was used. The server forwards the query to the configured providers. The existing test verifies untouched draft text and independently typed searches, skipping the redaction path.
- **Fix:** Keep draft-derived searches local for the life of the palette until the user explicitly submits the exact reviewed value. Use a submitted query value independent of the live debounce. Test partial edits, clearing, pasting and changing the value after confirmation.

### [SEVERITY: high] Mid-session re-consent can discard a draft the editor failed to save

- **Where:** [api.ts:87](../frontend/src/lib/api.ts#L87), [auth.tsx:91](../frontend/src/lib/auth.tsx#L91), [Layout.tsx:221](../frontend/src/components/Layout.tsx#L221), [Editor.tsx:353](../frontend/src/pages/Editor.tsx#L353), [Editor.tsx:444](../frontend/src/pages/Editor.tsx#L444), [saveQueue.ts:66](../frontend/src/lib/saveQueue.ts#L66).
- **What:** An API refusal triggers a profile refresh. The consent guard then unmounts the editor, destroying the in-memory queue that retained the rejected changes.
- **Impact / failure scenario:** A policy update lands while a researcher is typing. The next autosave is refused with `CONSENT_REQUIRED`. The guard replaces the editor with consent. Its unmount flush cannot save while consent is missing. After acceptance, a new editor opens the previous server version. The researcher can lose work in both the text and title.
- **Evidence:** A focused test mounted the real `AuthProvider` and `RequireAuth` with a stateful draft fixture. A consent reload removed the draft subtree and remount restored its previous server value. The production editor's only pending copy is its `SaveQueue` ref, whose failed fields remain in memory and whose teardown only calls `flush()`. The repository regression tests observe the HTTP notification callback without exercising this lifecycle.
- **Fix:** Preserve the current user's pending versioned edits across consent and restore them only for the same account and document. A consent overlay can keep the editor mounted and read-only, or the editor can hand off pending state to a guarded recovery store. Regression-test editing, a refused autosave, re-consent, retry and a concurrent version conflict.

### [SEVERITY: high] Closing an account can miss a PDF committed by a request that already passed authentication

- **Where:** [accounts.py:104](../backend/app/services/accounts.py#L104), [accounts.py:134](../backend/app/services/accounts.py#L134), [accounts.py:147](../backend/app/services/accounts.py#L147), [papers.py:180](../backend/app/api/routes/papers.py#L180), [processing.py:97](../backend/app/services/processing.py#L97), [models.py:174](../backend/app/db/models.py#L174).
- **What:** Closure snapshots PDF paths, then separately deletes the user and cascades the owned papers. An upload that already authenticated can commit a new paper and clear its storage intent after that snapshot.
- **Impact / failure scenario:** An upload starts writing an object. Closure locks out future requests and reads the current owned papers. The upload finishes its commit before the closure deletes the user. Its row is then cascaded, but the new key was absent from both the closure's pending list and its deletion records. The closure can report completion while an orphaned private PDF remains.
- **Evidence:** Source interleaving. Authentication is checked once at request entry. The upload's owner/digest lock is independent of the closure. `attach_pdf` confirms and removes the upload intent in the upload transaction. Closure collects only paths visible to its earlier query. The existing tests cover a storage deletion failure and duplicate uploads separately.
- **Fix:** Serialize new owned-file attachment with closure on the user row, and recheck account activity inside that transaction. Lock or otherwise fence existing paper attachment as needed before collecting paths. Add a PostgreSQL test with barriers around the owner snapshot, attachment commit and user deletion. An atomic deletion outbox for cascaded papers is another way to guarantee coverage.

### [SEVERITY: medium] Export and restore can hold the edit gate at the same time

- **Where:** [editGate.ts:59](../frontend/src/lib/editGate.ts#L59), [Editor.tsx:480](../frontend/src/pages/Editor.tsx#L480), [Editor.tsx:494](../frontend/src/pages/Editor.tsx#L494), [Editor.tsx:564](../frontend/src/pages/Editor.tsx#L564).
- **What:** `pause()` has no exclusive owner, and the Export dropdown and restore commands can still start another frozen operation. Either operation's `finally` calls `resume()` and marks the editor editable.
- **Impact / failure scenario:** A user starts an export and a restore before the export download completes. Once either finishes, the user can edit while the other operation is still reading or replacing content. A preview can become newer than its export or a late restore can replace subsequent edits.
- **Evidence:** A focused test acquired the gate twice, released it once, and showed that a new mutation then runs. ProseMirror's installed input handlers check `view.editable` for normal keyboard, paste and drop events, so those handlers honor a single freeze. The reproduced defect is concurrent gate ownership. Citation-label-only transactions do not enqueue a save.
- **Fix:** Acquire one exclusive export or restore operation synchronously, bind release to its holder, and disable operation controls while it holds the gate. Test with delayed, overlapping export and restore calls at the editor entry points.

### [SEVERITY: medium] A delayed citation can land beside unrelated text after its original anchor is deleted

- **Where:** [editGate.ts:15](../frontend/src/lib/editGate.ts#L15), [Editor.tsx:120](../frontend/src/pages/Editor.tsx#L120), [CitePalette.tsx:112](../frontend/src/components/editor/CitePalette.tsx#L112), [PdfPanel.tsx:172](../frontend/src/components/editor/PdfPanel.tsx#L172).
- **What:** The sources panel and palette use the mapped position but ignore the tracker’s `deleted` flag. The palette begins tracking at result selection, and the PDF panel begins tracking inside the queued mutation, after the click.
- **Impact / failure scenario:** A source request is pending when the writer removes the intended paragraph. A citation can land at the mapped boundary beside a different statement. If the palette target changed before result selection, the initial numeric position may already be stale. PDF insertion refuses a deletion it observed but cannot see transactions that happened before listener registration.
- **Evidence:** Both ordinary citation callbacks pass `target.pos` directly to `insertCitationAt`. The PDF callback explicitly checks `target.deleted`. The tracker is a per-operation transaction listener and has no mapping history from before its creation.
- **Fix:** Track a bookmark synchronously when the target is chosen, check lost or replaced anchor ranges consistently, and avoid creating a persistent citation record for a canceled insertion where practical. Test deletion, whole-block replacement and edits before and after the mutation starts.

### [SEVERITY: medium] Rewrite validation preserves citation order while allowing a change of claim

- **Where:** [rewrite.ts:26](../frontend/src/lib/rewrite.ts#L26), [rewrite.ts:51](../frontend/src/lib/rewrite.ts#L51), [rewrite.ts:61](../frontend/src/lib/rewrite.ts#L61).
- **What:** The check compares marker count and numeric order. It does not check which claim a marker accompanies or compare citation node IDs when deciding whether the selection changed.
- **Impact / failure scenario:** A model returns both original markers in order after the second rewritten claim. The proposal is accepted and the first claim loses its citation. If a referenced node changes while a proposal is open, the same placeholder is regenerated for the new node and applying the old proposal can restore the previous citation.
- **Evidence:** A focused test accepted `First claim. Second claim [[C1]][[C2]].` for a passage with one distinct citation per sentence. It then changed the first citation node and reproduced `isUnchanged === true`. This is a conditional AI issue while production AI remains off per handoff.
- **Fix:** Rewrite cite-bearing spans separately or use structured sentence and citation anchors with an explicit review when boundaries change. Compare actual citation identities and the selected snapshot before applying a proposal. Test merged claims, citation swaps and changed marks.

### [SEVERITY: medium] The export manifest fallback does not recover from a database-level render failure

- **Where:** [accounts.py:417](../backend/app/services/accounts.py#L417), [accounts.py:434](../backend/app/services/accounts.py#L434), [documents.py:485](../backend/app/services/documents.py#L485), [documents.py:522](../backend/app/services/documents.py#L522).
- **What:** The archive catches document-render exceptions while continuing with the same database transaction, which may already be aborted.
- **Impact / failure scenario:** A failing SQL statement during citation lookup causes PostgreSQL to reject subsequent queries in that transaction. The exporter records the document as missing, then retries another document or queries conversations and fails the entire request. When there are no formattable citations, the document-rendering path also holds the connection while `to_docx` runs, since only the nonempty citation branch commits.
- **Evidence:** Source review and the brief's known-risk note. The current test replaces the renderer with an exception and leaves the database transaction healthy. It does not exercise a failed statement or connection loss.
- **Fix:** Collect independent plain snapshots or use a short-lived session for each document's citation work, and release it before any render. Handle failed-render cleanup without reusing an aborted transaction. Test a database-origin failure and a citation-free document, including subsequent archive members and the manifest.

### [SEVERITY: medium] A Cloud Tasks deadline response can still be treated as definite rejection

- **Where:** [tasks.py:90](../backend/app/services/tasks.py#L90), [tasks.py:98](../backend/app/services/tasks.py#L98), [processing.py:161](../backend/app/services/processing.py#L161).
- **What:** Transport uncertainty is handled, but every non-409 HTTP error is classified as definite rejection. A deadline response for a state-changing create call can be returned after acceptance.
- **Impact / failure scenario:** A task creation response reports `DEADLINE_EXCEEDED` after Cloud Tasks accepted the task. The handler can mark the job failed before delivery. The worker then skips it. A stable name prevents duplicate creation but the current uncertainty branch does not confirm or resend. An already executed or deleted name can also return `ALREADY_EXISTS` without a live task.
- **Evidence:** `ConnectTimeout` from this fresh client's direct create call is a pre-send connect failure. The gap is provider HTTP/gRPC status classification. Cloud Tasks documents recent-task deduplication and gRPC documents successful operations returning a deadline status. [Cloud Tasks create semantics](https://docs.cloud.google.com/tasks/docs/reference/rest/v2/projects.locations.queues.tasks/create), [gRPC status codes](https://grpc.io/docs/guides/status-codes/)
- **Fix:** Treat ambiguous provider statuses as uncertain, validate the structured status body where available, and define bounded reconciliation using the task name and database state. Cover a 504 create response, prior completion and a genuine rejection.

### [SEVERITY: medium] The AI check overstates which sources it actually examined

- **Where:** [documents.py:181](../backend/app/api/routes/documents.py#L181), [features.py:74](../backend/app/services/ai/features.py#L74), [features.py:111](../backend/app/services/ai/features.py#L111), [Editor.tsx:289](../frontend/src/pages/Editor.tsx#L289).
- **What:** Scope reports the selected candidates as checked, while the model receives only the bounded evidence subset. A candidate may contribute no material.
- **Impact / failure scenario:** A document has 30 indexed sources. Some contribute no passage or abstract before the evidence budget is exhausted. The reported scope can still list all 30 with `not_checked: 0`. The user can reasonably infer that a contradictory source was presented to the model when it was omitted.
- **Evidence:** `scope.sources` is generated from `papers`. `gather_evidence` returns at most `limit + EVIDENCE_COVERAGE_EXTRA` items, and `grounded_answer` presents only those items. The scope test uses a small library and the evidence budget test checks item count separately.
- **Fix:** Report selected papers, papers searched, papers represented in model evidence, and papers without usable evidence separately. Include a test where selected sources exceed the evidence budget and where a source has no abstract or full text.

### [SEVERITY: medium] The former-tester screen directs data-rights access to the wrong branch

- **Where:** [Layout.tsx:189](../frontend/src/components/Layout.tsx#L189), [Layout.tsx:205](../frontend/src/components/Layout.tsx#L205), [Layout.tsx:209](../frontend/src/components/Layout.tsx#L209), [auth.py:227](../backend/app/security/auth.py#L227).
- **What:** The data-rights panel is rendered for an identity conflict, which the API cannot resolve as that account. It is missing from the not-invited screen, whose authenticated users can use the API.
- **Impact / failure scenario:** A former tester signs in to download or delete their work. The app shows only the invitation explanation and sign-out, despite the rights endpoints supporting the account. A person signed in using a conflicting identity instead sees buttons that return the identity conflict.
- **Evidence:** The two adjacent `RequireAuth` branches show the mismatch. The backend coverage checks endpoint access for a former tester, and the frontend rights test covers re-consent.
- **Fix:** Restore the panel for a recognized former tester and give the identity-conflict screen a path to the original sign-in or privacy contact. Add tests for both actual route-guard branches.

### [SEVERITY: medium] Two first citations of the same source can collide in the database

- **Where:** [documents API:136](../backend/app/api/routes/documents.py#L136), [documents service:468](../backend/app/services/documents.py#L468), [models.py:383](../backend/app/db/models.py#L383), [editGate.ts:47](../frontend/src/lib/editGate.ts#L47).
- **What:** Adding the document source uses a read-then-insert followed by its own commit. The edit gate allows multiple concurrent operations while open.
- **Impact / failure scenario:** Two tabs cite the same new source on the same draft. Both can read the missing `DocumentSource` row, then one inserts and the other conflicts on the composite primary key. The losing request can return a server error even though adding the same source should be safe and the citations may legitimately have different locators.
- **Evidence:** Source review of the shared source helper and the citation API. The existing concurrent-upload regression guards a different relation.
- **Fix:** Upsert the document-source link by `(document_id, paper_id)` and commit it atomically with the citation. Test two simultaneous citations with distinct locators and rollback if creating the citation fails.

### [SEVERITY: low] The PDF picker can hide its own search box and matching papers

- **Where:** [PdfPanel.tsx:96](../frontend/src/components/editor/PdfPanel.tsx#L96), [PdfPanel.tsx:201](../frontend/src/components/editor/PdfPanel.tsx#L201), [library.py:93](../backend/app/api/routes/library.py#L93).
- **What:** The panel filters for PDFs in the browser after receiving a 50-item library page. The empty state hides the finder on an empty query.
- **Impact / failure scenario:** A researcher has 50 newer metadata-only entries and an older uploaded PDF. If the current document has no sources, the panel says no sources have PDFs and offers no way to search for the older PDF from the editor. A broad search can likewise hide a matching PDF beyond the first page of title results.
- **Evidence:** Library paging is applied before the `p.has_pdf` filter. The no-candidates branch renders the finder only if `find` is already nonempty.
- **Fix:** Keep the finder visible in empty states. Filter for stored PDFs before paging on the server, and test a PDF following 50 newer metadata-only records.

### [SEVERITY: low] The section walkthrough shows an untraceable page locator and AI options that may be unavailable

- **Where:** [demos.ts:163](../frontend/src/lib/demos.ts#L163), [demos.ts:173](../frontend/src/lib/demos.ts#L173), [Guidance.tsx:106](../frontend/src/components/Guidance.tsx#L106).
- **What:** The editor scene presents `PDF page 3 · Cite highlight, p. 3` without a named PDF or selected passage, and advertises AI actions independent of the account status.
- **Impact / failure scenario:** The reader can mistake the locator for traceable source provenance or look for controls that are disabled in the current beta. Its venue and bibliographic records can be valid while the illustrated page remains unsupported.
- **Evidence:** The demo fixture contains a literal page number without a document-to-page mapping. Suri & Jack's year, volume, issue and printed page range and the Aker and Jack paper identities checked against journal records. The landing walkthrough includes the label, Play/Pause control and primary Aker study. [Suri and Jack record](https://pubmed.ncbi.nlm.nih.gov/27940873/), [Jack and Suri study](https://www.aeaweb.org/articles?id=10.1257/aer.104.1.183), [Aker study](https://www.aeaweb.org/articles?id=10.1257/app.2.3.46)
- **Fix:** Use a generic “Cite the selected page” label, or link a known source PDF and verified page. Show AI-dependent steps conditionally or label their availability.

## Disposition of the previous 15 findings

| # | Previous finding | Current disposition |
| --- | --- | --- |
| 1 | Draft text sent automatically | Open for first edit of a draft-derived query. Untouched prefill is now private. |
| 2 | Wrong-page PDF quotation | Original delayed text and page mismatch covered by an existing two-page regression. Quote plus citation is atomic, and range attribution is present. Position lifecycle and ordinary citations need the additional checks above. |
| 3 | Local account deletion reached production Firebase | Covered. Real Identity Toolkit deletion is skipped outside production unless an emulator is supplied, and tests mock both paths. |
| 4 | Rewrite moved or removed citations | Partial. Placeholder count and order are enforced. Same-order reassignment and changed citation identity remain. |
| 5 | Default-on AI drafting for all | Covered for the original mode. All seven generative write or response endpoints use `AIUser`, and suggestions default off for both deployment and account. Admins' pilot exemption is an explicit decision. Existing summaries are a read path and do not start new inference. Embeddings have a separate configuration and can run on ingestion or passage search if enabled. Keep both provider settings off in the current beta. |
| 6 | Pending closure presented as finished | 202 notice and storage retry exist. The snapshot race can omit new objects, and periodic maintenance is still listed as pending. The live-object guard is safe for a key truly owned by a remaining paper, but queue-row absence is only a sufficient completion signal if all of the closing user's keys were recorded. |
| 7 | Edits during frozen export or restore | Partial. One freeze blocks ProseMirror input and drains registered asynchronous edits. Concurrent freezes reopen the gate too early. |
| 8 | Late citation previews | Covered for prior out-of-order style and cluster scenarios through generation and match checks. |
| 9 | Silent check scope | Partial. Overlong text is refused and the candidate limit is disclosed. Candidate scope remains broader than actual evidence. |
| 10 | Source-level highlights | Covered for overlapping spans, claim emphasis and legacy offsets on normally assembled answers. Current grouping still derives claim numbers from rendered markers rather than stable structured claim IDs. |
| 11 | Account ZIP held the database during PDFs | Covered for the PDF-read loop. Per-instance slots, rate limits and off-thread DOCX generation are in place. SQL failure and citation-free render still have the gap above. |
| 12 | Dispatch restored old state | Partial. Ordinary transport uncertainty and a rejected stale transition are covered. Ambiguous provider responses remain. |
| 13 | Light and Night contrast | The updated text-token tests pass in both modes. Visual interaction and every CSS state were not independently checked in a browser. |
| 14 | Unlabelled landing demo and no pause | Covered on the landing page. Section demo page attribution and feature availability still need the content correction above. |
| 15 | PDF memory and library loading | Virtualization and download cancellation are wired. The filtered-after-paging picker can still hide matching PDFs. |

## Additional verification

- **Upload deduplication.** The owner/digest advisory lock and fresh lookup are in the same transaction as paper creation and serialize normal concurrent identical uploads. The existing real PostgreSQL test covers simultaneous writes. The account closure path requires separate coordination because it does not take that lock.
- **Consent reload.** The in-flight flag coalesces simultaneous profile reloads. The `/me` route uses `CurrentUser`, so an ordinary profile refresh does not independently yield `CONSENT_REQUIRED`. The primary defect is in editor state retention. A transient `/me` failure is also collapsed to `user = null`, where `RequireAuth` shows a spinner without recovery guidance.
- **Identity and deployment.** Local default identity deletion is screened, normal production access still uses Firebase verification and invitation policy, and the release script change count is zero in this interval. The deployed resource state was not queried.
- **Feature parity.** This scope changes behavior of existing editor, account, AI and guidance features. It adds no new legacy-page equivalents. The original [feature inventory](PAPERAID_V2_REAUDIT.md#legacy-to-v2-feature-parity) and [editor parity changes](PAPERAID_V2_SYSTEM_REAUDIT.md#feature-parity-changes) remain the baseline.

## Verification commands and results

| Command or evidence | Result |
| --- | --- |
| `git diff --check 6db03b0 2248a45` | Clean. Diff from `eeff256` to `2248a45` is the audit brief only. |
| `npm test` and `npm run build` in `frontend` | **93 tests passed** in 13 files. TypeScript and production build passed. The generated CSS contains **zero `url(data:...)` entries**, including fonts. This checks build output for the CSP fix, not PDF font behavior in a signed-in browser. |
| Focused temporary Vitest probes | Four confirmed behaviors. Draft search leaks the previous query. Double gate acquisition reopens editing after one release. Rewrite accepts misplaced citations and misses modified citation identity. The auth guard unmounts the unsaved work area during re-consent. The temporary probes were removed after verification. |
| `python -m pytest -q --tb=short --maxfail=1` in `backend` | Local fixture stopped on Windows sandbox error 10013 reaching PostgreSQL at `127.0.0.1:6423`. |
| `ruff check app tests alembic scripts` and `ruff format --check app tests alembic scripts` | Both passed. Format check covered 82 files. |
| `python -m alembic upgrade head --sql` | Generated offline SQL through `f2a6c8e4b1d3`, including the defaulted `pending_keys` column. |
| [GitHub CI for `eeff256`](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/actions/runs/43580287073) | **249 PostgreSQL tests passed**, seven external cases deselected. **93 frontend tests passed**. Container smoke passed, including fonts and all 18 styles. The frontend npm audit reported zero known vulnerabilities. `2248a45` does not change the application or CI. |
| Live API, scholarly provider tests, staging and Python advisories | No independent signed-in verification or change to production resources. The seven live scholarly tests and Python advisory scan were not rerun in this review. |

## Release recommendation

Keep the beta invite-only and AI off. Fix the three high findings before adding users. Run an isolated signed-in scenario that exercises draft redaction, failed autosave during re-consent, PDF quoting and account closure racing an upload. Verify that scheduled maintenance actually runs before promising automatic deletion. Cover the edit-gate and citation changes before enabling AI writing tools or sharing.
