# PaperAid Pro v2 follow-up audit

**Reviewed revision** `70431cb8fc6d1eee2228d753c55d98a3bccca653` on `main`, compared with the first audit at `7538f73` and the original `legacy-v1` at `dc38837`.

I reviewed the remediation diff across 70 files, followed affected paths through the API, database, worker and React components, and checked the new tests against the failure modes they claim to cover. I also rechecked the original parity inventory against the current route and feature changes. This is a source review with focused offline reproductions. Local PostgreSQL-backed verification was blocked at connection setup, and the GitHub connector did not return a CI result. No production resources were queried or changed. [Remediation commit](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/commit/70431cb8fc6d1eee2228d753c55d98a3bccca653) · [First audit](PAPERAID_V2_AUDIT.md) · [Remediation claims](AUDIT_RESPONSE.md)

**Verdict.** The remediation closes several original defects, including implicit identity linking, catalog relevance pagination, and batch citation numbering. It does not close all 28. The highest-priority residuals are Firebase session invalidation on account closure, private-paper references created under the old role policy, citation placement in exports, PDF job recovery, and AI provenance. The new welcome tour, help, dashboard and homepage are wired into the application.

## Findings

### [SEVERITY: high] The documented production image lacks fonts required for any PDF export

- **Where** [Dockerfile:16](../backend/Dockerfile#L16) · [export.py:113](../backend/app/services/export.py#L113) · [export.py:136](../backend/app/services/export.py#L136)
- **What** The Debian Bookworm image installs only `fonts-dejavu-core`. The exporter requires regular, bold, italic and bold italic to exist before registering any body font.
- **Impact / failure scenario** In an image built from this Dockerfile without additional fonts, even an English PDF export fails with “no Unicode font installed on the server.” The alternate font paths are Windows-only. The local Windows export tests do not validate the packaged image.
- **Evidence** Debian lists the regular and bold Serif fonts in `fonts-dejavu-core` and both italic variants in `fonts-dejavu-extra`. This is confirmed against the package contents and image recipe. I did not run a built container or check a deployed revision. [Debian core files](https://packages.debian.org/bookworm/all/fonts-dejavu-core/filelist) · [Debian extra files](https://packages.debian.org/bookworm/all/fonts-dejavu-extra/filelist)
- **Fix** Install the required font package or ship a complete selected font family. Add a PDF export smoke test against the final production image, including normal, bold and italic text.

### [SEVERITY: high] Closing an account can leave its existing token accepted

- **Where** [auth.py:54](../backend/app/security/auth.py#L54) · [auth.py:116](../backend/app/security/auth.py#L116) · [delete_user.py:56](../backend/scripts/delete_user.py#L56) · [test_audit_fixes.py:662](../backend/tests/test_audit_fixes.py#L662)
- **What** The deletion script removes the Firebase identity and the application row. The API checks JWT signature, audience, issuer and expiry without consulting revocation state or a local UID tombstone.
- **Impact / failure scenario** A request carrying a valid ID token can still resolve the user during deletion, and a still-valid token for a previously eligible UID can recreate an empty profile after the row is removed. A configured bootstrap admin could be recreated with admin privileges until the token expires. The previous data is still subject to the deletion transaction.
- **Evidence** Firebase distinguishes revocation of refresh tokens from acceptance of already-issued ID tokens. The test asserts that a mock deletion happened and database rows disappeared. It does not submit the old identity after deletion. Source-reviewed, with Firebase behavior documented. [Firebase session documentation](https://firebase.google.com/docs/auth/admin/manage-sessions#detect_id_token_revocation)
- **Fix** Make deletion reject the UID at the application boundary before cleanup, with a durable tombstone or revocation-aware verification and an idempotent closure flow. Test ordinary and bootstrap-admin tokens across partial and complete deletion.

### [SEVERITY: high] Old library links bypass the repaired private-paper policy

- **Where** [library.py:63](../backend/app/api/routes/library.py#L63) · [library.py:234](../backend/app/api/routes/library.py#L234) · [papers.py:25](../backend/app/services/papers.py#L25) · [migration](../backend/alembic/versions/20261114_a1c4e9f2b7d3_audit_fixes.py#L21)
- **What** Library listing and export authorize the library row and then serialize its paper without rechecking current paper visibility.
- **Impact / failure scenario** An administrator who saved another user's private paper under the previous policy can retain its metadata through the library and citation exports after deployment. The current direct paper/PDF routes enforce owner scoping. Historical conversation excerpts created under the previous policy also warrant review.
- **Evidence** At `7538f73`, `add_to_library` called the old paper authorization helper, which granted admins all private papers. The new list and export select by `LibraryItem.user_id` and the new migration leaves these historical links in place. This is a source-verified upgrade path. I did not query deployed data for affected rows.
- **Fix** Apply the shared visibility predicate to all paper-related list and export queries, clean up unauthorized links created under the former policy, and review or redact previously stored private excerpts. Test by seeding pre-upgrade admin library and conversation records.

### [SEVERITY: high] A valid citation can still move to the wrong claim in Word and PDF

- **Where** [documents.py:284](../backend/app/services/documents.py#L284) · [documents.py:456](../backend/app/services/documents.py#L456) · [export.py:85](../backend/app/services/export.py#L85) · [export.py:218](../backend/app/services/export.py#L218)
- **What** Both exporters consume positional citations, but their table walkers skip some nested blocks the sanitizer accepts and the citation renderer visits.
- **Impact / failure scenario** A cited blockquote or list in a table cell can be omitted from export. The next paragraph can then silently receive the omitted block's citation.
- **Evidence** Reproduced with a normalized table containing a cited blockquote and a following paragraph with its own citation. The renderer's traversal identified A then B. Both formats exported the following paragraph as `Source B[1]`, even though `[1]` belonged to A.
- **Fix** Use the same tree traversal or an explicit stable citation-node path in render and export. Preserve supported nested blocks. Add regression tests for lists and blockquotes inside cells and for a citation immediately after the table.

### [SEVERITY: high] Retry and terminal error handling can break after rollback

- **Where** [processing.py:247](../backend/app/services/processing.py#L247) · [processing.py:262](../backend/app/services/processing.py#L262) · [session.py:27](../backend/app/db/session.py#L27) · [test_audit_fixes.py:218](../backend/tests/test_audit_fixes.py#L218)
- **What** The failure handler rolls back and then reads `job.attempts` and `job.paper_id` from an ORM object that can have expired attributes.
- **Impact / failure scenario** If ingestion fails after starting a SQL transaction, accessing attributes can attempt implicit async I/O and raise `MissingGreenlet`. The intended failed/queued transition can be skipped, leaving the running lease in place. A failure immediately after the previous commit, before a transaction begins, does not exercise that expiration.
- **Evidence** The source accesses both ORM properties after rollback. A local SQLAlchemy check with `expire_on_commit=False` confirmed that rollback of an open transaction expired loaded attributes. The existing flaky test raises before doing any database work. I could not run the actual PostgreSQL worker integration locally. [SQLAlchemy rollback behavior](https://docs.sqlalchemy.org/en/21/orm/session_basics.html#rolling-back)
- **Fix** Capture immutable job/paper identifiers and the attempt number before ingestion or explicitly reload after rollback. Test both retryable and terminal failures after an executed SQL statement and after a failed flush.

### [SEVERITY: high] Old and expired jobs can remain blocked or overwrite newer work

- **Where** [audit migration:21](../backend/alembic/versions/20261114_a1c4e9f2b7d3_audit_fixes.py#L21) · [processing.py:75](../backend/app/services/processing.py#L75) · [processing.py:208](../backend/app/services/processing.py#L208) · [processing.py:238](../backend/app/services/processing.py#L238)
- **What** The migration leaves surviving active jobs with null leases. New leases identify a time window without identifying which worker owns the attempt.
- **Impact / failure scenario** A queued or running row created by the old app can block a new job after migration if its original task is gone. A worker that continues after lease expiry can commit chunks or paper status after a replacement starts. An early redelivery of a still-running job returns 204 through the internal route, acknowledging delivery before a dead worker's lease is reclaimable.
- **Evidence** SQL comparison of a null lease with a timestamp never selects the row. `_finish` filters by job ID and status, not attempt ownership, and `_ingest` commits paper results before `_finish`. Cloud Run can continue executing after the request deadline. These are source-reviewed paths. [Cloud Run timeout behavior](https://docs.cloud.google.com/run/docs/configuring/request-timeout)
- **Fix** Backfill or fail migrated active jobs, give each attempt a fencing token, and condition every publish/finalize operation on the active token. Return a retry outcome for a delivery that finds a live lease where successful completion is unknown. Test a migration with active rows, worker loss, and a slow old worker completing after replacement.

### [SEVERITY: high] AI still displays unchecked factual text and can hide the exact support

- **Where** [grounding.py:134](../backend/app/services/ai/grounding.py#L134) · [grounding.py:155](../backend/app/services/ai/grounding.py#L155) · [grounding.py:195](../backend/app/services/ai/grounding.py#L195) · [grounding.py:235](../backend/app/services/ai/grounding.py#L235) · [GroundedAnswerView.tsx:76](../frontend/src/components/GroundedAnswerView.tsx#L76)
- **What** The new verifier checks assembled claim text but returns model-written `gaps` after checking digits only. Numeric matching drops signs and commas and does not bind units. The response truncates the evidence excerpt without carrying the verified quote or its position.
- **Impact / failure scenario** A factual allegation can appear in the warning without support. If optional entailment verification is off, the deterministic checks alone can accept altered quantities. Even for a correct verified answer, the reader may see only an unrelated opening excerpt.
- **Evidence** Offline, a gap saying the only trial was retracted passed without evidence. Negative and positive values with different units tokenized identically. A quote beyond the excerpt cutoff was absent from the response. The second judgment uses the same model adapter, and the deterministic tests use mocked verdicts. The new Q&A claim pipeline is a material improvement.
- **Fix** Render fact-like gap statements only if they pass the same support checks, or use a structured limitation message. Preserve validated quote spans and check sign, unit and number together. Cover false textual gaps, negation, unit changes, and quotes past the response excerpt boundary.

### [SEVERITY: medium] A successful autosave result can still leave pending edits

- **Where** [saveQueue.ts:48](../frontend/src/lib/saveQueue.ts#L48) · [Editor.tsx:349](../frontend/src/pages/Editor.tsx#L349) · [Editor.tsx:360](../frontend/src/pages/Editor.tsx#L360) · [Editor.tsx:460](../frontend/src/pages/Editor.tsx#L460)
- **What** Queue flush sends one batch and returns true even when edits arrive before that batch resolves. Restore also allows editing while the restore request is in flight.
- **Impact / failure scenario** Export can use an older saved document even after the gate permits download. A restore response can discard text entered after the confirmation. The style selector also keeps the pre-restore value because the restore callback updates title and content but omits `setStyle`.
- **Evidence** Direct Node reproduction returned `export permitted: true | unsaved edits: true` with the newer title still pending. The unit test at [saveQueue.test.ts:34](../frontend/src/test/saveQueue.test.ts#L34) intentionally treats the first of two queued writes as successful.
- **Fix** Give export a drain or snapshot-version contract. During restore, freeze editing or retain and reconcile subsequent edits, and load all restored fields. Add controlled-latency component tests for typing during export and restore.

### [SEVERITY: medium] Revision restore can bypass the version precondition

- **Where** [documents route:176](../backend/app/api/routes/documents.py#L176) · [schemas.py:246](../backend/app/schemas.py#L246) · [documents service:309](../backend/app/services/documents.py#L309) · [test_documents.py:140](../backend/tests/test_documents.py#L140)
- **What** Restore locks the row but accepts an absent body, empty body or null `base_version`. The service deliberately skips comparison for null.
- **Impact / failure scenario** An older client can restore a previously viewed revision over a newer saved draft without a 409. The previous draft is snapshotted, so recovery is possible.
- **Evidence** The original integration test still invokes bodyless restore and expects success. A new test verifies 409 only when a stale version is supplied.
- **Fix** Require a version for normal restores, or make unconditional restore an explicit API mode with documented semantics. Test omission, null, and a concurrent write.

### [SEVERITY: medium] Reference verification can accept a wrong first author or publication year

- **Where** [verify.py:51](../backend/app/services/citations/verify.py#L51) · [verify.py:63](../backend/app/services/citations/verify.py#L63)
- **What** The verifier searches the whole pre-title segment for the first author's surname and the whole reference for any occurrence of the registry year.
- **Impact / failure scenario** A reference with the correct surname only in second position can be green-verified. A year inside the title can make a different publication year pass.
- **Evidence** Offline checks returned `verified` in both cases. For the year check, the title included 2020, the actual publication year was 2020, and the reference listed 2023 after the title.
- **Fix** Parse structured author and publication-year fields when possible. Return an unchecked state for ambiguous free-form references. Test APA and numeric examples with changed author order, title years, and date differences.

### [SEVERITY: medium] Existing unverified public catalog data survives clean imports

- **Where** [library.py:207](../backend/app/api/routes/library.py#L207) · [papers.py:69](../backend/app/services/papers.py#L69) · [papers.py:136](../backend/app/services/papers.py#L136) · [papers.py:149](../backend/app/services/papers.py#L149)
- **What** New reference imports consult registries, while canonical records already written under the old policy retain nonempty fields.
- **Impact / failure scenario** Incorrect historical metadata can continue into citations and evidence after a legitimate reimport. Two concurrent first imports can also hit a unique constraint because the canonical write remains select-then-insert. No deployed affected rows were inspected.
- **Evidence** The registry result reaches `upsert_public_paper`, but the existing-record branch uses `overwrite=False`. Current migrations do not reconcile catalog provenance.
- **Fix** Track provenance, audit pre-fix rows and replace untrusted values with authoritative fields. Make first insert/reload concurrency-safe and check conflicting identifiers in the database matcher. Test a contaminated seeded record and concurrent imports.

### [SEVERITY: medium] The document normalizer still throws for valid JSON shapes

- **Where** [documents.py:88](../backend/app/services/documents.py#L88) · [documents.py:147](../backend/app/services/documents.py#L147) · [documents.py:175](../backend/app/services/documents.py#L175) · [documents.py:248](../backend/app/services/documents.py#L248)
- **What** Several membership checks assume that JSON node names, mark names and alignment attributes are hashable. The size gate also counts Unicode characters, although the limit and error message are in bytes.
- **Impact / failure scenario** A list-valued node type or mark type, or an object-valued alignment, reaches an unhandled `TypeError`. International text can exceed the advertised byte limit. Valid long individual text nodes are silently shortened to 100,000 characters.
- **Evidence** All three malformed but valid JSON shapes raised `TypeError` offline. The size gate uses `len(json.dumps(...))` with `ensure_ascii=False`.
- **Fix** Type-check all discriminants before comparison, enforce encoded byte limits, and reject oversize user text rather than silently dropping it. Test nested arrays/objects and large Unicode content through create/PATCH.

### [SEVERITY: medium] PDF export silently drops unsupported glyphs

- **Where** [export.py:129](../backend/app/services/export.py#L129) · [export.py:153](../backend/app/services/export.py#L153) · [test_audit_fixes.py:447](../backend/tests/test_audit_fixes.py#L447)
- **What** The exception handler assumes fpdf2 throws for unsupported characters. With the registered TrueType fonts, missing glyphs can be logged and omitted.
- **Impact / failure scenario** A manuscript including CJK or another unsupported script can download successfully with words missing. The header encoding fix is effective and independent of body rendering.
- **Evidence** Offline, `Research 研究 end` produced extractable PDF text `Research  end` and a missing-glyph warning, without a 422.
- **Fix** Check font coverage before output or bundle supported Unicode fonts and enable appropriate shaping. Verify expected text in the generated PDF or assert a clear 422. Include mixed Latin/CJK and right-to-left text.

### [SEVERITY: medium] PDF object cleanup is still vulnerable to partial failures

- **Where** [papers route:166](../backend/app/api/routes/papers.py#L166) · [processing.py:62](../backend/app/services/processing.py#L62) · [processing.py:143](../backend/app/services/processing.py#L143) · [maintenance.py:30](../backend/app/services/maintenance.py#L30)
- **What** The object write precedes the transaction that records ownership or compensation. The uploaded-paper handler only compensates after `store_pdf` returns, and the open-access path commits without equivalent compensation.
- **Impact / failure scenario** A lost storage response or failure between storage success and the database commit can leave an untracked object. A paper can also commit successfully but return an error when job dispatch fails, so manual retry from the upload screen can create copies.
- **Evidence** The upload regression throws before the fake object write. In source, the storage key is calculated before upload but the API learns it only after the write returns. Queue dispatch is a separate commit boundary.
- **Fix** Record storage intent before any external write, reconcile incomplete writes, and make upload/dispatch retries idempotent. Test an object write that succeeds remotely but fails during response or commit, plus a retry after dispatch failure.

### [SEVERITY: medium] Maintenance is one-shot and deletion retries can starve

- **Where** [main.py:47](../backend/app/main.py#L47) · [main.py:63](../backend/app/main.py#L63) · [maintenance.py:30](../backend/app/services/maintenance.py#L30) · [maintenance.py:57](../backend/app/services/maintenance.py#L57)
- **What** Cleanup runs once per process start or on an admin request. Deletion retries select the oldest rows regardless of the requested keys or earlier failures.
- **Impact / failure scenario** A warm instance may leave failed storage cleanup and expired rate buckets pending until manual intervention or a new instance. Enough consistently failing old rows can crowd out later deletions, and `delete_now_or_later` can try an unrelated older key.
- **Evidence** Startup sleeps once and calls maintenance once. `process_deletions` sorts by creation time and leaves failed rows in the same position. The immediate wrapper uses only the length of the supplied key list.
- **Fix** Run maintenance via a deployed schedule with bounded retry/backoff. Process exact keys when attempting immediate cleanup and avoid holding a database transaction across a large serial storage batch. Test oldest-key failure and recurring cleanup.

### [SEVERITY: medium] Large library imports and downloads truncate silently

- **Where** [interchange.py:154](../backend/app/services/citations/interchange.py#L154) · [library.py:205](../backend/app/api/routes/library.py#L205) · [library.py:252](../backend/app/api/routes/library.py#L252) · [Library.tsx:149](../frontend/src/pages/Library.tsx#L149)
- **What** Parsers cap results before the API's oversize check, and the library UI does not use the new pagination controls. Export applies a hard limit without reporting truncation.
- **Impact / failure scenario** Large Zotero or Mendeley imports appear successful with missing items. Later pages of a library cannot be reached from the UI, and a large exported file can be mistaken for a complete backup.
- **Evidence** An offline 501-entry BibTeX input returned exactly 500 entries before the route could reject it. The library and export limits are 1,000 and 5,000 respectively. The UI sends no offset and has no pagination.
- **Fix** Detect the cap explicitly, return total or continuation metadata, and paginate the library UI. Export the full selected set in a streamed or asynchronous export, or disclose a hard limit. Test cap and cap-plus-one for both formats, UI and export.

### [SEVERITY: medium] Thread history can pair a response with the wrong question

- **Where** [tools.py:150](../backend/app/api/routes/tools.py#L150) · [tools.py:177](../backend/app/api/routes/tools.py#L177) · [tools.py:205](../backend/app/api/routes/tools.py#L205) · [models.py:51](../backend/app/db/models.py#L51)
- **What** A user message and its answer share a transaction-default creation time. The history query uses that time as its only ordering key, then reverses rows and reconstructs pairs by role.
- **Impact / failure scenario** A reopened thread can show answer before question or omit or mispair the latest turn in model context. Concurrent asks can use the same history and update the selected papers independently.
- **Evidence** The two rows are inserted in one transaction and both use PostgreSQL `now()`. There is no persisted turn key or sequence in sorting or pairing. This is a source finding, not a claim about the order returned by a particular query plan.
- **Fix** Persist turn identity and per-thread order, store or load complete turns, and use the same ordering for prompt history and the UI. Test equal timestamps, boundary reads and concurrent follow-ups.

### [SEVERITY: medium] Deduplication still merges uncorroborated records and misses strong-ID bridges

- **Where** [aggregator.py:55](../backend/app/services/scholarly/aggregator.py#L55) · [aggregator.py:85](../backend/app/services/scholarly/aggregator.py#L85) · [aggregator.py:190](../backend/app/services/scholarly/aggregator.py#L190)
- **What** Weak matching accepts records when either first author is missing. A record that connects two existing strong-ID groups picks only one and never coalesces both. Identifier resolution also merges provider results without reusing its conflict check.
- **Impact / failure scenario** Distinct cross-provider publications can still be combined on thin evidence, and a research result can list the same work twice when a provider later supplies a DOI-to-PMID bridge.
- **Evidence** Offline, two same-title/year records with no author lists and nonoverlapping identifier types merged into one. Three records containing a shared DOI/PMID bridge remained two groups.
- **Fix** Require substantive corroboration on weak keys, merge compatible strong-ID groups transitively, and reject registry enrichment with contradictory strong IDs. Test missing authors, bridge permutations and provider conflicts.

### [SEVERITY: medium] The release gate does not bind promotion to a successful readiness check

- **Where** [DEPLOYMENT.md:22](DEPLOYMENT.md#L22) · [system.py:44](../backend/app/api/routes/system.py#L44)
- **What** In the documented shell block, a failed `curl -fsS` does not stop the later traffic command. Promotion uses `--to-latest` instead of the immutable revision checked.
- **Impact / failure scenario** A pasted release block can promote a failed candidate. Concurrent deployments can cause promotion of a different revision from the one probed.
- **Evidence** There is no fail-fast setting, explicit condition, or validation of the actual readiness JSON before switching. An absent `alembic_version` table can also raise a generic database error before the explicit 503 branch.
- **Fix** Fail the script on any build, migration or probe error, verify the returned revision, and promote the exact checked Cloud Run revision. Test an unreachable candidate, wrong schema and concurrent candidate creation with mocked commands.

### [SEVERITY: medium] Slow I/O still holds database connections in core paths

- **Where** [search.py:59](../backend/app/services/search.py#L59) · [search.py:86](../backend/app/services/search.py#L86) · [documents.py:503](../backend/app/services/documents.py#L503) · [papers route:169](../backend/app/api/routes/papers.py#L169) · [admin.py:153](../backend/app/api/routes/admin.py#L153)
- **What** Several changed paths release database connections before providers, but evidence search still performs keyword SQL before awaiting the embedder. Citation renders and uploads also wait with an open transaction. The internal async worker route calls synchronous OIDC verification directly.
- **Impact / failure scenario** Slow upstreams can occupy the connection pool or event loop and delay unrelated work. A database error inside the vector query is swallowed without repairing an aborted transaction.
- **Evidence** Evidence search awaits the vector provider after the keyword query. Citation rendering queries papers and then awaits a subprocess. Upload flushes a paper before storage I/O. The task verifier uses the synchronous Google requests transport.
- **Fix** Materialize authorization and retrieval data before external waits or isolate optional work in its own session, and move synchronous verification off the event loop. Test slow upstream calls under concurrency and a database error in optional retrieval.

### [SEVERITY: low] A 21-reference anonymous request fails despite being accepted by the UI

- **Where** [CitationTools.tsx:18](../frontend/src/pages/CitationTools.tsx#L18) · [tools.py:43](../backend/app/api/routes/tools.py#L43) · [tools.py:62](../backend/app/api/routes/tools.py#L62)
- **What** The page accepts and submits up to 50 identifiers before sign-in. The backend rejects the entire request above 20 for an anonymous caller.
- **Impact / failure scenario** A user pasting 21 valid DOIs receives no citations and only learns the lower limit after submitting.
- **Evidence** The frontend slices at 50 for all users and the route enforces the lower anonymous cap.
- **Fix** Present the applicable limit and count before submission, and make excess input actionable. Test 20 and 21 anonymous identifiers and signed-in behavior.

### [SEVERITY: low] Research and dashboard panels can turn fetch failures into empty or stale state

- **Where** [Dashboard.tsx:27](../frontend/src/pages/Dashboard.tsx#L27) · [Dashboard.tsx:109](../frontend/src/pages/Dashboard.tsx#L109) · [Research.tsx:32](../frontend/src/pages/Research.tsx#L32) · [Research.tsx:84](../frontend/src/pages/Research.tsx#L84)
- **What** Dashboard cards and thread results lack independent error handling. A late answer can also navigate the page back to a thread the user has already left.
- **Impact / failure scenario** A failed collection/history query can show a misleading onboarding count or blank card. Users who switch threads during a request can be returned to the old thread when it finishes.
- **Evidence** Checklist treats missing data as zero or false. The threaded mutation always calls `setParams` with the result's conversation ID.
- **Fix** Show per-query errors and retry actions. Bind mutation UI updates to the initiating thread and request identity. Test delayed/out-of-order responses and each dashboard failure state.

### [SEVERITY: low] Modal improvements leave gaps in the mobile editor drawer

- **Where** [Editor.tsx:443](../frontend/src/pages/Editor.tsx#L443) · [ui.tsx:129](../frontend/src/components/ui.tsx#L129)
- **What** The mobile overlay and side panel bypass the shared focus-managed modal. The panel is an `aside` with no Escape handling or focus handoff.
- **Impact / failure scenario** Keyboard or screen reader focus can land on the editor behind the overlay, and dismissal does not return focus to the opener.
- **Evidence** The drawer uses a clickable overlay and a close button. The existing modal test exercises the shared dialog component only.
- **Fix** Give the small-screen panel dialog semantics and reuse focus management. Test keyboard traversal, Escape and return focus at a narrow viewport.

### [SEVERITY: low] Storage streaming can leak an HTTP client on failed open

- **Where** [storage.py:122](../backend/app/services/storage.py#L122) · [storage.py:129](../backend/app/services/storage.py#L129) · [storage.py:137](../backend/app/services/storage.py#L137)
- **What** The storage client is created before the awaited send. Cleanup is installed only after a response exists or a successful iterator starts.
- **Impact / failure scenario** Connection failure or cancellation while opening a stream can leave the client unclosed. A successful response acquired before body iteration also needs an explicit ownership path for cleanup on disconnect.
- **Evidence** The stream functions close after an HTTP error status or in the body generator's finally. The await of `client.send` has no covering cleanup. The current streaming regression uses local storage.
- **Fix** Make transfer ownership explicit and close resources on every exit, including failed open and early disconnect. Cover this with a mocked HTTP transport.

## Disposition of the original 28 findings

“Addressed” means the original defect has a corresponding code correction and I found no equivalent residual in the reviewed path. This designation does not imply the PostgreSQL regression ran locally.

| # | First audit issue | Follow-up disposition |
| --- | --- | --- |
| 1 | UID auto-linking | Addressed. Lookup is UID-based and identity collisions are rejected. |
| 2 | Reference file data becomes public | Partial. New file imports resolve first. Existing unverified records and canonical upsert races remain. |
| 3 | Unsupported AI prose | Partial. Claim construction, quotes and verifier improve the main answer. Unchecked gaps, numeric handling and excerpt provenance remain. |
| 4 | Concurrent document overwrites | Partial. Ordinary PATCH uses a row lock. Restore can omit the version precondition. |
| 5 | Jobs stuck in queued/running state | Partial. Unique index, retry outcomes and leases exist. Rollback expiry, migrated null leases and fencing remain. |
| 6 | Export shifts citations | Partial. Missing flat-cluster slots are preserved. Nested table content can still shift citations. |
| 7 | Admin privacy bypass | Partial. Direct reads are owner-scoped. Historical links can retain private metadata. |
| 8 | Bootstrap admin repeatedly promoted | Addressed for sequential demotion with the audit event in place. |
| 9 | Optional principal skips verification/invite | Addressed for current direct owner-scoped reads. |
| 10 | Cross-identity query cache | Addressed for the covered UID switch and stale profile response. Frontend tests passed. |
| 11 | Shared anonymous limits and amplification | Addressed for provider-list deduplication, shared citation subprocess and per-caller/global design. Production proxy arrangement remains unverified. |
| 12 | Autosave and stale export | Partial. Sends serialize, but later pending edits can survive a successful gate and be discarded during restore. |
| 13 | Discovery merges distinct records | Partial. Same-field identifier conflicts are considered. Weak and transitive matching remain faulty. |
| 14 | Reference verification overstates | Partial. Missing fields lower confidence. Wrong lead author and year can still be verified. |
| 15 | Unicode download titles | Addressed for content disposition. A distinct PDF body issue remains. |
| 16 | Malformed editor trees | Partial. Normalization is stronger, but valid JSON types can still produce 500 and text can be cut. |
| 17 | Orphaned PDFs | Partial. Committed deletion has a durable queue. External-write uncertainty and retries remain. |
| 18 | Account closure leaves identity active | Partial. The external identity is deleted, but existing ID tokens retain local acceptance until expiry. |
| 19 | Relevance is applied after pagination | Addressed structurally. Ranking and filters now execute before SQL pagination with a stable tie-breaker. |
| 20 | Research history loses context/status | Partial. Context and status now persist. Ordering cannot reliably pair same-timestamp messages. |
| 21 | Batch reference numbering restarts | Addressed. Direct runner checks verified shared numeric numbering and ordered bibliography IDs. |
| 22 | Legacy data transfer missing | Documented product decision. No migration shipped. Feature/data parity remains incomplete if legacy data must carry over. |
| 23 | Embedding outages take extracted text offline | Addressed for provider failures after successful extraction. The broader SQL-error recovery and connection-lifetime problems remain. |
| 24 | Private PDFs buffered and cached | Addressed for streaming and `no-store`. Transport lifecycle cleanup needs another test. |
| 25 | Collection membership race | Addressed for the identified remove/add race through shared row locking. |
| 26 | Long transactions and unbounded reads | Partial. Several provider calls release the connection, while other hot paths still hold it. Limits silently truncate some flows. |
| 27 | Mobile and keyboard UI | Partial. Toolbar and shared modal improved. The mobile drawer lacks equivalent behavior. |
| 28 | Migration order | Partial. The order in the runbook is right. Its shell block cannot guarantee that the checked revision gets promoted only after a passing gate. |

## Original behavior excluded from restoration

The first audit identified a fixed discovery response presented with invented page provenance, paper-specific deep research output, topic-specific validation shortcuts, and a scripted evidence sandbox. Those are still out of the active v2 workflows. The new homepage uses abstract visual previews and restores the FAQ and showcase. Genuine capabilities such as a generic evidence-table extractor, manual citation input, and a historical revision export remain eligible for a faithful implementation. [Original behavior inventory](PAPERAID_V2_AUDIT.md#original-behavior-to-retire-or-rebuild) · [New homepage](../frontend/src/pages/Home.tsx)

## Legacy-to-v2 feature parity

**Present** means the core capability has a reachable replacement. **Partial** means a meaningful part of the original workflow or interface is absent or materially different. **Missing** means there is no corresponding workflow. Configurable AI features are mapped from the code, with availability governed by the provider configuration.

| Capability | Original at `legacy-v1` | V2 status | V2 implementation or gap |
| --- | --- | --- | --- |
| Public homepage and quick search | `/` and hero search | Present | [Home.tsx](../frontend/src/pages/Home.tsx) has hero search, a workflow walkthrough, feature showcase and FAQ. The original scripted evidence sandbox remains retired. |
| Dashboard | `/dashboard` and dashboard view with recent documents, library, collections and research history | Partial | [Dashboard.tsx](../frontend/src/pages/Dashboard.tsx) restores the signed-in landing page, checklist, recent documents and research questions. Library and collection progress is summarized in the checklist, without the original recent library and collection views. |
| Onboarding and help | Root onboarding dialog, dashboard checklist, workspace help guides | Present | [Guidance.tsx](../frontend/src/components/Guidance.tsx), [guides.ts](../frontend/src/lib/guides.ts), [Dashboard.tsx](../frontend/src/pages/Dashboard.tsx) and [App.tsx](../frontend/src/App.tsx) provide a welcome tour, help centre, section guides and checklist. |
| Registration, login, logout and sessions | `/login`, `/register`, NextAuth handler and registration API | Present | [Auth.tsx](../frontend/src/pages/Auth.tsx) and [auth.tsx](../frontend/src/lib/auth.tsx) use Firebase, with verification, password reset and optional Google sign-in. |
| Account and privacy pages | `/account`, `/privacy` | Present | [Account.tsx](../frontend/src/pages/Account.tsx), [Static.tsx](../frontend/src/pages/Static.tsx) and [system.py](../backend/app/api/routes/system.py). Account management now includes profile editing and password reset. |
| Scholarly search and per-provider feedback | `/discover`, `searchScholarlyAction`, provider adapters | Present | [Discover.tsx](../frontend/src/pages/Discover.tsx) and [aggregator.py](../backend/app/services/scholarly/aggregator.py). OpenAlex and arXiv are built in. CitedEvidence's own integration is listed separately. |
| Discovery controls | Provider selection, subject filters, time presets and range, access filter, newest and citation-count sorting | Partial | [Discover.tsx](../frontend/src/pages/Discover.tsx) exposes start year and open access. [discovery.py](../backend/app/api/routes/discovery.py) also accepts providers and end year. Subject filters, time presets and user-selected ordering are absent. |
| Discovery cards and save/import | Local library match, reference modal, access link, metadata save | Partial | [Discover.tsx](../frontend/src/pages/Discover.tsx) and [discovery.py](../backend/app/api/routes/discovery.py) show a public catalog match by DOI/PMID, format citations and save by identifier. Personalized save status and arXiv-only match coverage are reduced. |
| Discovery research snapshot | `getResearchSnapshotAction`, automatic/manual snapshot, evidence mode and source detail | Partial | Abstract-only overview and excerpts in [Discover.tsx](../frontend/src/pages/Discover.tsx) and [features.py](../backend/app/services/ai/features.py#L188). Canned narrative and invented page provenance remain retired. |
| Paper catalog | `/papers`, hybrid search, category/status/sort controls | Partial | [Catalog.tsx](../frontend/src/pages/Catalog.tsx) and [papers.py](../backend/app/api/routes/papers.py#L74) provide paginated keyword search and sorting. Status filter is API-only. Category filtering and catalog vector ranking are absent. Hybrid ranking survives in passage search. |
| Author directory and profiles | `/authors`, `/authors/[id]`, search and paper counts | Missing | [models.py](../backend/app/db/models.py#L208) retains author records. No directory, profile or author route. |
| Category directory and profiles | `/categories`, `/categories/[id]`, category counts and papers | Missing | No category model, pages or API. Library collections are personal organization. |
| Paper details | `/papers/[id]`, metadata, identifiers, abstract, status, related author/category navigation | Partial | [PaperDetail.tsx](../frontend/src/pages/PaperDetail.tsx) retains paper metadata, citation, save and research tools. Linked author/category views and old embedding diagnostics are absent. |
| Open-access lookup and processing | `discoverPaperOpenAccessAction`, request/poll analysis, attach available PDF | Partial | [open_access.py](../backend/app/services/open_access.py), [processing.py](../backend/app/services/processing.py), [PaperDetail.tsx](../frontend/src/pages/PaperDetail.tsx). Retrieval and job polling survive. The separate find-access workflow is combined with processing. |
| Authorized paper PDF route | GET/HEAD, stored PDF or vetted external OA redirect | Partial | [papers.py](../backend/app/api/routes/papers.py#L215) provides signed-in GET for stored files and the UI downloads them. Dedicated HEAD and safe external redirect behavior are absent. |
| PDF pipeline, passages and optional vectors | Extract, detect sections, chunk, embed, retrieve passages | Present | [pdf.py](../backend/app/services/pdf.py), [processing.py](../backend/app/services/processing.py), [search.py](../backend/app/services/search.py). The worker and lease limits above still apply. OCR is outside v2. |
| Structured table extraction | Docling PDF conversion and experimental spatial table/evidence modules | Missing | [pdf.py](../backend/app/services/pdf.py) extracts text by page. It does not return structured cells with provenance. |
| Save and unsave papers | Bookmark actions, library, `/saved` redirect | Partial | [papers.tsx](../frontend/src/components/papers.tsx), [library.py](../backend/app/api/routes/library.py), [Library.tsx](../frontend/src/pages/Library.tsx). Save and remove survive. Old URL redirects and some in-place toggle behavior do not. |
| Upload and reprocess private PDFs | Library upload, deletion and explicit reprocess actions | Partial | [Library.tsx](../frontend/src/pages/Library.tsx), [PaperDetail.tsx](../frontend/src/pages/PaperDetail.tsx), [papers.py](../backend/app/api/routes/papers.py). Upload and deletion survive, and the reprocess API exists. No explicit ordinary-user reprocess button for a stored private PDF. |
| Lookup and import by identifier | Preview lookup and import by DOI, PubMed/PMC or other supported IDs | Partial | [papers.py](../backend/app/api/routes/papers.py#L116) supports verified DOI/PMID/PMCID/arXiv import. V2 combines lookup and import into one action. |
| Library organization | Filters, collections, membership operations and saved/uploaded statuses | Partial | [Library.tsx](../frontend/src/pages/Library.tsx) and [library.py](../backend/app/api/routes/library.py) retain collections, tags, notes and membership. Keyword/type/status filtering and bulk reassignment are reduced. |
| Reference file import | BibTeX/RIS upload or paste, preview, duplicate selection and destination collection | Partial | [Library.tsx](../frontend/src/pages/Library.tsx) and [library.py](../backend/app/api/routes/library.py#L148) import uploaded files and report results. No paste/preview workflow, duplicate choices or collection assignment during import. |
| Library and selected-paper export | Bulk selection and citation export modal | Partial | [library.py](../backend/app/api/routes/library.py#L188) exports whole library or collection in BibTeX, RIS or CSL-JSON. Arbitrary multi-select export is absent from the UI. |
| Paper AI summary | Paper detail summary and admin generation | Present | [PaperDetail.tsx](../frontend/src/pages/PaperDetail.tsx#L133) and [features.py](../backend/app/services/ai/features.py#L197) provide generation, cached summaries and excerpts. Admin-only generation control is gone. |
| Single-paper Q&A | `askPaperQuestionAction`, per-paper thread retrieval and history links | Partial | [PaperDetail.tsx](../frontend/src/pages/PaperDetail.tsx) and [papers.py](../backend/app/api/routes/papers.py#L311) answer from a paper and show excerpts. Q&A on the paper page has no persisted thread or legacy conversation deep link. |
| Quick multi-paper research | `/research`, corpus/paper selection, synthesis and evidence view | Partial | [Research.tsx](../frontend/src/pages/Research.tsx), [tools.py](../backend/app/api/routes/tools.py#L96) and [GroundedAnswerView.tsx](../frontend/src/components/GroundedAnswerView.tsx). Explicit library selection and excerpts survive. Legacy corpus discovery, preselected deep links and separate exact-chunk lookup are reduced. |
| Deep agent workspace | `/agent`, start/continue/reopen runs, process trace, comparison matrix and structured brief | Missing | Generic Q&A in [Research.tsx](../frontend/src/pages/Research.tsx) does not implement the agent workflow, evidence tables, trace or continuation. |
| Unified research history | `/conversations`, `/history`, `/conversations/[id]`, type filters and links | Partial | [Research.tsx](../frontend/src/pages/Research.tsx) and [tools.py](../backend/app/api/routes/tools.py#L194) support multi-paper list/detail/delete and bounded history with evidence status. Single-paper and deep-agent threads, type filters and old routes are absent. |
| Document dashboard | `/editor`, document CRUD, search and type filters | Partial | [Documents.tsx](../frontend/src/pages/Documents.tsx) lists, creates and deletes. Rename is available in [Editor.tsx](../frontend/src/pages/Editor.tsx). Dashboard search, type filtering and inline rename menu are absent. |
| Guided manuscript templates | Document types, study designs, suggested objectives, editable sections, writing guidance | Present | [Documents.tsx](../frontend/src/pages/Documents.tsx) and [templates.ts](../frontend/src/lib/templates.ts). V2 uses editable multiline fields instead of per-section controls. |
| Rich text and draft persistence | `/editor/[id]`, toolbar, live counts, autosave, conflict resolution | Partial | [Editor.tsx](../frontend/src/pages/Editor.tsx) and [documents.py](../backend/app/services/documents.py) implement the core editor and conflict UI. Legacy live counts and several toolbar controls are reduced. Save issues are documented above. |
| Document source attachment | List library sources, link/detach paper, source drawer | Partial | Source CRUD exists in [documents.py](../backend/app/api/routes/documents.py#L86). [Editor.tsx](../frontend/src/pages/Editor.tsx#L75) cites from the library and automatically attaches sources. Explicit linked-source management is absent in the UI. |
| In-text citations and bibliography | Structured insertion and deletion, CSL numbering, style switching, reference-list insertion | Partial | [Editor.tsx](../frontend/src/pages/Editor.tsx) and [documents.py](../backend/app/services/documents.py#L291) render a generated bibliography and support cursor insertion. API supports more locator fields than the UI. No citation delete-record endpoint or insert-bibliography-into-canvas command. |
| AI rewrite | Rewrite selection, then apply result | Present | [Editor.tsx](../frontend/src/pages/Editor.tsx#L131) and [tools.py](../backend/app/api/routes/tools.py#L169). Uses a toolbar modal. |
| Selection popover and inline ghost autocomplete | Inline menu, suggestion display and keyboard acceptance | Partial | [Editor.tsx](../frontend/src/pages/Editor.tsx#L131) and [tools.py](../backend/app/api/routes/tools.py#L177) offer manual continuation/rewrite via modal. Ghost text and contextual selection popover are absent. |
| Evidence summary inside editor | Source drawer action, summarization dialog and insert-with-citation | Missing | The separate paper summary does not summarize and insert evidence inside a document. |
| Document revisions and recovery | List, preview, compare/restore and export historical snapshots | Partial | [documents.py](../backend/app/api/routes/documents.py#L153) lists, reads and restores revisions. The UI lists/restores. No comparison, revision preview UI or direct historical export. |
| Current document export | Markdown, text, HTML, BibTeX, RIS, JSON, DOCX, PDF | Partial | [documents.py](../backend/app/api/routes/documents.py#L187) exports DOCX/PDF. Historical parity and the export correctness findings still apply. Bibliographic files export separately from the library. |
| Citation generator | `/tools/citation-generator`, manual entry/edit, formatted and BibTeX output | Partial | [CitationTools.tsx](../frontend/src/pages/CitationTools.tsx) formats and copies references by identifier. Manual entry and dedicated BibTeX output are absent. |
| Citation style catalog and XML detail | Searchable/paginated style API, XML by style/revision, advanced style selector | Partial | [tools.py](../backend/app/api/routes/tools.py#L42) and [csl.py](../backend/app/services/citations/csl.py) expose ten curated styles. Catalog search, XML endpoints and revision pinning are absent. |
| Reference verification | Verification API, UI and scholarly metadata checks | Present | [CitationTools.tsx](../frontend/src/pages/CitationTools.tsx#L76) and [verify.py](../backend/app/services/citations/verify.py) check Crossref matches. Verdict quality issues are described above. |
| Admin overview | `/admin` navigation and operator overview | Present | [Admin.tsx](../frontend/src/pages/Admin.tsx) and [admin.py](../backend/app/api/routes/admin.py#L39) provide platform stats, job visibility and user management. |
| Admin paper search, create, edit, attach and delete | `/admin/papers`, new/edit forms, attach/upload, moderation and metadata management | Partial | [admin.py](../backend/app/api/routes/admin.py#L127) has an admin deletion endpoint. No dedicated paper admin list, create/edit/attach UI or broader metadata maintenance endpoint. |
| Admin processing and embedding operations | Processing log, reprocess, per-paper summary/embedding generation and corpus backfill | Partial | [Admin.tsx](../frontend/src/pages/Admin.tsx) lists and retries failed jobs. [processing.py](../backend/app/services/processing.py) embeds after extraction when configured. Per-stage logs, standalone embedding refresh/statistics and backfill are absent. |
| Admin CSL synchronization | `/admin/citations`, sync GET/POST, revision and catalog controls | Missing | [csl.py](../backend/app/services/citations/csl.py) loads fixed bundled styles. |
| CitedEvidence scholar tools | Tool list and allowlisted invocation routes, search/network/validation/OA tools | Missing | V2 has direct provider discovery, Crossref verification and OA lookup. No MCP/tool proxy, provider integration or paper-network tool. |
| Compatibility URLs | Redirects from `/saved`, `/articles`, `/tools`, `/tools/chat-pdf` and `/pricing`; old editor/citation/history links | Missing | [App.tsx](../frontend/src/App.tsx) uses current routes and a generic fallback. Old links need explicit redirects where destinations survive. |

### Legacy API route cross-reference

| Legacy route | V2 route or disposition |
| --- | --- |
| GET/POST `/api/auth/[...nextauth]`; POST `/api/auth/register` | Firebase SDK for sign-in and registration. `/api/v1/me` for app identity. |
| GET `/api/citations/styles`; GET `/api/citations/styles/[id]` | `/api/v1/citations/styles` lists bundled styles. No XML/revision endpoint. |
| GET/POST `/api/citations/sync` | Missing. |
| POST `/api/citations/verify` | POST `/api/v1/citations/verify`. |
| GET `/api/editor/[id]/pdf` | GET `/api/v1/documents/{id}/export?format=pdf`. |
| GET `/api/editor/[id]/revisions/[revisionId]/export` | Historical GET and restore are available. Direct snapshot export is missing. |
| GET/HEAD `/api/papers/[id]/pdf` | Verified GET `/api/v1/papers/{id}/pdf` for stored objects. No dedicated HEAD/redirect. |
| GET `/api/scholar/tools`; POST `/api/scholar/tools/[toolName]` | Missing. |

### Legacy server-action cross-reference

| Legacy module | Action coverage |
| --- | --- |
| `src/app/admin/papers/actions.ts` | Delete survives in the admin API. Create, update, attach PDF and dedicated summary/embedding/backfill admin actions are missing. Summary generation and embedding survive elsewhere. |
| `src/app/admin/processing/actions.ts` | Reprocess maps to admin job retry and the paper full-text route, with the reliability limits above. |
| `src/app/agent/actions.ts` | Start, continue, retrieve and list agent runs are missing. |
| `src/app/editor/actions.ts` | Document CRUD, library sources, source attach/detach, insert citation, rewrite, manual continuation and revision list/get/restore survive. Delete citation records, editor evidence summary and historical export are missing. Current export supports two formats. |
| `src/app/library/actions.ts` | Upload, remove, reprocess, list, collection CRUD and per-paper membership survive. Dedicated preview lookup, replace-all memberships, open-access lookup and two-step reference import are reduced or combined. |
| `src/app/papers/bookmark-actions.ts` | Add/remove library endpoints replace bookmark actions. |
| `src/app/papers/qa-actions.ts` | Ask survives. Single-paper conversation retrieval is missing. |
| `src/app/research/actions.ts` | Synthesis, selected paper metadata, library, thread list and messages survive. Evidence excerpts are included with answers. No separate direct passage-by-ID route. |
| `src/lib/discovery/import-actions.ts` | Federated search and server-side identifier import survive. |
| `src/lib/discovery/snapshot/snapshot-actions.ts` | Replaced with optional abstract-based overview with source excerpts. |

## Areas verified and test gaps

- Direct account lookup is UID-based. Normal paper and document routes scope data on the server, and the new optional-auth check prevents an uninvited or unverified principal from widening ordinary paper visibility. Old access links need an upgrade test.
- Download headers now use an ASCII fallback and UTF-8 filename. Private PDF downloads set `no-store` and stream server-side. The browser intentionally assembles the download as a blob. The remaining stream and PDF rendering issues are listed above.
- Relevance filters and rank execute before catalog pagination. The query includes deterministic tie-breakers. Database execution remained blocked locally.
- Citation runner checks exercised all ten styles with two sources and a repeated citation. IEEE returned `[1]`, `[2]`, `[1]`, and APA returned alphabetical bibliography IDs independently of citation order.
- Current API routing keeps the internal worker out of OpenAPI and its endpoint is guarded by audience and service identity checks. Source checks also confirmed Firebase audience/issuer checks, authenticated owner routes, per-hop PDF target validation, and that frontend citation HTML sinks call the sanitizer. The audit did not exercise cloud credentials or the live network boundary.
- The 33 frontend tests include UID changes, out-of-order profile replies, manual modal focus wrapping, guidance rendering and serialized queue calls. They do not cover an edit during export or restore, mobile drawer focus, or out-of-order research UI requests.
- The database tests that claim account closure use a mock deletion adapter, and the AI tests use a fake model and verifier. They confirm wiring rather than deployed token revocation or factual support against a live provider. The reported worker retry test raises before any SQL in the stub, so it does not exercise post-rollback expiration inside a real transaction.
- PostgreSQL upgrade, downgrade and drift, old-row migration behavior, and concurrency on a real database remain verification gates. CI should exercise a seeded previous schema as well as a fresh install, run Alembic drift checks, and include Python and citation-engine dependency advisory checks.

## Verification commands and results

| Directory | Command | Result |
| --- | --- | --- |
| Repo | `git status --short --branch`, `git log -20 --oneline --decorate`, `git rev-parse HEAD`, `git diff --stat 7538f73 HEAD` | Local `main` at `70431cb`, clean at the start. The remediation touched 70 files. GitHub compare confirmed its `main` resolves to the same commit. |
| Repo | `git diff --check 7538f73 HEAD` | Reported a trailing blank line in `frontend/src/pages/Home.tsx:341`. |
| Frontend | `npm test` | **33 passed** in 5 files. |
| Frontend | `npm run typecheck` | Passed. |
| Frontend | `.\node_modules\.bin\vite.cmd build` | Passed. |
| Frontend | `npm audit --audit-level=high --fetch-retries=0` | Blocked by DNS resolution for the npm registry. |
| Citation engine | `npm audit --omit=dev --audit-level=high --fetch-retries=0` | Blocked by DNS resolution for the npm registry. |
| Backend | `.\.venv\Scripts\ruff.exe check app tests alembic scripts` and `.\.venv\Scripts\ruff.exe format --check app tests alembic scripts` | Passed. 69 files formatted. |
| Backend | `.\.venv\Scripts\python.exe -m pytest -q --tb=short` | **144 setup errors**, 5 live cases deselected. Local PostgreSQL fixture connection at `127.0.0.1:6423` failed with Windows error 10013. No collected test bodies ran. |
| Backend | `.\.venv\Scripts\python.exe -m pytest -m live -q --maxfail=1 --tb=short` | Stopped at the first PostgreSQL setup failure before any scholarly API call. |
| Backend | `.\.venv\Scripts\python.exe -m pytest --noconftest -q tests/test_scholarly.py tests/test_audit_fixes.py -k 'test_parse_identifier or test_provider_mappers or test_merge_fills or test_same_title or test_title_matching or test_missing_year or test_surname or test_content_disposition'` | **23 passed**, 36 deselected. Set a loopback-only `TEST_PG_URL` to suppress embedded database startup during imports. No database fixture ran. |
| Backend | `.\.venv\Scripts\python.exe -m alembic upgrade head --sql` with local test settings | Generated migration DDL through `a1c4e9f2b7d3`. |
| Backend | `.\.venv\Scripts\python.exe -m alembic check` with local test settings | Blocked by the same PostgreSQL connection error. |
| Backend | `.\.venv\Scripts\python.exe -m pip check` | Passed. |
| Backend | `.\.venv\Scripts\python.exe -m pip_audit --disable-pip --no-deps --timeout 5 --progress-spinner off -r requirements.txt` | `pip-audit` 2.10.1 ran. Advisory lookup blocked by PyPI DNS. |
| Backend | Numbered CSL JSON requests piped to `node app/services/citations/engine/format.cjs` | **10 styles passed** direct runner smoke checks, including returned bibliography IDs and repeated citation numbering. |
| Backend | Inline `.\.venv\Scripts\python.exe -X utf8 -` checks of documents, export, grounding, citation verification, imports, deduplication and SQLAlchemy expiration | Reproduced the offline findings described above. SQLAlchemy expiration used in-memory SQLite, without claiming PostgreSQL worker execution. |
| Frontend | Inline `node --experimental-transform-types --input-type=module` importing `src/lib/saveQueue.ts` | Reproduced a successful export gate with a newer edit still pending. |
| GitHub | Read-only compare, combined status and pull-request workflow lookup | Confirmed both revision identity and that the connector returned no statuses or PR runs. CI outcome remains unverified. |

The release decision should account for the unresolved high-severity findings and the unavailable PostgreSQL and dependency-advisory results. This report proposes fixes and tests. No application code was modified.
