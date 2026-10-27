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
  FolderPlus,
  Folder,
  Tag,
  BookOpen,
  FileCode,
  Check,
  Plus,
  Edit3,
  Filter,
  Quote,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  UserLibraryItem,
  UserDocumentType,
} from "@/lib/library/user-library-service";
import { UserCollection } from "@/lib/library/collections-service";
import { LookupPaperMetadata } from "@/lib/library/identifier-lookup-service";
import {
  ImportPreviewSummary,
  ReferencePreviewItem,
} from "@/lib/library/citation-import-service";
import { hasSubstantiveAbstract } from "@/lib/synthesis/types";
import {
  uploadUserDocumentAction,
  deleteLibraryItemAction,
  reprocessUserDocumentAction,
  getUserCollectionsAction,
  createCollectionAction,
  renameCollectionAction,
  deleteCollectionAction,
  addPaperToCollectionAction,
  removePaperFromCollectionAction,
  setPaperCollectionsAction,
  lookupIdentifierAction,
  importPaperByIdentifierAction,
  discoverPaperOpenAccessAction,
  previewReferenceImportAction,
  executeReferenceImportAction,
} from "./actions";
import { CitePaperModal } from "@/components/citations/cite-paper-modal";
import { BulkExportModal } from "@/components/citations/bulk-export-modal";
import { formatMetadataText } from "@/lib/utils";

interface LibraryViewProps {
  initialItems: UserLibraryItem[];
  initialCollections?: UserCollection[];
  user: {
    id?: string;
    name?: string | null;
    email?: string | null;
    role?: string;
  };
}

const PRESET_COLLECTION_COLORS = [
  "#4f46e5", // Indigo
  "#0ea5e9", // Sky
  "#059669", // Emerald
  "#d97706", // Amber
  "#7c3aed", // Violet
  "#e11d48", // Rose
];

