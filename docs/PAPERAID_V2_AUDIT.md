# PaperAid Pro v2 code and feature-parity audit

## Project overview

PaperAid Pro, also called Silver, is a research workspace for academics. A researcher can search scholarly databases, save papers into a private library, upload PDFs, search extracted passages, and write documents with citations and a generated bibliography. The platform also checks references against Crossref and has optional AI for paper summaries, research questions and writing assistance. [README](../README.md) · [Architecture](ARCHITECTURE.md)

The React and TipTap frontend calls a FastAPI service. Firebase handles sign-in, PostgreSQL and pgvector store and retrieve research data, private Cloud Storage holds PDFs, and Cloud Tasks dispatches PDF processing. A Node subprocess runs citeproc-js for ten bundled CSL styles. The deployment handoff records invite-only sign-in as enabled and AI provider keys as pending. This audit used the local checkout and did not contact the PaperAid production application or resources. [Handoff](HANDOFF.md) · [Deployment](DEPLOYMENT.md)

## Scope and result

The code under audit is the `platform-v2` rebuild introduced before `8c3c8ce` and tested at that revision. The local checkout moved to `main` during the review. GitHub and the final local refs confirm that `main` and `platform-v2` both point to `7538f73`. The two intervening commits only change documentation. The original is `legacy-v1` at `dc38837`, which was also the local `main` at the start. I traced the original's 29 page files, 11 API route files and 10 server-action modules, including the capability-bearing components and services they call. Parity describes behavior reachable from the original UI or API, with experimental code and replaced infrastructure identified where relevant. [GitHub comparison](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/compare/8c3c8ce...7538f73) · [Legacy tag](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/tree/legacy-v1)

The highest-priority issues are the account identity binding, public catalog entries created from uploaded reference files, and AI answers whose cited passages can fail to support the displayed text. Concurrent writes can also lose document edits, and two common queue failure modes can leave papers stuck. These conclusions come from source review and the offline checks explicitly marked below. PostgreSQL-backed tests and dependency advisory checks remain unverified in this environment.

## Findings

### [SEVERITY: high] Firebase UID changes can inherit an existing account

