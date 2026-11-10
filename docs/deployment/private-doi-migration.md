# Deployment Runbook & Visibility Migration Proposal: Private Paper DOI Isolation

> **Document Version**: 1.0.0  
> **Target Branch**: `fix/private-paper-isolation`  
> **Status**: Completed Locally & Dry-Run Verified (Local DB Only)  
> **Remote DB Guard**: Strictly Enforced (Remote Supabase Execution Forbidden)

---

## 1. Executive Summary & Purpose

In multi-tenant academic intelligence environments, private user manuscripts (user uploads, workspace documents, attachments, and copy-on-write clones) must never occupy globally unique database identifier columns (`doi`, `arxivId`, `pmid`, `pmcid`, `semanticScholarId`).

### The Root Problem
When a private document holds an external DOI in `Paper.doi`, three critical vulnerabilities arise:
1. **Public Discovery Collisions**: Another researcher importing that same published DOI could collide with or mutate the private user's record.
2. **Metadata Leakage**: Search queries or library matchers checking `doi` could leak the presence, title, or internal `paperId` of a private paper to other users.
3. **Multi-User Import Conflicts**: Two users uploading or analyzing the same published paper privately would violate unique index constraints on `Paper(doi)`.

### The Invariant & Solution
1. **Unique Column Isolation**: Private user papers (`classifyPaper(paper) === 'PRIVATE_USER_DOCUMENT'`) **always** set `doi: null`, `arxivId: null`, `pmid: null`, `pmcid: null`, and `semanticScholarId: null`.
2. **Canonical Provenance Storage**: The original identifier is stored strictly inside the JSON metadata column `sourceProvenance`:
   ```json
   {
     "canonicalDoi": "10.1002/uog.70315",
     "canonicalArxivId": null,
     "canonicalPmid": "20131365",
     "ownerUserId": "usr_scholar_a"
   }
   ```
3. **Transparent Citation & Export Fallback**: Citation generation, CSL rendering (APA, IEEE, BibTeX), DOCX/PDF export, and reader views check `paper.doi ?? paper.sourceProvenance?.canonicalDoi`, ensuring the document owner retains full citation fidelity while preventing database collisions.
4. **Zero-Mutation Import Idempotency**: User A importing a DOI matching User B's private paper always creates or retrieves a distinct public paper. User B's private paper record remains 100% byte-for-byte unchanged.

---

## 2. Code Paths Enforcing the Invariant

The following creation, ingestion, and export paths enforce the `canonicalDoi` invariant:

| Code Path | File | Invariant Implementation |
| :--- | :--- | :--- |
| **User PDF Upload** | `src/app/library/actions.ts` (`uploadUserPaperAction`) | Sets `doi: null`, writes normalized DOI to `sourceProvenance.canonicalDoi`. |
| **Workspace Attachment / CoW Clone** | `src/lib/editor/document-service.ts` (`attachPaperToDocument`) | Cloned private user copies strip `doi` and persist `canonicalDoi`. |
| **CSL Metadata Mapper** | `src/lib/citations/csl/metadata-mapper.ts` (`toCslItem`) | Resolves `DOI: paper.doi ?? paper.sourceProvenance?.canonicalDoi`. |
| **BibTeX / RIS Exporters** | `src/app/tools/citation-generator/page.tsx`, `src/lib/citations/export.ts` | Formats DOI using `canonicalDoi` fallback. |
| **DOCX & PDF Export Engines** | `src/lib/editor/docx-generator.ts`, `src/lib/editor/pdf-generator.ts` | Renders footnotes and bibliographies using `canonicalDoi`. |
| **Discovery Library Matcher** | `src/lib/discovery/library-matcher.ts` | Filters library checks by `ownerUserId === currentUserId` so User B's private paper is never returned to User A. |
| **Import Idempotency** | `src/lib/papers/import-actions.ts` | Searches strictly `doi: queryDoi, ...paperVisibilityFilter(null)` (public papers only). Private papers are completely ignored. |

---

## 3. Local Migration Script (`scripts/migrate-private-paper-dois.ts`)

A dedicated, guarded migration script has been implemented to inspect and migrate existing private papers.

### 3.1 Safety Guardrails
- **Host Allowlist**: The script verifies that `DATABASE_URL` and `DIRECT_URL` hostname is strictly loopback (`localhost`, `127.0.0.1`, `::1`). Any connection attempt to a non-local or remote Supabase host throws an immediate, fatal error.
- **Dry-Run by Default**: When executed without `--execute`, the script operates in read-only analysis mode.
- **Isolated DB Protection**: Even with `--execute`, the script requires `--allow-local-dev-db` to touch local development databases, defaulting to `ai_research_hub_test`.

### 3.2 Running the Dry-Run Locally
```bash
# Execute local dry-run against local PostgreSQL (safe, read-only)
node scripts/run-isolated-db.cjs scripts/migrate-private-paper-dois.ts
```

---

## 4. Visibility Migration Proposal (Proposal Only — Do Not Execute Against Supabase)

### 4.1 Schema Definition
The proposed schema introduces an explicit PostgreSQL enum `PaperVisibility` matching Prisma:
```prisma
enum PaperVisibility {
  PUBLIC
  PRIVATE
  ADMIN_FIXTURE
}

model Paper {
  // ...
  visibility PaperVisibility @default(PUBLIC)
  // ...
  @@index([visibility, createdAt])
}
```

