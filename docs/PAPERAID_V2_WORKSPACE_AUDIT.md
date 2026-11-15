# PaperAid Pro v2 workspace and staging follow-up audit

15 November 2026. Reviewed `main` at `ef7f8d92d4115f31597476f545d5c7e1a9eb46a1` against the staging-audit snapshot `e37856a`. I reviewed the eight commits and 40 changed files, followed their callers and shared state, and revisited the ten prior findings. The scope covers the signed-in workspace, writing, account and processing flows, and release tooling. Staging checks were read-only. [GitHub comparison](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/compare/e37856a...ef7f8d9) · [Previous audit](PAPERAID_V2_STAGING_AUDIT.md) · [Maintainer response](STAGING_AUDIT_RESPONSE.md)

PaperAid Pro is an invite-only research and writing workspace. It finds scholarly records, keeps private libraries, extracts text from PDFs, and lets researchers write, cite and export documents. The Firebase-hosted React frontend uses a separate Python API, with PostgreSQL for application data and durable jobs and Cloud Storage for PDFs. The workspace adds quick access to recent drafts, guided document creation and research history. This round found **2 high, 5 medium and 1 low** findings. I recommend holding the workspace frontend release and the next scripted API promotion until their respective high findings are fixed and tested.

## Findings

### 1. [SEVERITY: high] A pending autosave from one draft can overwrite another

