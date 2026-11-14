# Response to the staging audit

Response to [PAPERAID_V2_STAGING_AUDIT.md](PAPERAID_V2_STAGING_AUDIT.md) (`2248a45` through `e37856a`). All 10
findings are fixed, each with a test. Every new test was also run against the previous code, where it fails (the
two styling cases in finding 10 already held and are kept to pin the rule down).

- Backend: `backend/tests/test_staging_audit.py` (20 tests) and `backend/tests/test_release_audit.py` (10 new
  release-script tests).
- Frontend: `frontend/src/test/lib.test.ts`, `auth.test.tsx`, `reaudit.test.tsx`, `writing.test.tsx` and the new
  `consentParking.test.tsx`.
- Full suites: **285 backend, 125 frontend** (was 255 and 108). There is no schema change.

| # | Severity | Finding | Fix | Tests |
|---|---|---|---|---|
| 1 | High | A staging release could run the production migration job | `DEPLOY_ENV=production\|staging` is **required**, and `SERVICE` / `MIGRATE_JOB` can no longer be set. The service, migration job, database secret, runtime service account, bucket, queue and Firebase project all come from one profile. Before any change (the lock included), the script reads the live service and job and refuses if either runs as another identity or uses another database secret, or if the service points at another bucket, queue or Firebase project. The lock is per service, and the service is derived from the environment. | Fake cloud: no `DEPLOY_ENV` → refused with zero cloud calls. `SERVICE` or `MIGRATE_JOB` set → refused. A staging release touches only `paperaid-migrate-staging` and `paperaid-api-staging`. Six mismatched live configurations (job on the production secret, wrong identity, wrong bucket, queue or Firebase project) → refused with no mutating call. |
| 2 | High | Closure could miss a PDF attached by the full-text worker | One closure fence, `processing.lock_active_owner`, used by uploads and the worker: it share-locks the owner's row and requires the account to be active. `attach_pdf` takes it for every private paper. The worker takes it **before** its job lock, both when attaching the PDF and when publishing the text, so the lock order matches a closure's (owner row, then job and paper rows by cascade) and cannot deadlock. If the account is closed, the fetched object is queued for deletion and deleted at once, and the job fails as `ACCOUNT_CLOSED`. Objects from a worker that dies between writing and attaching keep their upload intent and are deleted by maintenance after `UPLOAD_GRACE` (1 hour); the closure does not wait for those. | PostgreSQL, both winning orders. **Closure first:** the worker discards its object (deleted, not merely queued), and no paper remains. **Worker first:** the closure is blocked by the fence until the attachment commits, then sees the new file and deletes it; it completes with `pending_keys == []`. Both fail with the fence disabled. |
| 3 | Medium | A request could use the previous account's token after a switch | The token getter remembers which Firebase user it started with and refuses (`SESSION_CHANGED`) if a different account, or no one, is signed in when the token arrives. Readiness and token refresh are bounded (15 s): a stall fails the request (`AUTH_TIMEOUT`) and never sends it anonymously. The API client tags every request with a session number. When the identity changes, `beginSession()` (called with `queryClient.clear()`) aborts in-flight requests, and their responses and any consent prompt they trigger are dropped. | A's token arriving after B signs in, and sign-out during a refresh, are both refused. A stalled restore gives `AUTH_TIMEOUT`. A request whose token arrives after the switch is never sent. An in-flight request is aborted, and its `CONSENT_REQUIRED` answer does not reach the new account. |
| 4 | Medium | A closed palette could still insert, and StrictMode broke the bookmark | The bookmark is created in a layout effect with symmetric cleanup (before any further input), so StrictMode's mount, unmount and mount leaves exactly one live tracker: the one in use. Closing the palette stops it and cancels any citation in flight (nothing is inserted later). Each request has an id and the editor keys the palette by it, so a new request gets a fresh bookmark, query and focus. | **Closed while in flight:** the draft keeps changing, and nothing is inserted. **StrictMode:** an edit before the target during the request is followed, so the citation lands after "New Claim" (the old code put it inside the word), and no listener is left after closing. |
| 5 | Medium | An export could hold two connections from the same pool | The archive ends its own transaction before opening each document's render session, so an export never holds two connections. Values stay loaded (`expire_on_commit=False`). | A real one-connection pool (`pool_size=1`, `max_overflow=0`) with two concurrent exports: both archives contain the Word file. On the old code the render session times out and the Word file goes missing. |
| 6 | Medium | Permanent PDF refusals were retried as transient | `fetch_pdf` now separates `PdfSourceRefused` (other 4xx, not a PDF, too large, redirect problems), which is final for that location, from `UpstreamError` (408, 425, 429, 5xx, DNS and transport errors), which is transient. Transport errors no longer escape, so the next location is still tried. Candidates are produced lazily: recorded, arXiv and Europe PMC locations first, and the Unpaywall and OpenAlex DOI lookups run only if those fail. **This explains the staging 503s:** Europe PMC's 403 was treated as transient, so attempts 1 and 2 answered 503 and attempt 3 failed for good (204). | 403, 404 and an HTML landing page are refusals; 503 and 429 are transient; a read timeout is transient. A job whose only location refuses fails once (`DONE`, `attempts == 1`), not `RETRY`. A refusal moves on to the next location, which succeeds. DOI lookups run only after the known locations. |
| 7 | Medium | Malformed Cloud Tasks error bodies | `_error_status` accepts any body shape: invalid JSON, `null`, lists, and a non-object `error` or `status` all give `""`. A 409 counts as queued only with `ALREADY_EXISTS`. `ABORTED` and an unrecognised 409 are uncertain (the job stays queued for lease recovery), never accepted. | Eight replies: 503 `null`, 500 list and 502 string-error are uncertain. 400 list-error and 400 numeric status are rejected. 409 `ABORTED` and 409 plain text are uncertain. 409 `ALREADY_EXISTS` is accepted. |
| 8 | Medium | Rewrite flattened explicit line breaks | Every non-text inline node (line breaks as well as citations) is kept exactly in place after the text before it. It is never sent to the model and never dropped. The change signature includes each kept node's identity. Text between two kept nodes is still rewritten as one piece; the model is instructed not to add or reorder claims, and the six-piece limit stays client-side (each piece is a normal rate-limited `/ai/rewrite` call). A server-enforced batch limit would need a batch endpoint, which is noted for when AI goes live. | "First line ⏎ Second line": two separate requests, the proposal reads with the line break, and the applied content is text, hardBreak, text. Fails on the old code. |
| 9 | Low | Autosave retried every 10 s behind the consent overlay | A save refused with `CONSENT_REQUIRED` is **parked**: no retry timer, and the status reads "Will save once you accept the updated terms". It flushes exactly once when the loaded profile shows this account's consent is current, either after acceptance or straight away if a reload shows it already was (e.g. accepted in another tab). Network failures keep the ordinary retry. Implemented in `lib/consentParking.ts`. | Parked: no flush while consent is pending, exactly one after acceptance. Already-current consent flushes immediately. Other errors are not parked. |
| 10 | Low | No space between a quote and a preceding citation | The spacing rule looks at the node before the insertion point, not only plain text. A space is added after a word, punctuation or another citation; none after a space, an opening bracket or quote, a line break, or at a paragraph start. Inserted quotations and citations never take surrounding formatting (bold, links). | Quote after a citation, adjacent citations, after a line break, and inside bold or a link (stays plain). |

