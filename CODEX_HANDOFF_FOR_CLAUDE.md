# PaperAid Pro handoff for Claude

## Current handoff · 21 November 2026

**Start with the [Deep Research audit](docs/PAPERAID_V2_DEEP_RESEARCH_AUDIT.md).** It covers eight commits after `90e4880` through `2d8b8b5`. There are 15 findings, including one high-severity mismatch between the web-search checkbox and the request sent to the backend. The reference checker also makes incorrect user-facing statements with AI off.

Work on a separate fix branch based on current main. Check for intervening commits. Make one finding per commit with its regression test, and record which entry point was checked. Keep frontend and backend separate. This handoff authorizes development work as directed by the maintainer. Production or staging releases, keys and cloud changes remain the maintainer's decision.

### Fix order and acceptance tests

Start F02–F05 on the currently reachable citation and catalog paths. F01, F06 and F07 block the corresponding optional providers. Address F08–F11 next and F12–F15 alongside their owning modules. The full audit contains file/line evidence and the proposed fix for every ID.

| Finding | Area or gate | Evidence required for closure |
| --- | --- | --- |
| F01 | Before Tavily | Submit the actual form with status pending, rejected, disabled, enabled and explicitly unchecked. Assert the transmitted option and the provider call count match the visible choice. Repeat at phone width. |
| F02 | Current checker | Submit a bare DOI, its URL and the same DOI with a conflicting title to /citations/verify. Check both the backend verdict and the rendered title/author/year field states. |
| F03 | Current checker | Submit the same fixture as entries 1, 10 and [12]. They must have equal field results. A wrong-year reference with no DOI must receive an accurate badge. |
| F04 | Current checker | Keep a Crossref candidate when OpenAlex returns 429. Preserve a successful first title segment if the next fails. Model a primary registry outage and an all-unavailable result. |
| F05 | Current catalog | Verify a signed-out local catalog miss can be answered within the intended lookup budget. Exhausted or unavailable external spelling must leave local search usable. Never expose private records from other accounts. |
| F06 | Before AI writing | Run through the real API with a failed planner and with a successful search followed by model transport failure. Reopen history and inspect sources, status and plan provenance. |
| F07 | Before Tavily | Apply a 2015–2025 range to scholarly and web results with 1999, 2015, 2025 and missing dates. Check the saved sources and evidence passed to the writer. |
| F08 | Current spelling | Run lowercase and uppercase mixed queries in both cache orders. Include an unchanged rare technical term. Correct terms and acronyms must remain under the researcher's control. |
| F09 | Current library and citation picker | Use a collection containing Metal exposure and search for fetal exposure. Test visible indication, literal search, paging and citation selection together. Decide whether the main Library should expose its own title box. |
| F10 | Current checker | Enforce a per-item and aggregate text bound before external calls, and score each candidate once. Cover ordinary pasted references near the accepted boundary. |
| F11 | Before collecting more staging tester data | Confirm the environments' actual providers and regions with the maintainer. Update the notice and appropriate consent version and verify the correct page in the staging build. |
| F12 | Identifier cleanup | Preserve a balanced DOI suffix inside prose and URL inputs. Still remove unmatched surrounding punctuation. Verify import and citation formatting use the same value. |
| F13 | Current spelling | Return an upstream ESpell refusal once and a valid suggestion next. Check the second request recovers and healthy no-change responses still follow the intended cache policy. |
| F14 | API validation | Reject whitespace and other unusable normalized input before quota, provider calls or history writes. Keep valid shortest inputs working. |
| F15 | Data portability | Extract the ZIP for a run with incomplete registry coverage and a model evidence warning. Compare all user-visible run fields with the detail endpoint, including model, service outcomes, gaps and insufficiency. |

### Quality and provider decisions

- Use Q6 and Q2 from the report to simplify reference assessment and local search while implementing the corresponding regressions. Split Deep Research orchestration at its existing planner, evidence and save boundaries. Keep the rest of the ranked Q1–Q12 work independent of urgent fixes.
- Omit unkeyed Semantic Scholar from default federated searches. Preserve explicit selection and identifier lookup. Keep provider failures visible for explicitly requested searches and measure incremental coverage before restoring the default.
- Align the frontend Node version across clean installs and CI. Introduce a reproducible Python typing baseline. Require secret references for provider credentials in release flags. The evidence supports these as maintenance work.
- Before enabling Tavily, review the privacy notice, policy version, enabled-state behavior and date-filter results. Before enabling AI writing, review a keyed staging run covering provider failure, unsupported claims, quote alignment and saved history.

### Validation baseline

