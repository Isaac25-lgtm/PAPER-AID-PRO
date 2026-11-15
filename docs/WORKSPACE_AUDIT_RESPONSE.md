# Response to the workspace audit

Response to [PAPERAID_V2_WORKSPACE_AUDIT.md](PAPERAID_V2_WORKSPACE_AUDIT.md) (`main` at `ef7f8d9`) and
`CODEX_HANDOFF_FOR_CLAUDE.md`. All 8 findings are fixed, each with a test.

**Tested against the previous code.** Every new regression fails on the code before this change:

| Area | Result on the old code |
|---|---|
| Release checks | 21 of 22 failed |
| Lock order and lookups | 4 of 4 failed (the two lock-order tests hung) |
| Editor isolation | 3 of 3 failed |
| Re-consent recovery | 2 of 2 failed |
| Drawer | 2 of 2 failed |

The one release case that already passed is an inline database URL on the migration job, which was already refused;
it now stays refused and is redacted.

There is no schema change.

| Suite | Tests | Earlier |
|---|---|---|
| Backend | 314 | 285 |
| Frontend | 144 | 135 |

| # | Severity | Finding | Fix | Tests |
|---|---|---|---|---|
| 1 | High | A pending autosave from one draft could overwrite another | **One editor instance per document.** The route renders `<EditorPage key={id} />`, so draft B never reuses A's save queue, version, title, content, palette or load-once state. Leaving A unmounts its instance, which flushes A's pending edits to A. **A dismissed create** no longer navigates: once the New document dialog is closed or unmounted, a late completion only refreshes the document list and counts. | `editorIsolation.test.tsx`, which drives the real app router, sidebar, dialog and editor: (a) A is edited with equal versions, B opens before the autosave, and A's title reaches A only while B shows its own title and body; (b) a create is completed after the dialog is dismissed and the person moved to A, and they stay on A while the list refreshes. |
| 2 | High | Release checks stopped before the candidate that receives traffic | The environment profiles moved to `deploy/release_checks.py` as one source of truth. They cover identity, database secret reference, bucket, Firebase project, `ENV`, and the **complete task routing**: project, location, queue, target URL and OIDC sender (the audience is the target URL). The live service is checked against all of it and the migration job against identity and database. `EXTRA_DEPLOY_FLAGS` is **allowlisted**: only `--update-env-vars` / `--update-secrets` for tuning settings, including gcloud's `^D^` delimiter form, checked before any cloud call. After the no-traffic deploy, the script runs `gcloud run revisions describe` on the **exact tagged candidate** and refuses unless its bindings match the profile and it runs the digest just built. No traffic moves on refusal and the lock is released. | Fake cloud: the audit's probe (a candidate whose task target changed, with green readiness) is refused before readiness and promotion. Also covered: candidate drift in OIDC sender, database, bucket, Firebase, identity and image digest; live mismatches in task target, sender, project and location; seven disallowed overrides (e.g. `TASKS_TARGET_URL`, `DATABASE_URL` in a list, `GCS_BUCKET` via `^\|^`, `--service-account`, `--set-env-vars`, `--image`); allowlisted tuning still deploys. |
| 3 | Medium | Worker startup could deadlock with an account closure | **One lock order** for every joint job and paper write: the owner's account row (the closure fence) first, then the job, then the paper. A closure also takes the account row before its cascade, so the two serialise instead of deadlocking. This order now covers worker start (`run_job` before `_hold` and the paper status write), failure finalisation (before `_finish` and the paper update), attachment and publishing (as before). When the account is closing, the worker records nothing and returns. Lease reclaim spans many owners and cannot take each fence, so it retries a PostgreSQL deadlock (bounded, 3 attempts). The closure retries a lost deadlock at once (bounded) instead of waiting for maintenance; every step is idempotent. | PostgreSQL, synchronised on real lock waits (`pg_stat_activity`, not sleeps): a closure arriving while a job starts, and while a job records its failure, both complete with no recorded error and no retry. A closure that loses a deadlock runs again at once. |
| 4 | Medium | Release validation could print an inline database credential | Diagnostics describe a Secret Manager value as `secret:<name>` and an inline secret-bearing value only as "an inline value". The inline value is never read into the message. The same reporting covers the service, migration job and candidate. | A synthetic inline URL on the service, the job and the candidate: the run is refused and neither the password nor the host appears in output. |
| 5 | Medium | Autosave could park indefinitely after a failed policy reload | `profileError` is now in the auth provider's memo, so consumers see it. A reload triggered by `CONSENT_REQUIRED` retries automatically (bounded: after 2 s and 5 s). If it still fails, the route guard shows a banner **above the page**, which stays mounted with its unsaved edits, offering **Try again** (`refresh()`). A successful reload either shows the consent overlay or wakes the parked queue, which flushes once for the same account (`useConsentParking`, unchanged). An account switch still drops the old session (staging audit). | Auth provider: three failed reloads stop, expose the error and keep the profile; the next success clears it. Guard: banner and retry shown while the edited draft stays mounted. Existing parking tests cover the single flush. |
| 6 | Medium | Transient DOI lookup failures ended PDF processing permanently | Unpaywall and OpenAlex outages (`UpstreamError`) are no longer swallowed. The candidate stream tries the other service, offers any location found, and raises the outage only after every alternative is exhausted. The worker then treats the job as retryable. A real "not found" stays terminal. | Both lookups down: the job is re-queued (`RETRY`), and the paper says the services could not be reached. No location anywhere: one terminal failure. One lookup down while the other delivers a PDF: success. |
| 7 | Medium | The phone drawer left keyboard focus behind it | The drawer is a modal (`role="dialog"`, `aria-modal`, "Menu") using the shared `useDialogFocus`: focus moves in, Tab and Shift+Tab stay inside, Escape closes it and focus returns to the menu button. The page behind is `inert` while it is open. Each sidebar instance uses `useId` for its heading IDs. | Focus inside on open; 30 Tabs and a Shift+Tab stay inside; Escape returns focus to the opener; the page is inert only while open; no duplicate IDs with both sidebars mounted. |
| 8 | Low | Recent documents and counts could be stale after writing | Each save updates the cached document list (title, words, edited time, version). Leaving the editor refreshes the list once after its queue drains. Restore refreshes the list. Create and delete refresh the list and the progress counts. | Warm cache: a renamed draft's new title and version appear in the cached list right after saving; the late-create test checks the list refresh. |

