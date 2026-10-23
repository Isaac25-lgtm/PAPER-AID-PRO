import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  Users,
  FileText,
  Sparkles,
  Share2,
  Bookmark,
  ExternalLink,
  Download,
  Quote,
  ShieldCheck,
  CheckCircle2,
  Building2,
  AlertCircle,
  Upload,
  Compass,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AISummaryView } from "@/components/papers/ai-summary-view";
import { SavePaperButton } from "@/components/papers/save-paper-button";
import { PaperQA } from "@/components/papers/paper-qa";
import { getPaperStatusBadge } from "@/lib/ui/status-mapper";
import { authorizePaperAccess } from "@/lib/auth/paper-authorization";
import { OpenAccessDiscoveryButton } from "@/components/papers/open-access-discovery-button";
import { isLocalPdfAvailable } from "@/lib/storage";

export async function generateMetadata({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const paper = await prisma.paper.findFirst({
    where: {
      OR: [{ id: params.id }, { doi: params.id }],
    },
  });

  if (!paper) {
    return { title: "Paper Not Found | AI Research Hub" };
  }

  const auth = await authorizePaperAccess(paper, session?.user, "VIEW_METADATA");
  if (!auth.allowed) {
    return { title: "Paper Not Found | AI Research Hub" };
  }

  return {
    title: `${paper.title} | AI Research Hub`,
    description: paper.abstract.slice(0, 160),
  };
}

export default async function PaperDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { conversationId?: string };
}) {
  const session = await getServerSession(authOptions);

  const paper = await prisma.paper.findFirst({
    where: {
      OR: [{ id: params.id }, { doi: params.id }],
    },
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
  });

  if (!paper) {
    notFound();
  }

  // Security Access Control Check
  const authResult = await authorizePaperAccess(paper, session?.user, "VIEW_METADATA");
  if (!authResult.allowed) {
    notFound();
  }

  const canDownloadPdf = (await authorizePaperAccess(paper, session?.user, "DOWNLOAD_PDF")).allowed;
  const canViewSummary = (await authorizePaperAccess(paper, session?.user, "VIEW_SUMMARY")).allowed;
  const canInteractAI = (await authorizePaperAccess(paper, session?.user, "INTERACT_AI")).allowed;

  let isBookmarked = false;
  if (session?.user?.id) {
    const bookmark = await prisma.bookmark.findUnique({
      where: {
        userId_paperId: {
          userId: session.user.id,
          paperId: paper.id,
        },
      },
    });
    isBookmarked = !!bookmark;
  }

  // Phase 7: Check paper chunk availability and embedding readiness
  const [chunkCount, embeddedCountResult] = await Promise.all([
    prisma.paperChunk.count({ where: { paperId: paper.id } }),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint as count
      FROM paper_chunks
      WHERE "paperId" = ${paper.id}
        AND embedding IS NOT NULL
    `,
  ]);
  const isEmbedded = Number(embeddedCountResult[0]?.count ?? 0) > 0;
  const statusBadge = getPaperStatusBadge(paper.status);
  const isMetadataOnly = paper.status === "METADATA_ONLY";

  const prov = paper.sourceProvenance as any;
  const isPrivateDoc = prov?.uploadedByUserId === session?.user?.id || prov?.ownerId === session?.user?.id;
  const docType = prov?.documentType;
  const institution = prov?.institution;
  const isPreprint = prov?.version === "submittedVersion" || prov?.isPreprint === true;

  const localPdfAvailable = isLocalPdfAvailable(paper.storagePath);
  const externalPdfUrl =
    (prov?.openAccessPdfUrl && typeof prov.openAccessPdfUrl === "string" && prov.openAccessPdfUrl.startsWith("http")
      ? prov.openAccessPdfUrl
      : null) ||
    (prov?.originalPdfUrl && typeof prov.originalPdfUrl === "string" && prov.originalPdfUrl.startsWith("http")
      ? prov.originalPdfUrl
      : null) ||
    (paper.pdfUrl && typeof paper.pdfUrl === "string" && paper.pdfUrl.startsWith("http") && !paper.pdfUrl.includes("/api/papers/")
      ? paper.pdfUrl
      : null) ||
    (prov?.externalLandingPageUrl && typeof prov.externalLandingPageUrl === "string" && prov.externalLandingPageUrl.startsWith("http")
      ? prov.externalLandingPageUrl
      : null) ||
    (prov?.externalUrl && typeof prov.externalUrl === "string" && prov.externalUrl.startsWith("http")
      ? prov.externalUrl
      : null);

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* Navigation Breadcrumb */}
      <div>
        <Link
          href={isPrivateDoc ? "/library" : "/papers"}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {isPrivateDoc ? "Back to My Library" : "Back to scholarly catalog"}
        </Link>
      </div>

      {/* Main Manuscript Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
        {/* Category Pills, Bibliometrics, and Human Status Badge */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {isPrivateDoc && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200">
                  <Lock className="h-3 w-3" />
                  <span>Private Document</span>
                </span>
              )}
              {isPreprint && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                  <span>Preprint (Submitted Version)</span>
                </span>
              )}
              {docType && (
                <Badge variant="secondary" className="text-xs">
                  {docType}
                </Badge>
              )}
              {paper.categories.map((pc) => (
                <Link key={pc.categoryId} href={`/categories/${pc.category.slug}`}>
                  <Badge variant="academic" className="hover:bg-indigo-100 transition-colors">
                    {pc.category.name}
                  </Badge>
                </Link>
              ))}
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusBadge.className}`}
                title={statusBadge.description}
              >
                {statusBadge.label}
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-500 font-medium">
              <span className="flex items-center gap-1 text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full font-bold">
                <Quote className="h-3 w-3" />
                {paper.citationCount.toLocaleString()} Citations
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-slate-400" />
                {paper.publicationDate ? formatDate(paper.publicationDate.toISOString()) : "—"}
              </span>
            </div>
          </div>

          {/* Manuscript Title */}
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-slate-900 leading-snug">
            {paper.title}
          </h1>

          {/* Journal & DOI metadata */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 pt-1">
            <span className="font-semibold text-slate-800 italic">
              {paper.journal || "Research Manuscript"}
            </span>
            {paper.doi && (
              <>
                <span className="text-slate-300">•</span>
                <span className="font-mono text-slate-500">DOI: {paper.doi}</span>
              </>
            )}
            {paper.arxivId && (
              <>
                <span className="text-slate-300">•</span>
                <span className="font-mono text-slate-500">arXiv: {paper.arxivId}</span>
              </>
            )}
            {paper.pmid && (
              <>
                <span className="text-slate-300">•</span>
                <span className="font-mono text-slate-500">PMID: {paper.pmid}</span>
              </>
            )}
            {paper.pmcid && (
              <>
                <span className="text-slate-300">•</span>
                <span className="font-mono text-slate-500">{paper.pmcid}</span>
              </>
            )}
          </div>
        </div>

        {/* Authors Section with Affiliations */}
        <div className="pt-4 border-t border-slate-100 space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Scholarly Authors &amp; Affiliations
          </h3>
          <div className="flex flex-wrap gap-2 pt-1">
            {paper.authors.map((pa) => (
              <Link
                key={pa.authorId}
                href={`/authors/${pa.authorId}`}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-200 transition-all text-xs group"
              >
                <div className="h-6 w-6 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-[10px] shrink-0">
                  {pa.author.name[0]}
                </div>
                <div>
                  <div className="font-semibold text-slate-900 group-hover:text-indigo-600">
                    {pa.author.name}
                    {pa.isCorresponding && (
                      <span className="ml-1 text-[10px] text-indigo-600 font-bold" title="Corresponding Author">
                        *
                      </span>
                    )}
                  </div>
                  {pa.author.institution && (
                    <div className="text-[10px] text-slate-500">{pa.author.institution}</div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            {localPdfAvailable && canDownloadPdf ? (
              <a href={`/api/papers/${paper.id}/pdf`} target="_blank" rel="noopener noreferrer">
                <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 gap-1.5 shadow-xs text-xs font-semibold">
                  <FileText className="h-3.5 w-3.5" />
                  View Original PDF
                </Button>
              </a>
            ) : externalPdfUrl && canDownloadPdf ? (
              <a href={externalPdfUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline" className="text-indigo-700 border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100 gap-1.5 shadow-xs text-xs font-semibold">
                  <ExternalLink className="h-3.5 w-3.5 text-indigo-600" />
                  External Full Text
                </Button>
              </a>
            ) : !isMetadataOnly && canDownloadPdf ? (
              <Button size="sm" variant="outline" disabled className="gap-1.5 text-xs text-slate-400 border-slate-200 bg-slate-50 cursor-not-allowed">
                <FileText className="h-3.5 w-3.5 text-slate-400" />
                PDF Unavailable
              </Button>
            ) : null}
            <SavePaperButton paperId={paper.id} initialSaved={isBookmarked} />
            <Link href="/tools/citation-generator">
              <Button size="sm" variant="outline" className="gap-1.5 text-xs text-slate-700">
                <Quote className="h-3.5 w-3.5" />
                Cite Paper
              </Button>
            </Link>
            {!isMetadataOnly ? (
              <a href="#ask-paper">
                <Button size="sm" variant="outline" className="gap-1.5 text-xs text-indigo-700 border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                  Ask This Paper
                </Button>
              </a>
            ) : (
              <span className="text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-medium">
                <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                <span>Full text needed for AI inquiry</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>Verifiable Grounding</span>
          </div>
        </div>
      </div>

      {/* METADATA_ONLY Guidance Banner (Section 7) */}
      {isMetadataOnly && (
        <Card className="rounded-2xl border border-amber-200 bg-amber-50/70 p-6 sm:p-7 space-y-4 shadow-2xs">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-amber-950">
                {isBookmarked
                  ? "Reference Saved in My Library — Full Text Needed for AI Analysis"
                  : "Bibliographic Reference — Full Text Needed for AI Analysis"}
              </h3>
              <p className="text-xs sm:text-sm text-amber-900 leading-relaxed">
                {paper.pdfUrl
                  ? "An open-access reading link is available for this manuscript, but direct server processing is restricted by publisher terms. You may open the external publication or upload a personal PDF copy."
                  : isBookmarked
                  ? "This paper is saved as a bibliographic reference in your research library. Grounded paragraph evidence, interactive RAG Q&A, and structured summaries require full-text ingestion."
                  : "This paper is cataloged as a bibliographic reference. Save it to your library or attach a manuscript PDF copy to enable grounded paragraph evidence, interactive RAG Q&A, and structured summaries."}
              </p>
              {isPreprint && (
                <p className="text-xs text-amber-800 font-medium">
                  Note: This manuscript is an author-submitted preprint and has not completed journal peer review.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-amber-200/60">
            <OpenAccessDiscoveryButton
              paperId={paper.id}
              hasDoi={Boolean(paper.doi)}
              doi={paper.doi}
              currentStatus={paper.status}
              externalPdfUrl={paper.pdfUrl}
            />

            <Link href={`/library?uploadPaperId=${paper.id}`}>
              <Button size="sm" variant="outline" className="border-amber-300 text-amber-900 bg-white hover:bg-amber-50 text-xs gap-1.5 shadow-2xs">
                <Upload className="h-3.5 w-3.5 text-amber-700" />
                <span>Upload PDF to My Library</span>
              </Button>
            </Link>

            <Link href="/tools/citation-generator">
              <Button size="sm" variant="outline" className="border-amber-300 text-amber-900 bg-white hover:bg-amber-50 text-xs gap-1.5 shadow-2xs">
                <Quote className="h-3.5 w-3.5 text-amber-700" />
                <span>Cite Paper</span>
              </Button>
            </Link>

            {session?.user?.role === "ADMIN" && (
              <Link href={`/admin/papers/${paper.id}/edit`}>
                <Button size="sm" className="bg-amber-800 hover:bg-amber-900 text-white text-xs gap-1.5 shadow-xs">
                  <Upload className="h-3.5 w-3.5" />
                  <span>Admin Edit / Upload</span>
                </Button>
              </Link>
            )}
          </div>
        </Card>
      )}

      {/* Abstract Section */}
      <Card className="bg-white p-6 sm:p-8 space-y-3">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-indigo-600" />
          Manuscript Abstract
        </h2>
        <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-normal whitespace-pre-line">
          {paper.abstract
            .replace(/^\[Development\s+(?:Summary|Overview|Benchmark Summary|Note|Takeaway)\]\s*/i, "")
            .replace(/^ABSTRACT\s*[:\-\s]*/i, "")
            .trim()}
        </p>
      </Card>

      {/* AI-Generated Scientific Summary (Phase 5: Grounded Evidence) */}
      {paper.aiSummary && canViewSummary && (
        <AISummaryView
          paperTitle={paper.title}
          summary={paper.aiSummary}
        />
      )}

      {/* Verbatim Extracted Manuscript Content (Golden Rule of Scientific Data) */}
      {(paper.researchQuestion || paper.methodology || paper.results || paper.limitations || paper.conclusion) && (
        <Card className="bg-white p-6 sm:p-8 space-y-6">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FileText className="h-4 w-4 text-indigo-600" />
              Verbatim Extracted Manuscript Sections
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Author&apos;s original findings extracted directly from the manuscript structure.
            </p>
          </div>

          <div className="space-y-6 text-xs sm:text-sm">
            {paper.researchQuestion && (
              <div className="space-y-1.5">
                <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider text-indigo-900">
                  Research Question &amp; Hypothesis
                </h4>
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-700 leading-relaxed">
                  {paper.researchQuestion}
                </div>
              </div>
            )}

            {paper.methodology && (
              <div className="space-y-1.5">
                <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider text-indigo-900">
                  Methodology &amp; Architecture
                </h4>
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-700 leading-relaxed">
                  {paper.methodology}
                </div>
              </div>
            )}

            {paper.results && (
              <div className="space-y-1.5">
                <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider text-indigo-900">
                  Empirical Results &amp; Benchmarks
                </h4>
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-700 leading-relaxed">
                  {paper.results}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {paper.limitations && (
                <div className="space-y-1.5">
                  <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider text-slate-600">
                    Stated Limitations
                  </h4>
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-600 leading-relaxed">
                    {paper.limitations}
                  </div>
                </div>
              )}

              {paper.conclusion && (
                <div className="space-y-1.5">
                  <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider text-slate-600">
                    Author Conclusion
                  </h4>
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-600 leading-relaxed">
                    {paper.conclusion}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Keywords Tag Cloud */}
      {paper.keywords && paper.keywords.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
            Index Keywords
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {paper.keywords.map((kw, i) => (
              <Link key={i} href={`/papers?q=${encodeURIComponent(kw)}`}>
                <Badge variant="secondary" className="hover:bg-slate-200 transition-colors text-xs">
                  #{kw}
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Ask This Paper (Phase 7: Single-Paper Grounded Research Q&A / RAG) */}
      {canInteractAI && (
        <section id="ask-paper" className="scroll-mt-8 pt-4">
          <PaperQA
            paperId={paper.id}
            paperTitle={paper.title}
            chunkCount={chunkCount}
            isEmbedded={isEmbedded}
            isAuthenticated={!!session?.user?.id}
            initialConversationId={searchParams?.conversationId}
          />
        </section>
      )}
    </div>
  );
}