Local backend **345 passed**. Clean frontend **156 passed**, type-check and build passed. The independent live suite was **6/7** with an OpenAlex 429 on the humanities case, repeated in isolation. Exact-head CI's backend, frontend and container jobs succeeded. The full report distinguishes local results from staging history, describes the test-double boundaries and lists the additional phone-width and HTTP checks.

Run section 9 of the active brief, both dependency audits, the citation-engine checks and the relevant new regression for each fix. Use controlled registry failures for deterministic CI. Record a separately authorized live-provider run and signed-in phone journey before feature activation. No credential material belongs in fixtures, reports or logs. [Audit brief](docs/AUDIT_BRIEF.md) · [Prior staging browser run](docs/BROWSER_TEST_RUN.md)

---

## Archived handoff · workspace audit at ef7f8d9

The material below records the earlier review. Use the current handoff above for today's work.

Audit snapshot `ef7f8d92d4115f31597476f545d5c7e1a9eb46a1` on `main`, compared with `e37856a`. Read `AGENTS.md` and the full [workspace audit](docs/PAPERAID_V2_WORKSPACE_AUDIT.md) before changing code. Recheck any commits that landed after the snapshot. The audit found eight issues, including two release blockers.

## Fix first

1. **Keep writes bound to the correct document.** In the real React app, a pending guided-create request navigated to the newly created draft after its dialog was dismissed. The already-mounted editor kept the earlier draft's state. A local probe saw A's edited title sent to B with B's URL and A's version. Key the editor state by document ID, bind queued saves to that ID, and make a late create completion safe after dismissal or navigation. Cover equal versions, unsaved title and body, an in-flight save, and correct loading and saving after switching drafts. This blocks the workspace frontend release. See audit finding 1.
2. **Validate the exact API candidate before promotion.** The release checks the live service and migration job, then accepts unrestricted extra deploy settings. The fake-cloud probe promoted a candidate after changing its task target because readiness checked only the schema and revision. Pin the allowed settings, inspect the exact candidate, and verify image, identity, database secret reference, bucket, Firebase and the complete task routing and OIDC configuration. Test rejection before traffic moves. Keep inline database values out of diagnostics. This blocks the next scripted API promotion. See findings 2 and 4.
3. **Fix the worker-start lock order.** PostgreSQL reproduced a deadlock when account closure's paper cascade waited on a job row while the worker waited to update the paper. The attachment fence works in the original two tested orderings. Cover startup, failure and reclaim paths that mutate both rows. Synchronize the regression on actual locks, and assert that closure completes. See finding 3.

## Follow-through

| Finding | Acceptance check |
| --- | --- |
| 5. Re-consent recovery | A failed `/me` reload surfaces a retry while preserving the editor. A successful refresh or consent acceptance flushes the parked queue once for the same account. |
| 6. DOI provider failures | An outage stays retryable after alternatives are exhausted. An actual missing location stays terminal. A usable alternative still succeeds. |
| 7. Mobile drawer | Opening moves focus into the drawer. Tab stays inside, Escape closes, and focus returns to the opener. Desktop and mobile heading references resolve uniquely. |
| 8. Recent drafts and progress | Creation, editing, renaming and deletion update the list, Continue writing and relevant counts with warm query caches. |

## Verification and release context

- At this SHA, local PostgreSQL had **285 passed**, the opt-in public scholarly checks had **7 passed**, and frontend had **135 passed** with successful type-check and build. The dependency checks found no known vulnerabilities in the audited manifests. Seven focused local probes reproduced findings 1–7. The audit removes those temporary probes from the worktree. Add permanent regressions alongside each fix.
- The GitHub frontend and container jobs succeeded. The backend job was still running pytest after more than an hour, and its log was unavailable during review. Get a completed Linux backend run on the target SHA before treating CI as green. Keep PostgreSQL race tests bounded and inspect the job log for the stalled stage when available. [GitHub run](https://github.com/Isaac25-lgtm/PAPER-AID-PRO/actions/runs/43638744427)
- Staging reported `paperaid-api-staging-00002-laj` ready at `f2a6c8e4b1d3`. The observed staging service, migration job, secret reference, bucket, queue, IAM grants, Firebase and frontend CSP matched the staging profile. The browser redirected to sign-in. Complete the authenticated smoke with the user's signed-in staging session. Use disposable data for any authorized writes. Keep inherited IAM and database separation behind the secret reference marked unverified until checked.
- Keep the API and frontend releases separate. Keep production invite-only and AI disabled. Use local PostgreSQL and fake-cloud tooling for tests. Treat any deployment, staging write or infrastructure change as a separate task requiring the corresponding user authorization.