## Also changed

**Clearer section borders** (requested by the maintainer during this round). Borders and dividers now use their own
firmer tokens (`--c-line-100/200/300` in `theme.css`), mapped to `border-slate-*` and `divide-slate-*` in Tailwind.
Backgrounds that share the slate scale are unchanged.

| Card border against the card | Before | After |
|---|---|---|
| Light | 1.27:1 | 1.56:1 |
| Night | 1.18:1 | 1.74:1 |

A test keeps card borders at least 1.5:1 against cards and 1.4:1 against the page, in both modes.

**Staging notes.** The 503s are now attributed correctly in [STAGING_TEST_RUN.md](STAGING_TEST_RUN.md): the job was
committed before dispatch, and the 403 was being retried as if transient (fixed earlier in `c82bce6`).

**CI.**
- The backend job that hung on `ef7f8d9`/`c27863a` came from a test that never bounded its wait on a lock; the race
  tests are now bounded.
- A completed Linux run on the commit with these fixes is required before any production release.

## Release status

| | Status |
|---|---|
| Staging | Holds these fixes after verification there. |
| Production frontend | Not deployed. The workspace (sidebar dashboard) and finding 1 ship together, after the maintainer approves. |
| Production API | Not deployed. Waits for the maintainer's approval and a green Linux CI run; the release then uses the new candidate checks. |
| Inherited IAM and database isolation behind the secret reference | Remain as the audit recorded: observed, not independently proven. |
