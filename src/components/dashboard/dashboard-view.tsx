"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FileText,
  Plus,
  Search,
  BookOpen,
  Quote,
  Clock,
  Compass,
  Layers,
  GraduationCap,
  Award,
  Scroll,
  ExternalLink,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Folder,
  Loader2,
  X,
  AlertCircle,
  FileUp,
} from "lucide-react";
import { DocumentType, PaperProcessingStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OnboardingChecklist } from "./onboarding-checklist";
import { useWorkspace } from "@/components/layout/workspace-context";

export interface DashboardDocumentItem {
  id: string;
  title: string;
  docType: DocumentType;
  version: number;
  textContent: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  _count: {
    citations: number;
    linkedPapers: number;
  };
}

export interface DashboardLibraryItem {
  id: string;
  title: string;
  abstract?: string;
  authors: string[];
  institution?: string | null;
  journal?: string | null;
  publicationDate?: string | null;
  isPrivate: boolean;
  documentType: string;
  status: PaperProcessingStatus;
  chunksCount: number;
  updatedAt?: Date | string;
}

export interface DashboardConversationItem {
  id: string;
  title: string;
  updatedAt: Date | string;
  paper?: {
    id: string;
    title: string;
    journal?: string | null;
  } | null;
  messages?: {
    content: string;
    role: string;
    createdAt: Date | string;
  }[];
}

interface DashboardViewProps {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    role?: string;
  };
  documents: DashboardDocumentItem[];
  totalDocuments: number;
  libraryItems: DashboardLibraryItem[];
  totalLibraryItems: number;
  collectionsCount: number;
  conversations: DashboardConversationItem[];
  totalConversations: number;
}

const DOC_TYPE_LABELS: Record<DocumentType, { label: string; icon: any; color: string; badgeColor: string }> = {
  MANUSCRIPT: {
    label: "Original Research (IMRaD)",
    icon: GraduationCap,
    color: "text-purple-700 bg-purple-50 border-purple-200",
    badgeColor: "bg-purple-100 text-purple-800 border-purple-200",
  },
  LITERATURE_REVIEW: {
    label: "PRISMA Systematic Review",
    icon: Scroll,
    color: "text-indigo-700 bg-indigo-50 border-indigo-200",
    badgeColor: "bg-indigo-100 text-indigo-800 border-indigo-200",
  },
  DRAFT: {
    label: "Doctoral Dissertation",
    icon: BookOpen,
    color: "text-emerald-700 bg-emerald-50 border-emerald-200",
    badgeColor: "bg-emerald-100 text-emerald-800 border-emerald-200",
  },
  PROPOSAL: {
    label: "Research / Grant Proposal",
    icon: Award,
    color: "text-amber-700 bg-amber-50 border-amber-200",
    badgeColor: "bg-amber-100 text-amber-800 border-amber-200",
  },
};

