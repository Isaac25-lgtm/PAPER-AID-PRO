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
  MoreVertical,
  Trash2,
  Edit2,
  ExternalLink,
  Sparkles,
  Layers,
  GraduationCap,
  Scroll,
  Loader2,
  X,
  AlertCircle,
  Compass,
  ArrowUp,
  ArrowDown,
  Check,
  Award,
} from "lucide-react";
import { DocumentType } from "@prisma/client";
import {
  createDocumentAction,
  renameDocumentAction,
  deleteDocumentAction,
} from "@/app/editor/actions";
import {
  STUDY_DESIGN_OPTIONS,
  getDefaultHeadings,
  getDefaultObjectives,
} from "@/lib/editor/guided-templates";

interface DocumentListItem {
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

interface DocumentsDashboardProps {
  initialDocuments: DocumentListItem[];
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
  };
}

const DOC_TYPE_LABELS: Record<DocumentType, { label: string; icon: any; color: string }> = {
  DRAFT: { label: "Draft", icon: FileText, color: "bg-slate-100 text-slate-700 border-slate-200" },
  MANUSCRIPT: { label: "Manuscript", icon: GraduationCap, color: "bg-purple-50 text-purple-700 border-purple-200" },
  PROPOSAL: { label: "Research Proposal", icon: Award, color: "bg-amber-50 text-amber-700 border-amber-200" },
  LITERATURE_REVIEW: { label: "Literature Review", icon: Scroll, color: "bg-indigo-50 text-indigo-700 border-indigo-200" },
};

const countWords = (text: string | null) =>
  text?.trim() ? text.trim().split(/\s+/).length : 0;

