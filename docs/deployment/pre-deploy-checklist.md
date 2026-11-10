# AI RESEARCH HUB — PRODUCTION PRE-DEPLOY CHECKLIST

> **Status**: Mandatory pre-flight checklist for merging and deploying `fix/private-paper-isolation` to production.

---

## 1. Migration Inventory (10 Canonical Migrations)

All migrations in `prisma/migrations` must be tracked and applied sequentially:

| # | Migration Directory | Description | Status in Production |
|---|---|---|---|
| 1 | `0_init` | Baseline relational schema (11 models, 5 enums) | Applied (Baselined) |
| 2 | `20260925_add_ai_summary_citations` | Added `citations Json?` to `AISummary` | Applied |
| 3 | `20260926_add_paper_chunk_embeddings` | Added `pgvector` vector extension and 1536-dimensional chunk embeddings (`embedding Unsupported("vector(1536)")`) | Applied |
| 4 | `20260928_add_embedding_hash_and_dimensions` | Added `embeddingDimensions`, `embeddingInputHash`, `embeddedAt` to `PaperChunk` | Applied |
| 5 | `20260929_add_conversation_paper_id` | Added `paperId` foreign key and relation on `AIConversation` | Applied |
| 6 | `20260930_add_scholarly_discovery_identifiers_and_metadata_only` | Added external scholarly identifiers (`arxivId`, `pmid`, `pmcid`, `semanticScholarId`, `isOpenAccess`, `sourceProvenance`) and `METADATA_ONLY` status | Applied |
| 7 | `20261013_add_relational_collections` | Added `Collection` and `CollectionPaper` relational models | Applied |
| 8 | `20261013_add_research_documents` | Added `ResearchDocument`, `DocumentCitation`, `DocumentNote` editor models | Applied |
| 9 | `20261020_add_csl_catalog_persistence` | Added `CslStyle` catalog and `CslSyncLock` concurrency locks | Applied |
| 10 | `20261104_add_document_revisions` | Added `document_revisions` table for historical versioning | **Pending Deploy** |

---

## 2. Read-Only Production Migration Status Check

Before executing any migrations or deployments, run the non-mutating status check against production.

Because `scripts/safe-migrate.cjs` strictly enforces loopback safety and rejects all remote/cloud database hosts by default, production migration status must be inspected via the dedicated opt-in script:

```bash
npm run db:status:prod
```

### Safety Guards Enforced by `db:status:prod`:
1. **Strictly READ-ONLY**: Executes only `prisma migrate status`. It cannot modify schemas, apply migrations, or write data.
2. **Explicit Opt-in Confirmation**: Interactively prompts for the exact Supabase project reference (e.g. `enbunglssqrjugyffysh`) and refuses execution if the input does not match.
3. **Session Connection via `DIRECT_URL`**: Connects via port 5432 session connection (since transaction poolers on port 6543 do not support advisory session locks).
4. **Credential Redaction**: Never logs passwords, secrets, or raw connection strings to the console.

To check local loopback database migration status instead, run:
```bash
npm run db:status
```

---

## 3. Step-by-Step Pre-Deployment Sequence

### Step 1: Pre-Migration Database Backup
- [ ] Create a full snapshot/backup via Supabase Dashboard -> Settings -> Database -> Backups, or execute:
  ```bash
  pg_dump --format=custom --no-owner --no-privileges "$DIRECT_URL" > "backups/prod-backup-$(date +%Y%m%d%H%M%S).dump"
  ```
- [ ] Verify dump file size is non-zero and readable.

### Step 2: Verify Migration Status
- [ ] Run `npm run db:status`.
- [ ] Confirm migration `20261104_add_document_revisions` is listed as pending and all previous 9 migrations are marked applied.

### Step 3: Deploy Pending Schema Migration
- [ ] Run `npm run db:deploy`.
- [ ] Verify `document_revisions` table is created successfully.
- [ ] Re-run `npm run db:status` and verify: `Database schema is up to date!`.

### Step 4: Private Paper DOI Migration (Path 3b Isolation)
- [ ] Review `docs/deployment/private-doi-migration.md`.
- [ ] Run the migration script in dry-run mode:
  ```bash
  npm run db:run scripts/migrate-private-paper-dois.ts --dry-run
  ```
- [ ] Verify candidate count matches known private papers.
- [ ] Execute the live migration:
  ```bash
  npm run db:run scripts/migrate-private-paper-dois.ts --execute
  ```
- [ ] Verify output: `Moved DOI to canonicalDoi and cleared unique DOI column on all private papers`.

### Step 5: Vercel Engine & Build Configuration
- [ ] In Vercel Project Settings -> **Build & Development Settings**:
  - **Node.js Version**: Select **`22.x`** (required by `nanoid@^6.0.2` and specified in `package.json` `"engines"` and `.nvmrc`).
  - **Framework Preset**: Next.js.
  - **Build Command**: `npm run build` (runs `prisma generate && next build`).
  - **Install Command**: `npm install` or `npm ci`.

### Step 6: Environment Variable Isolation Audit
- [ ] **Production**:
  - `DATABASE_URL`: Connection-pooled URL (`aws-0-eu-west-2.pooler.supabase.com:6543`).
  - `DIRECT_URL`: Direct session connection URL (`aws-0-eu-west-2.pooler.supabase.com:5432`).
  - `SUPABASE_SECRET_KEY`: Service-role key for backend storage and private bucket access.
  - `OPENAI_API_KEY`: Production OpenAI API key.
- [ ] **Preview & Staging**:
  - **CRITICAL**: Preview environments must **NEVER** share credentials with the production Supabase database.
  - Ensure Preview environments point to a dedicated staging/preview Supabase project or isolated database branch.

### Step 7: Vercel Deployment Protection
- [ ] In Vercel Project Settings -> **Deployment Protection**:
  - Enable Vercel Authentication or Password Protection for Preview Deployments to prevent public crawling of staging environments.

---

## 4. Post-Deployment Verification
- [ ] Verify `/discover` loads public paper catalog without errors.
- [ ] Verify `/papers/[id]` renders public papers correctly.
- [ ] Verify `/editor` mounts cleanly and allows document editing.
- [ ] Verify `/api/citations/sync` returns HTTP 401 for unauthenticated calls and functions for admins.
- [ ] Verify user private documents and private papers are strictly inaccessible to other users.

