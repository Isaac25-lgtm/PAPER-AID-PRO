# PaperAid Pro v2 Deep Research and code-integrity audit

**21 November 2026 · Independent review of main at `2d8b8b5d59fd2f858bde2f69e0824e6554808ffd`.** The requested interval after `90e4880` contains eight commits across 60 files. I checked the local revision against GitHub, reviewed the changed paths and their callers, and ran the application suites against the committed code. The broader integrity checks cover the existing application through those suites, earlier regressions and the route inventory. They do not constitute a new manual inspection of every historical line or a certification of the deployed environments.

PaperAid Pro is an academic research workspace. It searches scholarly databases, organizes personal papers and PDFs, supports citation-aware writing and exports, and checks references. Deep Research takes a question outside the personal library, collects ranked sources, and can write an evidence-linked report when the account has AI access.

**Decision. Proceed with fixes on a separate branch. Keep general web search off until F01 and F07 are fixed and the privacy notice is ready. Keep AI report writing off until F06 is fixed and a keyed staging run has been reviewed.** The current user-facing priority is the reference checker. I found **15 findings, one high, ten medium and four low**. The high finding requires a configured web provider. Independent checks passed for all 345 backend and 156 frontend tests. One of seven live-provider tests failed twice with OpenAlex HTTP 429.

## Findings

The numbered headings below correspond to F01–F15 in the handoff.

### 1. [SEVERITY: high] Deep Research can send a question to web search while its checkbox says it is off