const formatRelativeTime = (dateInput: Date | string) => {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const countWords = (text: string | null) =>
  text?.trim() ? text.trim().split(/\s+/).length : 0;

export function DashboardView({
  user,
  documents,
  totalDocuments,
  libraryItems,
  totalLibraryItems,
  collectionsCount,
  conversations,
  totalConversations,
}: DashboardViewProps) {
  const router = useRouter();
  const { openNewDocumentModal } = useWorkspace();

  // Search input on dashboard
  const [searchQuery, setSearchQuery] = useState("");

  const handleOpenCreateModal = (preselectedType?: DocumentType) => {
    openNewDocumentModal(preselectedType);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/discover?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const isBrandNewUser = totalDocuments === 0 && totalLibraryItems === 0;

  return (
    <div className="space-y-8">
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & WORKSPACE BANNER                                          */}
      {/* ========================================================================= */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase font-bold tracking-wider text-indigo-600 bg-indigo-50 border border-indigo-200/80 px-2.5 py-0.5 rounded-full">
              Authenticated Workspace
            </span>
            <span className="text-xs text-slate-400 font-mono">
              User ID: {user.id.slice(0, 10)}...
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Research Workspace
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 max-w-2xl">
            Welcome back, <span className="font-semibold text-slate-800">{user.name || user.email}</span>. Manage your literature base, run evidence synthesis, and draft peer-reviewed manuscripts.
          </p>
        </div>

        {/* Global Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <Button
            type="button"
            onClick={() => handleOpenCreateModal()}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium gap-1.5 text-xs shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>New Manuscript</span>
          </Button>

          <Button
            asChild
            variant="outline"
            className="border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-medium gap-1.5"
          >
            <Link href="/library">
              <FileUp className="w-4 h-4 text-slate-500" />
              <span>Import Paper</span>
            </Link>
          </Button>

          <Button
            asChild
            variant="outline"
            className="border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-medium gap-1.5"
          >
            <Link href="/discover">
              <Compass className="w-4 h-4 text-indigo-600" />
              <span>Search Literature</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. RESEARCH KPI METRICS BAR                                               */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <Link
          href="/editor"
          className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-2xs hover:border-indigo-300 transition-all group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Active Manuscripts
            </span>
            <FileText className="w-4 h-4 text-indigo-500 group-hover:scale-110 transition-transform" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-900">{totalDocuments}</span>
            <span className="text-xs text-indigo-600 group-hover:underline">Open studio &rarr;</span>
          </div>
        </Link>

        <Link
          href="/library"
          className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-2xs hover:border-indigo-300 transition-all group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Library Sources
            </span>
            <BookOpen className="w-4 h-4 text-blue-500 group-hover:scale-110 transition-transform" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-900">{totalLibraryItems}</span>
            <span className="text-xs text-blue-600 group-hover:underline">View library &rarr;</span>
          </div>
        </Link>

        <Link
          href="/research"
          className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-2xs hover:border-indigo-300 transition-all group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Research Threads
            </span>
            <Layers className="w-4 h-4 text-purple-500 group-hover:scale-110 transition-transform" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-900">{totalConversations}</span>
            <span className="text-xs text-purple-600 group-hover:underline">Synthesize &rarr;</span>
          </div>
        </Link>

        <Link
          href="/library"
          className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-2xs hover:border-indigo-300 transition-all group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Collections
            </span>
            <Folder className="w-4 h-4 text-emerald-500 group-hover:scale-110 transition-transform" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-900">{collectionsCount}</span>
            <span className="text-xs text-emerald-600 group-hover:underline">Organize &rarr;</span>
          </div>
        </Link>
      </div>

      {/* ========================================================================= */}
      {/* 3. DISMISSIBLE ONBOARDING CHECKLIST                                       */}
      {/* ========================================================================= */}
      <OnboardingChecklist
        milestones={{
          hasAccount: true,
          hasPapers: totalLibraryItems > 0,
          hasAnalyzed: totalConversations > 0,
          hasDrafted: totalDocuments > 0,
        }}
        onStartDraft={() => handleOpenCreateModal()}
      />

      {/* ========================================================================= */}
      {/* 4. QUICK GLOBAL LITERATURE JUMP BAR                                       */}
      {/* ========================================================================= */}
      <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs">
        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search 300M+ global scholarly papers on PubMed, Crossref, and Semantic Scholar..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-slate-50/50"
            />
          </div>
          <Button
            type="submit"
            className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-5 shrink-0"
          >
            <span>Search Literature</span>
            <ArrowRight className="ml-1.5 w-3.5 h-3.5" />
          </Button>
        </form>
      </div>

      {/* ========================================================================= */}
      {/* 5. NEW RESEARCHER ONBOARDING EXPERIENCE (If 0 docs & 0 library items)     */}
      {/* ========================================================================= */}
      {isBrandNewUser && (
        <div className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-slate-900">
              Start Your Scientific Research Workflow
            </h2>
            <p className="text-xs text-slate-500">
              Follow these three fundamental pillars to initiate your research workspace.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Pillar 1: Discover */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs flex flex-col justify-between hover:border-indigo-300 transition-all">
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                  <Compass className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-900">1. Discover Papers</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Search over 300 million publications across PubMed and Crossref with smart deduplication and one-click library saving.
                  </p>
                </div>
              </div>
              <div className="pt-4 mt-2 border-t border-slate-100">
                <Button asChild size="sm" variant="outline" className="w-full text-xs font-medium justify-between">
                  <Link href="/discover">
                    <span>Search Literature</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </Button>
              </div>
            </div>

            {/* Pillar 2: Ingest */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs flex flex-col justify-between hover:border-indigo-300 transition-all">
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                  <BookOpen className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-900">2. Ingest Lab Literature</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Upload lab PDFs or paste DOIs. Text is extracted deterministically with page numbers and paragraph chunks for zero-hallucination grounding.
                  </p>
                </div>
              </div>
              <div className="pt-4 mt-2 border-t border-slate-100">
                <Button asChild size="sm" variant="outline" className="w-full text-xs font-medium justify-between">
                  <Link href="/library">
                    <span>Import to Library</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </Button>
              </div>
            </div>

            {/* Pillar 3: Draft */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs flex flex-col justify-between hover:border-indigo-300 transition-all">
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
                  <GraduationCap className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-900">3. Draft Manuscripts</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Use structured outlines (IMRaD, PRISMA, Dissertation) with ghost-text autocomplete and citations anchored to verified evidence chunks.
                  </p>
                </div>
              </div>
              <div className="pt-4 mt-2 border-t border-slate-100">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleOpenCreateModal()}
                  className="w-full text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white justify-between"
                >
                  <span>Start First Draft</span>
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. GUIDED STARTER TEMPLATES CHIPS                                         */}
      {/* ========================================================================= */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h2 className="text-xs sm:text-sm font-bold text-slate-900">
              Academic Manuscript Templates
            </h2>
            <p className="text-xs text-slate-500">
              Initialize a new structured manuscript with pre-registered section headings.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {Object.entries(DOC_TYPE_LABELS).map(([docTypeKey, meta]) => {
            const Icon = meta.icon;
            return (
              <button
                key={docTypeKey}
                type="button"
                onClick={() => handleOpenCreateModal(docTypeKey as DocumentType)}
                className="p-3 rounded-xl border border-slate-200/90 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all text-left flex items-start gap-2.5 group"
              >
                <div className={`p-2 rounded-lg border ${meta.color} shrink-0`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-xs font-bold text-slate-900 block truncate group-hover:text-indigo-600 transition-colors">
                    {meta.label}
                  </span>
                  <span className="text-[11px] text-slate-400 block mt-0.5">
                    Click to initialize outline &rarr;
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 7. RETURNING RESEARCHER: RECENT MANUSCRIPTS                               */}
      {/* ========================================================================= */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900">Recent Manuscripts</h2>
            <Badge variant="academic" className="text-xs">
              {totalDocuments}
            </Badge>
          </div>
          {totalDocuments > 0 && (
            <Link
              href="/editor"
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
            >
              <span>View all ({totalDocuments})</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>

        {documents.length === 0 ? (
          <div className="p-8 rounded-2xl border-2 border-dashed border-slate-200 text-center bg-slate-50/50 space-y-3">
            <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
              <FileText className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-900">No Manuscripts Created Yet</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Create a manuscript with guided academic sections, or start with a blank research canvas.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => handleOpenCreateModal()}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create First Manuscript</span>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {documents.map((doc) => {
              const meta = DOC_TYPE_LABELS[doc.docType] || DOC_TYPE_LABELS.DRAFT;
              const Icon = meta.icon;

              return (
                <div
                  key={doc.id}
                  className="p-4 rounded-xl bg-white border border-slate-200/90 hover:border-slate-300 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between group"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${meta.color}`}>
                        <Icon className="w-3 h-3" />
                        <span className="truncate max-w-[120px]">{meta.label}</span>
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-1 py-0.5 rounded border border-slate-200">
                        v{doc.version}
                      </span>
                    </div>

                    <Link
                      href={`/editor/${doc.id}`}
                      className="block group-hover:text-indigo-600 transition-colors"
                    >
                      <h3 className="text-xs sm:text-sm font-bold text-slate-900 line-clamp-2 leading-snug">
                        {doc.title}
                      </h3>
                    </Link>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span className="font-mono">{countWords(doc.textContent).toLocaleString()} words</span>
                      <span>•</span>
                      <span className="text-indigo-600 font-medium">{doc._count.linkedPapers} sources</span>
                      <span>•</span>
                      <span className="text-emerald-600 font-medium">{doc._count.citations} cites</span>
                    </div>
                  </div>

                  <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                    <div className="flex items-center gap-1 font-mono">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>{formatRelativeTime(doc.updatedAt)}</span>
                    </div>

                    <Link
                      href={`/editor/${doc.id}`}
                      className="font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                    >
                      <span>Open Studio</span>
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 8. LOWER DUAL-COLUMN: RECENT SOURCES & ACTIVE SYNTHESIS THREADS           */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (7 cols): Recent Library Sources & Telemetry */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Recent Library Sources</h2>
              <Badge variant="academic" className="text-xs">
                {totalLibraryItems}
              </Badge>
            </div>
            {totalLibraryItems > 0 && (
              <Link
                href="/library"
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
              >
                <span>Open Library ({totalLibraryItems})</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>

          {libraryItems.length === 0 ? (
            <div className="p-6 rounded-2xl border border-slate-200 bg-white text-center space-y-3">
              <BookOpen className="w-8 h-8 text-slate-300 mx-auto" />
              <div className="space-y-1">
                <h3 className="text-xs sm:text-sm font-semibold text-slate-800">
                  No Sources in Library Yet
                </h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Import papers via DOI, upload lab PDFs, or bookmark works from Discovery.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 pt-1">
                <Button asChild size="sm" variant="outline" className="text-xs font-medium">
                  <Link href="/library">Import by DOI</Link>
                </Button>
                <Button asChild size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium">
                  <Link href="/discover">Search Literature</Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200/90 divide-y divide-slate-100 shadow-2xs">
              {libraryItems.slice(0, 5).map((item) => (
                <div key={item.id} className="p-3.5 hover:bg-slate-50/60 transition-colors flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold text-slate-500 uppercase bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                        {item.documentType.replace(/_/g, " ")}
                      </span>
                      {item.status === "COMPLETED" ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          <span>Indexed ({item.chunksCount} chunks)</span>
                        </span>
                      ) : item.status === "PROCESSING" ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          <span>Processing</span>
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold text-slate-600 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                          {item.status}
                        </span>
                      )}
                    </div>

                    <Link
                      href={`/papers/${item.id}`}
                      className="block text-xs font-bold text-slate-900 hover:text-indigo-600 truncate transition-colors"
                    >
                      {item.title}
                    </Link>

                    <div className="text-[11px] text-slate-500 truncate">
                      {item.authors && item.authors.length > 0 ? item.authors.join(", ") : "Unknown authors"}
                      {item.journal ? ` · ${item.journal}` : ""}
                    </div>
                  </div>

                  <Link
                    href={`/papers/${item.id}`}
                    className="p-1 rounded text-slate-400 hover:text-indigo-600 shrink-0"
                    title="View Paper Details"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column (5 cols): Active Synthesis Threads */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Research Threads</h2>
              <Badge variant="academic" className="text-xs">
                {totalConversations}
              </Badge>
            </div>
            {totalConversations > 0 && (
              <Link
                href="/history"
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
              >
                <span>View all ({totalConversations})</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>

          {conversations.length === 0 ? (
            <div className="p-6 rounded-2xl border border-slate-200 bg-white text-center space-y-3">
              <Layers className="w-8 h-8 text-slate-300 mx-auto" />
              <div className="space-y-1">
                <h3 className="text-xs sm:text-sm font-semibold text-slate-800">
                  No Synthesis Conversations Yet
                </h3>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  Ask grounded questions across your library papers to compare findings and detect consensus.
                </p>
              </div>
              <Button asChild size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium">
                <Link href="/research">Start Research Chat</Link>
              </Button>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200/90 divide-y divide-slate-100 shadow-2xs">
              {conversations.slice(0, 4).map((conv) => (
                <Link
                  key={conv.id}
                  href={`/research?thread=${conv.id}`}
                  className="p-3.5 block hover:bg-slate-50/60 transition-colors group"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-bold text-slate-900 group-hover:text-indigo-600 truncate transition-colors">
                      {conv.title}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 shrink-0">
                      {formatRelativeTime(conv.updatedAt)}
                    </span>
                  </div>

                  {conv.paper && (
                    <div className="text-[11px] text-indigo-600 truncate mb-1">
                      Paper: {conv.paper.title}
                    </div>
                  )}

                  {conv.messages && conv.messages[0] && (
                    <p className="text-[11px] text-slate-500 line-clamp-1 italic">
                      "{conv.messages[0].content}"
                    </p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
