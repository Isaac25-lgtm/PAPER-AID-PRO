"use client";

import * as React from "react";
import { Sparkles, RefreshCw, CheckCircle2, AlertCircle, ExternalLink, Globe, FileUp, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { discoverPaperOpenAccessAction, getPaperProcessingStatusAction } from "@/app/library/actions";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface OpenAccessDiscoveryButtonProps {
  paperId: string;
  hasDoi: boolean;
  doi?: string | null;
  currentStatus: string;
  externalPdfUrl?: string | null;
  className?: string;
  buttonSize?: "default" | "sm" | "lg";
}

type ProcessingStageLabel =
  | "IDLE"
  | "PREPARING"
  | "PARSING"
  | "INDEXING"
  | "TEXT_EXTRACTED"
  | "READY"
  | "RESTRICTED"
  | "FAILED"
  | "OCR_REQUIRED";

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
  const [stage, setStage] = React.useState<ProcessingStageLabel>("IDLE");
  const [feedback, setFeedback] = React.useState<{
    type: "success" | "error" | "info" | "warning";
    message: string;
    details?: string;
  } | null>(null);
  const [isCheckingProgress, setIsCheckingProgress] = React.useState(false);

  const isProcessing = stage === "PREPARING" || stage === "PARSING" || stage === "INDEXING";

  const handleAnalyze = async () => {
    setStage("PREPARING");
    setFeedback(null);

    try {
      // Step 1: Call on-demand analysis action
      const res = await discoverPaperOpenAccessAction(paperId);

      if (res.logicalState === "TEXT_EXTRACTED" || (res.success && res.hasFullText && res.logicalState !== "READY")) {
        setStage("TEXT_EXTRACTED");
        setFeedback({
          type: "info",
          message: res.message || "Full text acquired and extracted! Evidence and citations are ready (semantic indexing pending).",
        });
        router.refresh();
      } else if (res.success && res.hasFullText) {
        setStage("READY");
        setFeedback({
          type: "success",
          message: res.message || "Ready for AI! Full text acquired, parsed, and semantically indexed.",
        });
        router.refresh();
      } else if (res.logicalState === "RESTRICTED" || res.status === "OPEN_ACCESS_EXTERNAL_LINK_ONLY") {
        setStage("RESTRICTED");
        setFeedback({
          type: "warning",
          message:
            res.message ||
            "Full Text Restricted: Publisher terms restrict direct server processing. You can read via external link or upload your PDF.",
        });
        router.refresh();
      } else if (res.error?.includes("OCR") || res.message?.includes("OCR") || res.error?.includes("scanned")) {
        setStage("OCR_REQUIRED");
        setFeedback({
          type: "error",
          message: "OCR Required: Manuscript appears to be a scanned image without extractable text.",
        });
      } else {
        setStage("FAILED");
        setFeedback({
          type: "error",
          message: res.message || res.error || "No legally accessible full text found or processing failed.",
        });
      }
    } catch (err: any) {
      setStage("FAILED");
      setFeedback({
        type: "error",
        message: err?.message || "Failed to analyze paper.",
      });
    }
  };

  const checkProgress = async () => {
    setIsCheckingProgress(true);
    try {
      const res = await getPaperProcessingStatusAction(paperId);
      if (res && res.logicalState) {
        if (res.logicalState === "READY") {
          setStage("READY");
          setFeedback({
            type: "success",
            message: "Document is ready for AI! Full text chunks and embeddings are indexed.",
          });
        } else if (res.logicalState === "TEXT_EXTRACTED") {
          setStage("TEXT_EXTRACTED");
          setFeedback({
            type: "info",
            message: "Full text extracted! Citations and structured evidence ready (semantic indexing pending).",
          });
        } else if (res.logicalState === "RESTRICTED") {
          setStage("RESTRICTED");
          setFeedback({
            type: "warning",
            message: "Full Text Restricted: Automatic acquisition is not permitted by license.",
          });
        } else if (res.logicalState === "PARSING") {
          setStage("PARSING");
        } else if (res.logicalState === "INDEXING" || res.logicalState === "CHUNKING") {
          setStage("INDEXING");
        } else if (res.logicalState === "FAILED") {
          setStage("FAILED");
          setFeedback({
            type: "error",
            message: res.latestJob?.errorMessage || "Processing failed.",
          });
        }
      }
    } catch (err: any) {
      // safe fallback
    } finally {
      setIsCheckingProgress(false);
    }
  };

  const getButtonText = () => {
    switch (stage) {
      case "PREPARING":
        return "Preparing Document...";
      case "PARSING":
        return "Parsing Document...";
      case "INDEXING":
        return "Indexing Evidence...";
      case "TEXT_EXTRACTED":
        return "Full Text Extracted";
      case "READY":
        return "Ready for AI";
      case "RESTRICTED":
        return "Full Text Restricted";
      case "FAILED":
      case "OCR_REQUIRED":
        return "Processing Failed / Retry";
      default:
        return "Analyze Paper";
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size={buttonSize}
          type="button"
          onClick={handleAnalyze}
          disabled={isProcessing}
          className={`bg-indigo-600 hover:bg-indigo-700 text-white font-semibold gap-1.5 shadow-xs ${className}`}
          title="Verify lawful source, retrieve PDF, extract structured text, and index evidence"
        >
          {isProcessing ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span>{getButtonText()}</span>
            </>
          ) : stage === "READY" ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Ready for AI</span>
            </>
          ) : stage === "TEXT_EXTRACTED" ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-indigo-200" />
              <span>Full Text Extracted</span>
            </>
          ) : stage === "RESTRICTED" ? (
            <>
              <ShieldAlert className="h-3.5 w-3.5 text-amber-300" />
              <span>Full Text Restricted</span>
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              <span>{stage === "FAILED" ? "Retry Analysis" : "Analyze Paper"}</span>
            </>
          )}
        </Button>

        {/* Check progress button if previously triggered or in progress */}
        {isProcessing && (
          <Button
            size={buttonSize}
            variant="outline"
            type="button"
            onClick={checkProgress}
            disabled={isCheckingProgress}
            className="text-xs text-slate-600 gap-1 border-slate-200"
          >
            <RefreshCw className={`h-3 w-3 ${isCheckingProgress ? "animate-spin" : ""}`} />
            <span>Check Status</span>
          </Button>
        )}

        {/* External Link */}
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

        {/* Upload Your PDF option */}
        {(stage === "RESTRICTED" || stage === "FAILED" || stage === "OCR_REQUIRED" || !hasDoi) && (
          <Link
            href={`/library?uploadPaperId=${paperId}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 transition-colors shadow-2xs"
          >
            <FileUp className="h-3.5 w-3.5 text-amber-700" />
            <span>Upload Your PDF</span>
          </Link>
        )}
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-xl text-xs flex items-start gap-2 border animate-in fade-in duration-200 ${
            feedback.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : feedback.type === "error"
              ? "bg-rose-50 text-rose-800 border-rose-200"
              : feedback.type === "warning"
              ? "bg-amber-50 text-amber-900 border-amber-200"
              : "bg-sky-50 text-sky-800 border-sky-200"
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
