# Audit brief: changes since the hardening audit (`2248a45`)

**For:** Codex (independent reviewer). Read `AGENTS.md` first.
**Scope:** everything on `main` after `2248a45` (your hardening audit snapshot) up to `5d2c565`. That is 5 commits,
31 files.
**Ask:** is it hardened now?
1. Verify that each fix in `docs/HARDENING_AUDIT_RESPONSE.md` closes its failure scenario at the real entry
   points, not only in the tests.
2. Review the new staging environment for isolation from production.
3. Check the three bugs found in the signed-in staging run and their fixes.
4. Look for new defects.

Report in the format of `docs/PAPERAID_V2_HARDENING_AUDIT.md`, as `docs/PAPERAID_V2_STAGING_AUDIT.md`.

## Commits in scope

| Commit | What |
|---|---|
| `050521b` | Fixes for all 13 hardening findings (3 high) |
| `35ab46e` | Handoff: production API revision `paperaid-api-00018-dul` |
| `dbdab04` | Scheduled maintenance is live: Cloud Scheduler `paperaid-maintenance` (europe-west1, every 15 min, OIDC as `paperaid-tasks`) |
| `918c174` | Isolated staging environment (free tiers) and `deploy/deploy-staging-frontend.sh` |
| `5d2c565` | Three frontend bugs found in the signed-in staging run, with tests; `docs/STAGING_TEST_RUN.md` |

**Deployed:**
- Production API: `paperaid-api-00018-dul`, schema `f2a6c8e4b1d3`, released through `deploy/release.sh`. AI is
  **not configured** in production.
- Production frontend: has **not** been redeployed since `5d2c565`, so it still lacks those three fixes.
- Staging frontend: runs `5d2c565`.

**Tests:** 255 backend, 108 frontend, all passing.

## 1. Hardening fixes (`050521b`)

The fix-by-fix table, with file and test pointers, is in `docs/HARDENING_AUDIT_RESPONSE.md`. The main code:
- Draft privacy: `CitePalette.tsx`, using `submitted` (an exact value, never the live debounce).
- Re-consent overlay: `Layout.tsx` (`RequireAuth`: `workMounted`, `useInert`) and `auth.tsx` (`profileError`).
- Closure fence:
  - `routes/papers.py` `upload_paper` takes `FOR SHARE` on the user row and re-checks `is_active`.
  - `services/accounts.py` `_finish_closure` takes `FOR UPDATE` before collecting paths.
- Exclusive gate: `lib/editGate.ts` (`acquire`, `drain`, `isHeld`).
- Anchor bookmarks: `trackPosition` / `ANCHOR_LOST` in the palette, sources panel and PDF panel.
- Per-claim rewrite: `lib/rewrite.ts`. Citations are never sent to the model, and changes are detected with a
  signature that includes citation identities.
- Export render session: `services/accounts.py` `_build_export`.
- Dispatch classification: `services/tasks.py` (`AMBIGUOUS_STATUSES`, `_error_status`).
- Check scope: `routes/documents.py` `check_passage` (`in_evidence`) and `ai/features.py`
  (`evidence_paper_ids`).
- Citation upsert: `services/documents.py` `add_source(commit=False)`, `ON CONFLICT DO NOTHING`.
- Library filter: `routes/library.py` `has_pdf`.

## 2. Staging environment (`918c174`): please review the isolation

| Part | Staging | Production |
|---|---|---|
| Website | Firebase Hosting `paperaid-staging` → https://paperaid-staging.web.app | `paperaid` → paperaid.web.app |
| Sign-in | Firebase Auth in project `paperaid-staging` (separate users) | Firebase Auth in `paperaid` |
| API | Cloud Run `paperaid-api-staging` (europe-west4), same image digest as production, `ENV=production`, `FIREBASE_PROJECT_ID=paperaid-staging` | `paperaid-api` |
| Database | Neon free tier (Postgres 16 + pgvector, us-east-2). Secret `paperaid-staging-database-url` | Cloud SQL `paperaid-db` |
| Files / queue | bucket `paperaid-staging-files-307658066472`, queue `paper-processing-staging` | own bucket and queue |
| Identity | service account `paperaid-staging-api` | `paperaid-api` runtime account |

The staging service account has only these grants:
- `logging.logWriter` (project);
- `secretAccessor` on its own secret;
- `objectAdmin` on its own bucket;
- `enqueuer` on its own queue;
- `actAs` itself (for OIDC tasks);
- `firebaseauth.admin` in `paperaid-staging`.

Isolation I verified:
- There are no staging bindings on the production secret, bucket or queue.
- A staging ID token gets 401 from the production API and 200 from staging.

The staging frontend is built with `--mode staging` (`frontend/.env.staging`, public identifiers only). Its CSP is a
generated copy of `firebase.json`, with the API and auth domains swapped. Neither the generated file nor the build
output is committed.

Please probe:
- **Cross-environment paths:**
  - Could a staging token, task or object ever reach production, or the reverse?
  - The OIDC audience and target URL used by staging tasks (`TASKS_TARGET_URL`, `TASKS_SERVICE_ACCOUNT`).
  - The CORS origins on each service.
