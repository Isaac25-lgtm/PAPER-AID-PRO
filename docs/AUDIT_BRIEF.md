# Audit brief — hardening review of changes since `6db03b0`

**For:** Codex (independent reviewer). Read `AGENTS.md` first.
**Scope:** everything on `main` after `6db03b0` (your system re-audit snapshot) up to `eeff256`, 66 files changed.
**Ask:** is this code hardened? Verify that each fix in `docs/SYSTEM_REAUDIT_RESPONSE.md` closes its failure scenario
at the real entry points, and look for new defects the changes introduced. Report findings in the same format as
`docs/PAPERAID_V2_SYSTEM_REAUDIT.md`. Do not touch production (Cloud Run, Cloud SQL, Firebase `paperaid`).

## Commits in scope

| Commit | What |
|---|---|
| `9387181` | Floating per-section guide with a ghost-cursor walkthrough; new logo; header no longer wraps |
| `2ec2cf1` | Fixes for all 15 system re-audit findings; narrated walkthroughs; migration `f2a6c8e4b1d3`; policy version `2026-11-14.2` |
| `15b2d0b` | README for GitHub with live screenshots; handoff update |
| `eeff256` | Fonts never inlined as `data:` URLs (CSP `font-src 'self'`); consent screen appears when the policy changes mid-session; smaller guide panel |

Deployed: API `paperaid-api-00015-kaf` (schema `f2a6c8e4b1d3`, via `deploy/release.sh`), frontend on Firebase
Hosting. AI is **not configured** in production. CI is green: 249 backend tests, 93 frontend tests, plus the container
smoke test.

## What changed, by finding (where to look)

| # | Fix | Main code | Tests |
|---|---|---|---|
| H1 | Draft text from "Find a source" is searched in the library only. External search requires an explicit button that shows the exact words and their destination. Typed queries still search externally. | `frontend/src/components/editor/CitePalette.tsx` (`origin`, `externalAllowed`), `pages/Editor.tsx` (`onFindSource`) | `src/test/reaudit.test.tsx` (H1) |
| H2 | Quote and cite captures paper, words, start and end pages and insertion point at the click. The position is mapped through later transactions (`trackPosition`). Quote and citation are inserted in one transaction. Cross-page selections get a range locator. | `components/editor/PdfPanel.tsx`, `lib/editGate.ts` (`trackPosition`), `CitePalette.tsx` (`insertCitationAt` with `before`) | `reaudit.test.tsx` (H2: your exact scenario) |
| H3 | Identity deletion fails closed outside `ENV=production`: it uses the Auth emulator if `FIREBASE_AUTH_EMULATOR_HOST` is set, otherwise skips the step. | `backend/app/services/identity.py`, README, DEPLOYMENT.md | `tests/test_system_reaudit.py` (identity) |
| M4 | One rewrite path (selection menu and AI assist). Citations are sent as `[[C1]]`… placeholders, and a proposal applies only if every marker appears once and in order. An unchanged-passage check guards the replacement. Multi-paragraph selections are refused. The backend prompt was updated. | `frontend/src/lib/rewrite.ts`, `SelectionMenu.tsx`, `Editor.tsx` (`AIAssistModal`), `backend/app/services/ai/features.py` (`rewrite_text`) | `writing.test.tsx` (rewrite helpers, selection menu) |
| M5 | AI cohort: `AI_ACCESS=pilot` (default) with `AI_PILOT_EMAILS` (admins always allowed), via an `AIUser` dependency on every AI route. Separate `AI_AUTOCOMPLETE_ENABLED` (default off), per-user opt-in (off by default) and per-account `/ai/status`. The AI notice describes suggestions. | `app/security/auth.py` (`ai_allowed_for`, `get_ai_user`), `config.py`, routes `discovery/papers/tools/documents.py`, `system.py` (`ai_status`), `Static.tsx` | `test_system_reaudit.py` (M5), `test_system_auth.py` |
| M6 | A closure completes only when its files are deleted (`closed_accounts.pending_keys`), with back-off retries via `resume_closures`. The browser shows the 202 "finishing automatically" message. | `services/accounts.py` (`_finish_closure`, `_finish_files`, `resume_closures`), migration `f2a6c8e4b1d3`, `components/DataRights.tsx` | `test_system_reaudit.py` (M6), `test_release_audit.py` |
| M7 | Edit gate: panel citations, PDF quotes, palette, rewrites and AI assist run through `EditGate.run`. Export and restore `pause()` (drain in-flight, then lock) and `resume()`. The toolbar is disabled while frozen. | `lib/editGate.ts`, `Editor.tsx` (`frozen`, `EditGateContext`), `SourcesPanel`, `PdfPanel`, `CitePalette`, `SelectionMenu` | `reaudit.test.tsx` (M7) |
| M8 | Render generation counter. A render applies only if it is the newest and matches the current style and citation sequence; the reference list is published only with the labels. | `Editor.tsx` (`refreshCitations`), `lib/citationLabels.ts` (`applyRenderIfCurrent`) | `reaudit.test.tsx` (M8), `writing.test.tsx` (labels) |
| M9 | Check refuses passages over 2,000 characters instead of truncating. The response `scope` lists the sources examined, the total and how many were not checked; the source query filters to visible papers. `gather_evidence` has an overall budget (`limit + EVIDENCE_COVERAGE_EXTRA`). | `routes/documents.py` (`check_passage`), `ai/features.py`, `schemas.py` (`GroundedAnswerOut.scope`), `Editor.tsx` (`CheckPanel`) | `test_system_reaudit.py` (M9) |
| M10 | Quotes carry `claims` (statement indices). The UI numbers marker groups (`numberClaims`), merges overlapping spans and emphasises the clicked statement's words. Legacy code-point offsets are converted. | `ai/grounding.py` (`citation_payload`, `evidence_excerpt` owners), `components/GroundedAnswerView.tsx` | `test_system_reaudit.py` (M10), `reaudit.test.tsx` (M10) |
| M11 | Export snapshots file metadata, commits to release the connection, then reads storage. DOCX is built in a thread. A render failure goes into the manifest. Limits: 5 per hour per account, `EXPORT_SLOTS = Semaphore(2)` per instance. | `services/accounts.py` (`export_account`, `_build_export`), `routes/system.py` | `test_system_reaudit.py` (M11) |
| M12 | Stable Cloud Tasks name `job-<id>`, with 409 ALREADY_EXISTS treated as queued. `DispatchRejected` (connect errors, non-2xx) vs `DispatchUncertain` (other transport errors: the job stays queued for lease recovery). On rejection only an unclaimed queued job is failed, and the paper is restored only if no newer active job exists. | `services/tasks.py`, `services/processing.py` (`queue_ingest`) | `test_system_reaudit.py` (M12) |
| M13 | Light `slate-500` and both `slate-400` tokens raised; small text moved off `slate-400`. An automated WCAG test computes ratios from `theme.css`. | `frontend/src/theme.css`, many `className`s | `contrast.test.ts` |
| M14 | The landing demo is labelled, says what "Matched" means, has a keyboard Play/Pause and one pending timer. The trader claim cites Aker (2010, AEJ: Applied), verified matched by the live checker. Section walkthroughs also have pause. | `components/LiveDemo.tsx`, `SectionDemo.tsx` | `liveDemo.test.tsx`, `sectionDemo.test.tsx` |
| L15 | PDF pages render only near the viewport and are released when far. The download is aborted on paper switch (`api.blob` signal). A searchable picker shows list errors. | `PdfPanel.tsx`, `lib/api.ts` | `reaudit.test.tsx` (H2 harness) |

