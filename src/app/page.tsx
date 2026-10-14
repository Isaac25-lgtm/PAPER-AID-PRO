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
  PenTool,
  Globe,
  Upload,
  MessageSquare,
  Library,
  FileEdit,
  ExternalLink,
  GraduationCap,
  ChevronRight,
  Database,
  Quote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SectionHeader } from "@/components/shared/section-header";
import { PaperCard } from "@/components/shared/paper-card";
import { Paper } from "@/lib/types/paper";
import { prisma } from "@/lib/prisma";
import { FAQsSection } from "@/components/home/faqs-section";
import { HeroSearch } from "@/components/home/hero-search";
import { ADMIN_TEST_FIXTURE_IDS, isPublicScholarlyPaper, getPublicPaperWhereInput } from "@/lib/auth/paper-authorization";

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

  const isAdmin = session?.user?.role === "ADMIN";
  const isAuthenticated = Boolean(session?.user);

  // Fetch real research papers directly from PostgreSQL (compact preview of 2 top papers)
  const dbPapers = await prisma.paper.findMany({
    where: isAdmin ? {} : getPublicPaperWhereInput(),
    take: 10,
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

  const publicDbPapers = isAdmin ? dbPapers : dbPapers.filter(isPublicScholarlyPaper);

  const featuredPapers: Paper[] =
    publicDbPapers.length > 0
      ? publicDbPapers.slice(0, 2).map((p) => ({
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

  // Features configuration with authentication redirects for protected tools
  const features = [
    {
      id: "scholarly-search",
      title: "Scholarly Search",
      tag: "Literature Discovery",
      icon: Compass,
      description:
        "Query vast scholarly literature across PubMed, Crossref, and Semantic Scholar with smart deduplication and citation metrics.",
      actionText: "Search Literature",
      href: "/discover",
      isProtected: false,
      badgeColor: "bg-blue-50 text-blue-700 border-blue-200",
    },
    {
      id: "my-library",
      title: "My Library & Collections",
      tag: "Research Workspace",
      icon: BookOpen,
      description:
        "Curate papers into personalized color-coded collections, manage private lab manuscripts, and organize citations in a dedicated library.",
      actionText: isAuthenticated ? "Open My Library" : "Sign in to Library",
      href: isAuthenticated ? "/library" : "/login?callbackUrl=/library",
      isProtected: true,
      badgeColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
    },
    {
      id: "chat-pdf",
      title: "Chat with PDF",
      tag: "Document Intelligence",
      icon: FileText,
      description:
        "Upload or select any manuscript for grounded AI inquiry. Inspect exact page numbers, paragraph quotes, and verified citations.",
      actionText: "Try Chat with PDF",
      href: "/tools/chat-pdf",
      isProtected: false,
      badgeColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    {
      id: "multi-paper-chat",
      title: "Multi-Paper Research Chat",
      tag: "Comparative Synthesis",
      icon: Layers,
      description:
        "Select multiple studies to synthesize cross-manuscript evidence, detect consensus, and compare experimental metrics with verifiable source citations.",
      actionText: isAuthenticated ? "Open Research Threads" : "Explore Research Chat",
      href: isAuthenticated ? "/conversations" : "/research",
      isProtected: false,
      badgeColor: "bg-purple-50 text-purple-700 border-purple-200",
    },
    {
      id: "research-editor",
      title: "AI Research Editor",
      tag: "Academic Writing",
      icon: PenTool,
      description:
        "Draft academic articles with autosave, insert verified passage citations linked to source chunks, and refine prose with formal tone rewrites.",
      actionText: isAuthenticated ? "Launch Editor" : "Sign in to Edit",
      href: isAuthenticated ? "/editor" : "/login?callbackUrl=/editor",
      isProtected: true,
      badgeColor: "bg-amber-50 text-amber-800 border-amber-200",
    },
    {
      id: "doi-importer",
      title: "DOI Import & Full-Text Discovery",
      tag: "Automated Ingestion",
      icon: Globe,
      description:
        "Enter any standard DOI to retrieve bibliographic metadata, discover legal open-access copies via Unpaywall and OpenAlex, and process full text.",
      actionText: isAuthenticated ? "Import in Library" : "Sign in to Import",
      href: isAuthenticated ? "/library" : "/login?callbackUrl=/library",
      isProtected: true,
      badgeColor: "bg-sky-50 text-sky-700 border-sky-200",
    },
  ];

  return (
    <div className="space-y-20 sm:space-y-28 pb-20">
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

      {/* ========================================================================= */}
      {/* 1. HERO SECTION                                                           */}
      {/* ========================================================================= */}
      <section className="relative overflow-hidden pt-12 sm:pt-20 pb-16 border-b border-slate-200/70 bg-gradient-to-b from-indigo-50/50 via-white to-transparent">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center space-y-8">
          {/* Top Pill Marker */}
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200/80 bg-indigo-50/90 px-4 py-1.5 text-xs font-semibold text-indigo-700 shadow-xs">
            <ShieldCheck className="h-3.5 w-3.5 text-indigo-600" />
            <span>Evidence-Grounded Academic Intelligence Platform</span>
          </div>

          {/* Main Headline & Supporting Statement */}
          <div className="max-w-4xl mx-auto space-y-5">
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-slate-900 leading-[1.08]">
              Discover. Analyze. Write.
            </h1>
            <p className="text-lg sm:text-xl md:text-2xl font-medium text-slate-700 max-w-3xl mx-auto leading-relaxed">
              An AI-powered research workspace for discovering scholarly evidence, organizing sources, analyzing papers and writing academic documents.
            </p>
          </div>

          {/* Call to Action Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button
              asChild
              size="lg"
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-7 shadow-md transition-all hover:shadow-lg"
            >
              <Link href={isAuthenticated ? "/library" : "/register?callbackUrl=/library"}>
                <span>Get Started</span>
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold px-6"
            >
              <a href="#features">Explore Features</a>
            </Button>
          </div>

          {/* Integrated Discovery Search Box */}
          <div className="pt-4 max-w-3xl mx-auto">
            <HeroSearch />
          </div>

          {/* Quick Research Topic Chips */}
          <div className="pt-2 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">Explore Topics:</span>
            <Link href="/discover?q=Transformers" className="hover:text-indigo-600 underline-offset-2 hover:underline">
              Attention Transformers
            </Link>
            <span>•</span>
            <Link href="/discover?q=AlphaFold+3" className="hover:text-indigo-600 underline-offset-2 hover:underline">
              AlphaFold 3
            </Link>
            <span>•</span>
            <Link href="/discover?q=Retrieval+Augmented+Generation" className="hover:text-indigo-600 underline-offset-2 hover:underline">
              RAG Architectures
            </Link>
            <span>•</span>
            <Link href="/discover?q=Quantum+Error+Mitigation" className="hover:text-indigo-600 underline-offset-2 hover:underline">
              Surface Codes
            </Link>
            <span>•</span>
            <Link href="/discover?q=Breast+Ultrasound" className="hover:text-indigo-600 underline-offset-2 hover:underline">
              Biomedical Imaging
            </Link>
          </div>

          {/* Architectural Trust Guarantees */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto pt-8 border-t border-slate-200/60 text-left">
            <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-xs space-y-1">
              <div className="text-xs font-bold uppercase tracking-wider text-indigo-600">Global Catalog</div>
              <div className="text-sm font-bold text-slate-900">Vast Scholarly Index</div>
              <p className="text-[11px] text-slate-500 leading-snug">
                Unified discovery via PubMed, Crossref, and Semantic Scholar.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-xs space-y-1">
              <div className="text-xs font-bold uppercase tracking-wider text-emerald-600">Strict Grounding</div>
              <div className="text-sm font-bold text-slate-900">Verifiable Excerpts</div>
              <p className="text-[11px] text-slate-500 leading-snug">
                Every AI response is anchored to exact manuscript page numbers.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-xs space-y-1">
              <div className="text-xs font-bold uppercase tracking-wider text-blue-600">Verifiable Citations</div>
              <div className="text-sm font-bold text-slate-900">Evidence-Grounded Answers</div>
              <p className="text-[11px] text-slate-500 leading-snug">
                Strict claim-to-chunk provenance segregation with verified excerpts.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-xs space-y-1">
              <div className="text-xs font-bold uppercase tracking-wider text-purple-600">Open Access</div>
              <div className="text-sm font-bold text-slate-900">Legal Full Text</div>
              <p className="text-[11px] text-slate-500 leading-snug">
                Automated Unpaywall and OpenAlex discovery with rights checks.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 2. AUTHENTICATED USER QUICK RETURN BANNER                                 */}
      {/* ========================================================================= */}
      {isAuthenticated && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-5 rounded-2xl bg-indigo-50/80 border border-indigo-200 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shrink-0 shadow-xs">
                <Bookmark className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Welcome back, {session?.user?.name || "Researcher"}
                </h3>
                <p className="text-xs text-slate-600">
                  You have <span className="font-semibold text-indigo-700">{userSavedCount} paper{userSavedCount === 1 ? "" : "s"}</span> saved in your research library.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold shrink-0">
                <Link href="/library">
                  <span>My Library</span>
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="text-xs font-semibold shrink-0 border-indigo-200 bg-white">
                <Link href="/editor">
                  <span>Open Editor</span>
                </Link>
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* ========================================================================= */}
      {/* 3. CAPABILITIES & FEATURES SHOWCASE                                       */}
      {/* ========================================================================= */}
      <section id="features" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center max-w-3xl mx-auto space-y-3">
          <div className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
            <span>Comprehensive Academic AI Suite</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            Built for High-Stakes Scientific Literature
          </h2>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            Every feature is engineered to provide evidence-grounded answers, enforce verified provenance, and accelerate empirical discovery.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card
                key={feature.id}
                className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white hover:border-indigo-300 hover:shadow-lg transition-all duration-200 flex flex-col justify-between"
              >
                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 text-indigo-600 border border-slate-200 group-hover:bg-indigo-600 group-hover:text-white group-hover:border-indigo-600 transition-colors shadow-2xs">
                      <Icon className="h-5 w-5" />
                    </div>
                    <Badge variant="outline" className={`text-[10px] font-bold uppercase tracking-wider ${feature.badgeColor}`}>
                      {feature.tag}
                    </Badge>
                  </div>

                  <div className="space-y-1.5">
                    <h3 className="text-lg font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                      {feature.title}
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                </div>

                <div className="p-6 pt-0 border-t border-slate-100 mt-2">
                  <Button
                    asChild
                    variant="ghost"
                    className="w-full justify-between text-xs font-bold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50/70 px-3 h-9"
                  >
                    <Link href={feature.href}>
                      <span>{feature.actionText}</span>
                      <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </Link>
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 4. HOW IT WORKS: THE EVIDENCE WORKFLOW                                    */}
      {/* ========================================================================= */}
      <section id="how-it-works" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-12">
        <SectionHeader
          badge="Scientific Workflow"
          title="How It Works"
          description="A complete research cycle from global paper discovery to verifiable manuscript drafting."
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 relative">
          {/* Step 1 */}
          <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-3 relative group hover:border-indigo-300 transition-all">
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 font-extrabold text-sm border border-indigo-100">
                01
              </div>
              <Compass className="h-5 w-5 text-indigo-500" />
            </div>
            <h3 className="font-bold text-base text-slate-900">Discover Research</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Search across PubMed, Crossref, and Semantic Scholar or paste any DOI for automated open-access metadata resolution.
            </p>
          </div>

          {/* Step 2 */}
          <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-3 relative group hover:border-indigo-300 transition-all">
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700 font-extrabold text-sm border border-blue-100">
                02
              </div>
              <BookOpen className="h-5 w-5 text-blue-500" />
            </div>
            <h3 className="font-bold text-base text-slate-900">Save and Organize</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Curate literature in your private library, organize studies into thematic folders, and track full-text status.
            </p>
          </div>

          {/* Step 3 */}
          <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-3 relative group hover:border-indigo-300 transition-all">
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 font-extrabold text-sm border border-emerald-100">
                03
              </div>
              <Layers className="h-5 w-5 text-emerald-500" />
            </div>
            <h3 className="font-bold text-base text-slate-900">Analyze Evidence</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Interrogate manuscripts with grounded PDF chat or multi-paper synthesis where every finding is linked to page excerpts.
            </p>
          </div>

          {/* Step 4 */}
          <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-3 relative group hover:border-indigo-300 transition-all">
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 text-purple-700 font-extrabold text-sm border border-purple-100">
                04
              </div>
              <PenTool className="h-5 w-5 text-purple-500" />
            </div>
            <h3 className="font-bold text-base text-slate-900">Write and Cite</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Compose manuscripts in the AI Research Editor, auto-insert verifiable citations, and export literature bibliographies.
            </p>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 5. FEATURED RESEARCH PREVIEW (COMPACT PREVIEW)                           */}
      {/* ========================================================================= */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 uppercase tracking-wider mb-1">
              <BookOpen className="h-3.5 w-3.5" />
              <span>Grounded Literature Catalog</span>
            </div>
            <h2 className="text-2xl font-bold text-slate-900">Featured Research Studies</h2>
            <p className="text-xs sm:text-sm text-slate-500">
              Sample high-impact scientific manuscripts with structured findings and verified paragraph anchors.
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 shrink-0 font-semibold text-xs">
            <Link href="/papers">
              <span>Browse Full Catalog</span>
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {featuredPapers.map((paper) => (
            <PaperCard key={paper.id} paper={paper} />
          ))}
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 6. ACADEMIC INTEGRITY FAQS                                                */}
      {/* ========================================================================= */}
      <FAQsSection />

      {/* ========================================================================= */}
      {/* 7. CALL TO ACTION BANNER                                                  */}
      {/* ========================================================================= */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
        <div className="rounded-3xl bg-slate-900 p-8 sm:p-14 text-white shadow-2xl space-y-6 max-w-4xl mx-auto border border-slate-800">
          <div className="inline-flex items-center gap-2 rounded-full bg-indigo-500/20 px-3.5 py-1 text-xs font-semibold text-indigo-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Ready for Empirical Research</span>
          </div>

          <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight">
            Start Your Literature Workspace Today
          </h2>

          <p className="text-sm sm:text-base text-slate-300 max-w-xl mx-auto leading-relaxed">
            Create an account in seconds with your personal or institutional email. Search papers, curate your library, and write with verifiable evidence.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <Button
              asChild
              size="lg"
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-8 shadow-md"
            >
              <Link href={isAuthenticated ? "/library" : "/register?callbackUrl=/library"}>
                <span>{isAuthenticated ? "Open My Library" : "Create Free Account"}</span>
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-slate-700 text-slate-200 hover:bg-slate-800 font-semibold"
            >
              <Link href="/discover">Search Literature</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
