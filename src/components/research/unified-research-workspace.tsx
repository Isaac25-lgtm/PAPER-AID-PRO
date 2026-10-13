"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Layers, Bot, Sparkles, HelpCircle } from "lucide-react";
import { ResearchInterface } from "./research-interface";
import { AgentWorkspace } from "@/components/agent/agent-workspace";

interface UnifiedResearchWorkspaceProps {
  initialThreadId?: string;
  initialPaperIds?: string[];
  defaultTab?: "quick" | "deep";
}

export function UnifiedResearchWorkspace({
  initialThreadId,
  initialPaperIds,
  defaultTab = "quick",
}: UnifiedResearchWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentTabParam = searchParams.get("tab");

  const [activeTab, setActiveTab] = React.useState<"quick" | "deep">(
    currentTabParam === "deep" ? "deep" : currentTabParam === "quick" ? "quick" : defaultTab
  );

  React.useEffect(() => {
    if (currentTabParam === "deep" || currentTabParam === "quick") {
      setActiveTab(currentTabParam);
    }
  }, [currentTabParam]);

  const handleTabChange = (tab: "quick" | "deep") => {
    setActiveTab(tab);
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.set("tab", tab);
    router.replace(`/research?${newParams.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      {/* Mode Switcher Tabs */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-2 max-w-2xl mx-auto shadow-xs">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleTabChange("quick")}
            className={`flex flex-col items-center justify-center p-3 rounded-xl text-left transition-all ${
              activeTab === "quick"
                ? "bg-indigo-50 border border-indigo-200 text-indigo-900 shadow-2xs"
                : "hover:bg-slate-50 text-slate-600 border border-transparent"
            }`}
          >
            <div className="flex items-center gap-2 font-bold text-xs sm:text-sm">
              <Sparkles className={`h-4 w-4 ${activeTab === "quick" ? "text-indigo-600" : "text-slate-400"}`} />
              <span>Quick Research</span>
            </div>
            <span className="text-[11px] text-slate-500 mt-1 text-center font-normal">
              Ask across full-text papers currently in your library
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange("deep")}
            className={`flex flex-col items-center justify-center p-3 rounded-xl text-left transition-all ${
              activeTab === "deep"
                ? "bg-indigo-50 border border-indigo-200 text-indigo-900 shadow-2xs"
                : "hover:bg-slate-50 text-slate-600 border border-transparent"
            }`}
          >
            <div className="flex items-center gap-2 font-bold text-xs sm:text-sm">
              <Bot className={`h-4 w-4 ${activeTab === "deep" ? "text-indigo-600" : "text-slate-400"}`} />
              <span>Deep Research</span>
            </div>
            <span className="text-[11px] text-slate-500 mt-1 text-center font-normal">
              Investigate broader hypotheses across library &amp; scholarly sources
            </span>
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "quick" ? (
        <ResearchInterface
          initialThreadId={initialThreadId}
          initialPaperIds={initialPaperIds}
        />
      ) : (
        <AgentWorkspace initialConversationId={initialThreadId} />
      )}
    </div>
  );
}
