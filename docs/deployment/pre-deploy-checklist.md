# AI RESEARCH HUB — PRODUCTION PRE-DEPLOY CHECKLIST

> **Status**: Mandatory pre-flight checklist for merging and deploying `fix/private-paper-isolation` to production.

---

## 1. Migration Inventory (10 Canonical Migrations)

All migrations in `prisma/migrations` must be tracked and applied sequentially:

| # | Migration Directory | Description | Status in Production |
|---|---|---|---|
| 1 | `0_init` | Baseline relational schema (11 models, 5 enums) | Applied (Baselined) |
| 2 | `20260925_add_ai_summary_citations` | Added `citations Json?` to `AISummary` | Applied |
| 3 | `20261001_add_author_bibliometrics` | Added ORCID, h-index, and citation counts to `Author` | Applied |
| 4 | `20261010_add_full_text_search_indexes` | Added PostgreSQL GIN full-text search indexes on `Paper` | Applied |
| 5 | `20261015_add_ai_chat_models` | Added `AIConversation` and `AIMessage` multi-turn RAG threads | Applied |
| 6 | `20261020_add_user_roles_and_permissions` | Added `UserRole` enum and RBAC user permissions | Applied |
| 7 | `20261025_add_paper_chunk_pgvector` | Added `pgvector` extension and 1536-dimensional chunk embeddings | Applied |
| 8 | `20261028_add_csl_sync_locks` | Added `csl_sync_locks` distributed lock table with `updatedAt` | Applied |
| 9 | `20261102_add_csl_style_catalog` | Added `csl_styles` local CSL catalog cache table | Applied |
| 10 | `20261104_add_document_revisions` | Added `document_revisions` table for historical versioning | **Pending Deploy** |

---

## 2. Read-Only Production Migration Status Check

Before executing any migrations or deployments, run the non-mutating status check:

```bash
npm run db:status
```

*Note*: This invokes `node scripts/safe-migrate.cjs status`, which checks applied migrations against `_prisma_migrations` without applying changes or modifying schemas.

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

