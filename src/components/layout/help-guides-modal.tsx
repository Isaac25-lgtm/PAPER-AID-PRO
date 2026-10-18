"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Compass,
  FileText,
  Layers,
  GraduationCap,
  Keyboard,
  ShieldCheck,
  BookOpen,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface HelpGuidesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpGuidesModal({ isOpen, onClose }: HelpGuidesModalProps) {
  const [activeTab, setActiveTab] = useState<"workflows" | "shortcuts" | "integrity">("workflows");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
    >
      <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h2 id="help-modal-title" className="text-base font-bold text-slate-900">
                Help & Researcher Reference
              </h2>
              <p className="text-xs text-slate-500">
                Quick guides, editor keyboard shortcuts, and scientific integrity standards.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-100 text-xs font-semibold mt-3 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("workflows")}
            className={`px-4 py-2 border-b-2 transition-colors ${
              activeTab === "workflows"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            Core Workflows
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("shortcuts")}
            className={`px-4 py-2 border-b-2 transition-colors ${
              activeTab === "shortcuts"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            Editor Shortcuts
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("integrity")}
            className={`px-4 py-2 border-b-2 transition-colors ${
              activeTab === "integrity"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            Evidence Grounding
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4 text-xs text-slate-600 pr-1">
          {activeTab === "workflows" && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-slate-900 text-xs">
                  <Compass className="w-4 h-4 text-indigo-600" />
                  <span>1. Scholarly Discovery</span>
                </div>
                <p className="leading-relaxed">
                  Query over 300 million publications across PubMed, Crossref, and Semantic Scholar. Filter by publication year, open-access status, and journal. Save matching studies directly to your library.
                </p>
                <Link
                  href="/discover"
                  onClick={onClose}
                  className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline pt-1"
                >
                  <span>Go to Find Papers</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-slate-900 text-xs">
                  <BookOpen className="w-4 h-4 text-blue-600" />
                  <span>2. Research Library & PDF Processing</span>
                </div>
                <p className="leading-relaxed">
                  Upload private laboratory PDFs, dissertations, or import public preprints. The platform automatically extracts headings, detects sections, and produces verifiable chunk indexes for grounded synthesis.
                </p>
                <Link
                  href="/library"
                  onClick={onClose}
                  className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline pt-1"
                >
                  <span>Go to My Library</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-slate-900 text-xs">
                  <Layers className="w-4 h-4 text-purple-600" />
                  <span>3. Multi-Paper Synthesis</span>
                </div>
                <p className="leading-relaxed">
                  Formulate multi-paper research questions. Synthesis threads retrieve relevant manuscript passages and provide grounded answers with exact page and paragraph citation anchors.
                </p>
                <Link
                  href="/research"
                  onClick={onClose}
                  className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline pt-1"
                >
                  <span>Start Research Chat</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-slate-900 text-xs">
                  <GraduationCap className="w-4 h-4 text-emerald-600" />
                  <span>4. TipTap Research Editor Studio</span>
                </div>
                <p className="leading-relaxed">
                  Draft papers using registered IMRaD, PRISMA, or Dissertation outlines. Generate context-aware inline completions and anchor citations directly from your library sources drawer.
                </p>
                <Link
                  href="/editor"
                  onClick={onClose}
                  className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline pt-1"
                >
                  <span>Open Documents</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          )}

          {activeTab === "shortcuts" && (
            <div className="space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-start gap-2">
                <Keyboard className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Pro-Tip for Fast Writing:</span>
                  <p className="mt-0.5 text-amber-800">
                    Use inline keyboard shortcuts inside the TipTap Research Editor to generate and accept completions without leaving the keyboard.
                  </p>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 bg-white">
                <div className="p-3 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-slate-900 block">Trigger AI Autocomplete</span>
                    <span className="text-[11px] text-slate-500">Generates next sentence or paragraph continuation</span>
                  </div>
                  <div className="flex items-center gap-1 font-mono text-[11px]">
                    <kbd className="px-2 py-1 rounded bg-slate-100 border border-slate-300 font-bold text-slate-700">Ctrl</kbd>
                    <span>+</span>
                    <kbd className="px-2 py-1 rounded bg-slate-100 border border-slate-300 font-bold text-slate-700">J</kbd>
                  </div>
                </div>

                <div className="p-3 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-slate-900 block">Accept Ghost Suggestion</span>
                    <span className="text-[11px] text-slate-500">Inserts proposed continuation directly into canvas</span>
                  </div>
                  <div className="font-mono text-[11px]">
                    <kbd className="px-2.5 py-1 rounded bg-slate-100 border border-slate-300 font-bold text-slate-700">Tab</kbd>
                  </div>
                </div>

                <div className="p-3 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-slate-900 block">Dismiss Ghost Suggestion</span>
                    <span className="text-[11px] text-slate-500">Clears current suggestion without modifying text</span>
                  </div>
                  <div className="font-mono text-[11px]">
                    <kbd className="px-2.5 py-1 rounded bg-slate-100 border border-slate-300 font-bold text-slate-700">Esc</kbd>
                  </div>
                </div>

                <div className="p-3 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-slate-900 block">Undo Acceptance</span>
                    <span className="text-[11px] text-slate-500">Reverts accepted text back to previous state</span>
                  </div>
                  <div className="flex items-center gap-1 font-mono text-[11px]">
                    <kbd className="px-2 py-1 rounded bg-slate-100 border border-slate-300 font-bold text-slate-700">Ctrl</kbd>
                    <span>+</span>
                    <kbd className="px-2 py-1 rounded bg-slate-100 border border-slate-300 font-bold text-slate-700">Z</kbd>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "integrity" && (
            <div className="space-y-3">
              <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-indigo-950 text-xs">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  <span>Academic Evidence & Grounding Guarantees</span>
                </div>
                <p className="text-slate-600 leading-relaxed text-xs">
                  AI Research Hub is built specifically to address LLM hallucinations in scientific literature. Our platform enforces:
                </p>
                <ul className="list-disc pl-4 space-y-1.5 text-slate-700 text-xs">
                  <li>
                    <strong>Zero Numeric Fabrication:</strong> Models are strictly prohibited from generating altered numerical metrics, p-values, or statistical outcomes.
                  </li>
                  <li>
                    <strong>Exact Provenance Anchors:</strong> Every cited claim links to verifiable chunk IDs containing exact page and paragraph numbers from the original manuscript.
                  </li>
                  <li>
                    <strong>Multi-Tenant Data Isolation:</strong> Your private drafts, lab uploads, and research conversations are encrypted and isolated strictly to your account.
                  </li>
                </ul>
              </div>

              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-900 block">Account & Data Settings</span>
                  <span className="text-[11px] text-slate-500">Manage credentials, view authorization role, and review sessions</span>
                </div>
                <Button asChild size="sm" variant="outline" className="text-xs">
                  <Link href="/account" onClick={onClose}>
                    <span>Manage Account</span>
                    <ArrowRight className="w-3 h-3 ml-1" />
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
          <span>AI Research Hub Workspace v1.0</span>
          <Button
            type="button"
            size="sm"
            onClick={onClose}
            className="bg-slate-900 hover:bg-slate-800 text-white text-xs px-4"
          >
            Got it
          </Button>
        </div>
      </div>
    </div>
  );
}
