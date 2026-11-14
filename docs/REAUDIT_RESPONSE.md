# Response to the follow-up audit (`docs/PAPERAID_V2_REAUDIT.md`)

Every finding was checked against the code, reproduced where possible, and fixed. Each has at least one regression
test. Backend tests are in `backend/tests/test_reaudit_fixes.py` unless noted; frontend tests are in
`frontend/src/test/`. The full PostgreSQL suite (205 tests) ran locally and in GitHub CI on a fresh
PostgreSQL + pgvector service. A new CI **container** job runs `scripts/smoke_container.py` inside the production
image. Released to production as revision `paperaid-api-00008-cub` (schema `c7e2d9a41f05`) through the gated
release script.

| # | Sev. | Finding | Fix | Test |
|---|---|---|---|---|
| 1 | High | Production image lacks italic fonts | `fonts-dejavu-extra` installed. Missing italics fall back to the upright face. Coverage is checked before drawing. The container smoke test asserts real italic faces | `test_pdf_export_works_without_italic_font_files`, `test_dockerfile_installs…`, CI container job |
| 2 | High | Closed account's token still accepted | `closed_accounts` tombstone written first and the account deactivated. Unknown UIDs on the tombstone list are refused, so the profile can't be re-created (or a bootstrap admin re-promoted). One closure service serves the script and self-service | `test_closed_account_token_cannot_recreate_the_profile`, `…bootstrap_admin…`, `…closure_in_progress…` |
| 3 | High | Old library links bypass privacy | Library list, export and collection membership enforce *current* visibility. The migration deletes links created under the old policy (library, collections, document sources and citations) and redacts stored answers that used another person's private paper | `test_library_never_exposes…`, `test_migration_repairs_rows…` |
| 4 | High | Nested citations shift in exports | Citations are resolved by node identity (`citation_nodes` shared with rendering). Both exporters render every nested block, including lists, quotes and tables in cells | `test_citations_inside_table_cells…`, `test_export_maps_citations_by_node…` |
| 5 | High | Error handling after rollback | Immutable `Attempt` facts (job, paper, token, attempt number) are captured at claim time. No ORM attribute is read after a rollback | `test_failure_after_sql_work_still_records_the_outcome` |
| 6 | High | Null leases and stale workers | The migration gives old active jobs a lease, and a NULL lease counts as expired. Each claim gets a fencing token, and results plus job outcome publish in one transaction that locks and checks it. A delivery that finds a live lease returns RETRY (503) | `test_a_reclaimed_worker_cannot_overwrite…`, `test_delivery_during_a_live_lease…`, `test_jobs_without_a_lease…`, migration test |
| 7 | High | Unchecked AI text and hidden support | Model-written "gaps" are never shown; limitations use fixed wording. Quantities are checked as sign + number + unit against the claim's own quotes. Verified quote spans are returned with positions; excerpts are centred on them and highlighted in the UI | `test_ai.py` (12), `test_quantities_are_checked…`, `test_verified_quote_is_located…`, `test_answers_return_the_verified_quote…`, `guidance.test.tsx` (highlight) |
| 8 | Med | Autosave gate passes with pending edits | The save queue drains until nothing is pending. Editing is frozen during export and restore, and restore reloads title, content **and style** | `saveQueue.test.ts` (8, incl. the reproduction) |
| 9 | Med | Restore without a version | `base_version` is required (422 otherwise) | `test_restore_with_a_stale_version…`, `test_documents.py` |
| 10 | Med | Wrong first author or year verified | The author is the first name before the title (initials skipped). The year must appear outside the title. Contradictions give "mismatch" with the field named | `test_second_author_surname…`, `test_a_year_inside_the_title…` |
| 11 | Med | Unverified catalog data survives; insert race | `metadata_source` provenance. Registry imports overwrite non-registry records (fields and authors). First insert uses a savepoint and re-reads on conflict | `test_registry_import_replaces_unverified…`, `test_concurrent_first_imports…` |
| 12 | Med | Normaliser TypeErrors, char vs byte limit | Type-checked discriminants (`_kind`), string-only marks and alignment. The limit is in encoded bytes. Over-long text is rejected, not cut | `test_non_string_types_and_unicode_size…` |
| 13 | Med | PDF silently drops glyphs | Font coverage is checked before drawing, giving a clear 422 `PDF_UNSUPPORTED_CHARACTERS` (use Word). DejaVu Sans fallback and HarfBuzz text shaping for right-to-left scripts | `test_pdf_refuses_characters…`, `test_non_latin_titles_download` |
| 14 | Med | Storage write/commit gaps | An upload intent is committed before the object write and cleared in the commit that owns it; otherwise maintenance deletes after a grace period. Paper ids are generated up front, so no DB connection is held during the write. Re-uploading the same file is idempotent. A dispatch failure keeps the upload | `test_object_written_but_commit_failed…`, `test_reupload…`, `test_dispatch_failure_after_upload…` |
| 15 | Med | One-shot maintenance, starvation | Deletions are claimed with a short lease, failures back off exponentially, and exact keys are used for immediate cleanup. `POST /internal/maintenance` exists for Cloud Scheduler (command in DEPLOYMENT.md; awaiting approval) and Admin has a "Run maintenance" button | `test_failing_old_deletion_does_not_starve…`, `test_internal_maintenance_endpoint…` |
| 16 | Med | Imports and exports truncate silently | Parsers report the real count and >500 entries is rejected with a message. The library is paged (`X-Total-Count`, CORS-exposed) with "Load more"; editor and research pickers search server-side. Export is complete and streamed | `test_oversize_reference_files…`, `test_library_pages_and_complete_export`, `test_paging_headers…` (test_accounts.py) |
| 17 | Med | Thread history mispairs turns | `turn_index` is assigned under a conversation row lock; the UI and model context order by turn, then role. The migration backfills turns | `test_thread_turns_pair…`, migration test |
| 18 | Med | Dedupe merges thin records, misses bridges | Union-find over records. Strong ids merge transitively; title + year needs the same first author (or journal). Conflicting identifiers never join. Identifier resolution skips conflicting providers | `test_thin_records_do_not_merge…`, `test_audit_fixes.py` dedupe tests |
| 19 | Med | Release gate doesn't bind promotion | `deploy/release.sh`: `set -euo pipefail`, validates the readiness JSON schema, promotes `--to-revisions REVISION=100`. `/ready` returns 503 when `alembic_version` is missing | `test_release_script_is_fail_fast…`, `test_ready_reports_schema_not_ready…` |
| 20 | Med | Slow I/O holds DB connections | The query embedding is fetched before SQL, and the vector query runs in a savepoint. The connection is released before the citation engine and storage writes. OIDC verification runs off the event loop | covered by the suites above plus `test_embedding_outage…` |
| 21 | Low | 21 anonymous identifiers rejected late | The UI shows a count and the applicable limit (20 signed-out, 50 signed-in) and blocks submission over it | `guidance.test.tsx` ("Citation generator limits") |
| 22 | Low | Panels show misleading empty or stale state | The dashboard uses `/me/progress` with error and retry states. Research binds an answer to the thread that asked it | `guidance.test.tsx` (dashboard error) |
| 23 | Low | Mobile drawer lacks dialog focus | Shared `useDialogFocus` gives the narrow-screen drawer focus-in, Tab trapping, Escape and focus return | `auth.test.tsx` (Modal focus via the shared hook) |
| 24 | Low | Stream client leak on failed open | `StoredStream` owns the response and client. Opening failures close the client, and the response's background task closes it on disconnect (idempotent) | `test_gcs_stream_closes_its_client…` |

## Original 28 findings marked "partial" in the follow-up

All partial items (2, 3, 4, 5, 6, 7, 12, 13, 14, 16, 17, 18, 20, 23, 26, 27, 28) are covered by the rows above.
Finding 22 (legacy data) remains a maintainer decision (see DEPLOYMENT.md).

## Recommendations adopted from the follow-up review

- **Privacy before expanding the beta.** Consent gate with separate records for the Terms, Privacy and AI notices
  and the age confirmation, and optional choices off by default. Self-service data export and account deletion.
  18+ only and invite-only.
- **AI stays off for general testers** until a small, capped tester group has been evaluated on real papers from
  their fields (DEPLOYMENT.md, "Turning on AI").
- **Manual citations are private and labelled "User-supplied details".**
- **A focused style set testers need** (18 styles across disciplines) instead of the entire repository.
- **Measurement-driven infrastructure.** Container smoke test, gated releases, Error Reporting and a smaller DB pool
  now. Staging, scheduler and uptime alerts are prepared and await approval. Redis, a separate worker and a
  self-hosted OpenAlex index wait until load tests show the need.