export function LibraryView({
  initialItems,
  initialCollections = [],
  user,
}: LibraryViewProps) {
  const router = useRouter();
  const [items, setItems] = React.useState<UserLibraryItem[]>(initialItems);
  const [collections, setCollections] =
    React.useState<UserCollection[]>(initialCollections);
  const [activeTab, setActiveTab] = React.useState<"all" | "private" | "saved">(
    "all"
  );
  const [selectedCollection, setSelectedCollection] = React.useState<
    string | null
  >(null);
  const [searchQuery, setSearchQuery] = React.useState("");

  // Modals state
  const [isUploadOpen, setIsUploadOpen] = React.useState(false);
  const [isDoiModalOpen, setIsDoiModalOpen] = React.useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = React.useState(false);
  const [isNewCollectionOpen, setIsNewCollectionOpen] = React.useState(false);
  const [editingCollection, setEditingCollection] =
    React.useState<UserCollection | null>(null);
  const [managingCollectionsPaper, setManagingCollectionsPaper] =
    React.useState<UserLibraryItem | null>(null);

  // Upload state
  const [isUploading, setIsUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = React.useState<string | null>(null);
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [targetPaperId, setTargetPaperId] = React.useState<string | null>(null);
  const [docType, setDocType] = React.useState<UserDocumentType>("OTHER_DOCUMENT");
  const [title, setTitle] = React.useState("");
  const [authors, setAuthors] = React.useState("");
  const [institution, setInstitution] = React.useState("");
  const [researchCategory, setResearchCategory] = React.useState("");
  const [description, setDescription] = React.useState("");

  // DOI Lookup state
  const [doiInput, setDoiInput] = React.useState("");
  const [isLookingUpDoi, setIsLookingUpDoi] = React.useState(false);
  const [doiLookupResult, setDoiLookupResult] =
    React.useState<LookupPaperMetadata | null>(null);
  const [doiExistingPaperId, setDoiExistingPaperId] = React.useState<
    string | null
  >(null);
  const [doiLookupError, setDoiLookupError] = React.useState<string | null>(null);
  const [doiCollectionAssign, setDoiCollectionAssign] = React.useState("");
  const [isImportingDoi, setIsImportingDoi] = React.useState(false);
  const [doiImportSuccess, setDoiImportSuccess] = React.useState<string | null>(
    null
  );
  const [discoveringOaId, setDiscoveringOaId] = React.useState<string | null>(null);
  const [oaActionFeedback, setOaActionFeedback] = React.useState<{
    paperId: string;
    type: "success" | "error" | "info" | "warning";
    message: string;
  } | null>(null);

  // Dedicated Direct PDF Attachment Modal (zero redundant metadata entry)
  const [directAttachItem, setDirectAttachItem] =
    React.useState<UserLibraryItem | null>(null);
  const [directAttachFile, setDirectAttachFile] = React.useState<File | null>(
    null
  );
  const [isDirectAttaching, setIsDirectAttaching] = React.useState(false);
  const [directAttachError, setDirectAttachError] = React.useState<
    string | null
  >(null);

  const openDirectAttachModal = (item: UserLibraryItem) => {
    setDirectAttachItem(item);
    setDirectAttachFile(null);
    setDirectAttachError(null);
  };

  // BibTeX / RIS Import state
  const [importMode, setImportMode] = React.useState<"paste" | "file">("file");
  const [pastedContent, setPastedContent] = React.useState("");
  const [referenceFile, setReferenceFile] = React.useState<File | null>(null);
  const [isParsingReferences, setIsParsingReferences] = React.useState(false);
  const [previewSummary, setPreviewSummary] =
    React.useState<ImportPreviewSummary | null>(null);
  const [importCollectionAssign, setImportCollectionAssign] = React.useState("");
  const [importIncludeDuplicates, setImportIncludeDuplicates] =
    React.useState(true);
  const [isExecutingImport, setIsExecutingImport] = React.useState(false);
  const [importSuccessMsg, setImportSuccessMsg] = React.useState<string | null>(
    null
  );
  const [importError, setImportError] = React.useState<string | null>(null);

  // Collection form state
  const [newCollectionName, setNewCollectionName] = React.useState("");
  const [newCollectionDesc, setNewCollectionDesc] = React.useState("");
  const [newCollectionColor, setNewCollectionColor] = React.useState(
    PRESET_COLLECTION_COLORS[0]
  );
  const [collectionFormError, setCollectionFormError] = React.useState<
    string | null
  >(null);
  const [isSubmittingCollection, setIsSubmittingCollection] =
    React.useState(false);

  // Deletion state
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [itemToDelete, setItemToDelete] =
    React.useState<UserLibraryItem | null>(null);

  // Reprocessing state
  const [reprocessingId, setReprocessingId] = React.useState<string | null>(null);

  // Paper collection assignment state
  const [paperSelectedCols, setPaperSelectedCols] = React.useState<string[]>([]);
  const [isUpdatingPaperCols, setIsUpdatingPaperCols] = React.useState(false);

  // Multi-paper selection state for Phase 6 Multi-Paper Chat
  const [selectedPaperIds, setSelectedPaperIds] = React.useState<string[]>([]);

  // CSL Citation & Bulk Export state
  const [citingItem, setCitingItem] = React.useState<UserLibraryItem | null>(null);
  const [isExportingSelected, setIsExportingSelected] = React.useState(false);

  const togglePaperSelection = (id: string) => {
    setSelectedPaperIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const selectAllFiltered = () => {
    const allFilteredIds = filteredItems.map((i) => i.id);
    const allSelected = allFilteredIds.every((id) => selectedPaperIds.includes(id));
    if (allSelected) {
      setSelectedPaperIds((prev) => prev.filter((id) => !allFilteredIds.includes(id)));
    } else {
      setSelectedPaperIds((prev) => Array.from(new Set([...prev, ...allFilteredIds])));
    }
  };

  const clearSelection = () => setSelectedPaperIds([]);

  const handleStartMultiPaperChat = () => {
    if (selectedPaperIds.length === 0) return;
    router.push(`/research?papers=${encodeURIComponent(selectedPaperIds.join(","))}`);
  };

  // Sync state if initialItems change
  React.useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  React.useEffect(() => {
    setCollections(initialCollections);
  }, [initialCollections]);

  // Statistics
  const privateCount = items.filter((i) => i.isPrivate).length;
  const savedCount = items.filter((i) => !i.isPrivate).length;
  const readyCount = items.filter((i) => i.canChat).length;

  // Filtered items
  const filteredItems = items.filter((item) => {
    if (activeTab === "private" && !item.isPrivate) return false;
    if (activeTab === "saved" && item.isPrivate) return false;

    if (
      selectedCollection &&
      !item.collections.includes(selectedCollection)
    ) {
      return false;
    }

    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase();
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchAbstract = item.abstract.toLowerCase().includes(q);
      const matchAuthors = item.authors.some((a) => a.toLowerCase().includes(q));
      const matchInst = item.institution?.toLowerCase().includes(q);
      const matchType = item.documentType.toLowerCase().includes(q);
      const matchCol = item.collections.some((c) => c.toLowerCase().includes(q));
      return (
        matchTitle ||
        matchAbstract ||
        matchAuthors ||
        matchInst ||
        matchType ||
        matchCol
      );
    }

    return true;
  });

  // Handle PDF file upload selection
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
    if (targetPaperId) {
      formData.append("targetPaperId", targetPaperId);
    }
    formData.append("title", title);
    formData.append("documentType", docType);
    formData.append("authors", authors);
    formData.append("institution", institution);
    formData.append("researchCategory", researchCategory);
    formData.append("description", description);

    try {
      const res = await uploadUserDocumentAction(formData);
      if (res.success) {
        setUploadSuccess(
          targetPaperId
            ? "Full-text PDF successfully attached to saved reference!"
            : "Document successfully uploaded and processed!"
        );
        setSelectedFile(null);
        setTargetPaperId(null);
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
      setUploadError(
        err?.message || "An unexpected error occurred during upload."
      );
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

  // ============================================================================
  // COLLECTION ACTIONS
  // ============================================================================

  const handleCreateOrUpdateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollectionName.trim()) {
      setCollectionFormError("Please enter a collection name.");
      return;
    }

    setIsSubmittingCollection(true);
    setCollectionFormError(null);

    try {
      if (editingCollection) {
        const res = await renameCollectionAction(
          editingCollection.name,
          newCollectionName.trim()
        );
        if (!res.success) {
          setCollectionFormError(res.error || "Failed to rename collection.");
          return;
        }
        setCollections((prev) =>
          prev.map((c) =>
            c.id === editingCollection.id
              ? { ...c, name: newCollectionName.trim() }
              : c
          )
        );
        if (selectedCollection === editingCollection.name) {
          setSelectedCollection(newCollectionName.trim());
        }
        setItems((prev) =>
          prev.map((item) => ({
            ...item,
            collections: item.collections.map((c) =>
              c === editingCollection.name ? newCollectionName.trim() : c
            ),
          }))
        );
      } else {
        const res = await createCollectionAction(newCollectionName.trim(), {
          description: newCollectionDesc.trim() || undefined,
          color: newCollectionColor,
        });
        if (!res.success || !res.collection) {
          setCollectionFormError(res.error || "Failed to create collection.");
          return;
        }
        setCollections((prev) => [...prev, res.collection!]);
      }

      setIsNewCollectionOpen(false);
      setEditingCollection(null);
      setNewCollectionName("");
      setNewCollectionDesc("");
      router.refresh();
    } catch (err: any) {
      setCollectionFormError(err.message || "An error occurred.");
    } finally {
      setIsSubmittingCollection(false);
    }
  };

  const handleDeleteCollection = async (name: string) => {
    if (
      !confirm(
        `Are you sure you want to delete the collection "${name}"? Papers in this collection will NOT be deleted from your library.`
      )
    ) {
      return;
    }

    try {
      const res = await deleteCollectionAction(name);
      if (res.success) {
        setCollections((prev) => prev.filter((c) => c.name !== name));
        if (selectedCollection === name) {
          setSelectedCollection(null);
        }
        // Update local item collection tags
        setItems((prev) =>
          prev.map((item) => ({
            ...item,
            collections: item.collections.filter((c) => c !== name),
          }))
        );
        router.refresh();
      } else {
        alert(res.error || "Failed to delete collection.");
      }
    } catch (err: any) {
      alert(err.message || "Error deleting collection.");
    }
  };

  const handleRemoveFromCollection = async (
    paperId: string,
    collectionName: string
  ) => {
    try {
      const res = await removePaperFromCollectionAction(paperId, collectionName);
      if (res.success) {
        setItems((prev) =>
          prev.map((item) =>
            item.id === paperId
              ? {
                  ...item,
                  collections: item.collections.filter(
                    (c) => c !== collectionName
                  ),
                }
              : item
          )
        );
        setCollections((prev) =>
          prev.map((c) =>
            c.name === collectionName
              ? { ...c, paperCount: Math.max(0, c.paperCount - 1) }
              : c
          )
        );
        router.refresh();
      } else {
        alert(res.error || "Failed to remove paper from collection.");
      }
    } catch (err: any) {
      alert(err.message || "Error removing paper from collection.");
    }
  };

  const openManageCollectionsModal = (item: UserLibraryItem) => {
    setManagingCollectionsPaper(item);
    setPaperSelectedCols([...item.collections]);
  };

  const handleSavePaperCollections = async () => {
    if (!managingCollectionsPaper) return;
    setIsUpdatingPaperCols(true);
    try {
      const res = await setPaperCollectionsAction(
        managingCollectionsPaper.id,
        paperSelectedCols
      );
      if (res.success) {
        setItems((prev) =>
          prev.map((item) =>
            item.id === managingCollectionsPaper.id
              ? { ...item, collections: paperSelectedCols }
              : item
          )
        );
        setManagingCollectionsPaper(null);
        router.refresh();
      } else {
        alert(res.error || "Failed to update collections.");
      }
    } catch (err: any) {
      alert(err.message || "Error updating paper collections.");
    } finally {
      setIsUpdatingPaperCols(false);
    }
  };

  // ============================================================================
  // DOI / PMID LOOKUP ACTIONS
  // ============================================================================

  const handleDoiLookup = async () => {
    if (!doiInput.trim()) return;
    setIsLookingUpDoi(true);
    setDoiLookupError(null);
    setDoiLookupResult(null);
    setDoiExistingPaperId(null);

    try {
      const res = await lookupIdentifierAction(doiInput.trim());
      if (res.success && res.metadata) {
        setDoiLookupResult(res.metadata);
        setDoiExistingPaperId(res.existingPaperId || null);
      } else {
        setDoiLookupError(res.error || "Could not find paper metadata.");
      }
    } catch (err: any) {
      setDoiLookupError(err.message || "Lookup service error.");
    } finally {
      setIsLookingUpDoi(false);
    }
  };

  const handleDoiImportSubmit = async () => {
    if (!doiLookupResult) return;
    setIsImportingDoi(true);
    setDoiLookupError(null);

    try {
      const res = await importPaperByIdentifierAction(
        doiInput.trim(),
        doiCollectionAssign || undefined
      );
      if (res.success) {
        setDoiImportSuccess(res.message || "Paper added to your library.");
        setTimeout(() => {
          setIsDoiModalOpen(false);
          setDoiImportSuccess(null);
          setDoiLookupResult(null);
          setDoiInput("");
          router.refresh();
        }, 1200);
      } else {
        setDoiLookupError(res.error || "Failed to add paper to library.");
      }
    } catch (err: any) {
      setDoiLookupError(err.message || "Error importing paper.");
    } finally {
      setIsImportingDoi(false);
    }
  };

  const handleDiscoverOpenAccess = async (paperId: string) => {
    setDiscoveringOaId(paperId);
    setOaActionFeedback(null);

    try {
      const res = await discoverPaperOpenAccessAction(paperId);
      if (res.logicalState === "TEXT_EXTRACTED") {
        setOaActionFeedback({
          paperId,
          type: "success",
          message:
            res.message ||
            "Full text acquired and extracted! Structured evidence and citations are ready (semantic indexing pending).",
        });
        router.refresh();
      } else if (res.success && res.hasFullText) {
        setOaActionFeedback({
          paperId,
          type: "success",
          message:
            res.message ||
            "Ready for AI! Full-text acquired, verified, and semantically indexed.",
        });
        router.refresh();
      } else if (res.logicalState === "RESTRICTED" || res.status === "OPEN_ACCESS_EXTERNAL_LINK_ONLY") {
        setOaActionFeedback({
          paperId,
          type: "info",
          message:
            res.message ||
            "Full Text Restricted: Automatic acquisition is restricted by publisher license terms. External reading link provided. You can attach a personal copy using 'Upload My PDF'.",
        });
        router.refresh();
      } else if (res.error?.includes("OCR") || res.message?.includes("OCR")) {
        setOaActionFeedback({
          paperId,
          type: "warning",
          message:
            "OCR Required: Manuscript appears to be a scanned image without extractable text. Upload a digital text PDF.",
        });
        router.refresh();
      } else {
        setOaActionFeedback({
          paperId,
          type: "warning",
          message:
            res.message ||
            "No eligible open-access PDF located across academic providers. You can attach a personal copy using 'Upload My PDF'.",
        });
      }
    } catch (err: any) {
      setOaActionFeedback({
        paperId,
        type: "error",
        message: err.message || "Discovery service error.",
      });
    } finally {
      setDiscoveringOaId(null);
    }
  };

  const handleDirectAttachSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directAttachItem || !directAttachFile) {
      setDirectAttachError("Please select a PDF manuscript file to attach.");
      return;
    }

    setIsDirectAttaching(true);
    setDirectAttachError(null);

    try {
      const formData = new FormData();
      formData.append("pdfFile", directAttachFile);
      formData.append("file", directAttachFile);
      formData.append("targetPaperId", directAttachItem.id);
      formData.append("title", directAttachItem.title);
      if (directAttachItem.authors && directAttachItem.authors.length > 0) {
        formData.append("authors", directAttachItem.authors.join(", "));
      }
      if (directAttachItem.institution) {
        formData.append("institution", directAttachItem.institution);
      }
      if (directAttachItem.documentType) {
        formData.append("documentType", directAttachItem.documentType);
      }

      const res = await uploadUserDocumentAction(formData);
      if (res.success) {
        const attachedId = directAttachItem.id;
        setDirectAttachItem(null);
        setDirectAttachFile(null);
        setOaActionFeedback({
          paperId: attachedId,
          type: "success",
          message:
            "Authorized private copy attached successfully! Document indexed and ready for AI analysis.",
        });
        router.refresh();
      } else {
        setDirectAttachError(
          res.error || "Failed to attach PDF to this saved reference."
        );
      }
    } catch (err: any) {
      setDirectAttachError(err?.message || "Error attaching PDF.");
    } finally {
      setIsDirectAttaching(false);
    }
  };

  // ============================================================================
  // BIBTEX / RIS REFERENCE IMPORT ACTIONS
  // ============================================================================

  const handleReferenceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setReferenceFile(file);
    }
  };

  const handlePreviewReferences = async () => {
    let contentToPreview = "";

    if (importMode === "file") {
      if (!referenceFile) {
        setImportError("Please select a .bib or .ris file.");
        return;
      }
      contentToPreview = await referenceFile.text();
    } else {
      if (!pastedContent.trim()) {
        setImportError("Please paste BibTeX or RIS reference text.");
        return;
      }
      contentToPreview = pastedContent.trim();
    }

    setIsParsingReferences(true);
    setImportError(null);
    setPreviewSummary(null);

    try {
      const res = await previewReferenceImportAction(contentToPreview);
      if (res.success && res.summary) {
        if (res.summary.totalFound === 0) {
          setImportError(
            "No recognized BibTeX or RIS entries found in input. Please check the file formatting."
          );
        } else {
          setPreviewSummary(res.summary);
        }
      } else {
        setImportError(res.error || "Failed to parse references.");
      }
    } catch (err: any) {
      setImportError(err.message || "Error parsing references.");
    } finally {
      setIsParsingReferences(false);
    }
  };

  const handleExecuteImport = async () => {
    if (!previewSummary || previewSummary.items.length === 0) return;
    setIsExecutingImport(true);
    setImportError(null);

    try {
      const res = await executeReferenceImportAction({
        items: previewSummary.items,
        collectionName: importCollectionAssign || undefined,
        importDuplicates: importIncludeDuplicates,
      });

      if (res.success) {
        setImportSuccessMsg(
          `Successfully imported ${res.importedCount} references into your library!` +
            (res.skippedCount && res.skippedCount > 0
              ? ` (${res.skippedCount} skipped)`
              : "")
        );
        setTimeout(() => {
          setIsImportModalOpen(false);
          setPreviewSummary(null);
          setPastedContent("");
          setReferenceFile(null);
          setImportSuccessMsg(null);
          router.refresh();
        }, 1500);
      } else {
        setImportError(res.error || "Failed to complete reference import.");
      }
    } catch (err: any) {
      setImportError(err.message || "Error executing import.");
    } finally {
      setIsExecutingImport(false);
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
      case "METADATA_ONLY":
        return "Catalog Reference";
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
              Upload private dissertations, organize papers into collections,
              import references via BibTeX/RIS, and look up scholarly papers by
              DOI or PMID.
            </p>
          </div>

          {/* Action Buttons Group */}
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              onClick={() => setIsUploadOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-md gap-2 h-10 px-4 text-xs sm:text-sm"
            >
              <FileUp className="h-4 w-4" />
              <span>Upload PDF</span>
            </Button>

            <Button
              onClick={() => {
                setIsDoiModalOpen(true);
                setDoiLookupResult(null);
                setDoiLookupError(null);
                setDoiInput("");
              }}
              variant="outline"
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 font-semibold gap-1.5 h-10 px-3.5 text-xs sm:text-sm"
            >
              <BookOpen className="h-4 w-4" />
              <span>Add by DOI / PMID</span>
            </Button>

            <Button
              onClick={() => {
                setIsImportModalOpen(true);
                setPreviewSummary(null);
                setImportError(null);
              }}
              variant="outline"
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 font-semibold gap-1.5 h-10 px-3.5 text-xs sm:text-sm"
            >
              <FileCode className="h-4 w-4" />
              <span>Import BibTeX / RIS</span>
            </Button>
          </div>
        </div>

        {/* Quick Metrics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-6 mt-6 border-t border-slate-800 text-xs">
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <div className="text-slate-400 font-medium">Total Items</div>
            <div className="text-xl font-bold text-white mt-0.5">
              {items.length}
            </div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <div className="text-indigo-300 font-medium flex items-center gap-1">
              <Folder className="h-3 w-3" />
              <span>Collections</span>
            </div>
            <div className="text-xl font-bold text-white mt-0.5">
              {collections.length}
            </div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <div className="text-purple-300 font-medium flex items-center gap-1">
              <Lock className="h-3 w-3" />
              <span>Private Uploads</span>
            </div>
            <div className="text-xl font-bold text-white mt-0.5">
              {privateCount}
            </div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <div className="text-emerald-300 font-medium flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              <span>Ready for Chat</span>
            </div>
            <div className="text-xl font-bold text-white mt-0.5">
              {readyCount}
            </div>
          </div>
        </div>
      </div>

      {/* Collections Filter Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <Folder className="h-4 w-4 text-indigo-600" />
            <span>Personal Collections</span>
            <span className="text-slate-400 font-normal">
              ({collections.length})
            </span>
          </div>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditingCollection(null);
              setNewCollectionName("");
              setNewCollectionDesc("");
              setNewCollectionColor(PRESET_COLLECTION_COLORS[0]);
              setCollectionFormError(null);
              setIsNewCollectionOpen(true);
            }}
            className="h-8 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 font-semibold gap-1"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span>New Collection</span>
          </Button>
        </div>

        {/* Collection Pills Carousel / List */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => setSelectedCollection(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              selectedCollection === null
                ? "bg-slate-900 text-white shadow-xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <span>All Items</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                selectedCollection === null
                  ? "bg-slate-800 text-slate-300"
                  : "bg-slate-200 text-slate-600"
              }`}
            >
              {items.length}
            </span>
          </button>

          {collections.map((col) => {
            const isSelected = selectedCollection === col.name;
            return (
              <div key={col.id} className="relative group inline-flex items-center">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedCollection(isSelected ? null : col.name)
                  }
                  className={`pl-3 pr-2 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
                    isSelected
                      ? "bg-indigo-600 text-white shadow-xs"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: col.color }}
                  />
                  <span>{col.name}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                      isSelected
                        ? "bg-indigo-700 text-indigo-100"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {col.paperCount}
                  </span>
                </button>

                {/* Edit / Delete quick buttons */}
                <div className="hidden group-hover:flex items-center ml-1 bg-white border border-slate-200 rounded-md shadow-xs p-0.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingCollection(col);
                      setNewCollectionName(col.name);
                      setNewCollectionDesc(col.description || "");
                      setNewCollectionColor(col.color);
                      setCollectionFormError(null);
                      setIsNewCollectionOpen(true);
                    }}
                    className="p-1 text-slate-400 hover:text-indigo-600 rounded-sm"
                    title="Rename Collection"
                  >
                    <Edit3 className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteCollection(col.name);
                    }}
                    className="p-1 text-slate-400 hover:text-rose-600 rounded-sm"
                    title="Delete Collection"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}
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
            placeholder="Filter library or collections..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-xs bg-white border-slate-200"
          />
        </div>
      </div>

      {/* Active Collection Filter Bar indicator */}
      {selectedCollection && (
        <div className="flex items-center justify-between p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 text-xs">
          <div className="flex items-center gap-2">
            <Folder className="h-4 w-4 text-indigo-600" />
            <span className="text-slate-600">Filtering by collection:</span>
            <span className="font-bold text-indigo-900">
              {selectedCollection}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSelectedCollection(null)}
            className="text-indigo-600 hover:text-indigo-800 font-semibold underline"
          >
            Show All Papers
          </button>
        </div>
      )}

      {/* Phase 6 Multi-Paper Selection Banner */}
      {selectedPaperIds.length > 0 && (
        <div className="sticky top-20 z-30 p-4 bg-indigo-900 text-white rounded-xl shadow-xl flex flex-wrap items-center justify-between gap-4 border border-indigo-700 animate-in fade-in slide-in-from-top duration-200">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold text-sm">
              {selectedPaperIds.length}
            </span>
            <div>
              <p className="text-sm font-bold text-white">
                {selectedPaperIds.length === 1 ? "1 Paper Selected" : `${selectedPaperIds.length} Papers Selected for Research Chat`}
              </p>
              <p className="text-xs text-indigo-200">
                Ask cross-document comparative questions, contrast sample sizes, methodologies, and findings.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsExportingSelected(true)}
              className="bg-indigo-800 text-white hover:bg-indigo-700 border-indigo-600 text-xs gap-1.5 shadow-xs"
              title="Export selected references to BibTeX, RIS, or formatted CSL bibliography"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export References</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={clearSelection}
              className="bg-transparent text-indigo-200 hover:text-white hover:bg-indigo-800 border-indigo-700 text-xs"
            >
              Clear Selection
            </Button>
            <Button
              size="sm"
              onClick={handleStartMultiPaperChat}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow-sm"
            >
              <MessageSquare className="h-4 w-4" />
              <span>Chat with Selected Papers</span>
            </Button>
          </div>
        </div>
      )}

      {/* Select All Quick Bar */}
      {filteredItems.length > 0 && (
        <div className="flex items-center justify-between px-1 text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={
                  filteredItems.length > 0 &&
                  filteredItems.every((i) => selectedPaperIds.includes(i.id))
                }
                onChange={selectAllFiltered}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              />
              <span className="font-medium text-slate-700">Select All Filtered ({filteredItems.length})</span>
            </label>
            {selectedPaperIds.length > 0 && (
              <span className="text-indigo-600 font-semibold">
                ({selectedPaperIds.length} currently selected)
              </span>
            )}
          </div>
          {selectedPaperIds.length > 0 && (
            <Button
              size="sm"
              onClick={handleStartMultiPaperChat}
              className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold gap-1.5"
            >
              <MessageSquare className="h-3 w-3" />
              <span>Chat with {selectedPaperIds.length} Selected</span>
            </Button>
          )}
        </div>
      )}

      {/* Main Library List */}
      {filteredItems.length === 0 ? (
        <Card className="bg-white border-dashed border-2 border-slate-300 p-12 text-center space-y-4">
          <div className="mx-auto h-12 w-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
            {activeTab === "private" ? (
              <FileUp className="h-6 w-6" />
            ) : selectedCollection ? (
              <Folder className="h-6 w-6" />
            ) : (
              <Bookmark className="h-6 w-6" />
            )}
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-base font-semibold text-slate-900">
              {searchQuery
                ? "No matching documents found"
                : selectedCollection
                ? `No papers in collection "${selectedCollection}"`
                : activeTab === "private"
                ? "No Private Uploads Yet"
                : activeTab === "saved"
                ? "No Saved Papers Yet"
                : "Your Research Library is Empty"}
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
              {selectedCollection
                ? "You can add papers to this collection by clicking the collection tag on any paper card."
                : activeTab === "private"
                ? "Upload your theses, dissertations, research proposals, or draft manuscripts to analyze and chat with them privately."
                : "Add papers by DOI or PMID, import BibTeX/RIS references, or upload your own research PDFs."}
            </p>
          </div>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <Button
              size="sm"
              onClick={() => setIsUploadOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-xs gap-1.5"
            >
              <FileUp className="h-3.5 w-3.5" />
              <span>Upload PDF</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsDoiModalOpen(true)}
              className="text-xs gap-1.5"
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>Add by DOI</span>
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
              className={`flex flex-col justify-between hover:shadow-md transition-all bg-white relative group ${
                selectedPaperIds.includes(item.id)
                  ? "border-indigo-500 ring-2 ring-indigo-200 shadow-sm"
                  : "hover:border-indigo-200"
              }`}
            >
              <CardHeader className="p-5 pb-3 space-y-2">
                {/* Multi-Paper Selection Checkbox Header */}
                <div className="flex items-center justify-between pb-2 mb-1 border-b border-slate-100">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={selectedPaperIds.includes(item.id)}
                      onChange={() => togglePaperSelection(item.id)}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span
                      className={`text-xs font-semibold ${
                        selectedPaperIds.includes(item.id)
                          ? "text-indigo-700 font-bold"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {selectedPaperIds.includes(item.id)
                        ? "Selected for Chat"
                        : "Select for Chat"}
                    </span>
                  </label>
                  {selectedPaperIds.includes(item.id) ? (
                    <Badge className="bg-indigo-600 text-white text-[10px] font-bold">
                      In Context
                    </Badge>
                  ) : item.status === "METADATA_ONLY" || item.chunkCount === 0 ? (
                    <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                      Metadata Only
                    </span>
                  ) : null}
                </div>

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

                    <Badge
                      variant="secondary"
                      className="text-[10px] font-medium"
                    >
                      {formatDocTypeLabel(item.documentType)}
                    </Badge>

                    {item.isPreprint && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                        Preprint
                      </span>
                    )}

                    {item.isOpenAccess && item.pdfUrl && !item.storagePath && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200">
                        <Globe className="h-2.5 w-2.5" />
                        <span>External OA</span>
                      </span>
                    )}
                  </div>

                  {/* Processing Status Badge */}
                  <div>
                    {discoveringOaId === item.id ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200 animate-pulse">
                        <RefreshCw className="h-3 w-3 animate-spin text-indigo-600" />
                        <span>Preparing & Analyzing Document...</span>
                      </span>
                    ) : item.status === "COMPLETED" && item.chunkCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                        <span>Ready for AI Analysis</span>
                      </span>
                    ) : item.status === "TEXT_EXTRACTED" && item.chunkCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
                        <CheckCircle2 className="h-3 w-3 text-indigo-600" />
                        <span>Full Text Extracted</span>
                      </span>
                    ) : item.status === "PROCESSING" ||
                      item.status === "EMBEDDING" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200 animate-pulse">
                        <RefreshCw className="h-3 w-3 animate-spin text-blue-600" />
                        <span>Processing Full Text</span>
                      </span>
                    ) : item.status === "FAILED" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                        <AlertCircle className="h-3 w-3 text-rose-600" />
                        <span>Import Failed</span>
                      </span>
                    ) : item.status === "METADATA_ONLY" ? (
                      hasSubstantiveAbstract(item.abstract) ? (
                        <span
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-800 bg-sky-50 px-2 py-0.5 rounded-full border border-sky-200"
                          title="Published abstract available for AI research synthesis. Original PDF full-text has not been ingested."
                        >
                          <FileText className="h-3 w-3 text-sky-600" />
                          <span>Abstract Saved — Full Text Needed</span>
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200"
                          title="Bibliographic metadata and title only. No abstract or full-text manuscript available."
                        >
                          <AlertCircle className="h-3 w-3 text-amber-600" />
                          <span>Metadata Only — Full Text Needed</span>
                        </span>
                      )
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
                      <span className="truncate">
                        {item.authors.join(", ")}
                      </span>
                    </div>
                  )}

                  {item.institution && (
                    <div className="flex items-center gap-1.5 text-slate-500 truncate">
                      <Building2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{item.institution}</span>
                    </div>
                  )}
                </div>

                {/* Assigned Collections Pills */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {item.collections.map((colName) => (
                    <span
                      key={colName}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200"
                    >
                      <Folder className="h-2.5 w-2.5" />
                      <span>{colName}</span>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => openManageCollectionsModal(item)}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold text-slate-500 hover:text-indigo-600 hover:bg-slate-100 border border-dashed border-slate-300 transition-colors"
                    title="Manage Collections for this paper"
                  >
                    <Plus className="h-2.5 w-2.5" />
                    <span>Collection</span>
                  </button>
                </div>
              </CardHeader>

              <CardContent className="p-5 pt-0 flex-1 flex flex-col justify-between">
                {/* Abstract Excerpt */}
                <p className="text-xs text-slate-600 leading-relaxed line-clamp-3 mb-3">
                  {item.abstract}
                </p>

                {/* Open Access & Attachment Status Feedback */}
                {oaActionFeedback?.paperId === item.id && (
                  <div
                    className={`p-2.5 rounded-lg text-xs mb-3 flex flex-col gap-1.5 ${
                      oaActionFeedback.type === "success"
                        ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                        : oaActionFeedback.type === "info"
                        ? "bg-sky-50 border border-sky-200 text-sky-800"
                        : oaActionFeedback.type === "warning"
                        ? "bg-amber-50 border border-amber-200 text-amber-900"
                        : "bg-rose-50 border border-rose-200 text-rose-800"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="flex items-start gap-1.5">
                        {oaActionFeedback.type === "success" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                        )}
                        <span className="leading-snug">{oaActionFeedback.message}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOaActionFeedback(null)}
                        className="text-slate-400 hover:text-slate-600 text-xs px-1"
                        title="Dismiss"
                      >
                        ×
                      </button>
                    </div>

                    {/* Fallback actions when automatic full-text is restricted or unavailable */}
                    {oaActionFeedback.type !== "success" && (
                      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200/60 mt-0.5">
                        {item.pdfUrl && (
                          <a
                            href={item.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            <span>External Full Text</span>
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => openDirectAttachModal(item)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-800 hover:text-indigo-700 bg-white px-2 py-0.5 rounded border border-slate-300 hover:border-indigo-300 shadow-2xs"
                        >
                          <FileUp className="h-3 w-3 text-indigo-600" />
                          <span>Upload My PDF</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Footer Toolbar */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                  {/* Left: Chat & PDF Actions */}
                  <div className="flex flex-wrap items-center gap-1.5">
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
                    ) : item.status === "METADATA_ONLY" ? (
                      <>
                        {/* Primary: Analyze Paper */}
                        <Button
                          size="sm"
                          type="button"
                          onClick={() => handleDiscoverOpenAccess(item.id)}
                          disabled={discoveringOaId === item.id}
                          className="h-7 px-2.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold gap-1 shadow-2xs"
                          title="Invoke authorized, license-checked acquisition workflow to find, process, and index full text"
                        >
                          {discoveringOaId === item.id ? (
                            <RefreshCw className="h-3 w-3 animate-spin text-white" />
                          ) : (
                            <Sparkles className="h-3 w-3 text-white" />
                          )}
                          <span>{discoveringOaId === item.id ? "Analyzing..." : "Analyze Paper"}</span>
                        </Button>

                        {/* Secondary: Upload My PDF */}
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          onClick={() => openDirectAttachModal(item)}
                          className="h-7 px-2 text-xs text-slate-700 hover:text-indigo-700 hover:bg-indigo-50/50 border-slate-300 gap-1 font-medium"
                          title="Attach an authorized user-owned private PDF without entering metadata"
                        >
                          <FileUp className="h-3 w-3 text-indigo-600" />
                          <span>Upload My PDF</span>
                        </Button>

                        {/* External Full Text Link (when known) */}
                        {item.pdfUrl && (
                          <a
                            href={item.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 h-7 px-2 text-xs text-slate-600 hover:text-indigo-600 hover:bg-slate-50 rounded-md border border-slate-200 transition-colors font-medium"
                            title="Open external publisher or repository full text in new tab"
                          >
                            <ExternalLink className="h-3 w-3 text-slate-400" />
                            <span>External Link</span>
                          </a>
                        )}
                      </>
                    ) : null}

                    {item.hasLocalPdf ? (
                      <a
                        href={`/api/papers/${item.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 h-7 px-2 text-xs text-slate-600 hover:text-indigo-600 hover:bg-slate-50 rounded-md border border-slate-200 transition-colors font-medium"
                        title="View Stored Manuscript PDF"
                      >
                        <FileText className="h-3 w-3" />
                        <span>PDF</span>
                      </a>
                    ) : item.externalPdfUrl ? (
                      <div className="flex items-center gap-1.5">
                        <a
                          href={item.externalPdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 h-7 px-2 text-xs text-indigo-700 bg-indigo-50/70 hover:bg-indigo-100 hover:text-indigo-800 rounded-md border border-indigo-200 transition-colors font-medium"
                          title="Locally stored PDF is unavailable. Open verified external repository or publisher PDF."
                        >
                          <ExternalLink className="h-3 w-3 text-indigo-600" />
                          <span>External PDF</span>
                        </a>
                        {item.externalLandingPageUrl && (
                          <a
                            href={item.externalLandingPageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 h-7 px-2 text-xs text-slate-600 hover:text-indigo-600 hover:bg-slate-50 rounded-md border border-slate-200 transition-colors font-medium"
                            title="Open external article landing page."
                          >
                            <ExternalLink className="h-3 w-3 text-slate-500" />
                            <span>Article Page</span>
                          </a>
                        )}
                      </div>
                    ) : item.externalLandingPageUrl ? (
                      <a
                        href={item.externalLandingPageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 h-7 px-2 text-xs text-slate-600 hover:text-indigo-600 hover:bg-slate-50 rounded-md border border-slate-200 transition-colors font-medium"
                        title="Open external article landing page."
                      >
                        <ExternalLink className="h-3 w-3 text-slate-500" />
                        <span>Article Page</span>
                      </a>
                    ) : (item.status === "COMPLETED" || item.status === "TEXT_EXTRACTED") ? (
                      <span
                        className="inline-flex items-center gap-1 h-7 px-2 text-xs text-slate-400 bg-slate-50 rounded-md border border-slate-200 cursor-not-allowed font-medium"
                        title="Full-text chunks are indexed for grounded AI chat, but the original PDF manuscript is not in local storage."
                      >
                        <FileText className="h-3 w-3 text-slate-400" />
                        <span>PDF Unavailable</span>
                      </span>
                    ) : null}

                    {/* Secondary Attach PDF option when local PDF is missing */}
                    {!item.hasLocalPdf && (item.status === "COMPLETED" || item.status === "TEXT_EXTRACTED") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={() => openDirectAttachModal(item)}
                        className="h-7 px-2 text-xs text-slate-500 hover:text-indigo-600 hover:bg-slate-100 gap-1 font-medium"
                        title="Attach an authorized local PDF copy of this paper"
                      >
                        <FileUp className="h-3 w-3 text-slate-400" />
                        <span>Attach PDF</span>
                      </Button>
                    )}

                    {/* Cite Paper */}
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      onClick={() => setCitingItem(item)}
                      className="h-7 px-2 text-xs text-slate-500 hover:text-indigo-600 hover:bg-slate-100 gap-1 font-medium"
                      title="Cite this reference"
                    >
                      <Quote className="h-3 w-3" />
                      <span>Cite</span>
                    </Button>

                    {/* Quick Select for Multi-Paper Chat */}
                    <Button
                      size="sm"
                      type="button"
                      variant={selectedPaperIds.includes(item.id) ? "default" : "outline"}
                      onClick={() => togglePaperSelection(item.id)}
                      className={`h-7 px-2 text-xs font-medium gap-1 ${
                        selectedPaperIds.includes(item.id)
                          ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                          : "text-slate-600 hover:text-indigo-600 border-slate-200"
                      }`}
                      title={
                        selectedPaperIds.includes(item.id)
                          ? "Remove from multi-paper chat context"
                          : "Add to multi-paper chat context"
                      }
                    >
                      {selectedPaperIds.includes(item.id) ? (
                        <>
                          <Check className="h-3 w-3" />
                          <span>Selected</span>
                        </>
                      ) : (
                        <>
                          <Plus className="h-3 w-3" />
                          <span>Select</span>
                        </>
                      )}
                    </Button>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-1">
                    {/* If currently filtering by collection, allow removing from collection */}
                    {selectedCollection &&
                      item.collections.includes(selectedCollection) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            handleRemoveFromCollection(
                              item.id,
                              selectedCollection
                            )
                          }
                          className="h-7 px-1.5 text-slate-400 hover:text-amber-700 hover:bg-amber-50 text-[11px]"
                          title={`Remove from collection "${selectedCollection}" (paper remains in library)`}
                        >
                          <span>Remove from folder</span>
                        </Button>
                      )}

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

                {oaActionFeedback && oaActionFeedback.paperId === item.id && (
                  <div
                    className={`mt-2.5 p-2 rounded-lg text-[11px] flex items-start gap-1.5 border animate-in fade-in ${
                      oaActionFeedback.type === "success"
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                        : oaActionFeedback.type === "error"
                        ? "bg-rose-50 text-rose-800 border-rose-200"
                        : "bg-amber-50 text-amber-900 border-amber-200"
                    }`}
                  >
                    {oaActionFeedback.type === "success" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    ) : oaActionFeedback.type === "error" ? (
                      <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                    )}
                    <span className="leading-relaxed">{oaActionFeedback.message}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ============================================================================ */}
      {/* MODAL 1: UPLOAD PRIVATE DOCUMENT                                              */}
      {/* ============================================================================ */}
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
                    {targetPaperId ? "Attach Full-Text PDF" : "Upload Private Document"}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {targetPaperId
                      ? "Attach PDF to saved reference without creating a duplicate"
                      : "Research articles, theses, lecture notes, reports, and general PDF documents"}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsUploadOpen(false);
                  setTargetPaperId(null);
                  setUploadError(null);
                  setUploadSuccess(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {targetPaperId && (
              <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs flex items-start gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-indigo-600 mt-0.5" />
                <div>
                  <span className="font-semibold">Attaching to saved reference:</span>{" "}
                  <span className="italic">{title || targetPaperId}</span>. Full-text extraction and AI analysis will be enabled.
                </div>
              </div>
            )}

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
                  <label
                    htmlFor="modal-pdf-file"
                    className="cursor-pointer block"
                  >
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
                  onChange={(e) =>
                    setDocType(e.target.value as UserDocumentType)
                  }
                  className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                >
                  <option value="OTHER_DOCUMENT">General Document (PDF)</option>
                  <option value="RESEARCH_ARTICLE">Research Article / Paper</option>
                  <option value="MASTERS_THESIS">Master's Thesis</option>
                  <option value="PHD_DISSERTATION">Doctoral Dissertation</option>
                  <option value="UNPUBLISHED_MANUSCRIPT">Unpublished Manuscript / Working Paper</option>
                  <option value="RESEARCH_PROPOSAL">Research Proposal / Grant</option>
                  <option value="TEXTBOOK_STUDY_NOTES">Textbook & Study Notes</option>
                  <option value="LECTURE_MATERIAL">Lecture Material / Slides</option>
                  <option value="ESSAY_ASSIGNMENT">Essay & Assignment</option>
                  <option value="TECHNICAL_REPORT">Technical Report</option>
                  <option value="BUSINESS_REPORT">Business / Corporate Report</option>
                  <option value="INSTITUTIONAL_REPORT">Institutional / Policy Report</option>
                  <option value="DRAFT">Manuscript Draft</option>
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
                  Your file is stored in encrypted private storage scoped to your
                  account. It will not be indexed into public discovery, nor
                  accessible by other users.
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

      {/* ============================================================================ */}
      {/* MODAL 2: ADD BY DOI / PMID LOOKUP                                             */}
      {/* ============================================================================ */}
      {isDoiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-slate-200 p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <BookOpen className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Add Paper by DOI or PMID
                  </h2>
                  <p className="text-xs text-slate-500">
                    Fetch verified metadata from Crossref, PubMed, or local catalog
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsDoiModalOpen(false);
                  setDoiLookupResult(null);
                  setDoiLookupError(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {doiLookupError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{doiLookupError}</span>
              </div>
            )}

            {doiImportSuccess && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>{doiImportSuccess}</span>
              </div>
            )}

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  DOI, PMID, or arXiv ID
                </label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="e.g. 10.1038/s41586-024-07487-w or pmid:38720073"
                    value={doiInput}
                    onChange={(e) => setDoiInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleDoiLookup();
                      }
                    }}
                    className="h-9 text-xs"
                  />
                  <Button
                    type="button"
                    onClick={handleDoiLookup}
                    disabled={isLookingUpDoi || !doiInput.trim()}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs shrink-0"
                  >
                    {isLookingUpDoi ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <span>Search</span>
                    )}
                  </Button>
                </div>
              </div>

              {/* Resolved Metadata Preview */}
              {doiLookupResult && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">
                      <span>Source: {doiLookupResult.provider}</span>
                    </span>

                    {doiExistingPaperId && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                        <span>Already in Catalog</span>
                      </span>
                    )}
                  </div>

                  <h3 className="font-bold text-slate-900 text-sm leading-snug">
                    {doiLookupResult.title}
                  </h3>

                  <div className="text-slate-600 space-y-0.5">
                    {doiLookupResult.authors.length > 0 && (
                      <div className="font-medium text-slate-700">
                        {doiLookupResult.authors.join(", ")}
                      </div>
                    )}
                    {(doiLookupResult.journal ||
                      doiLookupResult.publicationDate) && (
                      <div className="text-slate-500">
                        {[
                          doiLookupResult.journal,
                          doiLookupResult.publicationDate?.slice(0, 4),
                        ]
                          .filter(Boolean)
                          .join(" • ")}
                      </div>
                    )}
                    {doiLookupResult.doi && (
                      <div className="text-indigo-600 font-mono text-[11px]">
                        doi:{doiLookupResult.doi}
                      </div>
                    )}
                  </div>

                  {doiLookupResult.abstract && (
                    <p className="text-slate-500 text-[11px] line-clamp-3 leading-relaxed border-t border-slate-200 pt-2">
                      {doiLookupResult.abstract}
                    </p>
                  )}

                  {/* Open-Access Full-Text Discovery Indicator */}
                  <div className="pt-2 border-t border-slate-200">
                    {doiLookupResult.openAccessStatus === "OPEN_ACCESS_PDF_FOUND" ? (
                      <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5 font-bold text-xs text-emerald-800">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          <span>Open-Access PDF Found</span>
                          {doiLookupResult.openAccessVersion && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-medium">
                              {doiLookupResult.openAccessVersion === "publishedVersion"
                                ? "Publisher Version"
                                : doiLookupResult.openAccessVersion === "acceptedVersion"
                                ? "Accepted Manuscript"
                                : "Submitted Preprint"}
                            </span>
                          )}
                          {doiLookupResult.openAccessLicense && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-medium uppercase">
                              {doiLookupResult.openAccessLicense}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-emerald-700 leading-snug">
                          {doiLookupResult.openAccessExplanation || "Full text will be automatically imported and processed for AI analysis."}
                        </p>
                      </div>
                    ) : doiLookupResult.openAccessStatus === "OPEN_ACCESS_EXTERNAL_LINK_ONLY" ? (
                      <div className="p-2.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-900 space-y-1">
                        <div className="flex items-center gap-1.5 font-bold text-xs text-sky-800">
                          <Globe className="h-3.5 w-3.5 text-sky-600 shrink-0" />
                          <span>External Reading Link Available</span>
                        </div>
                        <p className="text-[11px] text-sky-700 leading-snug">
                          {doiLookupResult.openAccessExplanation || "Reference and external reading link will be preserved in your library."}
                        </p>
                      </div>
                    ) : (
                      <div className="p-2.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 space-y-1">
                        <div className="flex items-center gap-1.5 font-bold text-xs text-slate-800">
                          <BookOpen className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                          <span>Bibliographic Reference Only</span>
                        </div>
                        <p className="text-[11px] text-slate-600 leading-snug">
                          No open-access copy was located. Reference will be saved to your library; you can upload a private manuscript PDF anytime.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Assign to Collection */}
                  {collections.length > 0 && (
                    <div className="pt-2 border-t border-slate-200">
                      <label className="block font-semibold text-slate-700 mb-1">
                        Assign to Collection (Optional)
                      </label>
                      <select
                        value={doiCollectionAssign}
                        onChange={(e) => setDoiCollectionAssign(e.target.value)}
                        className="w-full h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs"
                      >
                        <option value="">No Collection</option>
                        {collections.map((col) => (
                          <option key={col.id} value={col.name}>
                            {col.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="pt-2 flex justify-end">
                    <Button
                      type="button"
                      onClick={handleDoiImportSubmit}
                      disabled={isImportingDoi}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs gap-1.5 font-semibold"
                    >
                      {isImportingDoi ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          <span>
                            {doiLookupResult.canAutoDownload
                              ? "Importing & Processing Full Text..."
                              : "Saving Reference..."}
                          </span>
                        </>
                      ) : (
                        <>
                          <Plus className="h-3.5 w-3.5" />
                          <span>
                            {doiLookupResult.canAutoDownload
                              ? "Add to Library & Process Full Text"
                              : "Add to My Library"}
                          </span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* MODAL 3: BIBTEX / RIS REFERENCE IMPORT                                        */}
      {/* ============================================================================ */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-200 p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <FileCode className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Import References (BibTeX / RIS)
                  </h2>
                  <p className="text-xs text-slate-500">
                    Batch import academic citations into your research library
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsImportModalOpen(false);
                  setPreviewSummary(null);
                  setImportError(null);
                  setImportSuccessMsg(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {importError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{importError}</span>
              </div>
            )}

            {importSuccessMsg && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>{importSuccessMsg}</span>
              </div>
            )}

            {!previewSummary ? (
              <div className="space-y-4 text-xs">
                {/* Mode Selector */}
                <div className="flex items-center p-1 bg-slate-100 rounded-lg text-xs font-semibold text-slate-600 self-start w-fit">
                  <button
                    type="button"
                    onClick={() => setImportMode("file")}
                    className={`px-3 py-1 rounded-md transition-all ${
                      importMode === "file"
                        ? "bg-white text-indigo-700 shadow-xs font-bold"
                        : "hover:text-slate-900"
                    }`}
                  >
                    Upload File (.bib, .ris)
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportMode("paste")}
                    className={`px-3 py-1 rounded-md transition-all ${
                      importMode === "paste"
                        ? "bg-white text-indigo-700 shadow-xs font-bold"
                        : "hover:text-slate-900"
                    }`}
                  >
                    Paste Text
                  </button>
                </div>

                {importMode === "file" ? (
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Reference File
                    </label>
                    <div className="border-2 border-dashed border-slate-300 hover:border-indigo-400 rounded-xl p-4 text-center cursor-pointer transition-colors bg-slate-50/50">
                      <input
                        type="file"
                        accept=".bib,.ris,.txt"
                        onChange={handleReferenceFileChange}
                        className="hidden"
                        id="modal-ref-file"
                      />
                      <label
                        htmlFor="modal-ref-file"
                        className="cursor-pointer block"
                      >
                        <FileCode className="mx-auto h-7 w-7 text-indigo-500 mb-1.5" />
                        {referenceFile ? (
                          <div className="font-semibold text-slate-900 truncate max-w-xs mx-auto">
                            {referenceFile.name}
                          </div>
                        ) : (
                          <>
                            <span className="font-semibold text-indigo-600 hover:underline">
                              Choose a .bib or .ris file
                            </span>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              Standard BibTeX or RIS format
                            </p>
                          </>
                        )}
                      </label>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Paste BibTeX or RIS records
                    </label>
                    <textarea
                      rows={8}
                      placeholder="@article{vaswani2017attention, title={Attention is All you Need}, author={Vaswani, Ashish}, year={2017}}..."
                      value={pastedContent}
                      onChange={(e) => setPastedContent(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 p-2 text-xs font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                    />
                  </div>
                )}

                <div className="pt-2 flex justify-end">
                  <Button
                    type="button"
                    onClick={handlePreviewReferences}
                    disabled={isParsingReferences}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs gap-1.5"
                  >
                    {isParsingReferences ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Parsing Records...</span>
                      </>
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        <span>Parse & Preview</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              /* Preview Stage */
              <div className="space-y-4 text-xs">
                {/* Summary Badges */}
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="p-2 rounded-lg bg-slate-100 border border-slate-200">
                    <div className="text-slate-500 text-[10px] uppercase font-bold">
                      Format
                    </div>
                    <div className="font-bold text-slate-900">
                      {previewSummary.format}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200">
                    <div className="text-emerald-700 text-[10px] uppercase font-bold">
                      Valid
                    </div>
                    <div className="font-bold text-emerald-800">
                      {previewSummary.validCount}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-amber-50 border border-amber-200">
                    <div className="text-amber-700 text-[10px] uppercase font-bold">
                      Duplicates
                    </div>
                    <div className="font-bold text-amber-800">
                      {previewSummary.duplicateCount}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-rose-50 border border-rose-200">
                    <div className="text-rose-700 text-[10px] uppercase font-bold">
                      Invalid
                    </div>
                    <div className="font-bold text-rose-800">
                      {previewSummary.invalidCount}
                    </div>
                  </div>
                </div>

                {/* Import options */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Add to Collection (Optional)
                    </label>
                    <select
                      value={importCollectionAssign}
                      onChange={(e) =>
                        setImportCollectionAssign(e.target.value)
                      }
                      className="w-full h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs"
                    >
                      <option value="">No Collection</option>
                      {collections.map((col) => (
                        <option key={col.id} value={col.name}>
                          {col.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2 pt-4">
                    <input
                      type="checkbox"
                      id="chk-duplicates"
                      checked={importIncludeDuplicates}
                      onChange={(e) =>
                        setImportIncludeDuplicates(e.target.checked)
                      }
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <label
                      htmlFor="chk-duplicates"
                      className="text-xs text-slate-700 cursor-pointer"
                    >
                      Include duplicates (link to my library)
                    </label>
                  </div>
                </div>

                {/* Records Table Preview */}
                <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                  {previewSummary.items.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 text-xs flex items-start justify-between gap-3 bg-white"
                    >
                      <div className="space-y-0.5">
                        <div className="font-bold text-slate-900 line-clamp-1">
                          {item.title || "Untitled Record"}
                        </div>
                        <div className="text-slate-500 text-[11px] line-clamp-1">
                          {item.authors.join(", ")}
                          {item.year ? ` (${item.year})` : ""}
                        </div>
                        {item.doi && (
                          <div className="text-indigo-600 font-mono text-[10px]">
                            doi:{item.doi}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0">
                        {item.validationStatus === "VALID" ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Valid
                          </span>
                        ) : item.validationStatus === "DUPLICATE" ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            Duplicate
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            Invalid
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-2 flex items-center justify-between border-t border-slate-100">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPreviewSummary(null)}
                    disabled={isExecutingImport}
                    className="text-xs"
                  >
                    Back to Edit
                  </Button>

                  <Button
                    type="button"
                    onClick={handleExecuteImport}
                    disabled={
                      isExecutingImport ||
                      previewSummary.validCount +
                        (importIncludeDuplicates
                          ? previewSummary.duplicateCount
                          : 0) ===
                        0
                    }
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs gap-1.5"
                  >
                    {isExecutingImport ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Importing Records...</span>
                      </>
                    ) : (
                      <>
                        <Plus className="h-3.5 w-3.5" />
                        <span>
                          Import{" "}
                          {previewSummary.validCount +
                            (importIncludeDuplicates
                              ? previewSummary.duplicateCount
                              : 0)}{" "}
                          References
                        </span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* MODAL 4: CREATE / EDIT COLLECTION                                             */}
      {/* ============================================================================ */}
      {isNewCollectionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <FolderPlus className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {editingCollection
                      ? "Rename Collection"
                      : "New Collection"}
                  </h3>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsNewCollectionOpen(false);
                  setEditingCollection(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {collectionFormError && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-1.5">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{collectionFormError}</span>
              </div>
            )}

            <form
              onSubmit={handleCreateOrUpdateCollection}
              className="space-y-3 text-xs"
            >
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Collection Name <span className="text-rose-500">*</span>
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Thesis Chapter 3, Surface Codes"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  className="h-9 text-xs"
                  autoFocus
                />
              </div>

              {!editingCollection && (
                <>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Description (Optional)
                    </label>
                    <Input
                      type="text"
                      placeholder="Brief notes about this topic..."
                      value={newCollectionDesc}
                      onChange={(e) => setNewCollectionDesc(e.target.value)}
                      className="h-9 text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1.5">
                      Color Marker
                    </label>
                    <div className="flex items-center gap-2">
                      {PRESET_COLLECTION_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setNewCollectionColor(color)}
                          className={`h-6 w-6 rounded-full transition-transform ${
                            newCollectionColor === color
                              ? "scale-125 ring-2 ring-offset-2 ring-indigo-500"
                              : "hover:scale-110"
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsNewCollectionOpen(false);
                    setEditingCollection(null);
                  }}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmittingCollection || !newCollectionName.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs gap-1.5"
                >
                  {isSubmittingCollection ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : editingCollection ? (
                    <span>Rename</span>
                  ) : (
                    <span>Create Collection</span>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* MODAL 5: MANAGE COLLECTIONS FOR SPECIFIC PAPER                                */}
      {/* ============================================================================ */}
      {managingCollectionsPaper && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Tag className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Manage Collections
                  </h3>
                  <p className="text-xs text-slate-500 line-clamp-1 max-w-[200px]">
                    {managingCollectionsPaper.title}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setManagingCollectionsPaper(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {collections.length === 0 ? (
                <div className="text-center py-4 text-slate-500">
                  <p>You haven't created any collections yet.</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setManagingCollectionsPaper(null);
                      setIsNewCollectionOpen(true);
                    }}
                    className="mt-2 text-xs gap-1"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Create a Collection First</span>
                  </Button>
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {collections.map((col) => {
                    const isChecked = paperSelectedCols.includes(col.name);
                    return (
                      <label
                        key={col.id}
                        className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-200"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setPaperSelectedCols((prev) => [
                                ...prev,
                                col.name,
                              ]);
                            } else {
                              setPaperSelectedCols((prev) =>
                                prev.filter((c) => c !== col.name)
                              );
                            }
                          }}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: col.color }}
                        />
                        <span className="font-medium text-slate-800">
                          {col.name}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setManagingCollectionsPaper(null)}
                  disabled={isUpdatingPaperCols}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSavePaperCollections}
                  disabled={isUpdatingPaperCols}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs gap-1.5"
                >
                  {isUpdatingPaperCols ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <span>Save Collections</span>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* MODAL 6: DELETE CONFIRMATION                                                  */}
      {/* ============================================================================ */}
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
                    : `Remove "${itemToDelete.title}" from your personal library? The public scholarly record, collections, and citations will remain intact.`}
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
                      {itemToDelete.isPrivate
                        ? "Delete Document"
                        : "Remove Bookmark"}
                    </span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* MODAL 7: DIRECT PDF ATTACHMENT (ZERO REDUNDANT METADATA)                      */}
      {/* ============================================================================ */}
      {directAttachItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-slate-200 p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <FileUp className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Upload My PDF
                  </h2>
                  <p className="text-xs text-slate-500">
                    Attach an authorized private copy to this saved reference
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setDirectAttachItem(null);
                  setDirectAttachFile(null);
                  setDirectAttachError(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Reused Reference Metadata Card (Read-Only) */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                  Target Reference
                </span>
                <div className="flex items-center gap-1.5">
                  {directAttachItem.doi && (
                    <Badge variant="outline" className="text-[9px] font-mono border-slate-300 text-slate-600">
                      DOI: {directAttachItem.doi}
                    </Badge>
                  )}
                  {directAttachItem.arxiv && (
                    <Badge variant="outline" className="text-[9px] font-mono border-slate-300 text-slate-600">
                      arXiv: {directAttachItem.arxiv}
                    </Badge>
                  )}
                </div>
              </div>

              <h3 className="text-xs font-bold text-slate-900 leading-snug">
                {directAttachItem.title}
              </h3>

              <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {directAttachItem.authors && directAttachItem.authors.length > 0 && (
                  <span>{directAttachItem.authors.join(", ")}</span>
                )}
                {directAttachItem.journal && (
                  <span>· {formatMetadataText(directAttachItem.journal)}</span>
                )}
                {directAttachItem.publicationDate && (
                  <span>· {directAttachItem.publicationDate}</span>
                )}
              </div>
            </div>

            {directAttachError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{directAttachError}</span>
              </div>
            )}

            <form onSubmit={handleDirectAttachSubmit} className="space-y-4 text-xs">
              {/* PDF File Dropzone */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Local PDF File <span className="text-rose-500">*</span>
                </label>
                <div className="border-2 border-dashed border-slate-300 hover:border-indigo-400 rounded-xl p-5 text-center cursor-pointer transition-colors bg-slate-50/50">
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setDirectAttachFile(file);
                        setDirectAttachError(null);
                      }
                    }}
                    className="hidden"
                    id="direct-attach-pdf-file"
                  />
                  <label
                    htmlFor="direct-attach-pdf-file"
                    className="cursor-pointer block"
                  >
                    <Upload className="mx-auto h-8 w-8 text-indigo-500 mb-1.5" />
                    {directAttachFile ? (
                      <div className="space-y-0.5">
                        <div className="font-semibold text-slate-900 truncate max-w-xs mx-auto">
                          {directAttachFile.name}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {(directAttachFile.size / (1024 * 1024)).toFixed(2)} MB
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className="font-semibold text-indigo-600 hover:underline">
                          Choose your PDF manuscript
                        </span>{" "}
                        <span className="text-slate-500">or drag and drop</span>
                        <p className="text-[11px] text-slate-400 mt-1">
                          Maximum file size: 35 MB
                        </p>
                      </>
                    )}
                  </label>
                </div>
              </div>

              {/* Scope & Privacy Guarantee */}
              <div className="p-3 rounded-xl bg-indigo-50/60 border border-indigo-200/80 text-indigo-900 text-[11px] flex items-start gap-2">
                <Lock className="h-3.5 w-3.5 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Private & Ownership-Isolated:</span> Attaching this PDF creates an authorized private copy for your library, preserving the canonical metadata and enabling AI chat without exposing your document or creating duplicate library records.
                </div>
              </div>

              {/* Submit / Cancel Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDirectAttachItem(null);
                    setDirectAttachFile(null);
                    setDirectAttachError(null);
                  }}
                  className="h-9 px-4 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!directAttachFile || isDirectAttaching}
                  className="h-9 px-4 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold gap-1.5 shadow-sm"
                >
                  {isDirectAttaching ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-white" />
                      <span>Attaching & Indexing...</span>
                    </>
                  ) : (
                    <>
                      <FileUp className="h-3.5 w-3.5" />
                      <span>Attach & Index PDF</span>
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSL Cite Paper Modal */}
      <CitePaperModal
        isOpen={Boolean(citingItem)}
        onClose={() => setCitingItem(null)}
        paper={citingItem}
      />

      {/* CSL Bulk Reference Export Modal */}
      <BulkExportModal
        isOpen={isExportingSelected}
        onClose={() => setIsExportingSelected(false)}
        items={items.filter((it) => selectedPaperIds.includes(it.id))}
      />
    </div>
  );
}
