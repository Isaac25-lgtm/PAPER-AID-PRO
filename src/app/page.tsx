import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  Search,
  BookOpen,
  ArrowRight,
  ShieldCheck,
  ShieldAlert,
  Bookmark,
  Layers,
  FileText,
  Compass,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/shared/section-header";
import { PaperCard } from "@/components/shared/paper-card";
import { Paper } from "@/lib/types/paper";
import { prisma } from "@/lib/prisma";
import { FAQsSection } from "@/components/home/faqs-section";
import { HeroSearch } from "@/components/home/hero-search";

// High-fidelity fallback research papers if database is empty
const fallbackPapers: Paper[] = [
  {
    id: "paper-001",
    title: "Attention Is All You Need: Scaled Dot-Product and Multi-Head Self-Attention in Sequence Transduction",
    abstract:
      "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose the Transformer, a model architecture eschewing recurrence and instead relying entirely on an attention mechanism to draw global dependencies between input and output.",
    publicationDate: "2023-12-15",
    journal: "Advances in Neural Information Processing Systems (NeurIPS)",
    doi: "10.48550/arXiv.1706.03762",
    status: "COMPLETED",
    keywords: ["Transformer", "Self-Attention", "Deep Learning", "Seq2Seq"],
    authors: [
      { id: "a-1", name: "Ashish Vaswani", institution: "Google Brain" },
      { id: "a-2", name: "Noam Shazeer", institution: "Google Brain" },
      { id: "a-3", name: "Niki Parmar", institution: "Google Research" },
    ],
    categories: [
      { id: "c-1", name: "Artificial Intelligence" },
      { id: "c-2", name: "NLP" },
    ],
    createdAt: "2024-01-10T10:00:00Z",
    updatedAt: "2024-01-10T10:00:00Z",
  },
  {
    id: "paper-002",
    title: "Accurate Structure Prediction of Biomolecular Interactions with AlphaFold 3",
    abstract:
      "The interaction of proteins with other molecules is fundamental to cellular function. Here we present AlphaFold 3, with a substantially updated diffusion-based architecture that is capable of predicting the joint 3D structure of complexes including proteins, nucleic acids, small molecules, ions, and chemical modifications.",
    publicationDate: "2024-05-08",
    journal: "Nature Biomedical Science",
    doi: "10.1038/s41586-024-07487-w",
    status: "COMPLETED",
    keywords: ["AlphaFold", "Structural Biology", "Diffusion Models", "Biomolecules"],
    authors: [
      { id: "a-4", name: "Josh Abramson", institution: "Google DeepMind" },
      { id: "a-5", name: "John Jumper", institution: "Google DeepMind" },
      { id: "a-6", name: "Demis Hassabis", institution: "Google DeepMind" },
    ],
    categories: [
      { id: "c-3", name: "Computational Biology" },
      { id: "c-1", name: "Artificial Intelligence" },
    ],
    createdAt: "2024-05-10T12:00:00Z",
    updatedAt: "2024-05-10T12:00:00Z",
  },
  {
    id: "paper-003",
    title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
    abstract:
      "Large pre-trained language models have been shown to store factual knowledge in their parameters. However, their ability to access and precisely manipulate knowledge is still limited. We build RAG models where the parametric memory is a pre-trained seq2seq model and the non-parametric memory is a dense vector index of Wikipedia.",
    publicationDate: "2023-11-20",
    journal: "Conference on Empirical Methods in Natural Language Processing (EMNLP)",
    doi: "10.48550/arXiv.2005.11401",
    status: "COMPLETED",
    keywords: ["RAG", "Information Retrieval", "Vector Search", "Hallucination Mitigation"],
    authors: [
      { id: "a-7", name: "Patrick Lewis", institution: "Meta AI" },
      { id: "a-8", name: "Ethan Perez", institution: "NYU" },
      { id: "a-9", name: "Douwe Kiela", institution: "Stanford University" },
    ],
    categories: [
      { id: "c-2", name: "NLP" },
      { id: "c-1", name: "Artificial Intelligence" },
    ],
    createdAt: "2024-02-01T08:00:00Z",
    updatedAt: "2024-02-01T08:00:00Z",
  },
  {
    id: "paper-004",
    title: "Fault-Tolerant Quantum Computation with Surface Codes and Magic State Distillation",
    abstract:
      "Surface codes offer the highest known fault-tolerance thresholds against physical errors in quantum bits. We analyze practical architectures for fault-tolerant universal quantum computation utilizing 2D nearest-neighbor coupling lattices, showing threshold error rates above 1%.",
    publicationDate: "2024-01-18",
    journal: "Physical Review X (Quantum)",
    doi: "10.1103/PhysRevX.12.041012",
    status: "COMPLETED",
    keywords: ["Quantum Computing", "Surface Codes", "Error Correction", "Qubits"],
    authors: [
      { id: "a-10", name: "Austin G. Fowler", institution: "Google Quantum AI" },
      { id: "a-11", name: "John M. Martinis", institution: "UC Santa Barbara" },
    ],
    categories: [
      { id: "c-4", name: "Quantum Computing" },
    ],
    createdAt: "2024-01-20T14:30:00Z",
    updatedAt: "2024-01-20T14:30:00Z",
  },
];