## Found while verifying finding 3 on staging (new, fixed)

**Other tabs never noticed a sign-out or account switch.** `firebase.ts` called `getAuth()`, which starts with
IndexedDB storage and attaches Firebase's cross-tab listener there, and then `setPersistence(browserLocalPersistence)`.
That moves the session to `localStorage` but leaves the listener on the now-empty IndexedDB store. After signing out
in tab B, tab A kept showing and acting as the old account, refreshing its own token, with no time limit (a
shared-computer risk). Auth is now created with `initializeAuth(app, { persistence: browserLocalPersistence,
popupRedirectResolver })`, so the listener watches the store the session is in. Existing sessions are kept, since
they are already in `localStorage`.

Verified in two staging tabs with the new build:
- **Sign-out:** tab A redirected to sign-in within 3 s, with no data left on screen. The previous build stayed
  signed in.
- **Account switch:** after tab B signed in as another account, tab A showed that account (its own consent screen)
  and nothing of the previous one.
- **Restored session:** a directly opened paper page showed "In your library".

The session binding from finding 3 makes sure nothing started under the old account completes into the new one.

## Also changed

- **Staging frontend deploy:** `deploy/deploy-staging-frontend.sh` now refuses to publish if any production origin
  survives anywhere in the generated config, or if a staging origin is missing from the CSP.
- **Docs:** the release commands in `DEPLOYMENT.md`, `HANDOFF.md`, `README.md` and `AGENTS.md` now use `DEPLOY_ENV`.

## Notes on the auditor's other observations

- **Infrastructure verification.** Codex could not read the live configuration. The maintainer read it with
  read-only `describe` calls when writing finding 1's profiles, and both environments match:

  | | Production | Staging |
  |---|---|---|
  | Service and migration job identity | `paperaid-api@` | `paperaid-staging-api@` |
  | Database secret | `paperaid-database-url` | `paperaid-staging-database-url` |
  | Bucket | `paperaid-papers-…` | `paperaid-staging-files-…` |
  | Queue | `paper-processing` | `paper-processing-staging` |
  | Firebase project | `paperaid` | `paperaid-staging` |
  | Task target and OIDC identity | its own service URL, `paperaid-tasks@` | its own service URL, `paperaid-staging-api@` |

  The release script now re-checks these on every release.
- **Staging maintenance.** There is no scheduler for staging (closures there complete inline, as the staging run
  showed). Add one if staging is used to validate deferred deletion.
- **Contact email.** `CONTACT_EMAIL` stays unset on staging until the maintainer chooses a monitored project
  mailbox, as recommended.
- **Production frontend.** It still predates `5d2c565`. Finding 3 and the cross-tab fix are in, and the sign-in
  restore, sign-out and account-switch checks passed on staging with this build. It is ready to ship once the
  maintainer approves; the backend fixes (findings 2, 5, 6 and 7) go out separately with
  `DEPLOY_ENV=production deploy/release.sh`.