- **Where** [Documents.tsx:59](../frontend/src/pages/Documents.tsx#L59), [App.tsx:57](../frontend/src/App.tsx#L57), [Editor.tsx:317](../frontend/src/pages/Editor.tsx#L317), [Editor.tsx:430](../frontend/src/pages/Editor.tsx#L430), [Editor.tsx:450](../frontend/src/pages/Editor.tsx#L450), [documents.py:75](../backend/app/api/routes/documents.py#L75).
- **What** The guided-create mutation navigates after its request resolves, even if the user closed the dialog and moved elsewhere. The editor route preserves its mounted component when only the document ID changes. The load-once ref, Tiptap state, version and autosave queue retain draft A. The queue's send callback updates to use draft B's URL.
- **Impact / failure scenario** Start creating B on a slow connection, close the dialog, open A using Recent documents and edit A. If B's create response comes back before A's autosave sends, the app navigates to B and sends A's pending fields there. Matching versions allow the save. Differing versions cause a misleading conflict in B. The same queue receives both title and rich-text changes. This scenario concerns two drafts under one account.
- **Evidence** A focused Vitest probe drove the real app router, sidebar, create dialog and editor with a deferred API response. Its first save called `PATCH /documents/d2` with draft A's edited title and `base_version: 1`. The real API row-locks the document identified by the URL and checks that document's version. The existing workspace tests exercise navigation links and the wizard's first step, then stop before editor state and resumptions.
- **Fix** Give every editor instance a fixed document ID, with its own queue, version, render generation, palette and other state. Key the stateful editor by route ID and capture that ID when binding its writes. Make a late create completion safe after the dialog is dismissed or the user leaves. Refresh the list on successful creation either way. Retain an app-level test for equal-version drafts, pending saves, and a late create response.

### 2. [SEVERITY: high] Release isolation checks stop before the candidate that will receive traffic

- **Where** [release.sh:23](../deploy/release.sh#L23), [release.sh:73](../deploy/release.sh#L73), [release.sh:135](../deploy/release.sh#L135), [release.sh:151](../deploy/release.sh#L151), [system.py:68](../backend/app/api/routes/system.py#L68), [tasks.py:86](../backend/app/services/tasks.py#L86).
- **What** A single environment now selects the service and migration job, and the initial check validates several live bindings. Cloud Tasks dispatch also uses a project, region, target URL and OIDC identity. The preflight checks the queue name alone. Deploy accepts unrestricted extra flags after the preflight, and promotion checks the candidate's schema, readiness and revision name.
- **Impact / failure scenario** A configuration change accompanying a staging release can give a candidate an unintended job target or other environment binding and still pass readiness. A wrong task target can strand processing jobs. A wrong identity or resource assignment can weaken environment separation where infrastructure grants allow it. The staging bindings inspected live matched the intended resources.
- **Evidence** The fake-cloud harness accepted a staging release with a synthetic dispatch-target change and promoted it after its green readiness response. The real backend readiness route compares Alembic heads and returns the runtime revision. It has no assertion about the database identity, Firebase project, storage or the complete dispatch tuple.
- **Fix** Allowlist the tuning flags operators need. Validate the complete staging and production profiles under the deployment lock, including the expected task target and OIDC audience, sender, project and location. Describe and validate the exact tagged candidate's bindings and image digest before traffic changes. Add fake-cloud cases for incomplete task bindings, disallowed overrides and candidate drift. Keep the direct permissions on staging resources scoped to the staging identity.

### 3. [SEVERITY: medium] Worker startup can deadlock with an account closure

- **Where** [processing.py:256](../backend/app/services/processing.py#L256), [processing.py:365](../backend/app/services/processing.py#L365), [processing.py:401](../backend/app/services/processing.py#L401), [accounts.py:125](../backend/app/services/accounts.py#L125), [models.py:174](../backend/app/db/models.py#L174), [models.py:296](../backend/app/db/models.py#L296).
- **What** The new private-owner fence protects the PDF attach and text-publish branches. The initial status write still locks the job before changing the paper. The closure cascade locks the paper and then deletes its jobs. The failure handler and lease reclaim also perform job-before-paper writes and warrant the same lock-order review.
- **Impact / failure scenario** PostgreSQL can abort a closure while a private-paper job starts. In the local reproduction, the account was already disabled, but deletion was left pending for maintenance. The resulting delay affects completion of the user's deletion request.
- **Evidence** A focused test used real PostgreSQL, the normal worker and closure services, and synchronisation around the initial worker lock. Once the closure's cascading delete was waiting behind the job lock, the worker attempted its paper update. PostgreSQL reported `DeadlockDetected` in the closure cascade against `processing_jobs` and the closure recorded an error. The two existing PostgreSQL attachment-race tests passed in the full suite.
- **Fix** Review all joint job/paper writes, including initial status, failure finalisation, lease reclaim and dispatch rollback. Use a consistent order relative to closure, or handle a conflicting transaction through a bounded retry with a durable outcome. Add a PostgreSQL regression for worker startup and another for failure or reclaim under closure. Exercise both orderings and assert that the closure finishes.

### 4. [SEVERITY: medium] Release validation can print an inline database credential

- **Where** [release.sh:85](../deploy/release.sh#L85), [release.sh:101](../deploy/release.sh#L101).
- **What** The mismatch formatter prints the observed `DATABASE_URL`. Secret references are described by name, but a misconfigured service or job with an inline database URL is interpolated verbatim into stderr.
- **Impact / failure scenario** A release check intended to catch misconfiguration can put credentials in command output and retained build or terminal logs.
- **Evidence** A fake service and migration job supplied a synthetic inline value. The script correctly stopped before changing resources but printed the synthetic value in both diagnostic lines. Live staging used the expected Secret Manager reference.
- **Fix** Log the binding kind and the expected reference name. Describe an observed plaintext value only as an inline value. Apply the same redaction discipline to candidate diagnostics and test both service and job.

### 5. [SEVERITY: medium] Autosave can park indefinitely after a failed policy reload

- **Where** [api.ts:130](../frontend/src/lib/api.ts#L130), [auth.tsx:103](../frontend/src/lib/auth.tsx#L103), [auth.tsx:134](../frontend/src/lib/auth.tsx#L134), [auth.tsx:172](../frontend/src/lib/auth.tsx#L172), [auth.tsx:207](../frontend/src/lib/auth.tsx#L207), [consentParking.ts:14](../frontend/src/lib/consentParking.ts#L14), [Layout.tsx:237](../frontend/src/components/Layout.tsx#L237).
- **What** When autosave receives `CONSENT_REQUIRED`, it parks edits and the auth provider makes one profile reload. If that reload also fails, the provider keeps the old profile and sets `profileError`. Its memo dependencies omit that field and the route guard's retry screen handles only the no-profile case.
- **Impact / failure scenario** An intermittent API error during a policy update can leave the active editor saying it will save after acceptance while there is no acceptance prompt. The user's edits remain in memory and can be lost if they leave before another request or token event brings back the new profile.
- **Evidence** The focused auth-provider check drove a consent-triggered profile reload to a synthetic 503 while a profile was already active. The existing user remained visible and the error was unavailable to consumers. The parking hook has coverage for a successful refresh and for an already-current returned profile.
- **Fix** Include the error in the provider memo dependencies. Track a pending policy refresh for the active user and surface a recoverable error with a retry while keeping the editor mounted. Bound any automatic retries. Test refusal, failed `/me`, recovery, single flush and account switch in one sequence.

### 6. [SEVERITY: medium] Transient DOI lookup failures can end PDF processing permanently

- **Where** [open_access.py:17](../backend/app/services/open_access.py#L17), [open_access.py:52](../backend/app/services/open_access.py#L52), [processing.py:285](../backend/app/services/processing.py#L285), [processing.py:359](../backend/app/services/processing.py#L359).
- **What** The PDF download loop now distinguishes a publisher refusal from a retryable failure. The Unpaywall and OpenAlex lookup branches both suppress `AppError`, so the loop never learns about lookup timeouts or service errors.
- **Impact / failure scenario** A DOI-only paper with no saved PDF address becomes permanently failed when the lookup services are temporarily unreachable. The user gets a message that no known PDF location is available and must retry manually.
- **Evidence** The focused check forced both DOI lookups to return `UpstreamError`. The pipeline raised `PdfUnavailable`, which `run_job` treats as terminal. Existing host-response tests start after a candidate has been discovered.
- **Fix** Carry retryable lookup outcomes through the candidate search. Continue trying alternatives and permit success to override earlier failures. If lookup and download both fail, return a retryable outcome whenever at least one viable route failed transiently. Cover successful fallback, provider outage and genuine absence separately.

### 7. [SEVERITY: medium] The mobile workspace drawer leaves keyboard focus behind it

- **Where** [Workspace.tsx:120](../frontend/src/components/Workspace.tsx#L120), [Workspace.tsx:199](../frontend/src/components/Workspace.tsx#L199), [Workspace.tsx:229](../frontend/src/components/Workspace.tsx#L229), [ui.tsx:135](../frontend/src/components/ui.tsx#L135).
- **What** The new drawer creates a visual modal with a backdrop and Escape handler. It keeps focus on the opener and leaves background controls in the tab order. The desktop and mobile sidebar instances also render the same heading IDs while the drawer is open.
- **Impact / failure scenario** Keyboard and assistive-technology users can land in the page behind the dimmed drawer and miss, or fail to reach, its links. Shared IDs can undermine section labelling when both variants are mounted.
- **Evidence** The focused React test used the real workspace shell. After opening the menu, focus remained on the opener outside the drawer. The existing sidebar tests exercise desktop navigation and collapse.
- **Fix** Use the shared dialog focus behavior or equivalent sheet component. Give the drawer an accessible modal name, keep background content inert while open, and use unique heading IDs. Test opening focus, forward and reverse Tab, Escape and return focus at a mobile viewport.

### 8. [SEVERITY: low] Recent documents and counts can show stale results after writing

- **Where** [main.tsx:19](../frontend/src/main.tsx#L19), [Documents.tsx:48](../frontend/src/pages/Documents.tsx#L48), [Documents.tsx:149](../frontend/src/pages/Documents.tsx#L149), [Editor.tsx:430](../frontend/src/pages/Editor.tsx#L430), [Workspace.tsx:51](../frontend/src/components/Workspace.tsx#L51), [Dashboard.tsx:102](../frontend/src/pages/Dashboard.tsx#L102).
- **What** Create navigates without updating the list query. Autosave updates only the individual document query. Delete invalidates the list but leaves the progress count cached. Home and the sidebar read summaries and counts from queries with a 30-second freshness window and no window-focus refresh.
- **Impact / failure scenario** Return directly to Home after saving or renaming a document and Continue writing can suggest the wrong draft. A created draft can be absent from Recent documents until a later fetch, and a deleted draft's count can remain visible.
- **Evidence** The mutation callbacks and the three query consumers use distinct cache keys. The workspace tests seed all responses and assert the initially loaded views.
- **Fix** Update or invalidate the document-list cache after create, rename, edit and restore, with a single refresh after the save queue drains where appropriate. Update progress after create and delete. Test immediate navigation to Home and the sidebar with warm caches.

## Verification of the ten staging-audit findings

| # | Prior finding | Recheck at this revision |
| --- | --- | --- |
| 1 | A staging release could invoke the production migration job | The original service/job mismatch path is closed. Candidate validation and task routing remain incomplete. See findings 2 and 4. |
| 2 | Account closure could miss a worker-attached PDF | Both attachment orderings passed on PostgreSQL. A distinct lock ordering at worker startup still delays closure. See finding 3. |
| 3 | The previous user's token or response could survive an account switch | The tested request and token paths now bind to a session and drop obsolete replies. Restoration and timeout tests passed. Firebase config uses the same local persistence as its cross-tab listener. |
| 4 | A dismissed cite palette could insert later or lose its tracker under StrictMode | The tracker is bound to the palette lifecycle, each request gets its own key and a late result cannot insert after dismissal. Existing tests passed. An import that already reached the API can still leave its successful library side effect. |
| 5 | Account ZIP export could wait on a second DB connection | The archive releases its connection before per-document rendering. The two-export, one-connection PostgreSQL regression passed. |
| 6 | PDF-host refusals consumed the transient retry budget | Tested host refusals fall through and transient download errors retry. Provider lookup errors still lose the transient classification. See finding 6. |
| 7 | Cloud Tasks error-shape and HTTP 409 handling | Covered malformed responses and the distinction between confirmed duplicates and ambiguous outcomes. The app commits the job before dispatch. The maintainer attributes the earlier staging 503s to retries after a publisher refusal. I verified the code path and did not independently correlate historical request logs. |
| 8 | Rewrite lost explicit line breaks | The hard-break rewrite regression passed. It preserves breaks and citation nodes around rewritable text. |
| 9 | Consent refusals caused periodic autosave requests | A normal refusal parks the queue and success wakes it. Failed profile recovery can strand it. See finding 5. |
| 10 | Quote insertion omitted spacing after a citation | The preceding-node and mark-handling tests passed, including adjacent citations and insertion after a line break. |

## Staging and release verification

- Read-only staging service, migration job, queue, bucket and resource IAM checks succeeded. The service and migration job use the staging runtime identity and staging database secret reference. The staging identity has `secretAccessor` on that secret and `objectAdmin` on the staging bucket. The queue is running and staging's dispatch target and OIDC identity point back to staging. Firebase, CORS and the bucket are staging-specific. Both AI and embeddings providers are disabled on this service.
- Readiness returned `ready`, schema `f2a6c8e4b1d3`, revision `paperaid-api-staging-00002-laj`. Staging hosting returned HTTP 200 and served a workspace bundle with the staging API in its CSP and the production API origin absent. These checks establish the observed bindings. Effective inherited access and database isolation behind the secret reference remain unverified. No secret payload or production resource was accessed.
- The previously signed-in Chrome tab was absent. Opening the staging dashboard in Chrome redirected to sign-in. The signed-in browser pass remains pending. All write and race probes for this audit ran locally with test data or fake cloud tooling.
- The staging observation note still attributes early 503s to pre-commit task delivery. The current code commits before enqueueing. Reconcile the two documents using request/task logs before drawing a live root-cause conclusion. Staging's production-release equivalent still needs the checks in finding 2. [Staging test notes](STAGING_TEST_RUN.md) · [Maintainer response](STAGING_AUDIT_RESPONSE.md)

## Feature parity changes

The previous inventory covers the original `legacy-v1` routes and features. This delta changes the signed-in entry page and workspace navigation. Home, library, documents, research, citations, discovery, catalog, account and role-gated admin remain reachable. Quick document creation and Continue writing are present, with the failure cases in findings 1 and 8. The standalone editor route and earlier gaps in the legacy feature inventory remain as previously recorded. [Legacy feature inventory](PAPERAID_V2_REAUDIT.md#legacy-to-v2-feature-parity)

## Tests and evidence

| Check | Result |
| --- | --- |
| Pinned source | GitHub `main` matched the audited SHA at checkout. The eight-commit diff passed `git diff --check`. |
| Local backend | **285 passed**, 7 opt-in tests deselected, on PostgreSQL. The local pgserver emitted a shutdown logging error after pytest exited successfully. Ruff and the format check passed. |
| Live public scholarly APIs | **7 passed** with the live marker. This suite uses scholarly APIs independently of PaperAid production. |
| Local frontend | **135 passed** in 15 files. Type-check and Vite build passed. No embedded base64 font payloads were found in the built JS, CSS or HTML. |
| Dependencies and credentials | Frontend and citation-engine production `npm audit` reported zero findings. Backend `pip-audit --strict -r requirements.txt` reported no known vulnerabilities. A targeted added-line scan found no credential-like strings in the audited diff. |
| Added failure scenarios | Local probes reproduced findings 1–7. Finding 8 is supported by source and query-cache behavior. The probes were temporary. |
| GitHub at the same SHA | Frontend and container succeeded. The backend job was still running its pytest step after more than an hour, with an inaccessible job log. The backend CI outcome and cause of the long run are unconfirmed. [CI run](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/actions/runs/43638744427) · [Backend job](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/actions/runs/43638744427/job/132581281867) |

Next release checks include a Linux backend run that completes at the target SHA, regression tests for findings 1 and 2, and a signed-in staging smoke of the corrected workspace with disposable drafts. The work that can proceed in parallel is feature development behind the existing release boundary.