export default async function HomePage({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
  const isUnauthorized = searchParams?.error === "unauthorized";

  // Check user session safely
  let session = null;
  let userSavedCount = 0;
  try {
    session = await getServerSession(authOptions);
    if (session?.user?.id) {
      userSavedCount = await prisma.bookmark.count({
        where: { userId: session.user.id },
      });
    }
  } catch {
    // Session check fallback in isolated contexts
  }

  // Fetch real research papers directly from PostgreSQL
  const dbPapers = await prisma.paper.findMany({
    take: 6,
    include: {
      authors: {
        include: { author: true },
        orderBy: { orderIndex: "asc" },
      },
      categories: {
        include: { category: true },
      },
      aiSummary: true,
    },
    orderBy: [{ citationCount: "desc" }, { createdAt: "desc" }],
  });

  // Fetch real categories with paper counts (hide categories with 0 papers)
  const dbCategories = await prisma.category.findMany({
    where: {
      papers: {
        some: {},
      },
    },
    include: {
      _count: {
        select: { papers: true },
      },
    },
    orderBy: { papers: { _count: "desc" } },
    take: 6,
  });

  const featuredPapers: Paper[] =
    dbPapers.length > 0
      ? dbPapers.map((p) => ({
          id: p.id,
          title: p.title,
          abstract: p.abstract,
          publicationDate: p.publicationDate?.toISOString() || new Date().toISOString(),
          journal: p.journal || "Research Manuscript",
          doi: p.doi || undefined,
          pdfUrl: p.pdfUrl || undefined,
          status: p.status as any,
          keywords: p.keywords,
          citationCount: p.citationCount,
          researchQuestion: p.researchQuestion || undefined,
          methodology: p.methodology || undefined,
          results: p.results || undefined,
          limitations: p.limitations || undefined,
          conclusion: p.conclusion || undefined,
          authors: p.authors.map((pa) => ({
            id: pa.author.id,
            name: pa.author.name,
            institution: pa.author.institution || undefined,
          })),
          categories: p.categories.map((pc) => ({
            id: pc.category.id,
            name: pc.category.name,
          })),
          aiSummary: p.aiSummary
            ? {
                id: p.aiSummary.id,
                paperId: p.aiSummary.paperId,
                summary: p.aiSummary.summary,
                keyFindings: p.aiSummary.keyFindings,
                methodologySummary: p.aiSummary.methodologySummary || undefined,
                limitations: p.aiSummary.limitations || undefined,
                conclusion: p.aiSummary.conclusion || undefined,
                modelUsed: p.aiSummary.modelUsed,
                createdAt: p.aiSummary.createdAt.toISOString(),
              }
            : null,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        }))
      : fallbackPapers;

  return (
    <div className="space-y-16 sm:space-y-24 pb-16">
      {/* Access Denied / Unauthorized Banner */}
      {isUnauthorized && (
        <div className="mx-auto max-w-3xl px-4 pt-6">
          <div className="flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs sm:text-sm text-amber-900 shadow-sm animate-in fade-in slide-in-from-top-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-200 text-amber-900 shrink-0">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <div className="space-y-0.5">
              <span className="font-bold">Access Restricted</span>
              <p className="text-xs text-amber-700">
                You were redirected because the Admin Console requires an Administrator account.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 1. HERO SECTION */}
      <section className="relative overflow-hidden pt-12 sm:pt-20 pb-16 border-b border-slate-200/70 bg-gradient-to-b from-indigo-50/50 via-white to-transparent">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center space-y-8">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200/80 bg-indigo-50/80 px-4 py-1.5 text-xs font-semibold text-indigo-700 shadow-xs">
            <ShieldCheck className="h-3.5 w-3.5 text-indigo-600" />
            <span>Evidence-Grounded Literature Intelligence</span>
          </div>

          {/* Main Title & Conceptual Direction */}
          <div className="max-w-4xl mx-auto space-y-4">
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-slate-900 leading-[1.08]">
              AI Research Hub
            </h1>
            <p className="text-lg sm:text-2xl font-medium text-indigo-900 max-w-2xl mx-auto">
              Discover, understand, and organize scientific research.
            </p>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl mx-auto">
              A scientific literature and research manuscript platform designed for rigorous scientific inquiry.
              Read manuscripts, inspect verifiable evidence citations, and organize research in your personal library.
            </p>
          </div>

          {/* Search Box with Dual Target Selection */}
          <HeroSearch />

          {/* Quick Action Navigation */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button asChild variant="outline" size="sm" className="border-slate-300 text-xs text-slate-700 font-medium">
              <Link href="/papers">
                <BookOpen className="mr-1.5 h-3.5 w-3.5 text-slate-500" />
                Browse Library
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="border-slate-300 text-xs text-slate-700 font-medium">
              <Link href="/discover">
                <Compass className="mr-1.5 h-3.5 w-3.5 text-indigo-600" />
                Discover Literature
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="border-slate-300 text-xs text-slate-700 font-medium">
              <Link href="/research">
                <Layers className="mr-1.5 h-3.5 w-3.5 text-indigo-600" />
                Research Workspace
              </Link>
            </Button>
          </div>

          {/* Quick Topic Chips */}
          <div className="pt-2 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">Sample Topics:</span>
            <Link href="/papers?q=Transformer" className="hover:text-indigo-600 underline-offset-2 hover:underline">
              Attention Transformers
            </Link>
            <span>•</span>
            <Link href="/papers?q=AlphaFold" className="hover:text-indigo-600 underline-offset-2 hover:underline">
              AlphaFold 3
            </Link>
            <span>•</span>
            <Link href="/papers?q=Ultrasound" className="hover:text-indigo-600 underline-offset-2 hover:underline">
              Medical Ultrasound
            </Link>
            <span>•</span>
            <Link href="/papers?q=Quantum" className="hover:text-indigo-600 underline-offset-2 hover:underline">
              Surface Codes
            </Link>
            <span>•</span>
            <Link href="/papers?q=Breast+Cancer" className="hover:text-indigo-600 underline-offset-2 hover:underline">
              Breast Cancer AI
            </Link>
          </div>

          {/* Platform Architecture Highlights (Factual) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto pt-8 border-t border-slate-200/60 text-left">
            <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-xs space-y-1">
              <div className="text-xs font-bold uppercase tracking-wider text-indigo-600">Verifiable Grounding</div>
              <div className="text-sm font-bold text-slate-900">Source Evidence</div>
              <p className="text-[11px] text-slate-500 leading-snug">
                Key findings anchored to supporting manuscript chunks and page context.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-xs space-y-1">
              <div className="text-xs font-bold uppercase tracking-wider text-emerald-600">Dual Architecture</div>
              <div className="text-sm font-bold text-slate-900">Strict Separation</div>
              <p className="text-[11px] text-slate-500 leading-snug">
                Verbatim manuscript text strictly segregated from AI interpretations.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-xs space-y-1">
              <div className="text-xs font-bold uppercase tracking-wider text-blue-600">Original PDFs</div>
              <div className="text-sm font-bold text-slate-900">Direct Reading</div>
              <p className="text-[11px] text-slate-500 leading-snug">
                Stream original PDFs inline and inspect structured sections.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-xs space-y-1">
              <div className="text-xs font-bold uppercase tracking-wider text-purple-600">Personal Library</div>
              <div className="text-sm font-bold text-slate-900">Research Workspace</div>
              <p className="text-[11px] text-slate-500 leading-snug">
                Bookmark and curate scientific literature in your private library.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. AUTHENTICATED USER QUICK ACCESS BANNER */}
      {session?.user && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-5 rounded-2xl bg-indigo-50/70 border border-indigo-100">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shrink-0 shadow-xs">
                <Bookmark className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Welcome back, {session.user.name || "Researcher"}
                </h3>
                <p className="text-xs text-slate-600">
                  You have <span className="font-semibold text-indigo-700">{userSavedCount} paper{userSavedCount === 1 ? "" : "s"}</span> saved in your personal reading library.
                </p>
              </div>
            </div>
            <Button asChild size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold shrink-0">
              <Link href="/saved">
                Open My Library
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </section>
      )}

      {/* 3. FEATURED SCIENTIFIC PAPERS */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <SectionHeader
            badge="Scientific Literature"
            title="Featured Research Catalog"
            description="Explore scientific manuscripts with structured sections, verifiable citations, and original PDF access."
          />
          <Link
            href="/papers"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors shrink-0"
          >
            <span>Browse Full Catalog ({featuredPapers.length}+)</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {featuredPapers.map((paper) => (
            <PaperCard key={paper.id} paper={paper} />
          ))}
        </div>
      </section>

      {/* 4. RESEARCH DISCIPLINES & CATEGORIES */}
      {dbCategories.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <SectionHeader
              badge="Taxonomy"
              title="Explore by Research Category"
              description="Browse scientific literature across foundational and emerging research disciplines."
            />
            <Link
              href="/categories"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors shrink-0"
            >
              <span>All Disciplines</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {dbCategories.map((cat) => (
              <Link
                key={cat.id}
                href={`/papers?category=${cat.slug}`}
                className="group p-5 rounded-2xl bg-white border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all flex flex-col justify-between space-y-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-slate-900 group-hover:text-indigo-600 transition-colors">
                      {cat.name}
                    </span>
                    <Badge variant="secondary" className="text-[11px] font-semibold">
                      {cat._count.papers} paper{cat._count.papers === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  {cat.description && (
                    <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                      {cat.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center text-xs font-semibold text-indigo-600 gap-1 pt-1">
                  <span>Explore category</span>
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 5. PAPER-FIRST RESEARCH JOURNEY */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-8">
        <SectionHeader
          badge="Research Flow"
          title="The Evidence-First Workflow"
          description="How AI Research Hub empowers rigorous literature discovery without synthetic claims."
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="p-6 rounded-2xl bg-white border border-slate-200 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 font-bold text-sm">
              01
            </div>
            <h3 className="font-bold text-sm text-slate-900">Discover Literature</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Search by title, abstract, DOI, author, or keyword across scientific publications and research manuscripts.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-white border border-slate-200 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 font-bold text-sm">
              02
            </div>
            <h3 className="font-bold text-sm text-slate-900">Read Original PDFs</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Stream original manuscript PDFs inline and review structured methodology, results, and limitations.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-white border border-slate-200 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 font-bold text-sm">
              03
            </div>
            <h3 className="font-bold text-sm text-slate-900">Grounded Summaries</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Inspect AI summaries where key findings are anchored to supporting manuscript excerpts.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-white border border-slate-200 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 text-purple-600 font-bold text-sm">
              04
            </div>
            <h3 className="font-bold text-sm text-slate-900">Curate in My Library</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Save key papers into your personal workspace for quick retrieval during synthesis.
            </p>
          </div>
        </div>
      </section>

      {/* 6. ACADEMIC INTEGRITY FAQS */}
      <FAQsSection />

      {/* 7. CALL TO ACTION */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
        <div className="rounded-3xl bg-slate-900 p-8 sm:p-14 text-white shadow-2xl space-y-6 max-w-4xl mx-auto border border-slate-800">
          <div className="inline-flex items-center gap-2 rounded-full bg-indigo-500/20 px-3.5 py-1 text-xs font-semibold text-indigo-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Rigorous Scientific Intelligence</span>
          </div>

          <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight">
            Start Exploring Scientific Research
          </h2>

          <p className="text-sm sm:text-base text-slate-300 max-w-xl mx-auto leading-relaxed">
            Discover scientific literature, view evidence-grounded summaries, and curate your personal research library.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <Button asChild size="lg" className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md">
              <Link href="/papers">
                Browse Research Papers
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-slate-700 text-slate-200 hover:bg-slate-800">
              <Link href="/register">Create Free Account</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
