"use client";

import * as React from "react";
import { Sparkles, RefreshCw, CheckCircle2, AlertCircle, ExternalLink, Globe, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { discoverPaperOpenAccessAction } from "@/app/library/actions";
import { useRouter } from "next/navigation";

interface OpenAccessDiscoveryButtonProps {
  paperId: string;
  hasDoi: boolean;
  doi?: string | null;
  currentStatus: string;
  externalPdfUrl?: string | null;
  className?: string;
  buttonSize?: "default" | "sm" | "lg";
}

export function OpenAccessDiscoveryButton({
  paperId,
  hasDoi,
  doi,
  currentStatus,
  externalPdfUrl,
  className = "",
  buttonSize = "sm",
}: OpenAccessDiscoveryButtonProps) {
  const router = useRouter();
  const [isDiscovering, setIsDiscovering] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const handleDiscover = async () => {
    if (!hasDoi || !doi) {
      setFeedback({
        type: "info",
        message: "No registered DOI for this paper. Manual PDF upload is required.",
      });
      return;
    }

    setIsDiscovering(true);
    setFeedback(null);

    try {
      const res = await discoverPaperOpenAccessAction(paperId);
      if (res.success && res.hasFullText) {
        setFeedback({
          type: "success",
          message: res.message || "Open-access PDF discovered and full text processed for AI analysis!",
        });
        router.refresh();
      } else if (res.success && !res.hasFullText) {
        setFeedback({
          type: "info",
          message: res.message || "External open-access reading link preserved. Manual PDF upload available.",
        });
        router.refresh();
      } else {
        setFeedback({
          type: "error",
          message: res.message || "No legally accessible open-access PDF located.",
        });
      }
    } catch (err: any) {
      setFeedback({
        type: "error",
        message: err?.message || "Failed querying open-access repositories.",
      });
    } finally {
      setIsDiscovering(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size={buttonSize}
          type="button"
          onClick={handleDiscover}
          disabled={isDiscovering || !hasDoi}
          className={`bg-indigo-600 hover:bg-indigo-700 text-white font-semibold gap-1.5 shadow-xs ${className}`}
          title={hasDoi ? `Search Unpaywall and OpenAlex for DOI: ${doi}` : "No DOI available for this paper"}
        >
          {isDiscovering ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span>Searching Open Access...</span>
            </>
          ) : (
            <>
              <Globe className="h-3.5 w-3.5" />
              <span>Find Open-Access Version</span>
            </>
          )}
        </Button>

        {externalPdfUrl && (
          <a
            href={externalPdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors shadow-2xs"
          >
            <ExternalLink className="h-3.5 w-3.5 text-indigo-600" />
            <span>Open External Full Text</span>
          </a>
        )}
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-xl text-xs flex items-start gap-2 border animate-in fade-in duration-200 ${
            feedback.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : feedback.type === "error"
              ? "bg-rose-50 text-rose-800 border-rose-200"
              : "bg-amber-50 text-amber-900 border-amber-200"
          }`}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
          ) : feedback.type === "error" ? (
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
          ) : (
            <Sparkles className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
          )}
          <span className="leading-relaxed">{feedback.message}</span>
        </div>
      )}
    </div>
  );
}
