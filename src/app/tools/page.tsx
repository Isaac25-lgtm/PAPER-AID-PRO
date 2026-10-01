import type { Metadata } from "next";
import Link from "next/link";
import {
  BookOpen,
  ArrowRight,
  ShieldCheck,
  Bookmark,
  Layers,
  FileText,
  Clock,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/shared/section-header";

export const metadata: Metadata = {
  title: "Platform Capabilities & Roadmap",
  description: "Core research features and development roadmap for AI Research Hub.",
};

export default function ToolsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 sm:py-16 space-y-16">
      {/* Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200/80 bg-indigo-50/80 px-3.5 py-1 text-xs font-semibold text-indigo-700 shadow-xs">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Research Platform Overview</span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900 leading-tight">
          Core Capabilities &amp; Roadmap
        </h1>

        <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl mx-auto">
          AI Research Hub is built on scientific rigor. Rather than offering unverified chatbot tools,
          we focus on evidence-grounded literature discovery and verifiable manuscript understanding.
        </p>
      </div>

      {/* 1. Core Available Capabilities */}
      <section className="space-y-6">
        <SectionHeader
          badge="Live Now"
          title="Active Research Capabilities"
          description="Capabilities fully integrated with our database and document pipeline."
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="bg-white border-slate-200 shadow-xs hover:border-indigo-200 transition-all flex flex-col justify-between">
            <CardHeader className="p-6 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 font-bold">
                  <BookOpen className="h-5 w-5" />
                </div>
                <Badge variant="academic" className="text-[10px]">Active</Badge>
              </div>
              <h3 className="font-bold text-base text-slate-900 pt-2">Literature Discovery</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Search scientific papers and manuscripts by title, abstract, DOI, and keywords with disciplinary filtering.
              </p>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              <Button asChild variant="outline" size="sm" className="w-full text-xs font-semibold">
                <Link href="/papers">
                  Browse Papers
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-xs hover:border-indigo-200 transition-all flex flex-col justify-between">
            <CardHeader className="p-6 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 font-bold">
                  <FileText className="h-5 w-5" />
                </div>
                <Badge variant="academic" className="text-[10px]">Active</Badge>
              </div>
              <h3 className="font-bold text-base text-slate-900 pt-2">Original Manuscript PDFs</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Stream original PDFs inline and inspect structured sections (methodology, results, limitations).
              </p>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              <Button asChild variant="outline" size="sm" className="w-full text-xs font-semibold">
                <Link href="/papers">
                  View Manuscripts
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-xs hover:border-indigo-200 transition-all flex flex-col justify-between">
            <CardHeader className="p-6 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-50 text-purple-600 font-bold">
                  <Bookmark className="h-5 w-5" />
                </div>
                <Badge variant="academic" className="text-[10px]">Active</Badge>
              </div>
              <h3 className="font-bold text-base text-slate-900 pt-2">My Library &amp; Bookmarks</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Save papers from the catalog to your personal reading list for ongoing research and review.
              </p>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              <Button asChild variant="outline" size="sm" className="w-full text-xs font-semibold">
                <Link href="/saved">
                  Open My Library
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* 2. Platform Roadmap */}
      <section className="space-y-6">
        <SectionHeader
          badge="Roadmap"
          title="Upcoming Platform Capabilities"
          description="Features in active development for future engineering releases."
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-indigo-600" />
                <span className="font-bold text-sm text-slate-900">Phase 6: Embeddings &amp; Semantic Search</span>
              </div>
              <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                Upcoming
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              pgvector dense embeddings combined with full-text search for hybrid conceptual literature queries.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-indigo-600" />
                <span className="font-bold text-sm text-slate-900">Phase 7: Interactive PDF Evidence Chat</span>
              </div>
              <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                Upcoming
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Multi-turn conversational questioning against indexed manuscript chunks with exact citation anchors.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-indigo-600" />
                <span className="font-bold text-sm text-slate-900">Phase 8: Multi-Paper Systematic Synthesis</span>
              </div>
              <span className="text-[10px] font-bold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">
                Planned
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Synthesizing consensus and methodology comparisons across multiple papers simultaneously.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-indigo-600" />
                <span className="font-bold text-sm text-slate-900">Phase 9: Reference Manager Integrations</span>
              </div>
              <span className="text-[10px] font-bold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">
                Planned
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Exporting curated collections directly into Zotero, Mendeley, and BibTeX libraries.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <div className="text-center pt-4">
        <Button asChild className="bg-indigo-600 hover:bg-indigo-700 font-semibold text-xs sm:text-sm px-6">
          <Link href="/papers">
            Explore Research Papers
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
