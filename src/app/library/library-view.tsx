"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileText,
  Bookmark,
  Sparkles,
  Lock,
  Globe,
  Trash2,
  RefreshCw,
  Search,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Clock,
  Building2,
  Users,
  GraduationCap,
  X,
  FileUp,
  MessageSquare,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  UserLibraryItem,
  UserDocumentType,
} from "@/lib/library/user-library-service";
import {
  uploadUserDocumentAction,
  deleteLibraryItemAction,
  reprocessUserDocumentAction,
} from "./actions";

interface LibraryViewProps {
  initialItems: UserLibraryItem[];
  user: {
    id?: string;
    name?: string | null;
    email?: string | null;
    role?: string;
  };
}

export function LibraryView({ initialItems, user }: LibraryViewProps) {
  const router = useRouter();
  const [items, setItems] = React.useState<UserLibraryItem[]>(initialItems);
  const [activeTab, setActiveTab] = React.useState<"all" | "private" | "saved">("all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [isUploadOpen, setIsUploadOpen] = React.useState(false);
  const [isUploading, setIsUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = React.useState<string | null>(null);

  // Deletion state
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [itemToDelete, setItemToDelete] = React.useState<UserLibraryItem | null>(null);

  // Reprocessing state
  const [reprocessingId, setReprocessingId] = React.useState<string | null>(null);

  // File upload form state
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [docType, setDocType] = React.useState<UserDocumentType>("THESIS");
  const [title, setTitle] = React.useState("");
  const [authors, setAuthors] = React.useState("");
  const [institution, setInstitution] = React.useState("");
  const [researchCategory, setResearchCategory] = React.useState("");
  const [description, setDescription] = React.useState("");

  // Sync state if initialItems change (e.g. from server revalidation)
  React.useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  // Statistics
  const privateCount = items.filter((i) => i.isPrivate).length;
  const savedCount = items.filter((i) => !i.isPrivate).length;
  const readyCount = items.filter((i) => i.canChat).length;

  // Filtered items
  const filteredItems = items.filter((item) => {
    if (activeTab === "private" && !item.isPrivate) return false;
    if (activeTab === "saved" && item.isPrivate) return false;

    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase();
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchAbstract = item.abstract.toLowerCase().includes(q);
      const matchAuthors = item.authors.some((a) => a.toLowerCase().includes(q));
      const matchInst = item.institution?.toLowerCase().includes(q);
      const matchType = item.documentType.toLowerCase().includes(q);
      return matchTitle || matchAbstract || matchAuthors || matchInst || matchType;
    }

    return true;
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!title) {
        setTitle(file.name.replace(/\.pdf$/i, "").trim());
      }
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setUploadError("Please select a PDF file to upload.");
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    const formData = new FormData();
    formData.append("pdfFile", selectedFile);
    formData.append("title", title);
    formData.append("documentType", docType);
    formData.append("authors", authors);
    formData.append("institution", institution);
    formData.append("researchCategory", researchCategory);
    formData.append("description", description);

    try {
      const res = await uploadUserDocumentAction(formData);
      if (res.success) {
        setUploadSuccess("Manuscript successfully uploaded and processed!");
        // Reset form
        setSelectedFile(null);
        setTitle("");
        setAuthors("");
        setInstitution("");
        setResearchCategory("");
        setDescription("");
        setTimeout(() => {
          setIsUploadOpen(false);
          setUploadSuccess(null);
          router.refresh();
        }, 1200);
      } else {
        setUploadError(res.error || "Upload failed. Please try again.");
      }
    } catch (err: any) {
      setUploadError(err?.message || "An unexpected error occurred during upload.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteItem = async (item: UserLibraryItem) => {
    setDeletingId(item.id);
    try {
      const res = await deleteLibraryItemAction(item.id);
      if (res.success) {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
        setItemToDelete(null);
        router.refresh();
      } else {
        alert(res.error || "Failed to remove item.");
      }
    } catch (err: any) {
      alert(err?.message || "Error removing item.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleReprocess = async (paperId: string) => {
    setReprocessingId(paperId);
    try {
      const res = await reprocessUserDocumentAction(paperId);
      if (res.success) {
        router.refresh();
      } else {
        alert(res.error || "Reprocessing failed.");
      }
    } catch (err: any) {
      alert(err?.message || "Error reprocessing document.");
    } finally {
      setReprocessingId(null);
    }
  };

  const formatDocTypeLabel = (type: string) => {
    switch (type.toUpperCase()) {
      case "THESIS":
        return "Thesis / Dissertation";
      case "DISSERTATION":
        return "Dissertation";
      case "PROPOSAL":
        return "Research Proposal";
      case "DRAFT":
        return "Manuscript Draft";
      case "STUDENT_PAPER":
        return "Student Paper";
      case "JOURNAL_ARTICLE":
        return "Journal Article";
      case "PUBLISHED_PAPER":
        return "Scholarly Discovery";
      default:
        return "Manuscript";
    }
  };

  return (
    <div className="space-y-8">
      {/* Top Banner & Stats */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 sm:p-8 text-white shadow-lg relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-radial from-indigo-500/10 to-transparent pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
              <GraduationCap className="h-3.5 w-3.5" />
              <span>Personal Research Workspace</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              My Research Library
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Upload your private dissertations, theses, proposals, and manuscript drafts.
              Manage your personal literature and chat with your papers using verifiable citations.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={() => setIsUploadOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-md gap-2 h-10 px-4 text-xs sm:text-sm"
            >
              <FileUp className="h-4 w-4" />
              <span>Upload Private PDF</span>
            </Button>
          </div>
        </div>

        {/* Quick Metrics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-6 mt-6 border-t border-slate-800 text-xs">
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <div className="text-slate-400 font-medium">Total Items</div>
            <div className="text-xl font-bold text-white mt-0.5">{items.length}</div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <div className="text-indigo-300 font-medium flex items-center gap-1">
              <Lock className="h-3 w-3" />
              <span>Private Uploads</span>
            </div>
            <div className="text-xl font-bold text-white mt-0.5">{privateCount}</div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <div className="text-slate-300 font-medium flex items-center gap-1">
              <Globe className="h-3 w-3" />
              <span>Saved Scholarly</span>
            </div>
            <div className="text-xl font-bold text-white mt-0.5">{savedCount}</div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <div className="text-emerald-300 font-medium flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              <span>Ready for Chat</span>
            </div>
            <div className="text-xl font-bold text-white mt-0.5">{readyCount}</div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs & Search Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Tabs */}
        <div className="flex items-center p-1 bg-slate-100 rounded-xl text-xs font-semibold text-slate-600 self-start">
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={`px-3.5 py-1.5 rounded-lg transition-all ${
              activeTab === "all"
                ? "bg-white text-indigo-700 shadow-xs font-bold"
                : "hover:text-slate-900"
            }`}
          >
            All Items ({items.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("private")}
            className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === "private"
                ? "bg-white text-indigo-700 shadow-xs font-bold"
                : "hover:text-slate-900"
            }`}
          >
            <Lock className="h-3 w-3" />
            <span>My Uploads ({privateCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("saved")}
            className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === "saved"
                ? "bg-white text-indigo-700 shadow-xs font-bold"
                : "hover:text-slate-900"
            }`}
          >
            <Bookmark className="h-3 w-3" />
            <span>Saved Papers ({savedCount})</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <Input
            type="search"
            placeholder="Filter library..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-xs bg-white border-slate-200"
          />
        </div>
      </div>

      {/* Main Library List */}
      {filteredItems.length === 0 ? (
        <Card className="bg-white border-dashed border-2 border-slate-300 p-12 text-center space-y-4">
          <div className="mx-auto h-12 w-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
            {activeTab === "private" ? (
              <FileUp className="h-6 w-6" />
            ) : (
              <Bookmark className="h-6 w-6" />
            )}
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-base font-semibold text-slate-900">
              {searchQuery
                ? "No matching documents found"
                : activeTab === "private"
                ? "No Private Uploads Yet"
                : activeTab === "saved"
                ? "No Saved Papers Yet"
                : "Your Research Library is Empty"}
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
              {activeTab === "private"
                ? "Upload your theses, dissertations, research proposals, or draft manuscripts to analyze and chat with them privately."
                : "Explore our scholarly catalog of 300M+ research papers and save literature to your personal library."}
            </p>
          </div>
          <div className="pt-2 flex items-center justify-center gap-3">
            <Button
              size="sm"
              onClick={() => setIsUploadOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-xs gap-1.5"
            >
              <FileUp className="h-3.5 w-3.5" />
              <span>Upload PDF</span>
            </Button>
            <Link href="/discover">
              <Button size="sm" variant="outline" className="text-xs gap-1.5">
                <Globe className="h-3.5 w-3.5" />
                <span>Discover Papers</span>
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredItems.map((item) => (
            <Card
              key={item.id}
              className="flex flex-col justify-between hover:shadow-md hover:border-indigo-200 transition-all bg-white relative group"
            >
              <CardHeader className="p-5 pb-3 space-y-2">
                {/* Badges Header */}
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.isPrivate ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                        <Lock className="h-2.5 w-2.5" />
                        <span>Private</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                        <Globe className="h-2.5 w-2.5" />
                        <span>Public</span>
                      </span>
                    )}

                    <Badge variant="secondary" className="text-[10px] font-medium">
                      {formatDocTypeLabel(item.documentType)}
                    </Badge>
                  </div>

                  {/* Processing Status Badge */}
                  <div>
                    {item.status === "COMPLETED" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                        <span>Ready</span>
                      </span>
                    ) : item.status === "PROCESSING" || item.status === "EMBEDDING" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200 animate-pulse">
                        <RefreshCw className="h-3 w-3 animate-spin text-indigo-600" />
                        <span>Processing</span>
                      </span>
                    ) : item.status === "FAILED" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                        <AlertCircle className="h-3 w-3 text-rose-600" />
                        <span>Failed</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                        <Clock className="h-3 w-3 text-slate-500" />
                        <span>Uploaded</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Title */}
                <Link
                  href={`/papers/${item.id}`}
                  className="block hover:text-indigo-600 transition-colors pt-1"
                >
                  <h3 className="font-bold text-sm sm:text-base text-slate-900 leading-snug line-clamp-2">
                    {item.title}
                  </h3>
                </Link>

                {/* Authors & Institution */}
                <div className="space-y-1 text-xs text-slate-600 pt-0.5">
                  {item.authors.length > 0 && (
                    <div className="flex items-center gap-1.5 truncate">
                      <Users className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{item.authors.join(", ")}</span>
                    </div>
                  )}

                  {item.institution && (
                    <div className="flex items-center gap-1.5 text-slate-500 truncate">
                      <Building2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{item.institution}</span>
                    </div>
                  )}
                </div>
              </CardHeader>

              <CardContent className="p-5 pt-0 flex-1 flex flex-col justify-between">
                {/* Abstract Excerpt */}
                <p className="text-xs text-slate-600 leading-relaxed line-clamp-3 mb-4">
                  {item.abstract}
                </p>

                {/* Footer Toolbar */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                  {/* Left: Chat & PDF Actions */}
                  <div className="flex items-center gap-1.5">
                    {item.canChat ? (
                      <Link href={`/papers/${item.id}#ask-paper`}>
                        <Button
                          size="sm"
                          className="h-7 px-2.5 text-xs bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 border border-indigo-200 font-semibold gap-1"
                        >
                          <MessageSquare className="h-3 w-3 text-indigo-600" />
                          <span>Chat</span>
                        </Button>
                      </Link>
                    ) : item.status === "FAILED" && item.isPrivate ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleReprocess(item.id)}
                        disabled={reprocessingId === item.id}
                        className="h-7 px-2 text-xs text-amber-700 border-amber-300 hover:bg-amber-50 gap-1"
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${
                            reprocessingId === item.id ? "animate-spin" : ""
                          }`}
                        />
                        <span>Retry</span>
                      </Button>
                    ) : null}

                    {item.hasPdf && (
                      <a
                        href={`/api/papers/${item.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 h-7 px-2 text-xs text-slate-600 hover:text-indigo-600 hover:bg-slate-50 rounded-md border border-slate-200 transition-colors"
                        title="View Manuscript PDF"
                      >
                        <FileText className="h-3 w-3" />
                        <span>PDF</span>
                      </a>
                    )}
                  </div>

                  {/* Right: Open & Remove Actions */}
                  <div className="flex items-center gap-1">
                    <Link href={`/papers/${item.id}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-slate-500 hover:text-indigo-600"
                        title="View Paper Details"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </Link>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setItemToDelete(item)}
                      disabled={deletingId === item.id}
                      className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                      title={
                        item.isPrivate
                          ? "Delete private document from storage"
                          : "Remove from saved library"
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Upload Private Document Modal */}
      {isUploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-slate-200 p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <FileUp className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Upload Private Document
                  </h2>
                  <p className="text-xs text-slate-500">
                    Theses, dissertations, proposals, drafts, and research manuscripts
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsUploadOpen(false);
                  setUploadError(null);
                  setUploadSuccess(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {uploadError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{uploadError}</span>
              </div>
            )}

            {uploadSuccess && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>{uploadSuccess}</span>
              </div>
            )}

            <form onSubmit={handleUploadSubmit} className="space-y-4 text-xs">
              {/* File Dropzone */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  PDF Manuscript File <span className="text-rose-500">*</span>
                </label>
                <div className="border-2 border-dashed border-slate-300 hover:border-indigo-400 rounded-xl p-4 text-center cursor-pointer transition-colors bg-slate-50/50">
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={handleFileChange}
                    className="hidden"
                    id="modal-pdf-file"
                  />
                  <label htmlFor="modal-pdf-file" className="cursor-pointer block">
                    <Upload className="mx-auto h-7 w-7 text-indigo-500 mb-1.5" />
                    {selectedFile ? (
                      <div className="space-y-0.5">
                        <div className="font-semibold text-slate-900 truncate max-w-xs mx-auto">
                          {selectedFile.name}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className="font-semibold text-indigo-600 hover:underline">
                          Choose a PDF
                        </span>{" "}
                        <span className="text-slate-500">or drag and drop</span>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Maximum file size: 35 MB
                        </p>
                      </>
                    )}
                  </label>
                </div>
              </div>

              {/* Document Type Selector */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Document Type
                </label>
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value as UserDocumentType)}
                  className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                >
                  <option value="THESIS">Master's / Ph.D. Thesis</option>
                  <option value="DISSERTATION">Doctoral Dissertation</option>
                  <option value="PROPOSAL">Research Proposal / Grant</option>
                  <option value="DRAFT">Manuscript Draft</option>
                  <option value="STUDENT_PAPER">Student Research Paper</option>
                  <option value="JOURNAL_ARTICLE">Published Journal PDF</option>
                  <option value="MANUSCRIPT">Other Working Paper</option>
                </select>
              </div>

              {/* Title Input */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Title (Optional)
                </label>
                <Input
                  type="text"
                  placeholder="Defaults to filename if left empty"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              {/* Authors & Institution in 2 columns */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Authors (Optional)
                  </label>
                  <Input
                    type="text"
                    placeholder="e.g. Jane Doe, Dr. John Smith"
                    value={authors}
                    onChange={(e) => setAuthors(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Institution / University
                  </label>
                  <Input
                    type="text"
                    placeholder="e.g. Oxford, Stanford"
                    value={institution}
                    onChange={(e) => setInstitution(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
              </div>

              {/* Category / Discipline */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Research Discipline / Category
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Computer Science, Molecular Biology"
                  value={researchCategory}
                  onChange={(e) => setResearchCategory(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              {/* Description / Abstract */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Description / Abstract (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Brief synopsis of the document or thesis abstract..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>

              {/* Privacy Notice */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-[11px] flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  <span className="font-semibold text-slate-800">
                    Zero Public Exposure:
                  </span>{" "}
                  Your file is stored in encrypted private storage scoped to your account.
                  It will not be indexed into public discovery, nor accessible by other users.
                </p>
              </div>

              {/* Form Buttons */}
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsUploadOpen(false)}
                  disabled={isUploading}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isUploading || !selectedFile}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs gap-1.5"
                >
                  {isUploading ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>Uploading & Processing...</span>
                    </>
                  ) : (
                    <>
                      <FileUp className="h-3.5 w-3.5" />
                      <span>Upload & Process</span>
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {itemToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full border border-slate-200 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900">
                  {itemToDelete.isPrivate
                    ? "Delete Private Document?"
                    : "Remove From Saved Library?"}
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {itemToDelete.isPrivate
                    ? `Are you sure you want to permanently delete "${itemToDelete.title}"? The PDF file in storage, text chunks, and Q&A history will be deleted.`
                    : `Remove "${itemToDelete.title}" from your personal library? The public scholarly record and citations will remain intact.`}
                </p>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setItemToDelete(null)}
                disabled={Boolean(deletingId)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => handleDeleteItem(itemToDelete)}
                disabled={Boolean(deletingId)}
                className="bg-rose-600 hover:bg-rose-700 text-white text-xs gap-1.5"
              >
                {deletingId ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Removing...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>
                      {itemToDelete.isPrivate ? "Delete Document" : "Remove Bookmark"}
                    </span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