- **Where** [backend/app/security/auth.py:101](../backend/app/security/auth.py#L101), [backend/app/security/auth.py:144](../backend/app/security/auth.py#L144), [backend/app/api/routes/system.py:29](../backend/app/api/routes/system.py#L29)
- **What** When an incoming Firebase UID has no match, the application finds a row by email and assigns that row to the new UID before applying verification and invite checks.
- **Impact / failure scenario** If Firebase ever issues a different identity with the same email, the second identity can inherit the existing PaperAid user ID and role. An unverified identity is sufficient to cross this boundary in the API logic. Firebase provider configuration and identity lifecycle determine whether this condition can occur in deployment.
- **Evidence** The email fallback in `_upsert_user` mutates `firebase_uid` without a verified account-link event. `CurrentUser` accepts unverified profiles, and paper, passage and summary reads use `OptionalUser`, which returns the database row directly.
- **Fix** Make Firebase UID the durable account key. Handle email collisions through explicit verified linking or migration. Test that distinct signed identities with the same email cannot change ownership, inherit roles or read private content.

### [SEVERITY: high] Reference uploads can write unverified metadata into the shared catalog

- **Where** [backend/app/api/routes/library.py:149](../backend/app/api/routes/library.py#L149), [backend/app/services/citations/interchange.py:154](../backend/app/services/citations/interchange.py#L154), [backend/app/services/papers.py:135](../backend/app/services/papers.py#L135)
- **What** BibTeX/RIS entries with identifiers go straight from a user-controlled file to `upsert_public_paper`, bypassing the registry resolution used by direct imports.
- **Impact / failure scenario** Incorrect title, abstract or author data can become public and feed citations or later research answers. Once populated, those fields can survive a later import of the genuine record because enrichment fills blanks.
- **Evidence** The library endpoint calls `upsert_public_paper(db, work, created_by=user)` using the parsed object. The test named `test_bibtex_import_resolves_dois_and_keeps_private_entries` asserts visibility but never asserts that a registry was called or that registry metadata won. [Test](../backend/tests/test_library.py#L83)
- **Fix** Resolve normalized identifiers before any public write and keep unresolved user-supplied records private. Audit existing shared rows for provenance and repair confirmed mismatches. Test with disagreeing file and registry metadata and an unresolvable identifier.

### [SEVERITY: high] Grounding checks accept prose that the cited sources do not support

- **Where** [backend/app/services/ai/grounding.py:63](../backend/app/services/ai/grounding.py#L63), [backend/app/services/ai/features.py:111](../backend/app/services/ai/features.py#L111), [backend/app/services/ai/features.py:236](../backend/app/services/ai/features.py#L236), [frontend/src/pages/PaperDetail.tsx:162](../frontend/src/pages/PaperDetail.tsx#L162)
- **What** Q&A validates evidence identifiers in the prose and in a parallel claims list independently. It does not connect the displayed sentences to those claims or assess whether the excerpts support them. Summary overview text has no equivalent validation, and the insufficient-evidence paths relax checks on free-form output.
- **Impact / failure scenario** An answer may present an unsupported figure with a real source link or include unsupported prose alongside a genuinely supported claim. A summary may present an ungrounded overview after the UI strips its markers.
- **Evidence** An offline check supplied an excerpt stating that an outcome did not change. The validator accepted a displayed sentence saying it doubled and a second sentence with no citation, while the separate structured claim correctly stated no change. `summarize_paper` checks selected point IDs and stores `out.overview` as supplied.
- **Fix** Render answers from validated claim objects tied to quoted spans. Require sentence coverage and add a support check for quantities and meaning, with a fixed response when evidence is insufficient. Apply the same contract to overviews and summaries. Test unsupported text with valid IDs, mismatched prose and claims, invented quantities, and both insufficient-evidence branches.

### [SEVERITY: high] Concurrent saves can silently overwrite a document

- **Where** [backend/app/api/routes/documents.py:59](../backend/app/api/routes/documents.py#L59), [backend/app/services/documents.py:227](../backend/app/services/documents.py#L227), [backend/app/services/documents.py:269](../backend/app/services/documents.py#L269), [backend/app/db/models.py:334](../backend/app/db/models.py#L334)
- **What** The save checks `base_version` against an ORM object loaded earlier and then commits an unconditional update. Revision restore also changes the document without a version precondition.
- **Impact / failure scenario** Two sessions can read version 4, both pass the check and both write version 5. The later write can erase the earlier edit without a 409. Concurrent checkpoints may surface an integrity error instead.
- **Evidence** The model has a version column but no SQLAlchemy version mapping. The service has no row lock or conditional update. The existing test exercises stale writes sequentially. [Test](../backend/tests/test_documents.py#L72)
- **Fix** Perform a conditional update on document ID, owner and expected version, or lock the document row before checking it. Include restore and snapshot creation in the same concurrency model. Test with two independently committed PostgreSQL sessions and assert that exactly one conflicting save succeeds.

### [SEVERITY: high] PDF jobs can become unrecoverable through the normal retry path

- **Where** [backend/app/services/processing.py:36](../backend/app/services/processing.py#L36), [backend/app/services/processing.py:106](../backend/app/services/processing.py#L106), [backend/app/api/routes/admin.py:114](../backend/app/api/routes/admin.py#L114), [frontend/src/pages/Admin.tsx:103](../frontend/src/pages/Admin.tsx#L103)
- **What** The API commits a queued job before Cloud Tasks accepts it. The worker also commits `running` without a lease, and retry deliveries skip all running jobs.
- **Impact / failure scenario** A dispatch failure leaves a row marked queued with no task. A worker shutdown after the running commit leaves a permanently running row. Both states block `queue_ingest`, and the admin UI offers Retry only for failed jobs.
- **Evidence** `queue_ingest` commits at line 57 and dispatches at line 58. `run_job` returns on a running row at line 109. Ordinary ingest exceptions are stored as failed, then the internal endpoint returns 204, so Cloud Tasks treats the delivery as complete even for transient processing failures. The active-job check and worker claim are also read-then-write.
- **Fix** Use an atomic active-job constraint and atomic worker claims with expiring leases. Use a durable dispatch record or reconcilable task IDs, and distinguish retryable errors from terminal failures. Test dispatch failure, worker loss, duplicate delivery and concurrent enqueue.

### [SEVERITY: high] Export can put the wrong source beside a claim

- **Where** [backend/app/services/documents.py:314](../backend/app/services/documents.py#L314), [backend/app/services/export.py:25](../backend/app/services/export.py#L25), [backend/app/services/export.py:49](../backend/app/services/export.py#L49), [backend/app/services/export.py:150](../backend/app/services/export.py#L150)
- **What** The renderer omits clusters whose sources are missing. Both exporters consume the remaining rendered strings positionally against every citation node.
- **Impact / failure scenario** If the first source was deleted and a later source remains, a Word or PDF export can attach the later source to the first claim and leave a placeholder beside the claim it actually supports.
- **Evidence** An offline DOCX check returned `[1] first / [citation] second` when only the second node had a formatted citation.
- **Fix** Carry one render entry per citation node, preserving its position and any missing-source status. Have both exporters resolve the same stable position, including partial clusters. Test deletion, a cluster containing both valid and missing IDs, and subsequent citations in both export formats.

### [SEVERITY: medium] Administrator privileges bypass normal paper privacy

- **Where** [backend/app/services/papers.py:26](../backend/app/services/papers.py#L26), [backend/app/api/routes/papers.py:216](../backend/app/api/routes/papers.py#L216), [backend/app/api/routes/tools.py:103](../backend/app/api/routes/tools.py#L103)
- **What** Normal user-facing paper authorization grants admins all private papers. Legacy restricted this bypass to explicitly administrative operations. [Legacy policy](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/blob/dc38837/src/lib/auth/paper-visibility.ts#L9)
- **Impact / failure scenario** An administrator can encounter another user's private paper in Catalog and access it through the regular PDF, passage, citation and research routes. Research can include those passages in a model request. These paths do not use the admin action audit mechanism.
- **Evidence** `visible_papers_clause` returns `True` for admins and `can_view` makes the same exception. The public-facing privacy copy says uploaded PDFs are served only to the owner. [Privacy page](../frontend/src/pages/Static.tsx#L15)
- **Fix** Enforce owner scoping in user-facing routes. Put any required moderation access behind explicit admin endpoints with audit events. Test owner, unrelated member, anonymous and admin across the catalog and access paths.

### [SEVERITY: medium] Configured bootstrap admins are promoted again after demotion

- **Where** [backend/app/security/auth.py:131](../backend/app/security/auth.py#L131), [backend/app/api/routes/admin.py:84](../backend/app/api/routes/admin.py#L84), [backend/app/config.py:37](../backend/app/config.py#L37)
- **What** The existing-user path reapplies the `ADMIN_EMAILS` role on any verified request, even after an administrator demotes that account.
- **Impact / failure scenario** The admin interface can report a successful, audited demotion while the target's next request silently restores the privilege.
- **Evidence** The update branch assigns `UserRole.ADMIN` whenever the verified email is configured and the current role differs. The settings comment describes first-sign-in bootstrap.
- **Fix** Define a single authority for role changes after bootstrap. Test that a successful demotion persists across subsequent requests for a configured account, or reject demotion explicitly if configured roles are permanent.

### [SEVERITY: medium] Private reads skip invite and verification enforcement

- **Where** [backend/app/security/auth.py:144](../backend/app/security/auth.py#L144), [backend/app/api/routes/papers.py:75](../backend/app/api/routes/papers.py#L75), [backend/app/api/routes/papers.py:234](../backend/app/api/routes/papers.py#L234), [backend/app/api/routes/tools.py:48](../backend/app/api/routes/tools.py#L48)
- **What** Public endpoints resolve an optional Firebase user and use that identity to expand paper visibility without applying the signed-in access policy.
- **Impact / failure scenario** A previously invited researcher whose invite was removed can still receive owner-only paper metadata, passages or summaries through otherwise public endpoints. The same split applies if a previously verified account becomes unverified.
- **Evidence** Only `get_current_user` checks `ALLOWED_EMAILS`, and only `get_verified_user` checks the verification requirement. `OptionalUser` is used for paper, jobs, passages, summary and formatting reads.
- **Fix** Resolve public access separately from the principal permitted to access private data. Test an existing paper owner after allowlist removal and email verification change.

### [SEVERITY: medium] React Query cache can outlive the Firebase identity

- **Where** [frontend/src/lib/auth.tsx:63](../frontend/src/lib/auth.tsx#L63), [frontend/src/lib/auth.tsx:107](../frontend/src/lib/auth.tsx#L107), [frontend/src/pages/Library.tsx:148](../frontend/src/pages/Library.tsx#L148), [frontend/src/pages/PaperDetail.tsx:207](../frontend/src/pages/PaperDetail.tsx#L207)
- **What** Account-dependent query keys lack a user scope, and cache clearing runs only from the app's local sign-out function. Asynchronous profile loads can also complete out of order.
- **Impact / failure scenario** A Firebase identity change originating in another tab can leave private cached data or an outdated profile visible briefly on a shared browser. Server authorization protects fresh responses.
- **Evidence** `onIdTokenChanged` sets Firebase user and loads the profile. It does not clear protected query data or discard a late response from a prior identity.
- **Fix** Clear or switch caches immediately when UID changes, scope account queries to the principal, and discard stale profile responses. Test cross-tab sign-out and account replacement while library and paper queries are cached.

### [SEVERITY: medium] Anonymous work limits can be exhausted or amplified

- **Where** [backend/app/api/routes/discovery.py:35](../backend/app/api/routes/discovery.py#L35), [backend/app/services/scholarly/aggregator.py:126](../backend/app/services/scholarly/aggregator.py#L126), [backend/app/api/routes/tools.py:54](../backend/app/api/routes/tools.py#L54), [backend/app/schemas.py:301](../backend/app/schemas.py#L301)
- **What** Discovery and citation tools use one anonymous counter per action. Discovery accepts a variable-length provider list and fans out once per entry. Citation formatting spawns a Node process for each result.
- **Impact / failure scenario** Heavy traffic from a single caller can rate-limit every anonymous visitor. Per-request work can exceed a normal search severalfold, and a large formatting request can occupy CPU and database connections for an extended period.
- **Evidence** `search:anon`, `citefmt:anon` and `verify:anon` are shared globally. Provider selections are passed to `asyncio.gather` without deduplication. The format schema allows 500 stored IDs and 50 identifiers per call.
- **Fix** Bound and deduplicate provider selections, cap and batch formatting work, and combine per-client limits at a trusted boundary with a global ceiling. Test duplicates, maximum request cost and isolation between anonymous clients.

### [SEVERITY: medium] Document autosave can race with itself and export stale text

- **Where** [frontend/src/pages/Editor.tsx:227](../frontend/src/pages/Editor.tsx#L227), [frontend/src/pages/Editor.tsx:263](../frontend/src/pages/Editor.tsx#L263), [frontend/src/pages/Editor.tsx:320](../frontend/src/pages/Editor.tsx#L320), [frontend/src/pages/Editor.tsx:369](../frontend/src/pages/Editor.tsx#L369)
- **What** Debounced saves, citation insertion and style changes can call `flush` while another request is in flight. `flush` also absorbs errors, and revision restore can discard unsaved changes.
- **Impact / failure scenario** A slow network can produce conflicts in a single tab. Export can download the previous saved version after a conflict or network failure. Closing the tab while a save is in flight can bypass the warning, and restoring a revision before a save completes can lose local text.
- **Evidence** Pending edits are cleared before the PATCH completes, and there is no in-flight promise or queue. Export proceeds after awaiting `flush` regardless of its result. Restore clears pending edits directly.
- **Fix** Serialize saves, await a confirmed version before export, and define how pending work is saved or deliberately discarded before restoring and leaving. Test a delayed first PATCH, rapid edits, export after failed save, and restore with pending text.

### [SEVERITY: medium] Discovery merges distinct publications with the same title and year

- **Where** [backend/app/services/scholarly/aggregator.py:28](../backend/app/services/scholarly/aggregator.py#L28), [backend/app/services/scholarly/aggregator.py:65](../backend/app/services/scholarly/aggregator.py#L65), [backend/app/services/scholarly/identifiers.py:83](../backend/app/services/scholarly/identifiers.py#L83)
- **What** Title/year is treated as an identity key even when both records have different persistent identifiers. Title normalization also strips non-ASCII letters.
- **Impact / failure scenario** Same-title publications can disappear from results or have one paper's identifier combined with another paper's abstract, authors or access link.
- **Evidence** An offline check supplied two records with the same title and year and different DOIs. The aggregator returned one record.
- **Fix** Prioritize strong identifiers, reject conflicting identities before considering a weak match, and require additional Unicode-aware bibliographic agreement. Test identical titles with different DOIs, accented titles and transitive provider matches.

### [SEVERITY: medium] Reference verification overstates what matched

- **Where** [backend/app/services/citations/verify.py:30](../backend/app/services/citations/verify.py#L30), [backend/app/services/citations/verify.py:45](../backend/app/services/citations/verify.py#L45), [backend/app/services/citations/verify.py:91](../backend/app/services/citations/verify.py#L91)
- **What** Missing author/year information can still produce a `verified` result, and the first-author check searches the entire input for a surname substring.
- **Impact / failure scenario** A researcher can receive “Title, author and year match” when the year was absent and the author was not checked. An unrelated surname embedded in a title or journal can also satisfy the author check.
- **Evidence** An offline check returned `verified` with both `year_matches` and `first_author_matches` equal to `None`. Candidate selection ranks by title alone before checking the other fields.
- **Fix** Distinguish matched, mismatched and unavailable fields in the verdict. Compare structured author and year fields where available and rank candidates using all checked fields. Test incomplete references, surname substrings and similar titles.

### [SEVERITY: medium] Unicode titles can break downloads

- **Where** [backend/app/api/routes/papers.py:216](../backend/app/api/routes/papers.py#L216), [backend/app/api/routes/documents.py:182](../backend/app/api/routes/documents.py#L182)
- **What** The download handlers retain Unicode letters with `isalnum()` and interpolate them into the raw `Content-Disposition` header.
- **Impact / failure scenario** A valid Chinese, Arabic or other non-Latin-1 title can cause the PDF or document download to return a server error.
- **Evidence** An offline Starlette response constructed with a Chinese filename raised `UnicodeEncodeError` on header serialization.
- **Fix** Supply an ASCII fallback and a correctly encoded `filename*` value. Test paper PDF, document PDF and DOCX downloads with non-Latin titles.

### [SEVERITY: medium] Schema validation accepts malformed editor trees

- **Where** [backend/app/services/documents.py:61](../backend/app/services/documents.py#L61), [backend/app/services/documents.py:85](../backend/app/services/documents.py#L85), [backend/app/services/documents.py:101](../backend/app/services/documents.py#L101)
- **What** The sanitizer filters names and attributes but assumes many nested fields have usable shapes, and it does not enforce allowed parent-child structures.
- **Impact / failure scenario** Invalid editor input can return a generic 500 or be stored as a tree that TipTap or an exporter cannot render faithfully.
- **Evidence** An offline check gave a heading a non-numeric level. `normalise_document` raised an unhandled `ValueError`. Attribute maps and child collections are also used without consistent type checks.
- **Fix** Validate the document recursively with a typed node schema and a depth, node count and byte limit. Test invalid nested types and tables, and verify that rejected updates preserve the prior version.

### [SEVERITY: medium] Storage and database changes can leave orphaned PDFs

- **Where** [backend/app/api/routes/papers.py:165](../backend/app/api/routes/papers.py#L165), [backend/app/services/processing.py:26](../backend/app/services/processing.py#L26), [backend/app/api/routes/papers.py:184](../backend/app/api/routes/papers.py#L184), [backend/scripts/delete_user.py:49](../backend/scripts/delete_user.py#L49)
- **What** Upload, storage, library association, job submission and deletion use separate commits or external calls without a durable cleanup record.
- **Impact / failure scenario** A failed upload can leave an incomplete paper. A failed object deletion after database deletion can leave a private PDF with no row pointing to it. Retrying the original delete can no longer find the object key.
- **Evidence** Upload first commits the private paper, then stores the PDF, then attaches it to the library. Paper and account deletion commit row removal before object cleanup.
- **Fix** Track pending writes and deletions durably with idempotent cleanup. Test failures on each side of the database/storage boundary and re-run cleanup after restart.

### [SEVERITY: medium] Account deletion leaves the Firebase identity active

- **Where** [backend/scripts/delete_user.py:27](../backend/scripts/delete_user.py#L27), [backend/app/security/auth.py:111](../backend/app/security/auth.py#L111)
- **What** The account-deletion script removes the PaperAid row and associated data but does not disable or remove the Firebase account.
- **Impact / failure scenario** An eligible account can sign in again and recreate its PaperAid profile, while an existing Firebase session can do so on its next accepted request. Application data deletion and identity deletion have different effects.
- **Evidence** The script only uses SQLAlchemy and object storage. The login dependency creates a database user for an eligible UID without an existing row.
- **Fix** Define whether account closure includes Firebase identity deletion. If it does, make identity disablement, session revocation, app deletion and cleanup an idempotent workflow. Verify the identity cannot recreate the profile after closure.

### [SEVERITY: medium] Relevance sorting is applied after catalog pagination

- **Where** [backend/app/api/routes/papers.py:90](../backend/app/api/routes/papers.py#L90), [backend/app/services/search.py:121](../backend/app/services/search.py#L121)
- **What** The route selects candidate IDs by full-text rank, paginates them by creation time and sorts only the returned page by relevance.
- **Impact / failure scenario** An older top-ranked paper can appear on page two below weaker matches. Filtering by status after the 1,000-ID cutoff can also miss qualifying papers and undercount results.
- **Evidence** The SQL order for `relevance` is `Paper.created_at.desc()`, and the Python relevance sort occurs after SQL OFFSET and LIMIT.
- **Fix** Apply filters and ranking in one query before pagination, with a deterministic tie-breaker. Test that an older high-relevance record appears on page one.

### [SEVERITY: medium] Research history drops context and evidence status

- **Where** [backend/app/api/routes/tools.py:106](../backend/app/api/routes/tools.py#L106), [backend/app/db/models.py:411](../backend/app/db/models.py#L411), [frontend/src/pages/Research.tsx:28](../frontend/src/pages/Research.tsx#L28), [frontend/src/pages/Research.tsx:88](../frontend/src/pages/Research.tsx#L88)
- **What** The stored conversation provides display history. The synthesis request receives only the latest question and selected papers, and messages omit the insufficient-evidence flag and gaps.
- **Impact / failure scenario** A follow-up using “those studies” or “that outcome” loses the context the screen implies. Reopened answers can lose the evidence warning, and clearing the last selected paper restores the thread's prior selection.
- **Evidence** `research_synthesis(db, papers, body.question)` runs without previous messages. History constructs every answer with `insufficient_evidence: false` and empty gaps.
- **Fix** Preserve evidence status on stored messages. Make follow-up context explicit and bounded, or present each prompt as independent. Distinguish an untouched selection from an explicitly empty one. Test thread reload, follow-up and clearing the final selection.

### [SEVERITY: medium] Batch citation numbering starts over for every source

- **Where** [backend/app/api/routes/tools.py:73](../backend/app/api/routes/tools.py#L73), [frontend/src/pages/CitationTools.tsx:26](../frontend/src/pages/CitationTools.tsx#L26)
- **What** The generator calls citeproc with one work at a time and then displays and copies those separate bibliographies as one list.
- **Impact / failure scenario** A multi-paper IEEE or Vancouver bibliography can label multiple entries with the first reference number, and author-date disambiguation cannot account for the other works.
- **Evidence** Each loop iteration creates a new processor with only the current entry. Direct Node checks returned `[1]` for each IEEE single-item call and `[1]`, `[2]` for a shared call. The editor already supplies the full set and clusters in one call.
- **Fix** Format multi-item requests in a shared processor and return a bibliography in CSL order with a stable mapping to records. Test multiple numeric references and same-author/same-year disambiguation.

### [SEVERITY: medium] Legacy user data has no migration path in the repository

- **Where** [docs/DEPLOYMENT.md:16](DEPLOYMENT.md#L16), [backend/alembic/versions/20261113_76823bdc585a_initial_schema.py:21](../backend/alembic/versions/20261113_76823bdc585a_initial_schema.py#L21)
- **What** The deployment instructions and initial Alembic revision create the new schema. The repository contains no transfer for old accounts, bookmarks, uploads, documents, citations, revisions, collections or threads.
- **Impact / failure scenario** Existing researchers can lose access to prior work if a cutover depends only on the checked-in deployment procedure. An external migration may exist. Its execution and reconciliation were outside the evidence available for this review.
- **Evidence** The v1 Prisma schema has these entities and uses its own IDs and authentication. The v2 migration creates new tables and requires a Firebase UID per user. [Legacy schema](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/blob/dc38837/prisma/schema.prisma#L69)
- **Fix** For a cutover carrying existing data, create an explicit identity mapping and offline migration with owner validation, storage reconciliation and representative old document/citation tests. Keep fresh installs and legacy migration as separately testable paths.

### [SEVERITY: medium] Embedding failures also take extracted text offline

- **Where** [backend/app/services/processing.py:81](../backend/app/services/processing.py#L81), [backend/app/services/processing.py:121](../backend/app/services/processing.py#L121), [backend/app/services/search.py:57](../backend/app/services/search.py#L57)
- **What** Optional embedding errors can mark an already-extracted paper failed. At query time, a vector provider error aborts retrieval even after keyword results are available.
- **Impact / failure scenario** If the embedding provider is rate-limited or unavailable, passage search and grounded answers can fail despite usable local text. A paper may require manual reprocessing after an otherwise successful extraction.
- **Evidence** The worker commits `READY` before embedding, then the shared exception handler sets `FAILED`. Hybrid search awaits both branches with no fallback for vector errors.
- **Fix** Track embedding readiness independently and use keyword retrieval during embedding failures. Test provider timeouts in both ingestion and query paths.

### [SEVERITY: medium] Private PDF responses are buffered and cacheable

- **Where** [backend/app/api/routes/papers.py:215](../backend/app/api/routes/papers.py#L215), [backend/app/services/storage.py:87](../backend/app/services/storage.py#L87), [backend/app/main.py:91](../backend/app/main.py#L91)
- **What** The PDF handler loads the full object into memory and overrides the API's default `no-store` behavior with a five-minute private cache.
- **Impact / failure scenario** Concurrent large downloads increase process memory use, and the browser can retain a response after a user signs out or loses access. The response does restrict shared caches.
- **Evidence** GCS `get` returns `response.content`, and the route passes that byte array to `Response` with `private, max-age=300`.
- **Fix** Stream stored files with backpressure and use `no-store` for private uploads. Test object-stream cleanup on disconnect and cache headers for private files.

### [SEVERITY: low] Collection membership can outlive its library entry under concurrency

- **Where** [backend/app/api/routes/library.py:131](../backend/app/api/routes/library.py#L131), [backend/app/api/routes/library.py:273](../backend/app/api/routes/library.py#L273), [backend/app/db/models.py:325](../backend/app/db/models.py#L325)
- **What** Collection membership is checked against the library in application code, while the relation only references the collection and paper.
- **Impact / failure scenario** A simultaneous remove-from-library and add-to-collection can leave a membership counted by the collection but absent from its library view. Duplicate concurrent adds can also conflict.
- **Evidence** One request deletes memberships then the library row. The other reads the library row before inserting a membership. The database has no constraint relating that membership to the owner's library row.
- **Fix** Tie membership to the owning library item or serialize writes for the user and paper. Use a conflict-safe insert and test both concurrent cases.

### [SEVERITY: low] SQL sessions stay open across external calls and large reads are unbounded

- **Where** [backend/app/services/search.py:76](../backend/app/services/search.py#L76), [backend/app/api/routes/tools.py:96](../backend/app/api/routes/tools.py#L96), [backend/app/api/routes/library.py:51](../backend/app/api/routes/library.py#L51), [backend/app/api/routes/tools.py:141](../backend/app/api/routes/tools.py#L141), [backend/app/security/rate_limit.py:39](../backend/app/security/rate_limit.py#L39)
- **What** Several requests keep an open SQL transaction while awaiting providers or citation subprocesses. Library reads, conversation messages and library exports lack pagination or streaming. The rate-bucket purge has no application caller.
- **Impact / failure scenario** Slow provider calls can consume the ten default database connections per instance, while growing libraries, histories and expired buckets add avoidable load. Production pool and load behavior were not measured.
- **Evidence** Research loads papers and runs retrieval/model calls before committing messages. Library and message queries materialize complete result sets. The purge helper is defined but never scheduled in the checkout.
- **Fix** Keep transactions short, paginate interactive lists, bound bulk exports and schedule bucket expiry. Test response bounds and measure pool occupancy with slow upstreams.

### [SEVERITY: low] Mobile and keyboard users can lose access to editor controls

- **Where** [frontend/src/pages/Editor.tsx:311](../frontend/src/pages/Editor.tsx#L311), [frontend/src/pages/Editor.tsx:362](../frontend/src/pages/Editor.tsx#L362), [frontend/src/components/ui.tsx:128](../frontend/src/components/ui.tsx#L128), [frontend/src/pages/Library.tsx:212](../frontend/src/pages/Library.tsx#L212)
- **What** The editor hides style selection on small screens while the default sources panel takes a fixed 320px. Some library/history actions are hover-only, and the shared modal lacks focus trapping and restoration.
- **Impact / failure scenario** Narrow-screen users can lose writing space and citation controls. Keyboard and touch users may be unable to reach actions or may tab into the background of a dialog.
- **Evidence** The style selector uses `hidden md:block`, the open panel uses `w-80 shrink-0`, and collection controls use `hidden group-hover:block`. The modal registers an Escape handler and renders ARIA dialog attributes.
- **Fix** Use a responsive drawer, keep actions reachable on focus and touch, and manage dialog focus. Add keyboard and narrow-viewport interaction tests.

### [SEVERITY: low] Deployment instructions apply migrations in contradictory order

- **Where** [docs/DEPLOYMENT.md:16](DEPLOYMENT.md#L16)
- **What** The runnable procedure deploys the service before running migrations, then states that schema expansion must precede code that depends on it.
- **Impact / failure scenario** Following the sample can route traffic to a revision before its required columns exist. The readiness endpoint only checks connectivity.
- **Evidence** The command block starts with `gcloud run deploy`, then reuses that revision's image for the migration job. [Readiness handler](../backend/app/api/routes/system.py#L22)
- **Fix** Document building the image, applying compatible schema changes and verifying readiness before switching traffic. Check the expected schema revision in a release gate.

## Original behavior to retire or rebuild

- **Research Snapshot.** The original selected real abstracts but generated a fixed medical-imaging narrative even for unrelated searches. It derived “full text” page numbers from citation position and retained abstract snippets. V2 uses actual abstracts and can decline an answer. The grounding finding above still applies. [Legacy snapshot](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/blob/dc38837/src/lib/discovery/snapshot/snapshot-service.ts#L203)
- **Deep research metrics.** The original contained generic parsing and evidence selection alongside paper-specific records, values, excerpts and default page numbers. It covered several benchmark studies, beyond the single-study shorthand in the brief. Restore the workflow by reading real table cells and provenance. [Legacy metric verifier](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/blob/dc38837/src/lib/agent/metric-verifier.ts#L295)
- **Topic-specific evidence rules.** Legacy ranking and validation have hand-coded topic and study patterns. The deterministic Q&A fallback reads retrieved text but includes a hard-coded table attribution. These are provenance risks even where the rest of the workflow was genuine. [Legacy ranking](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/blob/dc38837/src/lib/discovery/ranking.ts#L156) · [Legacy synthesis validation](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/blob/dc38837/src/lib/synthesis/validate-multipaper-citations.ts#L40) · [Legacy lexical fallback](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/blob/dc38837/src/lib/rag/deterministic-qa-synthesizer.ts#L45)
- **Homepage evidence sandbox.** The original contains a scripted simulator with fixed questions, claims, source excerpts and scores. At the audited tag, the component is present in source without a page that imports it. The FAQ and onboarding are reachable and are genuine parity gaps. [Legacy sandbox](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/blob/dc38837/src/components/home/evidence-sandbox.tsx#L161) · [Legacy homepage](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/blob/dc38837/src/app/page.tsx#L532)
- **Citation generator fixtures.** The legacy tool shipped pre-filled sample papers. Editable manual citation entry and file export are genuine features and can use explicitly supplied metadata. [Legacy citation generator](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/blob/dc38837/src/app/tools/citation-generator/page.tsx#L99)

## Legacy-to-v2 feature parity

**Present** means the core capability has a reachable replacement. **Partial** means a meaningful part of the original workflow or interface is absent or materially different. **Missing** means there is no corresponding workflow. Configurable AI features are mapped from the code, with availability governed by the provider configuration.

| Capability | Original at `legacy-v1` | V2 status | V2 implementation or gap |
| --- | --- | --- | --- |
| Public homepage and quick search | `/` and hero search | Partial | [Home.tsx](../frontend/src/pages/Home.tsx) has the search and feature overview. FAQ, richer workspace landing and public workflow guides are absent. Standalone legacy showcase components have no active route at the tag. |
| Dashboard | `/dashboard` and dashboard view with recent documents, library, collections and research history | Missing | Direct navigation to individual sections in [Layout.tsx](../frontend/src/components/Layout.tsx). No aggregate dashboard. |
| Onboarding and help | Root onboarding dialog, dashboard checklist, workspace help guides | Missing | No equivalent in [App.tsx](../frontend/src/App.tsx) or [Layout.tsx](../frontend/src/components/Layout.tsx). |
| Registration, login, logout and sessions | `/login`, `/register`, NextAuth handler and registration API | Present | [Auth.tsx](../frontend/src/pages/Auth.tsx) and [auth.tsx](../frontend/src/lib/auth.tsx) use Firebase, with verification, password reset and optional Google sign-in. |
| Account and privacy pages | `/account`, `/privacy` | Present | [Account.tsx](../frontend/src/pages/Account.tsx), [Static.tsx](../frontend/src/pages/Static.tsx) and [system.py](../backend/app/api/routes/system.py). Account management now includes profile editing and password reset. |
| Scholarly search and per-provider feedback | `/discover`, `searchScholarlyAction`, provider adapters | Present | [Discover.tsx](../frontend/src/pages/Discover.tsx) and [aggregator.py](../backend/app/services/scholarly/aggregator.py). OpenAlex and arXiv are built in. CitedEvidence's own integration is listed separately. |
| Discovery controls | Provider selection, subject filters, time presets and range, access filter, newest and citation-count sorting | Partial | [Discover.tsx](../frontend/src/pages/Discover.tsx) exposes start year and open access. [discovery.py](../backend/app/api/routes/discovery.py) also accepts providers and end year. Subject filters, time presets and user-selected ordering are absent. |
| Discovery cards and save/import | Local library match, reference modal, access link, metadata save | Partial | [Discover.tsx](../frontend/src/pages/Discover.tsx) and [discovery.py](../backend/app/api/routes/discovery.py) show a public catalog match by DOI/PMID, format citations and save by identifier. Personalized save status and arXiv-only match coverage are reduced. |
| Discovery research snapshot | `getResearchSnapshotAction`, automatic/manual snapshot, evidence mode and source detail | Partial | Abstract overview and excerpts in [Discover.tsx](../frontend/src/pages/Discover.tsx) and [features.py](../backend/app/services/ai/features.py#L162). Old canned and invented provenance paths were retired. |
| Paper catalog | `/papers`, hybrid search, category/status/sort controls | Partial | [Catalog.tsx](../frontend/src/pages/Catalog.tsx) and [papers.py](../backend/app/api/routes/papers.py#L74) provide paginated keyword search and sorting. Status filter is API-only. Category filtering and catalog vector ranking are absent. Hybrid ranking survives in passage search. |
| Author directory and profiles | `/authors`, `/authors/[id]`, search and paper counts | Missing | [models.py](../backend/app/db/models.py#L208) retains author records. No directory, profile or author route. |
| Category directory and profiles | `/categories`, `/categories/[id]`, category counts and papers | Missing | No category model, pages or API. Library collections are personal organization. |
| Paper details | `/papers/[id]`, metadata, identifiers, abstract, status, related author/category navigation | Partial | [PaperDetail.tsx](../frontend/src/pages/PaperDetail.tsx) retains paper metadata, citation, save and research tools. Linked author/category views and old embedding diagnostics are absent. |
| Open-access lookup and processing | `discoverPaperOpenAccessAction`, request/poll analysis, attach available PDF | Partial | [open_access.py](../backend/app/services/open_access.py), [processing.py](../backend/app/services/processing.py), [PaperDetail.tsx](../frontend/src/pages/PaperDetail.tsx). Retrieval and job polling survive. The separate find-access workflow is combined with processing. |
| Authorized paper PDF route | GET/HEAD, stored PDF or vetted external OA redirect | Partial | [papers.py](../backend/app/api/routes/papers.py#L215) provides signed-in GET for stored files and the UI downloads them. Dedicated HEAD and safe external redirect behavior are absent. |
| PDF pipeline, passages and optional vectors | Extract, detect sections, chunk, embed, retrieve passages | Present | [pdf.py](../backend/app/services/pdf.py), [processing.py](../backend/app/services/processing.py), [search.py](../backend/app/services/search.py). Scanner OCR remains outside v2. Structured extraction is listed below. |
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
| Unified research history | `/conversations`, `/history`, `/conversations/[id]`, type filters and links | Partial | [Research.tsx](../frontend/src/pages/Research.tsx) and [tools.py](../backend/app/api/routes/tools.py#L133) support multi-paper conversation list/detail/delete. Single-paper/deep-agent threads, cross-type filters and legacy URLs are absent. |
| Document dashboard | `/editor`, document CRUD, search and type filters | Partial | [Documents.tsx](../frontend/src/pages/Documents.tsx) lists, creates and deletes. Rename is available in [Editor.tsx](../frontend/src/pages/Editor.tsx). Dashboard search, type filtering and inline rename menu are absent. |
| Guided manuscript templates | Document types, study designs, suggested objectives, editable sections, writing guidance | Present | [Documents.tsx](../frontend/src/pages/Documents.tsx) and [templates.ts](../frontend/src/lib/templates.ts). V2 uses editable multiline fields instead of per-section controls. |
| Rich text and draft persistence | `/editor/[id]`, toolbar, live counts, autosave, conflict resolution | Partial | [Editor.tsx](../frontend/src/pages/Editor.tsx) and [documents.py](../backend/app/services/documents.py) implement the core editor and conflict UI. Legacy live counts and several toolbar controls are reduced. Save issues are documented above. |
| Document source attachment | List library sources, link/detach paper, source drawer | Partial | Source CRUD exists in [documents.py](../backend/app/api/routes/documents.py#L86). [Editor.tsx](../frontend/src/pages/Editor.tsx#L75) cites from the library and automatically attaches sources. Explicit linked-source management is absent in the UI. |
| In-text citations and bibliography | Structured insertion and deletion, CSL numbering, style switching, reference-list insertion | Partial | [Editor.tsx](../frontend/src/pages/Editor.tsx) and [documents.py](../backend/app/services/documents.py#L291) render a generated bibliography and support cursor insertion. API supports more locator fields than the UI. No citation delete-record endpoint or insert-bibliography-into-canvas command. |
| AI rewrite | Rewrite selection, then apply result | Present | [Editor.tsx](../frontend/src/pages/Editor.tsx#L131) and [tools.py](../backend/app/api/routes/tools.py#L169). Uses a toolbar modal. |
| Selection popover and inline ghost autocomplete | Inline menu, suggestion display and keyboard acceptance | Partial | [Editor.tsx](../frontend/src/pages/Editor.tsx#L131) and [tools.py](../backend/app/api/routes/tools.py#L177) offer manual continuation/rewrite via modal. Ghost text and contextual selection popover are absent. |
| Evidence summary inside editor | Source drawer action, summarization dialog and insert-with-citation | Missing | The separate paper summary does not summarize and insert evidence inside a document. |
| Document revisions and recovery | List, preview, compare/restore and export historical snapshots | Partial | [documents.py](../backend/app/api/routes/documents.py#L153) lists, reads and restores revisions. The UI lists/restores. No comparison, revision preview UI or direct historical export. |
| Current document export | Markdown, text, HTML, BibTeX, RIS, JSON, DOCX, PDF | Partial | [documents.py](../backend/app/api/routes/documents.py#L181) exports DOCX/PDF. Bibliographic file export exists separately for the library. |
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

## Areas checked

- Public catalog and anonymous reads use explicit paper visibility. Ordinary users are owner-scoped on direct paper reads, and invisible papers return 404. The admin and optional-auth exceptions are documented above.
- Documents, revisions and conversation routes verify ownership server-side. Collection operations scope collection IDs to the owner. A citation's optional chunk ID is checked against its paper, and rendering resolves only citations belonging to the document.
- Firebase verification checks audience and issuer. The Cloud Tasks handler checks the OIDC audience, configured service-account email and verified-email claim and is excluded from OpenAPI. The local backend fixture substitutes token verification, so production token issuance was outside this check.
- The PDF fetcher checks scheme and port, rejects URL credentials, validates addresses on each hop, pins the connection address, and bounds redirects and PDF bytes. File downloads flow through the API. The storage availability and worker lifecycle issues are above.
- Inspected all frontend raw citation HTML sinks. They call the same allowlist sanitizer. Grounded Q&A renders text and recognized citation markers. The frontend test suite covers basic rendering, route guards, templates and utility behavior. It does not cover the concurrent editor, cross-tab identity and mobile workflows reported above.
- The new schema migration emitted offline DDL for PostgreSQL and pgvector. SQL execution, drift against a live schema, cascade behavior and database concurrency remain unverified in this session.
- The deployment plan keeps keys in runtime settings and Secret Manager. The repository's Firebase web configuration is public client configuration. Production IAM, secret state and cloud resource configuration were outside the local audit.
- The selected architectural decisions in the brief were treated as constraints. The audit found gaps in migration sequencing and data transfer, queue recovery and fallback behavior around optional embeddings. The documented fixed dimension, Cloud Tasks region, citeproc-js subprocess choice and lack of OCR were not scored as defects.

## Verification commands and results

Commands were run from the indicated directory using the installed workspace dependencies. Frontend build used the direct Vite entry after the standalone TypeScript check.

| Directory | Command | Result |
| --- | --- | --- |
| Repository | `git status --short --branch`, `git log -5 --oneline`, `git rev-parse main platform-v2 'legacy-v1^{commit}'` | Final local refs show both v2 branches at `7538f73`, legacy at `dc38837`. The audit Markdown is the only workspace change. |
| Repository | `git diff --name-only 8c3c8ce HEAD`, `git diff --exit-code 8c3c8ce HEAD -- backend frontend` | Only `AGENTS.md`, `docs/AUDIT_BRIEF.md` and `docs/HANDOFF.md` changed after the requested commit. |
| Repository | `git ls-remote origin refs/heads/main refs/heads/platform-v2 refs/tags/legacy-v1 'refs/tags/legacy-v1^{}'` | Direct Git transport failed to resolve GitHub. Read-only GitHub connector comparisons verified the refs and documentation-only delta. Its combined-status response and PR-workflow listing were empty, so this review has no independently verified CI result. |
| Repository | `git ls-tree -r --name-only legacy-v1 -- src/app src/lib src/components`, `git grep -l 'use server' legacy-v1 -- src/app src/lib`, followed by `git show` and `git grep` on original paths | Enumerated pages, routes and actions. Compared original capability implementations with current entry points. |
| Frontend | `npm test` | **17 passed** in 2 files. |
| Frontend | `npm run typecheck` | Passed. |
| Frontend | `.\node_modules\.bin\vite.cmd build` | Passed. |
| Frontend | `npm audit --audit-level=high --fetch-retries=0` | Advisory check blocked. DNS resolution for `registry.npmjs.org` failed. |
| Citation engine | `npm audit --omit=dev --audit-level=high --fetch-retries=0` | Same DNS failure. |
| Backend | `.\.venv\Scripts\ruff.exe check app tests alembic scripts` and `.\.venv\Scripts\ruff.exe format --check app tests alembic scripts` | Both passed. 63 files already formatted. |
| Backend | `.\.venv\Scripts\python.exe -m pytest -q` | 104 setup errors, 5 live tests deselected. The PostgreSQL session fixture failed connecting to local `127.0.0.1:6423` with Windows permission error 10013. No backend test bodies ran in this invocation. |
| Backend | `.\.venv\Scripts\python.exe -m pytest -m live -q --maxfail=1 --tb=short` | Stopped at the first PostgreSQL setup error, before any scholarly API request. A database-free attempt with `--noconftest -m live -q tests/test_live.py --tb=short` did not return a result and was cancelled. |
| Backend | `.\.venv\Scripts\python.exe -m pytest --noconftest -q tests/test_scholarly.py -k 'test_parse_identifier or test_provider_mappers or test_merge_fills'` | **18 passed**, 5 deselected. Used a loopback-only `TEST_PG_URL` to suppress embedded server startup when the test module imported its helpers. No database fixture ran. |
| Backend | `.\.venv\Scripts\python.exe -m pytest --noconftest -q tests/test_citations.py -k 'test_every_bundled_style or test_numeric_styles or test_arxiv_preprints'` | Did not return a result. A bounded retry of the style tests using `-k 'test_every_bundled_style' --maxfail=1 --tb=short` was stopped after 25 seconds without output. |
| Backend | PowerShell piped one JSON request per style to `node app/services/citations/engine/format.cjs` | **10 styles passed** the direct engine smoke checks. Two additional single-item IEEE calls each returned `[1]` while the shared call returned `[1]`, `[2]`. This exercises the runner independently of the Python subprocess wrapper. |
| Backend | `.\.venv\Scripts\python.exe -m alembic upgrade head --sql` with local test settings | Offline migration DDL generated successfully, including pgvector and revision `76823bdc585a`. |
| Backend | `.\.venv\Scripts\python.exe -m alembic check` with local test settings | PostgreSQL connection denied with error 10013. Live schema drift check remains unverified. |
| Backend | `.\.venv\Scripts\python.exe -m pip_audit --version` and `.\.venv\Scripts\python.exe -m pip check` | `pip-audit` was unavailable. Installed package requirements were consistent. |
| Backend | Inline `.\.venv\Scripts\python.exe -X utf8 -` checks against validators, models and exporters | Reproduced unsupported AI prose passing validation, wrong DOCX citation placement, duplicate DOI collapse, an incomplete reference marked verified, Unicode header failure and invalid editor node failure. |

### Remaining verification for maintainers

- Run the complete PostgreSQL suite on CI or a host with a permitted local PostgreSQL connection. Run `alembic check` against a disposable database migrated from the current revision.
- Run the live scholarly tests and dependency advisory tools in an environment with network access to those upstreams. Obtain CI results for the current commit if they are available.
- Add isolated regression tests for the source-reviewed findings when fixing them. Existing tests cover sequential document conflicts and user isolation with mocked identities. They do not exercise same-email/different-UID handling, demotion persistence, queue dispatch failures, worker shutdown or concurrent saves.
- Enable AI only after validating the grounded-output behavior with adversarial model fixtures and supported input. The report's fixes are proposals. Application code and production resources were left untouched.