- **Staging runs `ENV=production`:** it follows the production code paths deliberately. Any production-only
  behaviour that would be wrong against Neon? For example pool sizes, the `statement_timeout` / pgvector settings,
  or region latency from europe-west4 to us-east-2.
- **Generated staging CSP:** the replacement in `deploy/deploy-staging-frontend.sh` is a plain string replace.
  Confirm it covers every production origin in `firebase.json`, and that nothing in it points back at production.

## 3. Signed-in staging run (`5d2c565`)

Results for every scenario are in `docs/STAGING_TEST_RUN.md`. All passed. It found three bugs, now fixed:

| Bug | Fix | Tests |
|---|---|---|
| "Find a source" left the keyboard in the draft with the passage still selected, so typing replaced the writer's text. The palette focused its input while `visibility: hidden`: real browsers refuse that, jsdom does not. | Focus once the palette is placed and visible (`CitePalette.tsx`, `focused` ref plus an effect on `style`) | `reaudit.test.tsx`: records the palette's visibility at the moment of focus (fails on the old code) |
| A reloaded public page showed signed-out data, e.g. "Save to library" for a saved paper. The first request went out before Firebase had restored the session. | The token getter awaits `auth.authStateReady()` (`lib/auth.tsx`); `AddToLibraryButton` follows `paper.in_library` | `auth.test.tsx` (restored-session token); `components.test.tsx` (button follows the prop) |
| A quote or citation was inserted with no space after the preceding text | `insertCitationAt` adds a leading space after a word or punctuation | `reaudit.test.tsx` (spacing table) |

## 4. Where I am least certain (please probe)

1. **`authStateReady()` in every request.** Every API call now waits for it.
   - Check sign-out, account switching in another tab, account deletion (the Firebase user disappears) and the
     sign-up and verification flow.
   - Can any request wait forever or carry the wrong account's token?
   - In tests, `auth.authStateReady?.()` is optional-chained for mocks.
2. **Closure race, which code path actually refused the upload.** On staging the racing upload got **401** (the
   auth dependency, because the account was already gone). It never reached the `FOR SHARE` fence (403). The fence
   is covered only by the deterministic PostgreSQL test in `test_hardening_audit.py`. Is there any ordering where
   the request passes authentication, then the closure commits, and the object survives?
3. **First Cloud Tasks delivery gets 503.** On staging a new job's first delivery returned 503, the retry ran it
   2–5 s later, and the final call returned 204.
   - Is the task enqueued before the job row is committed?
   - If that commit then fails, does the task retry against a missing job until its attempts run out?
   - See `processing.queue_ingest` and `routes/internal` `run-job`.
4. **Retries behind the consent overlay.** While the overlay is open, the editor retries its failed save about
   every 10 s. Each retry is a 403 plus a profile reload (`Editor.tsx` `retryTimer`, `auth.tsx`
   `consentReload`). It is bounded, but should retries pause until consent is given?
5. **Spacing rule edge cases.** `insertCitationAt` reads one character before the insertion point.
   - After another citation node, `textBetween` yields `""`, so no space is added. Is that right for back-to-back
     citations?
   - Inside marks or links?
6. **Palette focus.** The focus effect runs on `style` changes, with a ref so it fires once. Check the narrow
   (mobile) layout and a palette re-opened for a new request.
7. **Per-claim rewrite** (`lib/rewrite.ts`). It is untested live because AI is off.
   - The `lead` regex absorbs `[\s.,;:!?)\]]*` after a citation.
   - Can a claim's text start with something it wrongly swallows?
   - Is `MAX_REWRITE_SEGMENTS = 6` enforced on the server too, or only in the client?
8. **Native `confirm()`.** Restore, delete-upload, delete-collection and delete-document use `window.confirm`.
   That isn't a security issue, but browser automation cannot click it. Is an in-app dialog worth it?
9. **No `CONTACT_EMAIL` on staging.** Without it Unpaywall is skipped, so staging finds fewer open-access PDFs than
   production. Europe PMC's renderer refused from Cloud Run (403). Is the candidate order in `open_access.py`
   right, and should a 403 from one host be treated as transient?
10. **Secrets.**
    - Confirm that the repository and its history contain no credentials. Only public Firebase web identifiers are
      in `frontend/.env.*`.
    - The staging test-account passwords live in a git-ignored local file (`deploy/staging-testers.local.txt`).
    - The Neon URL is only in Secret Manager.

## How to verify

```bash
cd backend && .venv/Scripts/python -m pytest -q            # 255 (embedded Postgres; or TEST_PG_URL)
cd backend && .venv/Scripts/ruff check app tests alembic scripts
cd frontend && npx tsc -b --noEmit && npx vitest run       # 108
git log -p --all | grep -nE 'npg_|sk-ant-|BEGIN .*PRIVATE KEY|ghp_|github_pat_'   # expect nothing
```

## Constraints

- **Production:** do not touch it (Cloud Run `paperaid-api`, Cloud SQL, Firebase `paperaid`).
- **Staging:** you may read it. Ask the maintainer for test-account credentials; they are not in the repo. Do not
  change staging infrastructure or IAM.
- **Product rules:**
  - the beta stays invite-only;
  - AI stays off in production;
  - frontend and backend stay separate (the browser only calls `/api/v1`);
  - no secrets go in the repo.