Corresponding PostgreSQL DDL:
```sql
CREATE TYPE "PaperVisibility" AS ENUM ('PUBLIC', 'PRIVATE', 'ADMIN_FIXTURE');
ALTER TABLE "papers" ADD COLUMN "visibility" "PaperVisibility" NOT NULL DEFAULT 'PUBLIC';
CREATE INDEX "papers_visibility_idx" ON "papers"("visibility");
```

### 4.2 Exact Classification Rules & Constant References
The migration must strictly use the canonical `ADMIN_TEST_FIXTURE_IDS` constant from `src/lib/auth/paper-authorization.ts`:
```ts
export const ADMIN_TEST_FIXTURE_IDS = new Set([
  "cmumgtiix0000vr445cn8ry7o", // Kim et al. (BUSI)
  "cmvm3h7390001vrso6r0h3x0g", // Li et al. (Breast Ultrasound)
  "cmvm3h745000bvrsoqylr30s8", // Morales et al. (Endometrial Hyperplasia)
  "cmvm3h749000kvrso7n2t5yfa", // Mengo et al. (Adenomyosis)
  "cmunotrr10000vrusnqyv61ut", // Su et al. (TB Radiomics)
  "cmvb1cabk0001vrgo46umk5zp", // Canonical Morales Admin Benchmark Fixture
]);
```

### 4.3 Ownership Key Mapping: Owner vs. Importer
`sourceProvenance` JSON stores different actor keys depending on the pipeline action. The migration must distinguish between **owners** and **importers**:

| Key | Meaning | Grants Ownership? | Visibility Classification |
| :--- | :--- | :--- | :--- |
| `ownerId` / `ownerUserId` | The user who owns this private document / upload | **YES** | `PRIVATE` |
| `uploadedByUserId` | The user who uploaded this private PDF | **YES** | `PRIVATE` |
| `attachedByUserId` | The user who created a private document clone | **YES** | `PRIVATE` |
| `userId` (in private context) | Workspace document association | **YES** | `PRIVATE` |
| `importedByUserId` | The user who imported a published paper to public catalog | **NO** | `PUBLIC` |
| `curatedBy` / `adminId` | Administrative catalog management | **NO** | `PUBLIC` (or `ADMIN_FIXTURE` if in fixture list) |

**Rule**: An importer (`importedByUserId`) is **not** an owner. Papers imported from Crossref, PubMed, or ArXiv remain `PUBLIC`. Only papers created via user upload, CoW attachment, or containing explicit private ownership keys become `PRIVATE`.

### 4.4 Dry-Run Parity Step
Prior to committing any schema changes, run the dry-run parity query implemented in `scripts/migrate-private-paper-dois.ts`. It compares the proposed SQL classification for every row against `paperVisibilityFilter(userId)`:
```
Total papers evaluated:                             N
Papers classified as PUBLIC:                        N_pub
Papers classified as PRIVATE:                       N_priv
Papers classified as ADMIN_FIXTURE:                 N_fix
Parity check with paperVisibilityFilter(null):      100.0% MATCH (0 discrepancies)
Parity check with paperVisibilityFilter(userA):     100.0% MATCH (0 discrepancies)
```

---

## 5. Security & Privacy Policy Corrections

All marketing claims regarding "Zero Data Retention" and "cryptographic" isolation have been eliminated from the application and documentation.

The verified privacy and data handling guarantees are:
1. **OpenAI Responses API (`store: false`)**: Calls to OpenAI API explicitly set `store: false` to prevent retention on OpenAI's persistent evaluation logs.
2. **Zero Model Training by Default**: OpenAI does not use API data to train models by default under enterprise terms.
3. **Abuse Monitoring Retention**: In compliance with OpenAI's standard enterprise terms, inputs/outputs may be retained temporarily (up to 30 days) by OpenAI solely for security and abuse monitoring before automated purge.
4. **Application Isolation**: Multi-tenant document isolation is enforced via strict server-side access controls, PostgreSQL query predicates (`paperVisibilityFilter`, `authorizePaperAccess`), and isolated Supabase storage bucket security policies.

---

## 6. Pre-Merge Verification Checklist

- [x] All unique columns (`doi`, `arxivId`, `pmid`, `pmcid`, `semanticScholarId`) are set to `null` on private paper records.
- [x] Canonical DOI is safely preserved in `sourceProvenance.canonicalDoi`.
- [x] CSL citation formatting, BibTeX export, RIS export, and DOCX/PDF generators correctly read `canonicalDoi`.
- [x] Discovery library matcher filters by current user, preventing private paper discovery leaks.
- [x] DOI importers verify public catalog only and never overwrite or mutate private user records.
- [x] Isolated test runner executes unit, regression, and acceptance tests in isolated local database (`ai_research_hub_test`).
- [x] Live external API suites are triaged to `npm run test:integration`.
- [x] Table proposal suites are isolated in `tests/table-proposal/` and tested via `npm run test:proposal`.
- [x] Type checking passes cleanly (`npm run type-check`) with zero errors.
- [x] Remote database connections are strictly guarded against non-local execution.

