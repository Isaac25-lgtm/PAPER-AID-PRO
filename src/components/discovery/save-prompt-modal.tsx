"use client";

import * as React from "react";
import Link from "next/link";
import { X, Bookmark, ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SavePromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  paperTitle?: string;
}

export function SavePromptModal({ isOpen, onClose, paperTitle }: SavePromptModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4"
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <Bookmark className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Sign in to Save Papers</h2>
            <p className="text-xs text-slate-500">Personal research library &amp; grounded AI analysis</p>
          </div>
        </div>

        {paperTitle && (
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-700 font-medium line-clamp-2">
            "{paperTitle}"
          </div>
        )}

        <div className="space-y-2 text-xs text-slate-600 leading-relaxed">
          <div className="flex items-center gap-2 text-slate-800 font-semibold">
            <Sparkles className="h-4 w-4 text-indigo-600 shrink-0" />
            <span>Unlock your private researcher workspace:</span>
          </div>
          <ul className="space-y-1.5 pl-6 list-disc text-slate-600">
            <li>Save scholarly papers and maintain personal collections</li>
            <li>Upload personal manuscript PDFs with copy-on-write privacy</li>
            <li>Perform interactive Q&amp;A with verifiable page and paragraph citations</li>
            <li>Draft manuscripts with the AI Research Editor</li>
          </ul>
        </div>

        <div className="pt-2 flex flex-col gap-2">
          <Button asChild className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs h-10">
            <Link href="/login?callbackUrl=/discover">
              <span>Sign In to Continue</span>
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Link>
          </Button>

          <Button asChild variant="outline" className="w-full text-xs h-9 border-slate-200">
            <Link href="/register?callbackUrl=/discover">
              <span>Create Free Account</span>
            </Link>
          </Button>

          <button
            type="button"
            onClick={onClose}
            className="text-center text-xs text-slate-400 hover:text-slate-600 pt-1"
          >
            Continue browsing as guest
          </button>
        </div>
      </div>
    </div>
  );
}
