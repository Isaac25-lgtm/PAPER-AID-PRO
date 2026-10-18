"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DocumentType } from "@prisma/client";
import {
  X,
  FileText,
  Compass,
  Sparkles,
  Loader2,
  ArrowRight,
  AlertCircle,
  GraduationCap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  STUDY_DESIGN_OPTIONS,
  getDefaultHeadings,
  getDefaultObjectives,
} from "@/lib/editor/guided-templates";
import { createDocumentAction } from "@/app/editor/actions";

interface NewDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDocType?: DocumentType;
}

export function NewDocumentModal({
  isOpen,
  onClose,
  initialDocType,
}: NewDocumentModalProps) {
  const router = useRouter();

  const [creationMode, setCreationMode] = useState<"BLANK" | "GUIDED">("GUIDED");
  const [newTitle, setNewTitle] = useState("");
  const [newDocType, setNewDocType] = useState<DocumentType>(
    initialDocType || DocumentType.MANUSCRIPT
  );
  const [guidedTopic, setGuidedTopic] = useState("");
  const [guidedDocType, setGuidedDocType] = useState<DocumentType>(
    initialDocType || DocumentType.MANUSCRIPT
  );
  const [guidedStudyDesign, setGuidedStudyDesign] = useState("");
  const [guidedGeneralObjective, setGuidedGeneralObjective] = useState("");
  const [guidedSpecificObjectives, setGuidedSpecificObjectives] = useState<string[]>([]);
  const [guidedHeadings, setGuidedHeadings] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Synchronize when initialDocType changes
  useEffect(() => {
    if (initialDocType) {
      setGuidedDocType(initialDocType);
      setNewDocType(initialDocType);
      setCreationMode("GUIDED");
    }
  }, [initialDocType]);

  // Synchronize guided objectives and headings when guidedDocType or studyDesign changes
  useEffect(() => {
    const defaultObj = getDefaultObjectives(guidedTopic, guidedDocType, guidedStudyDesign);
    setGuidedGeneralObjective(defaultObj.general);
    setGuidedSpecificObjectives(defaultObj.specific);
    const defaultHead = getDefaultHeadings(guidedDocType, guidedStudyDesign);
    setGuidedHeadings(defaultHead);
  }, [guidedDocType, guidedStudyDesign]);

  // Close modal on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isCreating) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isCreating, onClose]);

  if (!isOpen) return null;

  const handleCreateDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setCreateError(null);

    try {
      if (creationMode === "BLANK") {
        const titleToUse = newTitle.trim() || "Untitled Research Document";
        const res = await createDocumentAction({
          title: titleToUse,
          docType: newDocType,
        });

        if (!res.success || !res.document) {
          throw new Error(res.error || "Failed to create research document.");
        }

        onClose();
        setNewTitle("");
        router.push(`/editor/${res.document.id}`);
      } else {
        const topicToUse = guidedTopic.trim();
        if (!topicToUse) {
          throw new Error("Please specify your research topic or working title.");
        }

        const res = await createDocumentAction({
          guidedConfig: {
            topic: topicToUse,
            docType: guidedDocType,
            studyDesign: guidedStudyDesign || undefined,
            generalObjective: guidedGeneralObjective || undefined,
            specificObjectives: guidedSpecificObjectives.filter(Boolean),
            headings: guidedHeadings.filter(Boolean),
          },
        });

        if (!res.success || !res.document) {
          throw new Error(res.error || "Failed to create guided research document.");
        }

        onClose();
        setGuidedTopic("");
        router.push(`/editor/${res.document.id}`);
      }
    } catch (err: any) {
      setCreateError(err.message || "Failed to initialize manuscript studio.");
      setIsCreating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-headline"
    >
      <div className="relative w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
              <GraduationCap className="w-4 h-4" />
            </div>
            <div>
              <h2 id="modal-headline" className="text-base font-bold text-slate-900">
                Create New Research Document
              </h2>
              <p className="text-xs text-slate-500">
                Initialize an evidence-grounded manuscript with registered academic sections.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isCreating}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Toggle */}
        <div className="grid grid-cols-2 p-1 my-4 bg-slate-100 rounded-xl text-xs font-semibold shrink-0">
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
            <span>Guided Academic Outline</span>
          </button>

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
            <span>Blank Canvas</span>
          </button>
        </div>

        {createError && (
          <div className="p-3 mb-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{createError}</span>
          </div>
        )}

        <form onSubmit={handleCreateDocument} className="flex-1 flex flex-col min-h-0 space-y-4">
          {creationMode === "BLANK" ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Working Title
                </label>
                <input
                  type="text"
                  placeholder="e.g., Evaluation of Multimodal Vision Transformers in Pathology"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs sm:text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Academic Document Type
                </label>
                <select
                  value={newDocType}
                  onChange={(e) => setNewDocType(e.target.value as DocumentType)}
                  className="w-full px-3 py-2 text-xs sm:text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 bg-white"
                >
                  <option value="MANUSCRIPT">Original Research Manuscript (IMRaD)</option>
                  <option value="LITERATURE_REVIEW">PRISMA Systematic Review</option>
                  <option value="DRAFT">Doctoral Dissertation / Thesis</option>
                  <option value="PROPOSAL">Research / Grant Proposal</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Research Topic / Working Title <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g., Contrast-enhanced ultrasound for microvascular breast lesions"
                  value={guidedTopic}
                  onChange={(e) => setGuidedTopic(e.target.value)}
                  className="w-full px-3 py-2 text-xs sm:text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500"
                  required
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Academic Document Type
                  </label>
                  <select
                    value={guidedDocType}
                    onChange={(e) => setGuidedDocType(e.target.value as DocumentType)}
                    className="w-full px-3 py-2 text-xs sm:text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 bg-white"
                  >
                    <option value="MANUSCRIPT">Original Research Manuscript (IMRaD)</option>
                    <option value="LITERATURE_REVIEW">PRISMA Systematic Review</option>
                    <option value="DRAFT">Doctoral Dissertation / Thesis</option>
                    <option value="PROPOSAL">Research / Grant Proposal</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Study Design Protocol
                  </label>
                  <select
                    value={guidedStudyDesign}
                    onChange={(e) => setGuidedStudyDesign(e.target.value)}
                    className="w-full px-3 py-2 text-xs sm:text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 bg-white"
                  >
                    <option value="">Standard Academic Framework</option>
                    {(STUDY_DESIGN_OPTIONS[guidedDocType] || []).map((design) => (
                      <option key={design} value={design}>
                        {design}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  General Research Objective
                </label>
                <input
                  type="text"
                  value={guidedGeneralObjective}
                  onChange={(e) => setGuidedGeneralObjective(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 bg-slate-50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Pre-Configured Section Headings ({guidedHeadings.length})
                </label>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1 text-xs">
                  {guidedHeadings.map((heading, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-slate-700">
                      <span className="text-[10px] font-mono text-slate-400 w-4">{idx + 1}.</span>
                      <span className="font-medium">{heading}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={isCreating}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isCreating}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs gap-1.5"
            >
              {isCreating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Initializing Studio...</span>
                </>
              ) : (
                <>
                  <span>Open in Studio</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
