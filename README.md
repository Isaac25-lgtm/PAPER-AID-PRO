# AI Research Hub

A modern AI-powered research platform for discovering, reading, searching, and understanding academic research papers with grounded evidence and verifiable citations.

## Tech Stack
* **Framework**: [Next.js 14](https://nextjs.org/) (App Router)
* **Language**: [TypeScript](https://www.typescriptlang.org/)
* **Styling**: [Tailwind CSS](https://tailwindcss.com/)
* **Component Primitives**: [shadcn/ui](https://ui.shadcn.com/)
* **Icons**: [Lucide React](https://lucide.dev/)
* **Target Database** *(Upcoming Phase)*: PostgreSQL with `pgvector` & Prisma ORM
* **Target AI Stack** *(Upcoming Phase)*: OpenAI Embeddings & Chat Completions, RAG Assistant

---

## Getting Started

### 1. Prerequisites
* Node.js v18+ (v20 LTS recommended)
* npm v9+

### 2. Install Dependencies
```bash
npm install
```

### 3. Run Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Build for Production
```bash
npm run build
npm start
```

---

## Directory Structure
```
├── src/
│   ├── app/                    # Next.js App Router (pages & layouts)
│   │   ├── (public pages)      # /, /papers, /authors, /categories, /articles
│   │   ├── (auth pages)        # /login, /register, /account
│   │   ├── (user pages)        # /saved, /conversations, /conversations/[id]
│   │   └── admin/              # /admin, /admin/papers, /admin/processing
│   ├── components/
│   │   ├── layout/             # Navbar, Footer, Mobile navigation
│   │   ├── ui/                 # Reusable button, card, badge, input
│   │   └── shared/             # PaperCard, SectionHeader
│   ├── config/
│   │   └── site.ts             # Central navigation and branding config
│   └── lib/
│       ├── utils.ts            # Styling utilities (cn)
│       └── types/              # Typed domain models (Paper, Author, Category, etc.)
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```
