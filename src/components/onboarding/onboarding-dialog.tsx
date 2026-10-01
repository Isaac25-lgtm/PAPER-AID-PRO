"use client";

import * as React from "react";
import Link from "next/link";
import {
  Compass,
  FileText,
  Layers,
  ArrowRight,
  CheckCircle2,
  X,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const ONBOARDING_KEY = "ai_research_hub_onboarded_v1";

interface OnboardingStep {
  stepNumber: string;
  title: string;
  description: string;
  detail: string;
  icon: React.ElementType;
}

const STEPS: OnboardingStep[] = [
  {
    stepNumber: "01",
    title: "Find Research",
    description: "Search PubMed, Crossref, and Semantic Scholar.",
    detail:
      "Search external academic sources directly from the Discover tab. Review abstracts, publication years, and open-access availability before importing into your library.",
    icon: Compass,
  },
  {
    stepNumber: "02",
    title: "Understand Evidence",
    description: "Inspect AI-assisted findings anchored to manuscript text.",
    detail:
      "When a full-text manuscript is attached, examine structured key findings, methodologies, and limitations. Every finding is anchored to verified page and paragraph excerpts.",
  icon: FileText,
  },
  {
    stepNumber: "03",
    title: "Research Across Papers",
    description: "Compare evidence and formulate grounded research briefs.",
    detail:
      "Use Quick Research to synthesize answers across library papers, or Deep Research to investigate hypotheses, identify research gaps, and validate claims across multiple studies.",
    icon: Layers,
  },
];

export function OnboardingDialog() {
  const [isOpen, setIsOpen] = React.useState(false);
  const [currentStep, setCurrentStep] = React.useState(0);

  React.useEffect(() => {
    // Check if onboarding completed previously
    try {
      const isCompleted = localStorage.getItem(ONBOARDING_KEY);
      const urlParams = new URLSearchParams(window.location.search);
      const forceOnboarding = urlParams.get("onboarding") === "true";

      if (!isCompleted || forceOnboarding) {
        setIsOpen(true);
      }
    } catch {
      // LocalStorage access fallback
    }
  }, []);

  const handleComplete = () => {
    try {
      localStorage.setItem(ONBOARDING_KEY, "true");
    } catch {
      // Ignore storage errors
    }
    setIsOpen(false);
  };

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleComplete();
    }
  };

  if (!isOpen) return null;

  const step = STEPS[currentStep];
  const StepIcon = step.icon;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-xl rounded-3xl bg-white p-6 sm:p-8 shadow-2xl border border-slate-200">
        {/* Top Controls */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Welcome to AI Research Hub
            </span>
          </div>
          <button
            type="button"
            onClick={handleComplete}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100 transition-colors"
            aria-label="Skip onboarding"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step Progression Indicators */}
        <div className="grid grid-cols-3 gap-2 pt-4">
          {STEPS.map((s, idx) => (
            <button
              key={s.stepNumber}
              type="button"
              onClick={() => setCurrentStep(idx)}
              className="text-left group"
            >
              <div
                className={`h-1.5 rounded-full transition-all ${
                  idx === currentStep
                    ? "bg-indigo-600"
                    : idx < currentStep
                    ? "bg-emerald-500"
                    : "bg-slate-200 group-hover:bg-slate-300"
                }`}
              />
              <span
                className={`text-[11px] font-semibold mt-1.5 block ${
                  idx === currentStep
                    ? "text-indigo-700"
                    : idx < currentStep
                    ? "text-emerald-700"
                    : "text-slate-400"
                }`}
              >
                {s.title}
              </span>
            </button>
          ))}
        </div>

        {/* Step Body */}
        <div className="py-8 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 font-bold">
              <StepIcon className="h-6 w-6" />
            </div>
            <div>
              <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">
                Step {step.stepNumber} of 03
              </span>
              <h2 id="onboarding-title" className="text-xl sm:text-2xl font-bold text-slate-900 leading-tight">
                {step.title}
              </h2>
            </div>
          </div>

          <p className="text-sm font-medium text-slate-800 leading-relaxed">
            {step.description}
          </p>

          <p className="text-xs sm:text-sm text-slate-500 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100">
            {step.detail}
          </p>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={handleComplete}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
          >
            Skip Guide
          </button>

          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCurrentStep((prev) => prev - 1)}
                className="text-xs"
              >
                Previous
              </Button>
            )}

            <Button
              type="button"
              size="sm"
              onClick={handleNext}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold gap-1.5 shadow-xs"
            >
              {currentStep < STEPS.length - 1 ? (
                <>
                  <span>Next Step</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Start Researching</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
