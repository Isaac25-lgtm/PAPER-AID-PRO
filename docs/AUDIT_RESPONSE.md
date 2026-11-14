# Response to the v2 audit (`docs/PAPERAID_V2_AUDIT.md`)

Every finding was reproduced in code and fixed, with a regression test unless marked otherwise. The tests are in
`backend/tests/test_audit_fixes.py` and `backend/tests/test_ai.py`, plus the frontend tests in
`frontend/src/test/saveQueue.test.ts` and `frontend/src/test/auth.test.tsx`.

| # | Finding | Fix | Test |
|---|---|---|---|
| 1 | Firebase UID change inherits account | UID is the only account key; a different UID with an existing email gets 409 `ACCOUNT_CONFLICT`. Linking is an explicit operator action (`scripts/relink_user.py`, which requires the new identity's email to be verified) | `test_new_firebase_identity_…`, `test_admin_role_is_not_inherited…` |
| 2 | Reference files write unverified public data | Identifiers are resolved at the registries first, and only registry metadata reaches the shared catalog. Unresolvable entries become private | `test_reference_import_uses_registry_metadata…` |
| 3 | Grounding accepts unsupported prose | The model returns claims with verbatim quotes. The displayed answer is assembled only from claims that pass four checks: ids exist; quotes appear in the cited evidence; numbers appear in the claim's own quotes; an independent model support check (`AI_VERIFY_CLAIMS`). Unsupported claims are removed and counted. Insufficient-evidence answers use a fixed message. Summaries (overview included) use the same checks | 10 tests in `test_ai.py` |
| 4 | Concurrent saves overwrite | Row lock (`SELECT … FOR UPDATE`) on save and restore. Restore accepts `base_version` | `test_concurrent_saves…` (two real concurrent requests ×3), `test_restore_with_a_stale_version…` |
| 5 | Jobs stuck queued/running | Partial unique index (one active job per paper), atomic claim with lease, dispatch-failure rollback, lease-expiry reclaim, retryable vs terminal errors (internal endpoint returns 503 for retryable ones, capped at 3 attempts) | 7 tests (`test_dispatch_failure…`, `test_abandoned_running_job…`, …) |
| 6 | Export misplaces citations | One rendered entry per citation node, with `text: null` / `missing_ids`. Both exporters resolve by node | `test_export_never_moves_a_citation…` |
| 7 | Admin privacy bypass | No admin exception in visibility or ownership. Moderation only via audited `/admin` endpoints | `test_admins_cannot_read_private_papers…` |
| 8 | Bootstrap admin re-promoted | `ADMIN_EMAILS` promotes only users whose role no admin has changed (audit log) | `test_bootstrap_admin_demotion_persists` |
| 9 | Public reads skip invite/verification | Optional principal is anonymous unless invited and verified | `test_removed_tester_loses…`, `test_unverified_account…` |
| 10 | Query cache outlives identity | Cache cleared on any UID change (incl. other tabs); stale `/me` responses discarded | `auth.test.tsx` |
| 11 | Anonymous limits shared / amplified | Per-caller buckets (trusted last `X-Forwarded-For` hop, hashed) plus a global ceiling. Providers deduplicated. Formatting is one engine call. Anonymous identifier cap | `test_anonymous_limits…`, `test_duplicate_providers…` |
| 12 | Autosave races | `SaveQueue`: serial saves. Export refuses unless the save succeeded. Restore saves first or asks before discarding. Close warning while a save is in flight | `saveQueue.test.ts` (7 tests) |
| 13 | Discovery merges distinct works | Strong ids decide. Title+year only as fallback, never across conflicting ids, needs agreeing first authors. Unicode-aware titles | 2 unit tests |
| 14 | Verification overstates | `verified` requires title, year and author all compared. Author is searched only before the title. Per-field states are shown | 2 unit tests |
| 15 | Unicode filenames → 500 | RFC 6266/5987 `Content-Disposition` with ASCII fallback. PDF export also gained fallback fonts and a clear 422 for scripts it cannot draw (export to Word instead) | `test_non_latin_titles_download` |
| 16 | Malformed editor trees | Schema-based normaliser (parent/child rules, typed attrs, node and depth limits) | `test_malformed_editor_trees…` |
| 17 | Orphaned PDFs | `storage_deletions` written in the same transaction as row deletes, then retried by maintenance. Upload commits row and pointer together | `test_failed_object_delete…`, `test_failed_upload…` |
| 18 | Firebase identity survives deletion | `delete_user.py` deletes the Firebase account first, which revokes all sessions | `test_account_closure…` |
| 19 | Relevance after pagination | Filter, rank and paginate in one SQL query with a deterministic tie-breaker | `test_relevance_sort…` |
| 20 | Research history drops context/status | Messages store `insufficient_evidence` and `gaps`. Follow-ups get a bounded, explicitly not-evidence context. An emptied selection stays empty | `test_research_synthesis_persists…` |
| 21 | Batch numbering restarts | One shared citeproc processor; bibliography ids returned; duplicates of the same work dropped | `test_batch_formatting_numbers…` |
| 22 | No legacy data migration | Documented decision and procedure (DEPLOYMENT.md). Needs the maintainer to decide whether any legacy data matters | — |
| 23 | Embedding failure takes text offline | Embedding is best-effort after success. Vector search falls back to keyword search | `test_embedding_outage…` |
| 24 | Private PDFs buffered and cached | Streamed (constant memory), `no-store`, DB connection released first | `test_private_pdfs_are_streamed…` |
| 25 | Collection membership race | Library-item row lock in both paths; conflict-safe insert | `test_collection_membership…` |
| 26 | Long transactions / unbounded reads | Commit before provider/LLM calls. Library, thread and export reads bounded. Bucket purge scheduled (maintenance) | covered by existing suites |
| 27 | Mobile / keyboard access | Responsive editor drawer, style selector on all sizes, actions visible on touch and focus, modal focus trap and restore | `auth.test.tsx` (Modal) |
| 28 | Deployment order | Build → migrate → deploy `--no-traffic` → `/ready` schema gate → switch | `test_ready_fails_when_schema…` |

Schema change: Alembic revision `a1c4e9f2b7d3`. It is additive, and the upgrade → downgrade → upgrade cycle plus `alembic check` showed no drift.
