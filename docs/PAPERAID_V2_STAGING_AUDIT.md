# PaperAid Pro staging audit

14 November 2026. Reviewed `main` from `2248a45` through `e37856a`, including all 13 fixes in [the hardening response](HARDENING_AUDIT_RESPONSE.md) and the three changes from [the signed-in staging run](STAGING_TEST_RUN.md). The application changes end at `5d2c565`. `e37856a` updates the brief. The brief identifies production API revision `paperaid-api-00018-dul`, schema `f2a6c8e4b1d3`, and a frontend that predates `5d2c565`. These production facts are maintainer-reported. The audit made no production or staging infrastructure changes.

## Findings

### [SEVERITY: high] The staging service and migration job can be pointed at different environments

- **Where:** [release.sh:14](../deploy/release.sh#L14), [release.sh:27](../deploy/release.sh#L27), [release.sh:66](../deploy/release.sh#L66), [DEPLOYMENT.md:90](DEPLOYMENT.md#L90).
- **What:** Release accepts independent service and migration-job variables with production defaults. Both migration jobs and services now live in the same Google Cloud project.
- **Impact / failure scenario:** An operator intends a staging release and supplies only the staging service. The script can update and execute the default production migration job before deploying or probing staging. The lock applies to the API service, so it does not serialize this wrong-target migration against a production release. The printed staging example includes both settings, and there is no evidence that a mis-targeted migration occurred.
- **Evidence:** The script establishes `SERVICE` and `MIGRATE_JOB` independently, then updates and executes the selected migration job before the readiness gate. Current production validation checks that required settings exist but does not assert the Firebase, storage and queue bindings against a deployment identity.
- **Fix:** Select a single explicit environment that derives or validates the service, migration job, database-secret binding, identity, bucket, queue and lock before any cloud command can mutate resources. Reject mixed or incomplete combinations in fake-cloud tests. Prefer staging-scoped deployment permissions that cannot update the production migration job.

### [SEVERITY: high] Account closure still has an unfenced path for private PDF attachment

- **Where:** [papers.py:189](../backend/app/api/routes/papers.py#L189), [papers.py:312](../backend/app/api/routes/papers.py#L312), [processing.py:262](../backend/app/services/processing.py#L262), [accounts.py:135](../backend/app/services/accounts.py#L135), [library.py:242](../backend/app/api/routes/library.py#L242).
- **What:** The user-row fence covers a new multipart upload. The background worker can attach a newly fetched PDF to an existing private record without taking that fence.
- **Impact / failure scenario:** A private reference has a DOI or arXiv ID and no stored PDF, for example from a reference-file import whose registry lookup did not resolve at the time. A full-text job starts. Closure reads the owned papers before the worker attaches a new PDF. If the worker commits before the user deletion cascades the paper, its confirmed object key is absent from closure's cleanup list. The worker can clear its upload intent before the cascade. This is a source-derived interleaving and needs a PostgreSQL regression with two sessions.
- **Evidence:** `request_full_text` permits the owner to queue a private record. `pdf_candidates` tries identifier-derived locations. `_obtain_pdf` checks the job lease, then calls `attach_pdf` and commits; it never checks the private owner under the closure lock. The staging test's 401 occurred earlier. The deterministic CI test reaches the multipart route's 403 and explicitly observes the uploaded object in the cleanup queue while closure is already marked complete.
- **Fix:** Reuse one owner-activity fence for every private PDF attachment with a consistent lock order. Keep closure pending for any object durably associated with that owner's unfinished upload, or clearly document asynchronous deletion and its timing. Test both winning orderings for multipart attachment and worker attachment, plus cleanup after refusal.

### [SEVERITY: medium] A request can use an old account's token after a session switch

- **Where:** [auth.tsx:43](../frontend/src/lib/auth.tsx#L43), [auth.tsx:124](../frontend/src/lib/auth.tsx#L124), [api.ts:60](../frontend/src/lib/api.ts#L60), [api.ts:87](../frontend/src/lib/api.ts#L87).
- **What:** `authStateReady()` waits for initial restoration. The token getter does not recheck the identity after awaiting `getIdToken()`, and request completion and consent notifications are not bound to the identity that started the request.
- **Impact / failure scenario:** A request starts while account A is active. The browser switches to B or signs out during a pending token refresh. The request can still dispatch as A. An old response can reach a component or run a callback after the switch. Owner checks still prevent an account using its own token from viewing another account's records. No cross-account disclosure was demonstrated.
- **Evidence:** The focused test resolves A's token after setting the active user to B and receives A's token. The production getter waits for initial Firebase state and returns the captured user's token promise. `queryClient.clear()` and `/me` generations protect part of the transition, but neither cancels an already-started mutation/download nor binds the global consent callback to the initiating identity. Firebase documents the method as an initial-state barrier. [Firebase Auth reference](https://firebase.google.com/docs/reference/js/auth.auth#authstateready)
- **Fix:** Bind each request to a session generation, check it before dispatch and before publishing a response, and cancel pending requests when the identity changes. Bound the wait for initial readiness and token refresh using cancellation and a user-visible recovery path. Keep authenticated actions fail-closed if startup stalls. Test sign-out, two-tab account switches, expired users and registration. The normal restored-login scenario passed in the staging browser.

### [SEVERITY: medium] Closing a pending citation palette ends tracking while its mutation can still insert

- **Where:** [CitePalette.tsx:113](../frontend/src/components/editor/CitePalette.tsx#L113), [CitePalette.tsx:130](../frontend/src/components/editor/CitePalette.tsx#L130), [CitePalette.tsx:141](../frontend/src/components/editor/CitePalette.tsx#L141), [main.tsx:28](../frontend/src/main.tsx#L28).
- **What:** Escape and backdrop dismissal are allowed while the citation request is in flight. Unmount stops the position tracker, but the mutation can later still use it to insert. In development StrictMode, the tracker is also registered during render, then cleaned up by the effect replay without a matching re-registration.
- **Impact / failure scenario:** Close a slow palette and edit or remove the target paragraph. When the response arrives, the stale position can place a citation beside unrelated text. The ordinary open-palette anchor-loss test does not exercise closing it. A new palette request on the same mounted component also inherits the initial tracker, query and focus guard.
- **Evidence:** The request body owns the async work independently of component mount. Its insert checks `target.deleted`, which stops updating after cleanup. The focused StrictMode probe observed two listener registrations, cleanup of the retained tracker on replay, and an unused registration remaining after unmount. The focus fix itself passed on staging.
- **Fix:** Allocate the tracker in the requesting event or in an effect with symmetrical setup and cleanup. Transfer it to the running mutation until settlement, or explicitly cancel and suppress insertion when the palette closes. Key the component to a new request or reset its state on request identity changes. Test Escape, backdrop, slow POST, StrictMode and a narrow viewport.

### [SEVERITY: medium] Account exports can stall waiting for a second connection from the same pool

- **Where:** [accounts.py:228](../backend/app/services/accounts.py#L228), [accounts.py:362](../backend/app/services/accounts.py#L362), [accounts.py:426](../backend/app/services/accounts.py#L426), [session.py:19](../backend/app/db/session.py#L19).
- **What:** The per-document render session isolates SQL failure, but the archive session still holds its database connection while borrowing a second one for rendering.
- **Impact / failure scenario:** On a small pool, two concurrent archive builds can occupy the available connections, then both wait on another connection for the rendering session. PDF reads no longer hold the first transaction, but document/revision reads open it again. With a larger pool this still increases contention. Actual staging pool size and effective Neon pool limits were unavailable for verification.
- **Evidence:** The parent session fetches documents, citation records and revisions, then enters the child session without ending that parent transaction. The renderer regression proves isolation after a failed SQL statement and does not use a saturated pool.
- **Fix:** Build plain owner-scoped document snapshots and release the parent connection before formatting or acquiring another session. Exercise a one-connection pool and two exports in a small pool. Keep the archive recoverable when a renderer fails.

### [SEVERITY: medium] Permanent PDF host refusals are retried as transient failures

- **Where:** [open_access.py:30](../backend/app/services/open_access.py#L30), [url_safety.py:93](../backend/app/security/url_safety.py#L93), [processing.py:265](../backend/app/services/processing.py#L265).
- **What:** A 403 from an OA candidate becomes the same `UpstreamError` as a transient response. If every candidate fails, the worker treats any such error as grounds to retry the whole job.
- **Impact / failure scenario:** A host consistently denies server-side download, as reported for the Europe PMC renderer. The job can retry the same refusal and repeat external lookups even though the worker can already move to the next candidate. The recorded candidate, arXiv and DOI fallbacks are reasonable. The list is built eagerly, so even a known good candidate waits for DOI lookups before it is tried.
- **Evidence:** `fetch_pdf` raises `UpstreamError` for every non-200 response and `_obtain_pdf` ORs that type into `transient`. No causal link between this specific refusal and the reported first 503 was established.
- **Fix:** Treat persistent origin refusals and unavailable PDFs as candidate-level failures. Retry transport failures, 429s and relevant 5xx responses. Keep trying independent candidates and consider resolving DOI fallbacks only after known locations fail. Add one test with a 403 and no other candidate, and another with a later successful candidate.

### [SEVERITY: medium] Structured Cloud Tasks errors assume a JSON object shape

- **Where:** [tasks.py:52](../backend/app/services/tasks.py#L52), [tasks.py:109](../backend/app/services/tasks.py#L109), [processing.py:165](../backend/app/services/processing.py#L165).
- **What:** `_error_status` catches invalid JSON but not valid JSON with a list, null or a non-object `error`. Every 409 is accepted without checking its structured status, which also bypasses the existing ambiguous `ABORTED` list.
- **Impact / failure scenario:** A proxy sends a 5xx with a response such as `null`. Parsing raises before the 5xx classification, so the ingestion path treats the unexpected exception as a definite failure. An ambiguous 409 can instead be counted as acceptance and leave the job waiting for lease recovery if no task was created.
- **Evidence:** The extraction helper invokes `.get()` twice without type checks. HTTP 409 is checked before that helper or `AMBIGUOUS_STATUSES`. Existing tests cover normal error objects and a specific duplicate response, not malformed JSON shapes or `ABORTED` as 409.
- **Fix:** Read the structured status defensively. Classify known `ALREADY_EXISTS` as accepted, apply uncertain statuses before generic HTTP handling, and classify unrecognized 409s conservatively. Test null, list and nested non-object responses.

### [SEVERITY: medium] Per-citation rewrite can silently flatten explicit breaks and still rewrite multiple claims under one citation

- **Where:** [rewrite.ts:55](../frontend/src/lib/rewrite.ts#L55), [rewrite.ts:74](../frontend/src/lib/rewrite.ts#L74), [rewrite.ts:89](../frontend/src/lib/rewrite.ts#L89), [tools.py:264](../backend/app/api/routes/tools.py#L264), [schemas.py:424](../backend/app/schemas.py#L424).
- **What:** Rewrites split at citation nodes, ignoring other inline atoms such as `hardBreak`. A slice between two citations can contain multiple sentences and is sent as one unit.
- **Impact / failure scenario:** The selected text `First line` followed by an explicit line break and `Second line` is submitted and reconstructed as `First lineSecond line`. A model can also rewrite, reorder or add a claim within a citation-delimited segment, even though it cannot move the citation node between segments. This is conditional on enabling AI.
- **Evidence:** A focused TipTap check reproduced the hard-break loss without any model call. The lead regex only reserves leading whitespace and listed punctuation. It preserves those characters when reconstructing the span, but omits them from context seen by the model. The six-segment cap is client-side only because the backend receives one ordinary `/ai/rewrite` request per segment. The endpoint's own input-length and per-user rate limits apply to each call.
- **Fix:** Preserve line breaks and other supported inline nodes by splitting on them or refusing unsupported selections. Test sentence-delimited cited passages and headings with explicit breaks. Use a structured batch endpoint if the product needs a server-enforced per-proposal limit.

### [SEVERITY: low] Re-consent leaves the editor sending predictable retries

- **Where:** [Editor.tsx:372](../frontend/src/pages/Editor.tsx#L372), [Layout.tsx:247](../frontend/src/components/Layout.tsx#L247), [auth.tsx:109](../frontend/src/lib/auth.tsx#L109).
- **What:** The overlay keeps the editor safely mounted, but all non-conflict autosave errors schedule another save, including `CONSENT_REQUIRED`.
- **Impact / failure scenario:** An open editor that needs re-consent can make repeated 403 autosave attempts and profile refreshes indefinitely while the tab remains open. The interval limits frequency. The in-memory draft survives the overlay and existing staging evidence shows eventual save after acceptance.
- **Evidence:** Editor schedules 10 seconds plus the save debounce on errors. Only concurrent, overlapping profile refreshes coalesce, so repeated refusals can start additional refreshes.
- **Fix:** Park the save queue when it receives `CONSENT_REQUIRED`, then flush once when the current account has accepted. Keep the ordinary backoff for network failures and test acceptance and denial separately.

### [SEVERITY: low] A quote immediately after a citation still has no leading separator

- **Where:** [CitePalette.tsx:38](../frontend/src/components/editor/CitePalette.tsx#L38), [PdfPanel.tsx:187](../frontend/src/components/editor/PdfPanel.tsx#L187).
- **What:** The spacing logic examines the previous character in plain text. An inline citation node has no character in `textBetween`, so a quote immediately after it is inserted without a separator. The JSON insertion also leaves mark handling implicit.
- **Impact / failure scenario:** A quote can appear directly against an earlier rendered citation. Adjacent unquoted citations may be acceptable for some styles, while quotes need a word boundary. Insertions inside emphasis or a link should have a deliberate rendering rule.
- **Evidence:** A focused test inserted a quote after an existing citation node and reproduced a new text node starting directly with the opening quote. The current table tests cover preceding words, punctuation and brackets.
- **Fix:** Inspect the neighboring inline node as well as plain text. Add style-aware tests for adjacent citations, quote-after-citation, marks and links.

## Staging isolation

| Boundary | Evidence and remaining check |
| --- | --- |
| Hosting and bundle | Generated the current staging CSP locally. Both production origins in `firebase.json` were replaced. The staging bundle contained the staging API and auth origins, with no production equivalents. The production build passed the inverse check. `deploy-staging-frontend.sh` uses an explicit Hosting project. Plain replacement would miss a future production origin, so add an exact allowlist assertion before publishing. |
| Firebase | Token verification uses both the configured project audience and issuer. `ENV=production` permits real Identity Toolkit deletion against `FIREBASE_PROJECT_ID`, which is deliberately different for staging. The supplied staging account successfully accessed its own dashboard and document. Cross-project 401 is maintainer-reported. I did not send a staging token to production. |
| Cloud Run, OIDC, CORS | Task and maintenance verification check both configured audience and service-account email. A correctly configured staging token sent to the production task handler would fail those checks. The API CORS middleware uses explicit `CORS_ORIGINS`; CORS does not replace token checks. The staging CLI could not read the active service or queue because its local credential database was inaccessible. Effective IAM, active revision environment values, the inverse CORS check, and queue-level target overrides were not independently verified. [Cloud Tasks OIDC](https://cloud.google.com/tasks/docs/creating-http-target-tasks) |
| Data and resources | The brief documents a dedicated Neon database, secret, bucket, queue and runtime service account. The staging API shares the production Google Cloud project and billing, so isolation depends on the effective individual and inherited grants. No verified production-data path was found. An isolated Firebase project alone cannot verify the Cloud Run runtime or deployer's permissions. |
| Neon | The migration creates pgvector, and the recorded staging readiness/browser flow exercised database access. The code uses ordinary PostgreSQL row locks and transaction-scoped advisory locks. The repository does not pin staging DSN TLS settings, effective `statement_timeout`, pool size, connection limits or cold-start timing. Verify those from redacted configuration and distinguish direct from pooled endpoints. Cross-region connection and wake-up time are expected to differ from production. The maintainer reported one cold start followed by warm requests below one second. [Neon connection pooling](https://neon.com/docs/connect/connection-pooling) |
| Maintenance | The runbook records the production 15-minute OIDC job and first successful run. The audit did not inspect production. An equivalent periodic staging schedule is not evidenced. Startup and Admin maintenance exist in code. Confirm staging retries and cleanup separately if staging is used to validate eventual deletion. |

## What the first Cloud Tasks 503 means

The job insert and `QUEUED` paper update commit at [processing.py:154](../backend/app/services/processing.py#L154). Dispatch begins at [processing.py:160](../backend/app/services/processing.py#L160). A failed commit cannot reach task creation in this path. A missing job returns `SKIPPED`, which the endpoint maps to HTTP 204. An application-generated 503 can mean a duplicate found an active running lease or that an attempt failed transiently and re-queued. A platform-side 503 is also possible. Without a correlated task/worker log, the observed 503 followed by 204 does not establish which occurred or whether the job succeeded. Compare the job ID, attempt, outcome and queue delivery metadata. [Worker claim](../backend/app/services/processing.py#L203), [retry transition](../backend/app/services/processing.py#L374), [internal endpoint](../backend/app/api/routes/admin.py#L153)

## Disposition of all 13 hardening fixes

| # | Previous finding | Current disposition |
| --- | --- | --- |
| 1 | Draft-derived search leaked before confirmation | Fixed at the real palette/API boundary. The only external query in selection mode is `submitted`, distinct from debounce. Regression covers redaction, submit and follow-up edits. |
| 2 | Re-consent discarded unsaved work | Fixed for normal mid-session re-consent by retaining the editor with `inert`. The maintainer's signed-in save-resume run and route-guard test cover it. Remaining retries and identity-switch semantics above. |
| 3 | Closure missed an in-flight upload | Multipart fence is correct for attach vs closure and reaches 403 in CI. Browser 401 tests an earlier guard. Background private attachment and the timing of queued cleanup remain partial. |
| 4 | Concurrent export/restore lock | Fixed. Synchronous exclusive acquire and holder-specific release. The staging report also records an overlapping export refusal. |
| 5 | Delayed citation lost its anchor | Fixed while the original tracker remains active. Pending dismissal and development cleanup leave the lifecycle gap above. PDF and sources panel start tracking in the click handler. |
| 6 | Rewrite moved citation between segments | Fixed for marker-order relocation by preserving citation nodes outside generation. Inline structure and multiple claims within a segment remain partial. |
| 7 | Archive aborted on renderer SQL failure | Fixed for the original failure with the separate render session. Peak-connection behavior remains open. |
| 8 | Deadline response treated as definite rejection | Fixed for ordinary 5xx and recognized gRPC statuses. JSON shape and unqualified 409 handling remain open. |
| 9 | Scope overclaimed sources present in evidence | Fixed. Scope marks the candidate IDs that contributed the actual bounded evidence payload. |
| 10 | Former-tester rights on wrong branch | Fixed. Not-invited users see rights controls; conflicting identities get original-sign-in or privacy-contact instructions. |
| 11 | Concurrent first citations collided | Fixed. The source uses `ON CONFLICT DO NOTHING`, and the link and citation share a commit. |
| 12 | PDF picker hid older PDFs behind metadata records | Fixed. `has_pdf` filters before library pagination and the zero-results state retains the finder. Verified picker and rendered PDF on the existing staging document. |
| 13 | Walkthrough claimed an untraceable page and unexplained AI controls | Fixed for the editor/research scenes. No change to baseline feature parity. The walkthrough still illustrates UI state and uses known paper metadata. |

## Staging frontend fixes and release decisions

- **Focus:** Confirmed in signed-in Chrome that opening Cite in the staging editor focused the search input. The existing regression covers hidden-to-visible placement. I did not type into the draft, run an external search from selected text, or force a consent change. The native confirmations are not a security defect. An in-app dialog is worthwhile when testability and consistent focus become part of the workflow, rather than a requirement for releasing these fixes.
- **Restored session:** Confirmed the saved paper still displayed “In your library” after a real reload, without showing a Save button in the verified final state. The identity-switch defect is an adjacent case. In the installed SDK the readiness call resolves on the first known auth state. The application adds no timeout or abort handling to that wait or the subsequent token fetch. A deleted Firebase user's token failure can be reported as a generic profile load issue until auth state changes.
- **Spacing:** Ordinary leading spacing is covered by the staging report and the local regression table. The adjacent-citation case remains open. No citation was written during the read-only staging audit.
- **Production frontend:** Approve a Hosting-only release of the focus and spacing improvements, and include the readiness change once the session-generation check is in place. If shipping the exact three-change bundle, fix the stale-token race first and rerun sign-in restore, sign-out and account-switch tests. Keep existing invite-only limits and AI settings. Backend closure and environment guard fixes belong to a separate release. No deploy was performed.
- **Staging contact:** Set `CONTACT_EMAIL` only to a monitored project mailbox, with the maintainer's approval for its onward use. The code sends the operator address to Unpaywall, Crossref, OpenAlex and NCBI/PubMed, depending on which providers are queried. It does not need each tester's email. Test the exact DOI before treating the additional lookup as a remedy for the Europe PMC host refusal. No contact setting was changed. [Unpaywall API](https://unpaywall.org/products/api), [Provider configuration](../backend/app/services/scholarly/providers.py#L246)

## Verification commands and evidence

| Check | Result |
| --- | --- |
| `git pull --ff-only origin main`, `git rev-parse HEAD`, `git diff --check 2248a45 e37856a` | Shell GitHub fetch failed at DNS. The clean local `main` and `origin/main` already pointed to `e37856a`, independently confirmed by GitHub's commit and CI run. Diff whitespace check passed. |
| `npm test`, `npm run build`, `npx vite build --mode staging --outDir dist-staging --emptyOutDir` | **108 frontend tests passed** locally. Both builds passed. Generated CSS had zero inlined font URLs. Bundle scan confirmed environment-specific API and auth origins. |
| `python -m pytest -q --tb=short --maxfail=1` | Local embedded PostgreSQL did not become ready within the fixture's startup timeout. Exact snapshot GitHub CI passed **255 PostgreSQL tests**, with seven opt-in live tests deselected. |
| Ruff lint and format | Passed, 83 files formatted. |
| [GitHub Actions on `e37856a`](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/actions/runs/43610283205) | Backend, frontend and container jobs passed. Logs confirm **255** backend, **108** frontend, font and 18 citation style smoke checks, and zero known vulnerabilities in the frontend npm audit. |
| Focused offline frontend probes | **Four passed**, demonstrating a stale token after an identity switch, StrictMode tracker lifecycle, hard-break loss during rewrite, and quote spacing after a citation. Temporary probe file removed. |
| Read-only staging browser | Tester session supplied by the maintainer. Dashboard, two-paper library, saved badge after reload, existing draft, rendered PDF with text layer, and citation-palette focus checked. Returned to the dashboard. No account settings, research data, infrastructure or production resources changed. |
| Credential-pattern scan of locally reachable Git history | Scanned 382,263 patch lines. Found no strings matching the requested Neon, Anthropic, GitHub token or private-key patterns, nor the added AWS and Google OAuth secret patterns. Database-URL candidates were local/example data or patch-context matches. Tracked `.env` files hold public web configuration. Confirmed the staging tester file is ignored without reading it. This is a pattern scan of reachable history, not proof about deleted refs, unrecognized formats, local untracked files or Secret Manager. |

## Recommendation

The 13 fixes materially improve the tested paths. Keep the beta invite-only and AI off. Add the staging/production release guard and close the remaining private worker attachment race before treating staging or account deletion as hardened. Fix request identity handling before shipping the exact three-fix frontend bundle. Obtain a redacted staging service, migration job, queue and effective IAM snapshot to finish infrastructure verification without touching production. No additional destructive staging test account is needed for this audit. The remaining closure ordering is better reproduced deterministically in PostgreSQL before any repeat staging run.