- **Where** [DeepResearch.tsx · 53](../frontend/src/pages/DeepResearch.tsx#L53), [DeepResearch.tsx · 132](../frontend/src/pages/DeepResearch.tsx#L132), [deep_research.py · 239](../backend/app/services/deep_research.py#L239).
- **What** The checkbox displays the combination of the capability response and the user's selection. The POST sends the selection alone, initially true. Submission is available while the capability is pending or has failed.
- **Impact / failure scenario** With Tavily configured, a researcher told that only scholarly databases will be searched can have their question or its search terms sent to Tavily. The brief records Tavily as disabled on both deployments. This is an activation blocker, with no observed disclosure.
- **Evidence** In an isolated copy of the committed frontend, I kept the status request pending, rendered the real page, typed a question and clicked Run. The checkbox was disabled and unchecked. The captured POST contained `include_web: true`. The backend checks that value and its own provider configuration. I repeated the form submission in real headless Chrome at 320 and 390 CSS pixels with an isolated local API fixture. Both widths sent true.
- **Fix** Derive the checkbox and the payload from the same effective choice. Treat unknown capability as off and default the API's optional web flag to false. Cover pending, failed, disabled, checked and explicitly unchecked states at the submit boundary.

### 2. [SEVERITY: medium] A DOI that resolves can be labelled as pointing to the wrong publication

- **Where** [verify.py · 116](../backend/app/services/citations/verify.py#L116), [verify.py · 175](../backend/app/services/citations/verify.py#L175), [test_messy_input.py · 206](../backend/tests/test_messy_input.py#L206).
- **What** After resolving a DOI, the verifier strips the DOI and compares the remaining text with the registered title. For a bare DOI or DOI URL there are no bibliographic fields left, yet the DOI branch treats that missing title as a contradiction.
- **Impact / failure scenario** A researcher can paste a valid DOI and receive a red warning that it resolves to a different work. This directly contradicts the browser handoff's DOI-only result.
- **Evidence** I called `verify_reference` with only a DOI and a successful controlled registry lookup. The result was `mismatch` with the different-publication explanation. The existing regression supplies both author and title alongside the link. The public HTTP endpoint returned the same mismatch.
- **Fix** Represent a successfully resolved identifier with absent title, author and year as a found publication with unchecked fields. Preserve disagreement for actual conflicting metadata. Test the bare DOI, its URL, and the same DOI alongside an incorrect title through the HTTP endpoint and UI.

### 3. [SEVERITY: medium] Correct numbered references can fail the author check, and the badge misstates the reason

- **Where** [verify.py · 101](../backend/app/services/citations/verify.py#L101), [CitationTools.tsx · 83](../frontend/src/pages/CitationTools.tsx#L83), [CitationTools.tsx · 91](../frontend/src/pages/CitationTools.tsx#L91).
- **What** The author matcher drops a one-character enumeration but retains a multi-digit enumeration as the supposed first author. The UI labels every mismatch as a DOI pointing to another work, even when the input contains no DOI.
- **Impact / failure scenario** Later entries in a numbered bibliography can be marked wrong solely because of their position. A genuine year or author discrepancy also receives a misleading headline.
- **Evidence** Against the same registry record, `1. Smith A. School attendance and household income. 2017.` assessed as verified. Changing only the prefix to `12.` returned mismatch. The submit handler splits numbered records and passes the numbering through.
- **Fix** Remove leading bibliography labels before field comparison. Keep meaningful numbers inside titles. Use a neutral mismatch badge or render the specific field conflict. Cover 1, 10 and bracketed 12, a no-DOI wrong year, and a genuine DOI/title disagreement.

### 4. [SEVERITY: medium] A secondary registry outage discards evidence already obtained

- **Where** [verify.py · 52](../backend/app/services/citations/verify.py#L52), [verify.py · 192](../backend/app/services/citations/verify.py#L192), [verify.py · 205](../backend/app/services/citations/verify.py#L205).
- **What** A secondary OpenAlex error escapes the candidate loop and the outer handler drops even the successful Crossref match. Conversely, an error from the first DOI registry prevents trying the second. An error on a later OpenAlex title segment can also discard its earlier candidates.
- **Impact / failure scenario** A plausible real paper disappears from the result during a quota refusal. It is an error response, not a fabricated-reference verdict, but the promised Crossref-only degradation does not work.
- **Evidence** The actual verifier assessed a controlled Crossref record as `likely_match`. With the same record and an OpenAlex 429 represented by the transport's `UpstreamError`, it returned `error` and `match: null`. The independent live suite also encountered a genuine OpenAlex 429 on a different operation.
- **Fix** Retain candidate and completion status per registry and segment. Assess available records, disclose incomplete coverage, and return lookup unavailable when the search is inconclusive. Test both outage directions, a partial segment result and full outage.

### 5. [SEVERITY: medium] Public catalog misses can consume the shared upstream search budget without a caller limit

- **Where** [papers.py · 89](../backend/app/api/routes/papers.py#L89), [papers.py · 117](../backend/app/api/routes/papers.py#L117), [discovery.py · 55](../backend/app/api/routes/discovery.py#L55), [rate_limit.py · 30](../backend/app/security/rate_limit.py#L30).
- **What** The public catalog route sends unsuccessful local queries to ESpell and can issue keyed OpenAlex count requests. This path has no application-level caller or aggregate upstream limit. Discover already has one. The same catalog route also searches a signed-in researcher's private uploads.
- **Impact / failure scenario** Regular use of suggested spelling on a public catalog can compete with Discover, PDF lookup, verification and Deep Research for OpenAlex quota. The brief records a single provider key shared with staging. A local catalog query may also leave the service on a miss.
- **Evidence** Traced `CatalogPage` to `list_papers` to `suggest_correction` and the HTTP wrapper. The route accepts an optional user, and its middleware supplies request context rather than a quota. No load or quota-exhaustion experiment was performed. A separate anonymous HTTP test reached the upstream-suggestion boundary on a catalog miss.
- **Fix** Prefer local vocabulary for a search presented as a catalog of imported records. If external suggestions remain, make the external behavior visible, bound it with the existing caller and aggregate limiter, and cache provider unavailability briefly. Test that a refused or exhausted external allowance still returns the local result.

### 6. [SEVERITY: medium] AI outages can abort Deep Research before it saves any sources

- **Where** [deep_research.py · 101](../backend/app/services/deep_research.py#L101), [deep_research.py · 230](../backend/app/services/deep_research.py#L230), [deep_research.py · 298](../backend/app/services/deep_research.py#L298), [providers.py · 136](../backend/app/services/ai/providers.py#L136).
- **What** The planner falls back for malformed model output and refusal, but provider rate-limit and upstream errors escape before scholarly search. At report time the handler catches application errors, while the OpenAI and Gemini HTTP adapters can also raise transport or response-decoding exceptions directly.
- **Impact / failure scenario** With AI enabled, a transient model failure can cost a run and leave no report history or sources, even with working databases. AI is recorded as disabled in the deployed configuration.
- **Evidence** A controlled provider outage propagated `UpstreamError` from `plan_queries`. The call sequence reaches database search only afterwards. I also traced the report adapter boundaries. Model billing and real model responses were not exercised. Against the real route and local PostgreSQL, the failed planner returned an error and history was empty.
- **Fix** Normalize provider transport and invalid-response failures at the adapter boundary. Fall back to the question on a recoverable planner error. Save the search-only result when writing fails. Preserve cancellation. Test planner 429, report transport failure and a plan that cleans to nothing, with truthful `planned_by_ai` metadata.

### 7. [SEVERITY: medium] Deep Research year limits do not constrain web evidence

- **Where** [DeepResearch.tsx · 127](../frontend/src/pages/DeepResearch.tsx#L127), [deep_research.py · 240](../backend/app/services/deep_research.py#L240), [deep_research.py · 281](../backend/app/services/deep_research.py#L281), [web_search.py · 84](../backend/app/services/web_search.py#L84).
- **What** The year fields are presented for the run. Only the scholarly branch receives them. Web results retain a parsed publication year but are accepted as sources and report evidence regardless of that year.
- **Impact / failure scenario** With Tavily enabled, a time-bounded literature review can cite out-of-period material. A verbatim quotation can pass the grounding checks without meeting the study's date criterion.
- **Evidence** Traced both branches from the same request. A controlled 1999 web result passed the actual web collection helper and reported success. The caller supplies no year range to this helper and the evidence loop has no year check. With a 2015–2025 request, an independent API test found the 1999 item marked read in the saved run.
- **Fix** Apply the range before listing or citing web results. Define how undated web pages are handled and show that choice to the reader. Test both inclusive boundaries, out-of-range and undated pages in the saved run and written report.

### 8. [SEVERITY: medium] Spelling cache entries can rewrite protected terms across requests

- **Where** [spelling.py · 49](../backend/app/services/scholarly/spelling.py#L49), [spelling.py · 124](../backend/app/services/scholarly/spelling.py#L124), [discovery.py · 87](../backend/app/api/routes/discovery.py#L87).
- **What** Eligibility depends on capitalization, but the cache folds case and stores a fully rendered replacement. One request therefore determines another request's spelling and capitalization on that process.
- **Impact / failure scenario** An acronym or protected term can be silently replaced. Different instances can return different queries for identical input depending on which casing was searched first.
- **Evidence** With fixed ESpell and confirmation responses, `MALRIA study` was left alone on a cold cache. After searching lowercase `malria study`, the uppercase request returned `malaria study`. The counts were mocked so only cache behavior varied.
- **Fix** Cache on the normalized but case-preserving query, or cache word suggestions and reapply eligibility to the current tokens. Test both arrival orders. Frequency ratios estimate plausibility only. Where preserving a correctly spelled research term is a requirement, show the suggestion and let the researcher choose it.

### 9. [SEVERITY: medium] Library and citation pickers can silently substitute a different research term

- **Where** [library.py · 113](../backend/app/api/routes/library.py#L113), [fuzzy.py · 18](../backend/app/services/fuzzy.py#L18), [papers.tsx · 148](../frontend/src/components/papers.tsx#L148), [Library.tsx · 177](../frontend/src/pages/Library.tsx#L177).
- **What** The library returns ordinary items and a count after a fuzzy retry. It returns no effective query. Callers cannot explain a substitution or request a literal result. The main Library page itself sends collection and tag filters but has no title-search input.
- **Impact / failure scenario** A researcher searching their collection for one subject may be offered papers about another in a citation or research picker without knowing why. Restricting substitute words to the collection does not establish they mean the same thing.
- **Evidence** The real local helper changed `fetal exposure` to `metal exposure` when the available title was `Metal exposure`. The backend retries that query and serializes items alone. The test of a successful HTTP library filter does not exercise a title filter on the main Library page.
- **Fix** Expose the effective query and exact-search choice through the API and picker UI, or make fuzzy matches explicit suggestions. Keep ordinary collection and tag paging intact. Test a valid near-neighbor, a genuine typo, and main-page title filtering if that feature is intended.

### 10. [SEVERITY: medium] Reference assessment has unbounded synchronous work per submitted reference

- **Where** [schemas.py · 376](../backend/app/schemas.py#L376), [tools.py · 127](../backend/app/api/routes/tools.py#L127), [verify.py · 69](../backend/app/services/citations/verify.py#L69), [verify.py · 192](../backend/app/services/citations/verify.py#L192).
- **What** The schema limits reference count but leaves each string unbounded. Candidate scoring repeatedly slides title windows over the full string with synchronous `SequenceMatcher` work. The upstream Crossref query uses a prefix, but local scoring still receives the whole reference.
- **Impact / failure scenario** A long pasted bibliography or unbroken paragraph can delay unrelated requests on the same async worker. The route's request-count limit and four-way coroutine semaphore do not bound this per-item work.
- **Evidence** Static resource-boundary review of the public endpoint, schema, scoring and fallback loops. No stress test was run against either deployment and no service-latency magnitude is claimed.
- **Fix** Validate per-reference and batch text limits before provider calls. Compute the title span and assessment once per candidate. Give the UI a specific oversized-input message. Test at the boundary and assert no upstream invocation when a request exceeds it.

### 11. [SEVERITY: medium] Staging's privacy notice describes the wrong database provider and location

- **Where** [Static.tsx · 82](../frontend/src/pages/Static.tsx#L82), [DEPLOYMENT.md · 110](../docs/DEPLOYMENT.md#L110), [AUDIT_BRIEF.md · 214](../docs/AUDIT_BRIEF.md#L214).
- **What** The same privacy page describes Google hosting the database and storage in the Netherlands. The handoff documents staging using Neon in Ohio. The text is visible to testers who are asked to accept the notice.
- **Impact / failure scenario** Staging testers receive inaccurate information about where their records are stored. This is a factual documentation and configuration discrepancy. I did not inspect cloud resources or make a legal determination.
- **Evidence** Compared the deployed-state description and regional latency note in the brief with the page rendered by the shared frontend. They expressly name different hosts and regions.
- **Fix** Have the maintainer confirm both inventories and publish accurate environment-specific wording or one notice that distinguishes them. Check the actual staging build and consent version. Include Tavily's planned role before enabling web search.

### 12. [SEVERITY: low] DOI normalization removes valid balanced closing parentheses

- **Where** [identifiers.py · 35](../backend/app/services/scholarly/identifiers.py#L35), [verify.py · 173](../backend/app/services/citations/verify.py#L173).
- **What** The shared normalizer unconditionally strips final closing punctuation, including a balanced suffix parenthesis.
- **Impact / failure scenario** A DOI containing a meaningful final parenthesis can be looked up under a different identifier during import or verification. This predates the change to permissive identifier prefixes.
- **Evidence** The current function transformed the synthetic identifier `10.1234/example(2020)` into `10.1234/example(2020`. This checks normalization without asserting a registration for the example.
- **Fix** Strip unmatched surrounding punctuation while retaining balanced identifier suffixes. Structure URL parsing separately from prose extraction. Add paired tests for parentheses belonging to the DOI and parentheses wrapping it.

### 13. [SEVERITY: low] A transient ESpell refusal can suppress future corrections after recovery

- **Where** [spelling.py · 60](../backend/app/services/scholarly/spelling.py#L60), [spelling.py · 107](../backend/app/services/scholarly/spelling.py#L107), [spelling.py · 140](../backend/app/services/scholarly/spelling.py#L140).
- **What** A non-200 response returns the same value as a successful no-suggestion result. The outer cache remembers it until eviction with no time-based expiry.
- **Impact / failure scenario** A search remains uncorrected on that instance after a temporary upstream failure. The brief specifically promises that failures are not cached.
- **Evidence** A scripted ESpell 503 followed by a healthy response produced two `None` results for the repeated query and only one network call. OpenAlex exceptions take a different path and remain uncached.
- **Fix** Represent temporary unavailability separately from a successful no-change response. Bound negative cache lifetime. Test recovery on the same query while preserving useful caching for a healthy no-suggestion response.

### 14. [SEVERITY: low] Whitespace can pass Deep Research validation and create an empty search

- **Where** [schemas.py · 406](../backend/app/schemas.py#L406), [deep_research.py · 42](../backend/app/api/routes/deep_research.py#L42), [deep_research.py · 81](../backend/app/services/deep_research.py#L81).
- **What** The API checks raw length before trimming. A sufficiently long whitespace-only string passes the schema, consumes the run allowance, and becomes an empty question. Cleaning can also remove all searchable text.
- **Impact / failure scenario** A direct API client can receive an empty saved run or consume an AI call on an unusable question. The normal browser button already checks trimmed length.
- **Evidence** The actual request schema accepted ten spaces, which the route reduced to an empty string. With AI off the fallback produced no queries, and the orchestration still constructs a run. The real endpoint returned 200 with an empty saved question and empty query list.
- **Fix** Validate normalized text before charging quota or contacting providers. Test whitespace, text removed by normalization, and a valid question exactly at the lower bound through the endpoint.

### 15. [SEVERITY: low] Account downloads omit part of a saved Deep Research report

- **Where** [accounts.py · 504](../backend/app/services/accounts.py#L504), [models.py · 476](../backend/app/db/models.py#L476), [DeepResearch.tsx · 235](../frontend/src/pages/DeepResearch.tsx#L235), [DataRights.tsx · 30](../frontend/src/components/DataRights.tsx#L30).
- **What** The export writes the report text, citations, sources, searches, options and status. It omits the saved service outcomes, model, insufficient-evidence flag and gaps text.
- **Impact / failure scenario** After downloading a report and closing the account, a researcher loses information about failed databases and the evidence limitations that accompanied the answer.
- **Evidence** Compared the persisted fields and report view against the ZIP writer's field list. The existing export test checks that the report is present. It does not compare all reader-visible fields. I extracted the account ZIP through the real HTTP route and verified that all four fields were present in the detail response and absent from its archived JSON.
- **Fix** Use one report serialization contract for the detail view and the archive, keeping any intentional export aliases stable. Compare the extracted JSON with a stored report containing a partial provider failure and a nonempty evidence warning.

## Verification of the browser-test fixes

Numbers follow section 3 of the brief. The staging browser record predates the final OpenAlex-key release. Its statement that both environments lacked the key is historical. The later release record supersedes it. [Browser run](BROWSER_TEST_RUN.md) · [Current brief](AUDIT_BRIEF.md)

| Brief # | Feature | Independent assessment |
| --- | --- | --- |
| 1 | Discover AI overview | The snapshot control follows AI status. The API still uses its AI user gate. Confirmed for the disabled state in the component and regression suite. |
| 2 | Europe PMC PDF | The PDF worker's candidate generator uses the new Europe PMC getPdf address. The URL regression passed. The signed-in 71-passage download is evidence from the earlier staging run. The live DOAJ/Europe PMC metadata test is a separate check. |
| 3 | Misspelled Discover search | The UI sends the exact flag, includes it in the query cache key and exposes the typed query. The HTTP handler skips correction entirely on exact searches. Automatic correction has the case-cache fault in F08. |
| 4 | Search inside a paper | The paper page displays matched_query from the passage endpoint. Full-text search retries once using vocabulary from the selected papers. Optional semantic retrieval still embeds the typed words. A vocabulary neighbor can be a different legitimate term. |
| 5 | Guidance italics | The editor registers the guidance paragraph attribute with keepOnSplit disabled. Sanitization preserves it and both export paths transform guidance before allocating citation labels. The existing tests cover the split and export. Previously saved italic text remains ordinary italic text. |
| 6 | AI controls on editor, paper and research pages | Editor reads AI status, Paper gates summary generation and the question area, and Research disables submission when AI is unavailable. Existing summaries and answers remain readable. No live AI key was used. |
| 7 | Journal HTML entities | Provider metadata goes through clean_text, which strips markup then decodes entities. The supported entity regression passed. React renders these strings as text. |
| 8 | Identifier forms | The import and formatting paths share the parser. Prefixed PMID, PMC, DOI and arXiv examples pass. Bare numbers retain the older ambiguity. F12 covers destructive DOI cleanup. |
| 9 | Reference checker | Crossref and OpenAlex fallback is wired into the actual HTTP route. The Vaswani fixture, wrong-year case and live LeCun check pass. F02–F04 cover bare DOI, numbering, misleading badges and partial outages. |
| 10 | Catalog search | The Catalog page submits q and displays matched_query when a corrected retry succeeds. The external check on a miss needs the F05 change. If an external suggestion yields no local results the current code also omits the vocabulary fallback. |
| 11 | Library filter | Word-order-independent API filtering and typo retries exist. The Research and citation pickers consume it. The main Library page currently filters by tag and collection. F09 describes the resulting UI and substitution gap. |
| 12 | Manuscript wording | The document dialog chooses a/an from the displayed document-type label. The original-research-manuscript branch now selects an. |
| 13 | Data-rights wording | Account and guidance copy now mention Deep Research. Its ZIP contains each saved report, but part of the reader-visible evidence context is absent. See F15. |

## Deep Research, data integrity and release review

| Boundary | Assessment |
| --- | --- |
| Access and account isolation | The status, start, history, detail and delete routes require a verified user. History is filtered by owner, detail checks ownership, and deletion includes the owner in its predicate. Status exposes capability flags and provider names. The API evaluates AI availability and account eligibility again when starting. The ordinary tests exercise authentication, ownership, rate limiting and data export. |
| Search and ranking | The planner bounds and de-duplicates queries. The service limits searches to two concurrently, uses the existing identifier-conflict and corroborated-title rules, and caps listed scholarly results at 40. A provider marked successful has answered at least one query. Per-query partial failures can disappear from the summary and counts are accumulated before deduplication. Describe them accordingly. |
| Registry and catalog trust | Only identified scholarly records with abstracts enter the public-paper upsert path in this feature. Up to 14 per AI run can be inserted or enriched. Registry IDs and existing constraints support reuse. Web excerpts stay with the user's run and cannot become catalog papers through this code path. Monitor growth in distinct public records per run before introducing pruning. |
| Grounding | Evidence IDs, verbatim spans and quantities are checked. An independent model support check is enabled by default. Displayed gaps use fixed wording. Web links are scheme-filtered, titled as web evidence, and labelled as non-peer-reviewed. These measures establish traceability. They cannot establish that source claims are true or guarantee resistance to instructions in retrieved text. Keyed model behavior remains unverified. |
| Transactions and cancellation | The session releases its connection before long provider calls. Paper upserts commit individually. The run commits near the end. Cancellation before that commit can leave legitimate catalog records without an associated run. A lost response after commit can leave a completed history entry. Check history before retrying. Add a local cancellation test after the first upsert and a lost-response test before considering idempotent submissions or a background job. |
| Persistence and retention | The migration adds the runs table with an owner FK, cascade and owner/creation-time index. The detail route, history, account export and account-closure schema all include the new data. History lists the latest 100. The archive discrepancy is F15. |
| Deployment isolation | The environment-specific release profiles still bind service account, Firebase project, database secret, bucket and task target. This delta extends optional tuning/secret names. The brief records production API revision `00033-toj`, staging `00020-nay` and separate application resources. Their OpenAlex quota is shared by design. These are maintainer deployment records, not an independent cloud inventory. |

### OpenAlex and Semantic Scholar

OpenAlex search, identifier lookup, the open-access PDF fallback, spelling counts and reference verification use the shared JSON client. The configured OpenAlex credential is attached as an Authorization header for the matching host. The active provider URLs use HTTPS. I checked the call sites and the local header-routing regression. Production key values and provider billing were outside this review.

| OpenAlex refusal during | Actual behavior |
| --- | --- |
| Discover | Provider failure appears in its status. Other providers can return results. A corrected second search currently replaces the typed search result set. |
| Spelling confirmation | An OpenAlex exception leaves the search as typed. The ESpell non-200 path has the separate cache defect in F13. |
| Reference verification | A secondary failure can discard a Crossref match, as demonstrated in F04. |
| PDF discovery | The worker tries other configured candidates. If upstream failure leaves resolution inconclusive, the existing processing retry path applies. |
| Deep Research | Ordinary scholarly search keeps the other databases' responses. The AI planner has its own failure path documented in F06. |

**Semantic Scholar decision. Omit it from default federated searches while its key is absent.** Apply that decision when building defaults so explicit provider requests and identifier resolution continue to work. Update the Discover empty-state text and Deep Research's capability list to match. Keep genuine unavailability visible when the provider is requested. Reconsider its default position after observing successful keyed requests, incremental unique results, latency and 429 frequency. The handoff's shared OpenAlex key creates a real quota dependency between staging and production. Separate keys or budgets would make sense if measurements show meaningful interference.

## Code quality and simplest fixes

Ranked by effect on correctness, evidence integrity and future change cost. Rankings are implementation priorities. Each of the 12 original IDs appears once.

| Rank | Brief hotspot | Assessment and smallest useful change |
| --- | --- | --- |
| 1 | Q6 · Reference assessment | Correctness and CPU cost. Parse a reference once, compute one assessment per candidate, and retain candidates from each available registry. Test F02–F04 and F10 first. |
| 2 | Q2 · Search policy in Catalog and Library routes | Both need a clear literal search and an identifiable suggestion. Keep authorization, collection and visibility predicates in their own database queries. Move candidate selection and retry decisions into small services. Release the DB connection before external I/O only when that I/O is necessary. |
| 3 | Q4 · Deep Research orchestration | Extract planning, evidence collection with its associated source, and persistence. Use the paired source directly when marking it read. Keep explicit transaction and cancellation boundaries. F06 and F07 give the refactor observable acceptance criteria. |
| 4 | Q7 · Per-process spelling cache | The synchronous OrderedDict operations do not themselves await on the current event loop. The concrete faults are case sharing and indefinite cached misses after upstream failures. Fix F08 and F13. Bound lifetime before considering a shared cache. |
| 5 | Q1 · Three spelling implementations | Extract one local vocabulary matcher with explicit tokenization, casing, tie-breaking and frequency inputs for passages and library/catalog. Preserve passage ranking through fixtures. Retain the remote registry evidence check as a separate policy. A 50× frequency ratio and a 0.8 character similarity measure different things. Neither proves intent. |
| 6 | Q3 · Discover concurrency | Exact mode branches before spelling. One caller charge covers the request, while a correction can produce two complete provider searches. gather waits for its slower operation even for a correct query. Keep successful typed results usable if the spelling service is slow or the corrected search returns fewer/no usable sources. Add call-count and partial-outage cases. |
| 7 | Q10 · Python typing | Annotate the nested query/provider return values and enable a pinned mypy check for small completed modules first. Match CI's Python and project plugins. Expand incrementally and avoid a large blanket ignore. A targeted mypy 2.4.1 run returned eight errors in three dependency modules, including two paper-only .id accesses through the widened evidence union. The current Deep Research path does not feed web pages to those two callers. |
| 8 | Q8 · Export tree identity | Both exporters transform the tree before mapping citations keyed by object identity. Preserve the current ordering in one preparation function returning the exact tree with its labels. Cover guidance plus citations inside a table for both formats. |
| 9 | Q9 · Large React components | Split by state ownership. Keep the form and its effective submitted options together, move report/history views into separate components, and keep the editor's document-scoped autosave lifetime intact. File length alone is insufficient reason for a rewrite. |
| 10 | Q12 · Ambiguous bare numbers | A year alone is parsed as a PMID. Preserve bare-PMID entry in the explicit identifier tool and require an explicit mode/prefix in mixed search fields when ambiguous. Centralize normalization and fix F12 first. |
| 11 | Q11 · Mixed test module | Split by public behavior as each fix lands: registry spelling, local retrieval, reference verification, and editor/export. Share registry fixtures. Keep cross-layer assertions that catch different UI/API interpretations. |
| 12 | Q5 · Paper and web evidence types | The two variants are currently manageable. The source and citation factories should each have exhaustive tests for paper IDs versus external links. Introduce a common protocol only when another concrete source type needs it. Narrow paper-only consumers explicitly, as the mypy findings in Q10 show. |

**Additional maintenance findings.** The npm clean install warned that the current Firebase packages require Node 24.12 or later and that the installed jsdom also specifies supported minor versions. Local Node was 24.11.1 and the frontend CI workflow selects 22. Align local and CI on a version supported by all pinned packages. The release flag validator allows provider credentials through the inline environment-variable option as well as secret references. Require the secret-reference form for credential names. The recorded OpenAlex release already used that form. Neither observation establishes a leaked credential.

## Feature parity and earlier fixes

The `legacy-v1` tag contains 29 Next.js page files. I compared the legacy page list with the current router and the previous detailed parity matrix. That matrix supplies the per-feature baseline. This round changes the following assessments. [Legacy-to-v2 inventory](PAPERAID_V2_REAUDIT.md#legacy-to-v2-feature-parity) · [Previous workspace audit](PAPERAID_V2_WORKSPACE_AUDIT.md)

| Area | Current status |
| --- | --- |
| Legacy deep agent | **Partial, previously missing.** Starting, reopening and deleting saved Deep Research runs are present. Continued multi-turn agent runs, legacy comparison matrices and the original agent URL have no equivalent in this flow. |
| Research history | **Partial.** Personal-paper conversations and saved Deep Research runs have separate histories. The legacy unified history and compatibility URLs remain gaps. |
| Core pages | **Present as routes.** Home, sign-in, dashboard, discovery, catalog, paper details, library, documents/editor, research, citation tools, account/privacy and admin remain reachable. Presence of a route does not imply every legacy control exists. |
| Discovery, catalog, library, citation tools, operator features | **Partial** against the earlier feature inventory. Today's changes improve search and paper formatting. They do not restore every legacy filter, editor workflow or admin action. |
| Author/category directory pages, admin CSL synchronization and legacy compatibility routes | **Missing** from the current route inventory. These are carried-forward parity items, outside the new defect count. |

The three follow-ups fixed at `90e4880` retain regression coverage: a PDF reclaim survives a deadlock retry, concurrent first requests for the same new identity succeed, and the mobile drawer restores focus and closes at the desktop breakpoint. The first two ran in the PostgreSQL suite. The drawer's focus and resize tests ran in the frontend suite. Their paths warrant continued coverage during unrelated refactors.

## Tests and evidence

| Check | Independent result |
| --- | --- |
| Backend application tests | **345 passed**, 7 live cases deselected, 394.47 seconds on local PostgreSQL. Migrations ran in the test environment. The Windows pgserver logger emitted a closed-stream message during interpreter teardown after pytest reported its result. |
| Live scholarly tests | **6 passed, 1 failed.** Federated discovery, three identifier cases, reference verification, and DOAJ/Europe PMC passed. OpenAlex returned HTTP 429 on the direct humanities subject-filter case. A separate run of just that case without an OpenAlex key also received 429. This is evidence about this reviewer's live calls. The production key and its usage were not tested. |
| Frontend | **156 passed in 19 test files**, both from the workspace and after a clean lockfile install in a temporary checkout. The brief says 17 files. TypeScript no-emit check and the Vite production build passed. The clean install emitted engine-version warnings documented above. |
| Font assets | The production build emits application fonts as files. I found no font data URL in its emitted CSS. The PDF viewer JavaScript contains PDF.js's runtime construction of a font data URL in its compatibility code. An assertion that the entire bundle contains no such string would be inaccurate. No broken rendering was demonstrated. |
| Lint, formatting and dependency advisories | Ruff passed and all 93 checked Python files met its format rules. pip-audit reported no known vulnerabilities in the checked environment. Frontend and citation-engine npm audits reported zero. Those results reflect their advisory coverage at review time. |
| Additional route checks | **5 independent checks** passed against the local HTTP API and PostgreSQL. They confirmed the current failure behavior for the bare DOI verdict, anonymous catalog miss, planner outage with empty history, blank saved run, and date/export inconsistencies. Test inputs and the database were local. |
| Focused service and UI checks | Controlled probes exercised numbered references, case-dependent cache hits, ESpell recovery, registry partial failure, local vocabulary and balanced DOI suffixes. A separate component test verified the web checkbox/request discrepancy. Real headless Chrome repeated it at 320 and 390 CSS pixels. The local form did not overflow at either width. These are fixtures around the real page, not full signed-in mobile journeys. |
| Python static typing | An isolated mypy 2.4.1 invocation targeting Deep Research and spelling returned eight diagnostics across three dependency files. They involve the AI adapter signature, the registry provider interface, and AI evidence/summary annotations. Mypy is outside the project's required CI gates. |
| Source and secret hygiene | Git object connectivity and the scoped diff whitespace check passed. A limited value-pattern scan of 248 tracked paths found no matching private-key material, service-account private keys or sampled provider/GitHub token formats. No `*.local.txt` credential files are tracked. This check does not detect all credential formats or establish the contents of remote secret stores. |
| CI | I checked the GitHub run for the exact audit head. Backend, frontend and the production-image smoke job all succeeded. I also checked the successful workflow conclusions for `f212c15`, `4440e81`, `94a467e`, `9537ec5` and `29ebdba`. The container result is from CI. [Head workflow and jobs](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/actions/runs/44891732705) |
| Deployment and real services | The prior signed-in staging session and release evidence are attributed to the maintainer. I did not use a hosted tester account, inspect or change cloud resources, or invoke real AI/Tavily. The live suite contacted scholarly providers only. The local mobile checks cover the Deep Research form. A full signed-in phone journey remains open. |

The implementation order, acceptance tests and feature-activation checks are in the [Claude handoff](../CODEX_HANDOFF_FOR_CLAUDE.md).
