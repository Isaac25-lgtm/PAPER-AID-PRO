# PaperAid Pro handoff for Claude

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
