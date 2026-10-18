"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  X,
  Compass,
  BookOpen,
  Layers,
  PenTool,
  ArrowRight,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface OnboardingMilestones {
  hasAccount: boolean;
  hasPapers: boolean;
  hasAnalyzed: boolean;
  hasDrafted: boolean;
}

interface OnboardingChecklistProps {
  milestones: OnboardingMilestones;
  onStartDraft: () => void;
}

const STORAGE_KEY = "ai_research_hub_onboarding_dismissed";

export function OnboardingChecklist({
  milestones,
  onStartDraft,
}: OnboardingChecklistProps) {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (dismissed === "true") {
      setIsDismissed(true);
    }
  }, []);

  const handleDismiss = () => {
    setIsDismissed(true);
    localStorage.setItem(STORAGE_KEY, "true");
  };

  const handleRestore = () => {
    setIsDismissed(false);
    localStorage.removeItem(STORAGE_KEY);
  };

  // Calculate completed count
  const items = [
    {
      id: "account",
      title: "Create your researcher account",
      description: "Profile created with secure credentials and isolated workspace.",
      completed: milestones.hasAccount,
      actionText: "View Account",
      href: "/account",
      icon: CheckCircle2,
    },
    {
      id: "papers",
      title: "Add papers to your research library",
      description: "Import studies from PubMed/Crossref discovery or upload laboratory PDFs to your library.",
      completed: milestones.hasPapers,
      actionText: "Find & Import Papers",
      href: "/discover",
      icon: Compass,
    },
    {
      id: "synthesis",
      title: "Synthesize evidence across source manuscripts",
      description: "Ask multi-paper research questions with verified paragraph citations.",
      completed: milestones.hasAnalyzed,
      actionText: "Start Research Chat",
      href: "/research",
      icon: Layers,
    },
    {
      id: "draft",
      title: "Draft your first structured research manuscript",
      description: "Choose a guided IMRaD, PRISMA, or Dissertation outline with AI autocomplete.",
      completed: milestones.hasDrafted,
      actionText: "Create Manuscript",
      onClick: onStartDraft,
      icon: PenTool,
    },
  ];

  const completedCount = items.filter((i) => i.completed).length;
  const progressPercent = Math.round((completedCount / items.length) * 100);
  const allCompleted = completedCount === items.length;

  if (!isMounted) return null;

  if (isDismissed) {
    return (
      <div className="flex items-center justify-between text-xs text-slate-500 py-1 px-3 rounded-lg bg-slate-50 border border-slate-200">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
          <span>Research Checklist: {completedCount}/{items.length} milestones complete</span>
        </div>
        <button
          type="button"
          onClick={handleRestore}
          className="text-indigo-600 hover:text-indigo-800 font-medium text-xs underline-offset-2 hover:underline"
        >
          Show Checklist
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50/70 via-white to-slate-50/80 p-5 sm:p-6 shadow-xs relative">
      {/* Header & Dismiss */}
      <div className="flex items-start justify-between gap-4 pb-4 border-b border-indigo-100">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-100 text-indigo-800 border border-indigo-200">
            <Sparkles className="w-3 h-3 text-indigo-600" />
            <span>Academic Onboarding</span>
          </div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900">
            Research Workspace Milestones
          </h2>
          <p className="text-xs text-slate-600 max-w-xl">
            {allCompleted
              ? "All fundamental milestones completed! You have established a grounded literature base and active manuscripts."
              : "Complete these steps to establish your literature base, run grounded synthesis, and draft peer-reviewed manuscripts."}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right hidden sm:block">
            <span className="text-xs font-mono font-bold text-indigo-700">
              {completedCount} of {items.length} completed
            </span>
            <div className="w-24 h-2 bg-indigo-100 rounded-full mt-1 overflow-hidden">
              <div
                className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
            title="Dismiss checklist"
            aria-label="Dismiss onboarding checklist"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Checklist Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4">
        {items.map((item) => {
          return (
            <div
              key={item.id}
              className={`p-3.5 rounded-xl border transition-all flex items-start gap-3 ${
                item.completed
                  ? "bg-white/90 border-emerald-200/80 shadow-2xs"
                  : "bg-white border-slate-200 shadow-2xs hover:border-indigo-200"
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {item.completed ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                ) : (
                  <Circle className="w-5 h-5 text-slate-300" />
                )}
              </div>

              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <h3
                    className={`text-xs font-semibold truncate ${
                      item.completed ? "text-slate-800 line-through opacity-85" : "text-slate-900"
                    }`}
                  >
                    {item.title}
                  </h3>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-2">
                  {item.description}
                </p>

                {!item.completed && (
                  <div className="pt-1.5">
                    {item.href ? (
                      <Link
                        href={item.href}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
                      >
                        <span>{item.actionText}</span>
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={item.onClick}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
                      >
                        <span>{item.actionText}</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