Not from the audit:
- **Guides:** `components/Guidance.tsx` (`SectionGuide` dock with `guide_<section>_collapsed`), `components/SectionDemo.tsx`,
  `lib/demos.ts` (scenes and one-line narration) and `lib/guides.ts` (structured steps).
- **Logo:** `LogoMark` in `Layout.tsx`, `public/favicon.svg`.
- **Fonts:** `vite.config.ts` `assetsInlineLimit` keeps fonts as files.
- **Mid-session consent:** `lib/api.ts` `setConsentRequiredHandler`, registered in `lib/auth.tsx` to reload the profile on any `CONSENT_REQUIRED`.

## Where I am least certain (please probe)

1. **Gate coverage.** Are there command paths that still change the document while frozen? Candidates:
   - keyboard shortcuts such as undo/redo or Tab-accepting a ghost suggestion while `setEditable(false)`;
   - paste;
   - the citation-label refresh (it uses `LABEL_META` transactions, which are meant to be allowed).
2. **`trackPosition` semantics.** It maps through `editor.on("transaction")`. Check transactions dispatched before
   the listener attaches, and whether `deleted` should also refuse when the surrounding paragraph is replaced.
3. **Rewrite markers.** Validation checks only marker count and order. Can a proposal still attach a citation to a
   different sentence while keeping the order, for example by merging two claims? Is refusing that the right rule?
4. **Export after a render failure.** I deliberately do not roll back (a rollback would expire the ORM objects still
   in use), so a database-level error inside `render_citations` could still abort the whole archive.
5. **Closure files.** `_finish_files` decides completion from the `storage_deletions` rows for `pending_keys`.
   Check the interaction with the live-object guard in `process_deletions`, and with concurrent maintenance runs.
6. **Dispatch classification.** `httpx.ConnectTimeout` is treated as "not sent". Confirm that holds for the
   Cloud Tasks client path, and that name reuse cannot block a legitimate re-queue of the same job id.
7. **AI cohort.** `/ai/status` uses `OptionalUser`. Confirm no AI route still uses `VerifiedUser` (grep), and that
   admins bypassing the pilot list is acceptable.
8. **Consent reload.** `setConsentRequiredHandler` is a module-level singleton. Look for loops (repeated 403 →
   reload) and the behaviour when the consent screen itself makes requests.
9. **Upload deduplication.** It uses `pg_advisory_xact_lock(hashtextextended(...))` across a commit boundary, with
   a re-check under the lock. Look for any window where two papers can still be created.
10. **Demos.** Every paper and number in `LiveDemo.tsx`, `lib/demos.ts` and the narration must be real and true to
    the product (AGENTS rule "never fabricate").

## How to verify

```bash
cd backend && .venv/Scripts/python -m pytest -q            # 249 (embedded Postgres; or TEST_PG_URL)
cd backend && .venv/Scripts/ruff check app tests alembic scripts
cd frontend && npx tsc -b --noEmit && npx vitest run       # 93
cd frontend && npx vite build && grep -c "url(data:font" dist/assets/*.css   # expect 0
```

Constraints that still apply: the beta stays invite-only, AI stays off in production, frontend and backend stay
separate (the browser only calls `/api/v1`), and nothing is changed in production resources.
