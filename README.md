# Paper Aid Pro — Academic Intelligence Platform

[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14.2-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.19-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)

A production-grade, full-stack scientific research and academic intelligence platform designed to eliminate hallucinations in scholarly literature. Combines multi-paper discovery, evidence-grounded PDF chat, deep research synthesis, a CSL-compliant manuscript editor, and developer integrations via the Model Context Protocol (MCP).

---

## 1. Core Platform Capabilities

### 🔍 Grounded Literature Discovery & Hybrid Search
- **Reciprocal Rank Fusion (RRF)**: Blends PostgreSQL full-text lexical search with `pgvector` 1536-dimensional semantic cosine similarity.
- **Exact Identifier Priority**: Automatic top-rank boosting for DOIs, exact manuscript titles, and author names.
- **Evidence Snippets**: Search results surface verifiable extracted chunks directly in search previews.

### 📑 Verifiable Evidence Grounding & PDF Chat
- **Deterministic Text Extraction**: Powered by `unpdf` with strict preservation of page boundaries, headers, and section hierarchies.
- **Zero Hallucination Anchors**: Synthetic claims are strictly anchored to verbatim extracted manuscript excerpts, page numbers, and section labels.
- **Architectural Data Separation**: Verbatim manuscript text (`Paper` entity) is stored strictly separate from AI-generated interpretations (`AISummary` entity) to prevent recursive prompt contamination.

### 🧬 Deep Research & Multi-Paper Synthesis
- **Multi-Paper Evidence Synthesis**: Cross-examines multiple scientific publications to synthesize consensus findings, identify methodological disagreements, and isolate research gaps.
- **Corroboration Enforcement**: Comparative claims require two or more independent empirical papers; single-paper claims are prevented from fabricating cross-study consensus.

### ✍️ Scientific Manuscript Editor & CSL Citation Engine
- **Rich Document Editor**: Block-based academic writing environment built on Tiptap with support for headings, abstracts, tables, and callouts.
- **Citation Style Language (CSL)**: In-browser citation generation via `citeproc-js` supporting APA 7th, MLA 9th, Chicago, IEEE, Harvard, and Vancouver with live bibliography compilation.
- **Export Formats**: One-click manuscript export to Academic PDF, structured Markdown, `.bib` (BibTeX), and `.ris` formats.
- **Document Revisions**: Immutable revision snapshots with visual diffing and guarded restoration.

### 🔒 Strict Multi-Tenant Paper Isolation
- **Private Document Boundaries**: User-uploaded preprints and proprietary manuscripts are strictly isolated to their owning researcher.
- **Copy-on-Write (CoW)**: When researchers annotate or attach private notes to shared public literature, private clones are spawned automatically without altering canonical public metadata.
- **Anti-Enumeration Security**: Unauthorized requests to private resources receive HTTP 404 rather than 403 to prevent resource probing.

### 🔌 Model Context Protocol (MCP) Server
- **IDE & Agent Connectivity**: First-class MCP server integration allowing IDEs (Cursor, Claude Desktop, Antigravity) to query the literature catalog, inspect paper metadata, and retrieve grounded evidence chunks directly from AI coding environments.

---

## 2. Technical Stack

| Layer | Technology | Details |
| :--- | :--- | :--- |
| **Framework** | Next.js 14 (App Router) | React Server Components, Server Actions, Route Handlers |
| **Runtime** | Node.js `22.x` | Modern LTS with native ES module and fetch support |
| **Language** | TypeScript 5.7+ | Strict mode enabled, zero `any` tolerance |
| **Database** | PostgreSQL 16 + pgvector | Relational schema with 1536-dim vector embeddings |
| **ORM** | Prisma ORM 6.19 | 11 relational models, 10 canonical migrations, connection pooling |
| **Auth & RBAC** | NextAuth.js 4.24 | Credentials provider, stateless JWT, bcrypt password hashing |
| **Styling** | Tailwind CSS 3.4 | Academic Slate/Indigo design tokens, custom typography |
| **Editor** | Tiptap 3.3 | Headless rich-text editor with custom citation nodes |
| **Citations** | citeproc-js 2.4 | Official CSL 1.0.2 citation processor & local style catalog |
| **PDF Extraction** | unpdf 0.12 | Modern PDF.js runtime wrapper for Node.js 22 |

---

## 3. Project Directory Map