export function DocumentsDashboard({ initialDocuments, user }: DocumentsDashboardProps) {
  const router = useRouter();
  const [documents, setDocuments] = useState<DocumentListItem[]>(initialDocuments);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>("ALL");

  // New Document Dialog State
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [creationMode, setCreationMode] = useState<"BLANK" | "GUIDED">("BLANK");
  const [newTitle, setNewTitle] = useState("");
  const [newDocType, setNewDocType] = useState<DocumentType>(DocumentType.DRAFT);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Guided Document State
  const [guidedTopic, setGuidedTopic] = useState("");
  const [guidedDocType, setGuidedDocType] = useState<DocumentType>(DocumentType.MANUSCRIPT);
  const [guidedStudyDesign, setGuidedStudyDesign] = useState("");
  const [guidedGeneralObjective, setGuidedGeneralObjective] = useState("");
  const [guidedSpecificObjectives, setGuidedSpecificObjectives] = useState<string[]>([]);
  const [guidedHeadings, setGuidedHeadings] = useState<string[]>([]);
  const [isManualObjectives, setIsManualObjectives] = useState(false);
  const [isManualHeadings, setIsManualHeadings] = useState(false);

  // Initialize or update default outline & objectives
  React.useEffect(() => {
    if (!isManualHeadings) {
      setGuidedHeadings(getDefaultHeadings(guidedDocType, guidedStudyDesign));
    }
    if (!isManualObjectives) {
      const defObj = getDefaultObjectives(guidedTopic, guidedDocType, guidedStudyDesign);
      setGuidedGeneralObjective(defObj.general);
      setGuidedSpecificObjectives(defObj.specific);
    }
  }, [guidedDocType, guidedStudyDesign, guidedTopic, isManualHeadings, isManualObjectives]);

  // Outline section handlers
  const handleAddHeading = () => {
    setIsManualHeadings(true);
    setGuidedHeadings((prev) => [...prev, "New Section"]);
  };

  const handleUpdateHeading = (index: number, val: string) => {
    setIsManualHeadings(true);
    setGuidedHeadings((prev) => {
      const next = [...prev];
      next[index] = val;
      return next;
    });
  };

  const handleMoveHeading = (index: number, direction: -1 | 1) => {
    setIsManualHeadings(true);
    setGuidedHeadings((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      const temp = next[index];
      next[index] = next[target];
      next[target] = temp;
      return next;
    });
  };

  const handleDeleteHeading = (index: number) => {
    setIsManualHeadings(true);
    setGuidedHeadings((prev) => prev.filter((_, i) => i !== index));
  };

  // Specific objective handlers
  const handleAddSpecificObjective = () => {
    setIsManualObjectives(true);
    setGuidedSpecificObjectives((prev) => [...prev, ""]);
  };

  const handleUpdateSpecificObjective = (index: number, val: string) => {
    setIsManualObjectives(true);
    setGuidedSpecificObjectives((prev) => {
      const next = [...prev];
      next[index] = val;
      return next;
    });
  };

  const handleDeleteSpecificObjective = (index: number) => {
    setIsManualObjectives(true);
    setGuidedSpecificObjectives((prev) => prev.filter((_, i) => i !== index));
  };

  // Rename Dialog State
  const [renameTarget, setRenameTarget] = useState<DocumentListItem | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  // Delete Dialog State
  const [deleteTarget, setDeleteTarget] = useState<DocumentListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Menu dropdown state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Filter documents
  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch =
      doc.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType =
      selectedTypeFilter === "ALL" || doc.docType === selectedTypeFilter;
    return matchesSearch && matchesType;
  });

  const totalWords = documents.reduce((acc, doc) => acc + countWords(doc.textContent), 0);
  const totalCitations = documents.reduce((acc, doc) => acc + doc._count.citations, 0);
  const totalSources = documents.reduce((acc, doc) => acc + doc._count.linkedPapers, 0);

  // Handle Document Creation
  const handleCreateDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setCreateError(null);

    try {
      let res;
      if (creationMode === "BLANK") {
        res = await createDocumentAction({
          title: newTitle.trim() || undefined,
          docType: newDocType,
        });
      } else {
        if (!guidedTopic.trim()) {
          setCreateError("Please enter a research topic or title for your guided document.");
          setIsCreating(false);
          return;
        }

        res = await createDocumentAction({
          guidedConfig: {
            topic: guidedTopic.trim(),
            docType: guidedDocType,
            studyDesign: guidedStudyDesign.trim() || undefined,
            generalObjective: guidedGeneralObjective.trim() || undefined,
            specificObjectives: guidedSpecificObjectives.filter((o) => o.trim().length > 0),
            headings: guidedHeadings.filter((h) => h.trim().length > 0),
          },
        });
      }

      if (res.success && res.document) {
        setIsNewModalOpen(false);
        setNewTitle("");
        setGuidedTopic("");
        router.push(`/editor/${res.document.id}`);
      } else {
        setCreateError(res.error || "Failed to create document.");
      }
    } catch (err: any) {
      setCreateError(err.message || "Failed to create document.");
    } finally {
      setIsCreating(false);
    }
  };

  // Handle Rename
  const handleRenameDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !renameTitle.trim()) return;

    setIsRenaming(true);
    try {
      const res = await renameDocumentAction(renameTarget.id, renameTitle.trim());
      if (res.success && res.document) {
        setDocuments((prev) =>
          prev.map((d) => (d.id === renameTarget.id ? { ...d, title: res.document!.title } : d))
        );
        setRenameTarget(null);
      }
    } catch (err) {
      console.error("Rename failed:", err);
    } finally {
      setIsRenaming(false);
    }
  };

  // Handle Delete
  const handleDeleteDocument = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    try {
      const res = await deleteDocumentAction(deleteTarget.id);
      if (res.success) {
        setDocuments((prev) => prev.filter((d) => d.id !== deleteTarget.id));
        setDeleteTarget(null);
      }
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setIsDeleting(false);
    }
  };

  const formatRelativeTime = (dateInput: Date | string) => {
    const d = new Date(dateInput);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);

    if (diffSec < 60) return "Just now";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              AI Research Editor
            </h1>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              Jenni-Inspired Beta
            </span>
          </div>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Compose research papers with inline ghost-text autocomplete, verified literature citations, and private multi-model routing.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsNewModalOpen(true)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm transition-colors shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>New Document</span>
        </button>
      </div>

      {/* Aggregate Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium">Documents</span>
            <FileText className="w-4 h-4 text-slate-400" />
          </div>
          <p className="text-2xl font-bold text-slate-900">{documents.length}</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium">Total Words</span>
            <Scroll className="w-4 h-4 text-slate-400" />
          </div>
          <p className="text-2xl font-bold text-slate-900">{totalWords.toLocaleString()}</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium">Linked Sources</span>
            <BookOpen className="w-4 h-4 text-indigo-500" />
          </div>
          <p className="text-2xl font-bold text-indigo-900">{totalSources}</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium">Inserted Citations</span>
            <Quote className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-emerald-900">{totalCitations}</p>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search documents by title..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white shadow-2xs"
          />
        </div>

        {/* Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setSelectedTypeFilter("ALL")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap border ${
              selectedTypeFilter === "ALL"
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            All ({documents.length})
          </button>
          {Object.entries(DOC_TYPE_LABELS).map(([key, meta]) => {
            const count = documents.filter((d) => d.docType === key).length;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedTypeFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap border ${
                  selectedTypeFilter === key
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-2xs"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {meta.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Documents Grid / Empty State */}
      {filteredDocuments.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center bg-white/50">
          <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-4">
            <FileText className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 mb-1">
            {documents.length === 0 ? "No research documents yet" : "No matching documents found"}
          </h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
            {documents.length === 0
              ? "Create your first document to start drafting with inline AI autocomplete, verified literature citations, and private model routing."
              : "Try adjusting your search terms or filter selection to find your documents."}
          </p>
          {documents.length === 0 && (
            <button
              type="button"
              onClick={() => setIsNewModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm transition-colors shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Create First Document</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredDocuments.map((doc) => {
            const meta = DOC_TYPE_LABELS[doc.docType] || DOC_TYPE_LABELS.DRAFT;
            const Icon = meta.icon;

            return (
              <div
                key={doc.id}
                className="bg-white rounded-xl border border-slate-200/90 hover:border-slate-300 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between group relative"
              >
                <div className="p-5 flex-1">
                  {/* Card Top: Type Badge & Action Menu */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${meta.color}`}
                    >
                      <Icon className="w-3 h-3" />
                      <span>{meta.label}</span>
                    </span>

                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-mono text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                        v{doc.version}
                      </span>

                      {/* Dropdown Menu Trigger */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setOpenMenuId(openMenuId === doc.id ? null : doc.id)}
                          className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>

                        {openMenuId === doc.id && (
                          <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-20 animate-in fade-in zoom-in-95 duration-100">
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuId(null);
                                setRenameTarget(doc);
                                setRenameTitle(doc.title);
                              }}
                              className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                            >
                              <Edit2 className="w-3.5 h-3.5 text-slate-400" />
                              <span>Rename</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuId(null);
                                setDeleteTarget(doc);
                              }}
                              className="w-full text-left px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-2"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                              <span>Delete</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Document Title */}
                  <Link
                    href={`/editor/${doc.id}`}
                    className="block group-hover:text-indigo-600 transition-colors mb-3"
                  >
                    <h2 className="text-base font-semibold text-slate-900 line-clamp-2 leading-snug">
                      {doc.title}
                    </h2>
                  </Link>

                  {/* Document Metrics */}
                  <div className="flex items-center gap-3 text-xs text-slate-500 mb-4">
                    <span className="font-mono">{countWords(doc.textContent).toLocaleString()} words</span>
                    <span className="text-slate-300">•</span>
                    <span className="flex items-center gap-1 text-indigo-600 font-medium">
                      <BookOpen className="w-3 h-3" />
                      {doc._count.linkedPapers} sources
                    </span>
                    <span className="text-slate-300">•</span>
                    <span className="flex items-center gap-1 text-emerald-600 font-medium">
                      <Quote className="w-3 h-3" />
                      {doc._count.citations} cites
                    </span>
                  </div>
                </div>

                {/* Card Footer */}
                <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 rounded-b-xl flex items-center justify-between text-xs text-slate-400">
                  <div className="flex items-center gap-1 font-mono">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>{formatRelativeTime(doc.updatedAt)}</span>
                  </div>

                  <Link
                    href={`/editor/${doc.id}`}
                    className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
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

      {/* New Document Modal: Blank vs Guided Research Document */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            className={`bg-white rounded-2xl w-full p-6 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 transition-all ${
              creationMode === "GUIDED" ? "max-w-3xl max-h-[92vh] flex flex-col" : "max-w-md"
            }`}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3 flex-shrink-0">
              <div className="flex items-center gap-2">
                {creationMode === "GUIDED" ? (
                  <Compass className="w-5 h-5 text-indigo-600" />
                ) : (
                  <FileText className="w-5 h-5 text-indigo-600" />
                )}
                <h3 className="text-base font-semibold text-slate-900">
                  {creationMode === "GUIDED"
                    ? "Create Guided Research Document"
                    : "Create Blank Research Document"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsNewModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mode Switch Tabs */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl mb-4 flex-shrink-0 text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setCreationMode("BLANK");
                  setCreateError(null);
                }}
                className={`py-2 rounded-lg flex items-center justify-center gap-2 transition-all ${
                  creationMode === "BLANK"
                    ? "bg-white text-indigo-700 shadow-xs font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Blank Document</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCreationMode("GUIDED");
                  setCreateError(null);
                }}
                className={`py-2 rounded-lg flex items-center justify-center gap-2 transition-all ${
                  creationMode === "GUIDED"
                    ? "bg-white text-indigo-700 shadow-xs font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Compass className="w-3.5 h-3.5" />
                <span>Guided Research Document</span>
              </button>
            </div>

            {createError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2 flex-shrink-0">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{createError}</span>
              </div>
            )}

            <form onSubmit={handleCreateDocument} className="space-y-4 flex-1 overflow-y-auto pr-1">
              {creationMode === "BLANK" ? (
                /* Blank Document Form */
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Document Title (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Scalable Transformer Architectures: A Survey"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      autoFocus
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Document Type
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(DOC_TYPE_LABELS).map(([typeKey, meta]) => (
                        <button
                          key={typeKey}
                          type="button"
                          onClick={() => setNewDocType(typeKey as DocumentType)}
                          className={`p-2.5 rounded-lg border text-left transition-all flex items-center gap-2 ${
                            newDocType === typeKey
                              ? "border-indigo-600 bg-indigo-50/60 text-indigo-900 ring-1 ring-indigo-600"
                              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          <meta.icon className="w-4 h-4 text-slate-500" />
                          <span className="text-xs font-medium">{meta.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    Creates an empty TipTap canvas. Full formatting, passage-verified citations, autosave, and on-demand inline AI autocomplete (<kbd className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200 text-[10px]">Ctrl+J</kbd>) remain available.
                  </p>
                </>
              ) : (
                /* Guided Research Document Form */
                <div className="space-y-4">
                  {/* Topic & Document Type Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Research Topic or Working Title <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Evaluating Transformer Latency in Resource-Constrained Edge Devices"
                        value={guidedTopic}
                        onChange={(e) => setGuidedTopic(e.target.value)}
                        autoFocus
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Document Type
                      </label>
                      <select
                        value={guidedDocType}
                        onChange={(e) => {
                          const dt = e.target.value as DocumentType;
                          setGuidedDocType(dt);
                          setIsManualHeadings(false);
                          setIsManualObjectives(false);
                          setGuidedStudyDesign("");
                        }}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                      >
                        <option value="MANUSCRIPT">Original Research (Manuscript)</option>
                        <option value="PROPOSAL">Research Proposal (Grant/Protocol)</option>
                        <option value="LITERATURE_REVIEW">Literature Review</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Optional Study Design
                      </label>
                      <select
                        value={guidedStudyDesign}
                        onChange={(e) => setGuidedStudyDesign(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                      >
                        <option value="">None / Standard Protocol</option>
                        {(STUDY_DESIGN_OPTIONS[guidedDocType] || []).map((design) => (
                          <option key={design} value={design}>
                            {design}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Suggested Objectives */}
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                        <span className="text-xs font-bold text-indigo-950">
                          Suggested Research Objectives
                        </span>
                      </div>
                      <span className="text-[10px] text-indigo-600">Editable before creation</span>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Primary / General Objective
                      </label>
                      <input
                        type="text"
                        value={guidedGeneralObjective}
                        onChange={(e) => {
                          setIsManualObjectives(true);
                          setGuidedGeneralObjective(e.target.value);
                        }}
                        placeholder="e.g. To investigate and quantify..."
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[11px] font-semibold text-slate-700">
                          Specific Objectives ({guidedSpecificObjectives.length})
                        </label>
                        <button
                          type="button"
                          onClick={handleAddSpecificObjective}
                          className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium inline-flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Add Objective</span>
                        </button>
                      </div>

                      <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                        {guidedSpecificObjectives.map((obj, idx) => (
                          <div key={idx} className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono text-indigo-600 font-bold w-4 text-center">
                              {idx + 1}.
                            </span>
                            <input
                              type="text"
                              value={obj}
                              onChange={(e) => handleUpdateSpecificObjective(idx, e.target.value)}
                              placeholder={`Specific Objective ${idx + 1}...`}
                              className="flex-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                            <button
                              type="button"
                              onClick={() => handleDeleteSpecificObjective(idx)}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                              title="Delete objective"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Editable Outline Preview */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-slate-600" />
                        <span className="text-xs font-bold text-slate-800">
                          Editable Outline Preview ({guidedHeadings.length} Headings)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleAddHeading}
                        className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium inline-flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Add Section</span>
                      </button>
                    </div>

                    <p className="text-[11px] text-slate-500">
                      Sections to be generated in your TipTap document. Edit labels, reorder, or remove any heading:
                    </p>

                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {guidedHeadings.map((heading, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-1.5 p-1.5 bg-white border border-slate-200 rounded-lg shadow-2xs"
                        >
                          <span className="text-[10px] font-mono font-bold text-slate-400 w-5 text-center">
                            {idx + 1}.
                          </span>
                          <input
                            type="text"
                            value={heading}
                            onChange={(e) => handleUpdateHeading(idx, e.target.value)}
                            className="flex-1 px-2 py-0.5 text-xs text-slate-800 font-medium border-0 focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded"
                          />
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMoveHeading(idx, -1)}
                              className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 rounded"
                              title="Move up"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === guidedHeadings.length - 1}
                              onClick={() => handleMoveHeading(idx, 1)}
                              className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 rounded"
                              title="Move down"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteHeading(idx)}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                              title="Remove section"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2 flex-shrink-0 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsNewModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors shadow-xs disabled:opacity-50"
                >
                  {isCreating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>
                    {isCreating
                      ? "Creating..."
                      : creationMode === "GUIDED"
                      ? "Create Guided Document"
                      : "Create Blank Document"}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Document Modal */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-semibold text-slate-900 mb-3">Rename Document</h3>
            <form onSubmit={handleRenameDocument} className="space-y-4">
              <div>
                <input
                  type="text"
                  value={renameTitle}
                  onChange={(e) => setRenameTitle(e.target.value)}
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRenameTarget(null)}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRenaming || !renameTitle.trim()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors shadow-xs disabled:opacity-50"
                >
                  {isRenaming && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-semibold text-slate-900 mb-2">Delete Research Document?</h3>
            <p className="text-xs text-slate-500 mb-4">
              Are you sure you want to delete <span className="font-semibold text-slate-800">"{deleteTarget.title}"</span>? All draft contents and inserted citation links will be permanently deleted.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteDocument}
                disabled={isDeleting}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium transition-colors shadow-xs disabled:opacity-50"
              >
                {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
