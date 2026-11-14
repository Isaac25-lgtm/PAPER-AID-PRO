# PaperAid Pro release follow-up audit

**Reviewed 14 November 2026.** Source snapshot `691c6c0` on `main`, with particular attention to changes since `70431cb`. The handoff identifies `paperaid-api-00008-cub` and schema `c7e2d9a41f05` as the deployed backend. The audit covers the release handoff. Next-phase edits were already in progress and are outside this snapshot. The report records source defects and local checks. It does not establish that any of the failure scenarios occurred in production.

PaperAid Pro is a research workspace. Researchers discover papers across scholarly indexes, manage a private library, write citation-aware drafts, and export Word or PDF. Optional AI uses source excerpts to answer questions. The next phase can improve the workflow between finding a source and using it in a draft. The release findings below affect the trustworthiness of that workflow and of the new privacy controls.

## Findings

### [SEVERITY: high] The Account ZIP bypasses current paper visibility

- **Where:** [accounts.py:140](../backend/app/services/accounts.py#L140), [library.py:264](../backend/app/api/routes/library.py#L264), [papers.py:26](../backend/app/services/papers.py#L26).
- **What:** Account export filters library links by the requesting user and serializes the linked paper without enforcing the same current visibility predicate as the ordinary library and bibliography export.
- **Impact / failure scenario:** If an obsolete or inconsistent library link to another person's private paper exists, its metadata can be disclosed in the ZIP's CSL-JSON and BibTeX. The PDF copy has a separate owner check. The migration removes the known historical rows and current normal writes check visibility, so this is a conditional leak and no production disclosure was observed.
- **Evidence:** `export_account` selects `LibraryItem` by `user_id`, eagerly loads `LibraryItem.paper`, then calls `to_csl_json` for every item. The ZIP regression test covers a normal owned upload only. The old-link regression exercises the ordinary library routes.
- **Fix:** Reuse the current visibility predicate on every paper-derived ZIP entry. Extend the existing seeded legacy-row test to cover notes, CSL-JSON, BibTeX and ZIP filenames.

### [SEVERITY: high] A stale worker can leave a live PDF eligible for deletion

- **Where:** [processing.py:87](../backend/app/services/processing.py#L87), [processing.py:243](../backend/app/services/processing.py#L243), [storage.py:199](../backend/app/services/storage.py#L199), [maintenance.py:88](../backend/app/services/maintenance.py#L88).
- **What:** The storage write and its durable cleanup intent happen before the job lease is checked, using a key shared by attempts retrieving identical bytes for the same paper.
- **Impact / failure scenario:** Worker A reads a paper without a PDF and stalls. Its replacement B retrieves and attaches a PDF, clearing the intent. A resumes with the same bytes, writes the same key, creates another cleanup intent and then fails the lease check. Maintenance later deletes the key B published. The paper still points to it.
- **Evidence:** `put_pdf` records an intent before `_hold` in `_obtain_pdf`. `_claim` in maintenance returns due keys and `process_deletions` deletes them without checking a live reference. An offline mock exercising both service functions confirmed deletion of the replacement's key. The existing stale-worker test covers publication of database results, not ownership of the object across attempts.
- **Fix:** Give writes immutable attempt-specific keys or object generations. Bind attachment and deletion to the exact key or generation and add a regression where B attaches before A completes the identical write. Fence the initial `PROCESSING` update in `run_job` as well.

### [SEVERITY: high] Concurrent releases can promote a revision whose URL was never checked

- **Where:** [release.sh:49](../deploy/release.sh#L49), [release.sh:55](../deploy/release.sh#L55), [release.sh:66](../deploy/release.sh#L66), [test_reaudit_fixes.py:605](../backend/tests/test_reaudit_fixes.py#L605).
- **What:** The candidate URL comes from the release tag, while the promoted revision comes from the service-wide `latestCreatedRevisionName` in a separate lookup.
- **Impact / failure scenario:** Release A creates a tagged revision. Release B creates a later revision before A looks up the service. A checks its own tagged URL, sees readiness, then sends all traffic to B. Same-commit releases also reuse the tag and image tag. The shared migration job adds another mutable release dependency.
- **Evidence:** `REVISION` and `URL` have different sources of truth. The current test asserts shell text rather than executing a multi-release scenario. This finding is based on shell control flow. No cloud release was run.
- **Fix:** Use a unique candidate tag and resolve its revision and URL from the same traffic entry. Use an immutable image digest, serialize releases per environment and verify that the probed revision reports its own identity. Add a fake-cloud test interleaving two releases.

### [SEVERITY: medium] An interrupted account closure can require manual recovery

- **Where:** [accounts.py:68](../backend/app/services/accounts.py#L68), [identity.py:23](../backend/app/services/identity.py#L23), [auth.py:193](../backend/app/security/auth.py#L193), [maintenance.py:129](../backend/app/services/maintenance.py#L129).
- **What:** The tombstone and deactivation commit before external identity deletion, with no automatic recovery if the remaining steps fail.
- **Impact / failure scenario:** A Firebase timeout, permission error or later database failure can leave the account inaccessible while consented deletion of documents, messages and uploads is unfinished. The user cannot repeat the request, and current maintenance only handles storage intents, rate buckets and abandoned ingestion jobs. The operator script remains available for manual recovery.
- **Evidence:** `close_account` commits `is_active=False`, awaits external identity deletion, then deletes the local data. `get_token_user` rejects inactive accounts. The current test proves successful deletion and token denial, not retry after an external outage.
- **Fix:** Persist an idempotent closure request, let a bounded background worker resume incomplete steps and expose a clear request status. Test failures after deactivation, identity deletion and database deletion separately.

### [SEVERITY: medium] Account export omits stored work and is unavailable during re-consent

- **Where:** [accounts.py:140](../backend/app/services/accounts.py#L140), [accounts.py:162](../backend/app/services/accounts.py#L162), [library.py:170](../backend/app/api/routes/library.py#L170), [system.py:170](../backend/app/api/routes/system.py#L170), [Layout.tsx:200](../frontend/src/components/Layout.tsx#L200), [Static.tsx:74](../frontend/src/pages/Static.tsx#L74).
- **What:** The ZIP omits collections and their membership, revision history, and the citation records needed to resolve IDs in structured draft content. Stored owned PDFs are exported only while linked to the library. The Account UI and export endpoint are also behind the product-policy gate.
- **Impact / failure scenario:** Removing an upload from the library removes its association and leaves the owned paper, but its PDF is omitted from the next Account ZIP. A returning user who declines updated terms cannot open Account to export or delete data. The delete endpoint itself requires an invited authenticated account and does not require the new policy version.
- **Evidence:** The ZIP writes derived library entries and current document snapshots without querying `Collection`, `CollectionPaper`, `DocumentRevision` or `DocumentCitation`. The existing archive test creates no collection or revision and leaves the owned PDF in the library. The privacy page names collections and document history as stored work.
- **Fix:** Inventory and export all owner-scoped records with stable IDs and a manifest of missing files. Preserve authenticated access to data-rights functions during re-consent and define the route for former testers. For large archives, stream individual files or build them in a bounded job. Test removal from library, revision history, cross-owner isolation and outdated consent.

### [SEVERITY: medium] Consent can be stamped with a policy version the browser did not show

- **Where:** [Consent.tsx:46](../frontend/src/components/Consent.tsx#L46), [schemas.py:47](../backend/app/schemas.py#L47), [system.py:129](../backend/app/api/routes/system.py#L129).
- **What:** The form submits choices without the version shown, and the API always records the current server version.
- **Impact / failure scenario:** A tab opened before a policy change submits after the new API is deployed. The choices are recorded against the new version despite the tab having presented the old version. Independent frontend and API releases create the same mismatch.
- **Evidence:** `ConsentIn` has no version field. Supplying an extra version does not bind acceptance to it. The existing version-bump test checks the need to re-accept and currently posts the same versionless payload afterward.
- **Fix:** Bind acceptance to the version of the displayed notices. Reject outdated versions with a refresh prompt and record the submitted, validated version. Test old tabs and old/new frontend/backend combinations.

### [SEVERITY: medium] Optional consent state can diverge from its audit record

- **Where:** [system.py:143](../backend/app/api/routes/system.py#L143), [system.py:158](../backend/app/api/routes/system.py#L158), [Account.tsx:66](../frontend/src/pages/Account.tsx#L66).
- **What:** Generic preferences can overwrite or remove the same `consent_*` fields used by the Account UI. Both routes also replace the entire preferences object from a snapshot.
- **Impact / failure scenario:** A future caller using the generic route can change the displayed choice without recording it. Two tabs saving a guide preference and withdrawing an optional consent can leave a withdrawal in the history while the current value is restored by the other save. This matters before an email or analytics integration uses that value to decide what to send.
- **Evidence:** `update_preferences` accepts arbitrary keys and logs no consent. `update_optional_consents` writes a consent record and assigns a merged copy of the same user JSON column.
- **Fix:** Store authoritative optional decisions independently of general preferences, or reserve the key namespace and use atomic field updates with transactional audit records. Test both routes and concurrent updates.

### [SEVERITY: medium] Public paper routes can still expose a user's private workspace before re-consent

- **Where:** [auth.py:214](../backend/app/security/auth.py#L214), [papers.py:252](../backend/app/api/routes/papers.py#L252), [papers.py:317](../backend/app/api/routes/papers.py#L317), [App.tsx:35](../frontend/src/App.tsx#L35).
- **What:** The optional principal used by public paper routes checks invitation and email verification, but it grants access to the caller's own private content without checking current policy acceptance.
- **Impact / failure scenario:** A returning tester who has not accepted the new notices can open a saved private-paper URL and read its details and passages while the protected workspace redirects to consent. This is inconsistent policy enforcement for the same signed-in user. The owner check still prevents access to other users' papers.
- **Evidence:** `get_optional_user` returns the caller before applying the consent check used by `get_verified_user`. The public catalog and detail routes use this principal, which widens their query to the caller's private papers.
- **Fix:** Use an anonymous principal for public reads until current consent is accepted. Keep authenticated account-rights access available independently. Test public details and private passages with an old policy version.

### [SEVERITY: medium] AI highlights can omit a claim's support or highlight the wrong characters

- **Where:** [grounding.py:252](../backend/app/services/ai/grounding.py#L252), [grounding.py:284](../backend/app/services/ai/grounding.py#L284), [grounding.py:354](../backend/app/services/ai/grounding.py#L354), [GroundedAnswerView.tsx:134](../frontend/src/components/GroundedAnswerView.tsx#L134).
- **What:** Verdicts use full cited passages while highlights are grouped by passage, capped at three spans and indexed in different units by backend and browser.
- **Impact / failure scenario:** Four retained claims cite the same passage with four distinct quotes. The fourth claim remains in the answer, but the fourth quote is missing from the highlight payload. A citation can also point to a source without an aligned quote for that claim. An emoji or another supplementary character before a span shifts the highlight because Python indexes Unicode code points and JavaScript slices UTF-16 code units.
- **Evidence:** `verify_support` sends the full `shown_text` for every cited ID. `citation_payload` pools all claim spans by source. `evidence_excerpt` slices the first three, and the browser uses their offsets directly. A local Node check confirmed the offset mismatch. The existing ASCII highlight test exercises a single quote.
- **Fix:** Carry source and span identifiers per claim, retain each supporting quote and verify against the same evidence reviewers see. Specify the offset unit and test Unicode, four claims sharing a source and multi-source claims. Use reviewer judgments on real papers in the limited AI pilot.

### [SEVERITY: medium] Private PDF uploads can duplicate or become stuck after dispatch fails

- **Where:** [papers.py:170](../backend/app/api/routes/papers.py#L170), [models.py:213](../backend/app/db/models.py#L213), [tasks.py:77](../backend/app/services/tasks.py#L77), [PaperDetail.tsx:67](../frontend/src/pages/PaperDetail.tsx#L67).
- **What:** Upload deduplication is a non-atomic existence check. If extraction fails after upload, the private-paper UI lacks the retry action the backend directs the user to use.
- **Impact / failure scenario:** Two simultaneous uploads can insert two papers with separate objects. A queue timeout may return a server error after committing a successful upload. An application-level dispatch error leaves a stored upload but the details page hides its retry message unless it is in the failed state and only offers retrieval for public papers. Reupload of the same bytes returns the old paper without retrying extraction.
- **Evidence:** There is no owner-and-digest unique constraint. The queue client can raise an HTTP transport exception. `queue_ingest` re-raises it while the upload route catches `AppError` only. The existing regressions test a sequential duplicate and an application-level error, not concurrency or user recovery.
- **Fix:** Enforce and resolve owner-and-digest uniqueness transactionally. Normalize known dispatch errors and expose a retry action when a private paper has a stored PDF. Test concurrent uploads, transport failure and private retry end to end.

### [SEVERITY: medium] The staging recipe reuses production credentials and permissions

- **Where:** [DEPLOYMENT.md:77](DEPLOYMENT.md#L77), [config.py:35](../backend/app/config.py#L35), [config.py:52](../backend/app/config.py#L52).
- **What:** The suggested commands copy the production database connection string with only the database name changed, reuse the production migration identity and propose cloning the production API environment with only a few changes.
- **Impact / failure scenario:** A staging service could inherit production database privileges, Firebase identity configuration, the storage bucket, a queue or third-party keys. A staging test of account closure could reach the production identity provider if those values are reused. This concerns the proposed commands. No staging resources were provisioned during this audit.
- **Evidence:** The recipe substitutes the database name in the production secret and points the migration job at the production service account. The API has separate configuration for Firebase, storage and Cloud Tasks, but the cloning instruction does not isolate them.
- **Fix:** Define staging from its own allowlisted configuration. Use a separate database principal scoped to staging, Firebase project, bucket, queue, service identities and restricted provider credentials. A shared SQL instance can be considered separately if privileges are demonstrated to be isolated. Verify that staging credentials cannot access production data.

### [SEVERITY: medium] Repeated citations can show the wrong label in the editor

- **Where:** [Editor.tsx:31](../frontend/src/pages/Editor.tsx#L31), [citationNode.ts:17](../frontend/src/lib/citationNode.ts#L17), [documents.py:475](../backend/app/services/documents.py#L475).
- **What:** Editor labels are indexed by the joined IDs of the cluster, so repeated clusters overwrite earlier occurrence labels.
- **Impact / failure scenario:** Copy a citation node into another paragraph in a note style with full and shortened forms. Both nodes have the same IDs, so the later note's output can also appear on the first occurrence. The Word/PDF occurrence fix uses a different mapping.
- **Evidence:** `applyCitationLabels` builds a `Map` keyed by `citation_ids.join(",")`, and paste preserves those IDs via `data-citation-ids`.
- **Fix:** Match the saved editor content and rendered clusters by occurrence in the same traversal order. Ignore stale render results if the editor has since changed. Test identical clusters in body text and table cells with OSCOLA or Chicago notes.

## Status of the 24-item remediation

The row numbers refer to [REAUDIT_RESPONSE.md](REAUDIT_RESPONSE.md). “Covered” describes the reported issue's primary path and the corresponding code or test. The PostgreSQL tests ran in GitHub. The local database run stopped at fixture setup.

| Follow-up items | Status on this snapshot |
| --- | --- |
| 1, 4, 13 | Covered for production-image fonts, nested Word/PDF citation occurrence and explicit rejection of unsupported PDF glyphs. Editor labels have a separate occurrence defect above. |
| 2 | Covered for preventing closed-token re-entry. Automated deletion recovery remains incomplete. |
| 3 | Covered for the migration and ordinary library routes. The newly added Account ZIP misses the same visibility requirement. |
| 5–6 | Covered for ORM state after rollback, null leases and fencing published job results. External storage writes can still outlive a lease. |
| 7 | Covered for removing model-written gaps and checking signed quantities with units. Claim-to-highlight integrity is partial. |
| 8–12 | Covered for queue draining, required restore version, author/year verification, registry promotion and first-import conflict handling, and document input normalization. |
| 14–15 | Durable storage intents, claim backoff and a maintenance endpoint exist. Stale-write cleanup, concurrent upload deduplication and dispatch recovery are partial. A periodic scheduler is pending by the handoff. |
| 16–18 | Covered for ordinary library pagination and export, oversize import feedback, turn pairing and corroborated scholarly deduplication. The Account ZIP is a different export. |
| 19 | Partial. The readiness schema gate checks a tagged endpoint and promotion is explicit. The endpoint and promoted revision can diverge. |
| 20 | Improvements are visible in the cited search, citation and storage paths. The new Account export builds a full archive before responding and performs sequential file and document work. |
| 21–24 | Covered for citation-count limits, dashboard retry and thread-bound responses, shared dialog focus handling and storage-stream opening failure. |

## Feature parity changes since the previous audit

The [previous release review](PAPERAID_V2_REAUDIT.md#legacy-to-v2-feature-parity) contains the full `legacy-v1` inventory. The table updates the affected areas and records the planned editor additions.

| Capability | Legacy v1 | Current status | V2 location |
| --- | --- | --- | --- |
| Discovery filters and sources | Subjects, providers, date and sort controls | Partial. Subject selection and DOAJ/Europe PMC are present. Legacy time presets and all old sort controls are still missing. | [Discover.tsx](../frontend/src/pages/Discover.tsx), [aggregator.py](../backend/app/services/scholarly/aggregator.py) |
| Guidance | Dashboard and guided onboarding | Present with optional tour, Help and section guides. | [Guidance.tsx](../frontend/src/components/Guidance.tsx), [guides.ts](../frontend/src/lib/guides.ts) |
| Account and privacy | Account and privacy pages | Present and expanded with consent and self-service rights. ZIP and closure findings above affect completeness. | [Account.tsx](../frontend/src/pages/Account.tsx), [accounts.py](../backend/app/services/accounts.py) |
| Manual references, citation styles and templates | Citation and template tooling | Present and expanded. Includes private user-supplied references, 18 styles and templates organized by research approach. | [ManualSource.tsx](../frontend/src/components/ManualSource.tsx), [csl.py](../backend/app/services/citations/csl.py), [templates.ts](../frontend/src/lib/templates.ts) |
| Editor citation workflow | Citation editor and richer writing assist | Partial. Cite from saved sources, revision history and exports are present. In-editor scholarly discovery and a docked PDF reader are missing. | [Editor.tsx](../frontend/src/pages/Editor.tsx) |
| Inline autocomplete | Legacy inline ghost text | Missing. Rewrite and explicit continue are available when AI is configured. | [Editor.tsx](../frontend/src/pages/Editor.tsx) |
| Sharing and comments | Next-phase request | Missing. Existing draft and paper endpoints are owner-scoped. | [documents.py](../backend/app/api/routes/documents.py), [papers.py](../backend/app/services/papers.py) |

## Verification

| Check | Result |
| --- | --- |
| `git diff --check 70431cb 691c6c0` | Clean. The review starts from the previous audit and the delta spans 96 files, including vendored CSL definitions. |
| `npm test` and `npm run build` in `frontend` | **44 tests passed**. TypeScript and production build passed. |
| `ruff check app tests alembic scripts` and `ruff format --check app tests alembic scripts` in `backend` | Both passed. Format check covered 77 files. |
| `python -m pytest -q --tb=short --maxfail=1` in `backend` | Local PostgreSQL fixture could not connect to loopback at `127.0.0.1:6423` (Windows error 10013). Seven live cases were deselected. |
| `python -m pytest --noconftest -q tests/test_reaudit_fixes.py -k 'font or export_maps_citations or quantities or locate or surname or year_inside or cannot_draw or thin_records or release_script or unused_imports'` | **11 selected backend tests passed** without running the database fixture. |
| [GitHub Actions handoff run](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/actions/runs/43562756055) and [privacy-contact run](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/actions/runs/43563284400) | All three jobs succeeded for both commits. The handoff logs confirm **205 PostgreSQL tests passed** and **44 frontend tests passed**. The container logs confirm real italic fonts, citation placement and all 18 citation styles. The handoff reports seven opt-in external scholarly tests, which this audit did not rerun. |
| `npm audit --audit-level=high --fetch-retries=0` in `frontend` and with `--omit=dev` in the citation engine | Both local advisory lookups failed because the npm registry did not resolve. The frontend CI log reported zero known vulnerabilities. |
| Inline Python checks for `_obtain_pdf`, `process_deletions`, `evidence_excerpt` and `ConsentIn`, and Node `String.slice` with Unicode code-point positions | The mocked stale attempt leaves the replacement's object key pending and maintenance deletes that key. Four input quotes produce three highlighted spans. The consent schema accepts and ignores an older `policy_version` field. Offsets after an emoji select the wrong characters in the browser. |
| `python -m pip check` and `python -m pip_audit --disable-pip --no-deps --timeout 5 --progress-spinner off -r requirements.txt` | Installed requirements passed consistency checking. The advisory lookup could not resolve PyPI. |
| Production revision, privacy contact and signed-in workflow | `691c6c0` configures `silvercheptoris@gmail.com` in [the frontend build](../frontend/.env.production#L10). The deployed hostname, revision and smoke results are reported by the handoff. The release status of the frontend mailbox and the signed-in flow were not independently checked. |

## Next-phase recommendation

Proceed with design directions and implementation of a read-only PDF pane next to the draft, followed by in-editor source search and explicit cite-at-cursor. These can be designed against the existing owner-only API and tested with real sources on a local or isolated fixture. For the PDF pane, cover authenticated streaming, page navigation, accessibility and clean switching between private papers. For source search, retain provenance and provide an explicit confirmation before inserting a citation.

Before widening the beta, close the three high findings, fix account export and closure recovery, review the privacy notices and run a signed-in end-to-end workflow in isolated staging. Fix PDF object ownership before enabling periodic cleanup. The uptime alert can be planned independently. Keep public sharing and inline AI disabled until sharing permissions and revocation are covered, and until claim-level quote alignment and a real opt-in AI evaluation pass. The current AI setup instructions turn the provider on at service level, so implement and test server-side cohort gating before adding a live key for a small pilot.