```
├── prisma/
│   ├── schema.prisma             # Canonical relational schema (11 models, 5 enums)
│   ├── schema.table-proposal.prisma # Extended table proposal schema
│   └── migrations/               # 10 sequential database migrations
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── (auth)/               # /login, /register
│   │   ├── admin/                # /admin, /admin/papers, /admin/processing
│   │   ├── api/                  # API Route Handlers (auth, citations, scholar, editor)
│   │   ├── authors/              # Scholar directory and bibliometrics
│   │   ├── categories/           # Scientific domain taxonomy
│   │   ├── discover/             # Scholarly paper catalog & hybrid search
│   │   ├── editor/               # Scientific manuscript editor & revision history
│   │   ├── library/              # Researcher personal library & collections
│   │   ├── papers/[id]/          # Grounded manuscript detail view
│   │   ├── research/             # Deep Research & multi-paper synthesis
│   │   └── tools/                # Academic utility suite (Citation Generator)
│   ├── components/               # React client & server components
│   ├── config/                   # Site navigation, tools registry, metadata
│   └── lib/                      # Core backend & business logic
│       ├── ai/                   # OpenAI client, embeddings, prompt versioning
│       ├── auth/                 # NextAuth options, RBAC, paper-visibility filters
│       ├── citations/            # CSL catalog, citeproc-js compiler, RIS/BibTeX
│       ├── editor/               # Document persistence, revision manager, PDF export
│       ├── pdf/                  # Extractor, chunker, section detector, pipeline
│       ├── rag/                  # Single-paper evidence retrieval & QA
│       ├── search/               # Hybrid search engine (lexical + pgvector)
│       └── synthesis/            # Multi-paper synthesis orchestrator
├── scripts/                      # Safe migration runners, preflight guards, dev seeders
└── tests/                        # Comprehensive test suite (68 deterministic test files)
```

---

## 4. Local Development Quickstart

### Prerequisites
- **Node.js**: `22.x` (enforced via `.nvmrc` and `package.json` `"engines"`)
- **Docker & Docker Compose**: For containerized PostgreSQL 16 + `pgvector`
- **npm**: `10.x+`

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/Isaac25-lgtm/PAPER-AID-PRO.git
cd PAPER-AID-PRO
npm ci
```

### 2. Configure Environment Variables
Copy the template configuration:
```bash
cp .env.example .env
```
Ensure your `.env` contains:
```env
# Local isolated Docker database
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/ai_research_hub?schema=public"
DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:5432/ai_research_hub"

# NextAuth configuration
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-32-character-random-secret-key"

# AI services (optional for testing; mock embeddings are used offline)
OPENAI_API_KEY="sk-..."
```

### 3. Start PostgreSQL with pgvector
```bash
docker compose up -d
```

### 4. Initialize Test Database & Disposable Marker
```bash
# Initializes the isolated local test database with safety markers
npm run db:test:init
```

### 5. Start Isolated Development Server
```bash
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser. The isolated development runner automatically enforces local loopback database connections and enables mock storage (`USE_MOCK_STORAGE=true`).

---

## 5. Verification & Testing

The project maintains an extensive, deterministic test suite designed to run offline without paid API calls or cloud dependencies:

```bash
# Run the complete deterministic unit & regression test suite (68 suites)
npm test

# Run table proposal schema extension tests (4 suites)
npm run test:proposal

# Run full-stack integration tests (requires external network)
npm run test:integration

# Run strict TypeScript type-checking
npm run type-check
```

---

## 6. Database Migrations & Safety Architecture

Database migrations are strictly protected against accidental remote cloud execution.

```bash
# Check local migration status against Docker PostgreSQL
npm run db:status

# Apply pending migrations to local development database
npm run db:deploy

# Safely check read-only migration status on production (requires confirmation prompt)
npm run db:status:prod
```

### Safe Migration Guards (`scripts/safe-migrate.cjs`)
1. **Loopback Whitelist**: Restricts `migrate dev` and `db push` strictly to `127.0.0.1` and `localhost`.
2. **Keyword Rejection**: Immediately aborts if connection URLs reference Supabase, AWS, GCP, Neon, or other cloud providers.
3. **Explicit Opt-In Production Status**: `npm run db:status:prod` runs strictly read-only `prisma migrate status` after requiring interactive confirmation of the target project reference.

---

## 7. Model Context Protocol (MCP) Integration

To connect AI Research Hub to **Claude Desktop** or **Cursor**, add the following configuration to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "paper-aid-pro": {
      "command": "node",
      "args": ["<PATH_TO_PROJECT>/src/lib/mcp/server.js"],
      "env": {
        "DATABASE_URL": "postgresql://postgres:postgres@127.0.0.1:5432/ai_research_hub?schema=public"
      }
    }
  }
}
```

### Available MCP Tools:
- `search_literature`: Hybrid lexical and semantic search across indexed papers.
- `inspect_paper`: View abstract, authors, DOI, and publication metadata.
- `retrieve_evidence`: Fetch exact chunk excerpts with page and section references.
- `format_citation`: Generate formatted citations in APA, MLA, Chicago, IEEE, or BibTeX.

---

## 8. License & Academic Integrity

Built for academic transparency, reproducibility, and rigorous scientific research. All citations are anchored in source literature with verified bibliographic provenance.
