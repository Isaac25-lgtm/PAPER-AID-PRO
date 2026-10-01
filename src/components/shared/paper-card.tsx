import * as React from "react";
import Link from "next/link";
import {
  BookOpen,
  Calendar,
  Sparkles,
  ExternalLink,
  Bookmark,
  Users,
  FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Paper } from "@/lib/types/paper";
import { formatDate, truncate } from "@/lib/utils";
import { getPaperStatusBadge } from "@/lib/ui/status-mapper";

export interface MatchedSnippet {
  section?: string | null;
  pageNumber?: number | null;
  text: string;
  similarity?: number;
}

interface PaperCardProps {
  paper: Paper;
  showAiBadge?: boolean;
  matchedSnippet?: MatchedSnippet;
}

/**
 * Formats an abstract excerpt cleanly for card views:
 * - Strips internal development prefixes or leading ABSTRACT headers
 * - Collapses irregular whitespace and newlines
 * - Limits to a concise 2-4 line excerpt (~220 characters)
 */
function formatAbstractExcerpt(raw?: string | null, maxLen = 220): string {
  if (!raw) return "";
  const cleaned = raw
    .replace(/^\[Development\s+(?:Summary|Overview|Benchmark Summary|Note|Takeaway)\]\s*/gi, "")
    .replace(/^ABSTRACT\s*[:\-\s]*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxLen) return cleaned;
  const truncated = cleaned.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 50 ? truncated.slice(0, lastSpace) : truncated) + "...";
}

export function PaperCard({ paper, showAiBadge = true, matchedSnippet }: PaperCardProps) {
  const statusBadge = getPaperStatusBadge(paper.status);

  return (
    <Card className="flex flex-col justify-between hover:shadow-md hover:border-indigo-200 transition-all group bg-white">
      <CardHeader className="p-5 pb-3">
        {/* Top Meta: Categories & Status */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {paper.categories.map((cat) => (
              <Badge key={cat.id} variant="secondary" className="text-[11px] font-medium">
                {cat.name}
              </Badge>
            ))}
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusBadge.className}`}
              title={statusBadge.description}
            >
              {statusBadge.label}
            </span>
          </div>
          <div className="flex items-center text-xs text-slate-500 gap-1">
            <Calendar className="h-3.5 w-3.5" />
            <span>{formatDate(paper.publicationDate)}</span>
          </div>
        </div>

        {/* Paper Title (Clamped to 2 lines for uniform card heights) */}
        <Link
          href={`/papers/${paper.id}`}
          className="group-hover:text-indigo-600 transition-colors"
        >
          <h3 className="font-semibold text-base sm:text-lg text-slate-900 leading-snug line-clamp-2">
            {paper.title}
          </h3>
        </Link>

        {/* Authors */}
        <div className="flex items-center gap-1.5 text-xs text-slate-600 mt-2">
          <Users className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span className="truncate">
            {paper.authors.map((a) => a.name).join(", ")}
          </span>
        </div>

        {/* Journal */}
        <div className="text-xs font-medium text-slate-500 mt-1 italic">
          {paper.journal}
        </div>
      </CardHeader>

      <CardContent className="p-5 pt-0 flex-1 flex flex-col justify-between">
        {/* Abstract Snippet (Clean 2-4 line excerpt) */}
        <p className="text-xs sm:text-sm text-slate-600 leading-relaxed line-clamp-3 mb-4">
          {formatAbstractExcerpt(paper.abstract)}
        </p>

        {/* Matched Evidence Snippet (Phase 6 Semantic Grounding) */}
        {matchedSnippet && (
          <div className="mb-4 p-2.5 rounded-lg bg-indigo-50/60 border border-indigo-100/80 text-xs">
            <div className="flex items-center gap-1.5 font-medium text-indigo-900 mb-1">
              <FileText className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
              <span>
                Matched in {matchedSnippet.section || "Manuscript Evidence"}
                {matchedSnippet.pageNumber ? ` · Page ${matchedSnippet.pageNumber}` : ""}
              </span>
            </div>
            <p className="text-slate-600 italic line-clamp-2 leading-relaxed">
              &ldquo;{matchedSnippet.text}&rdquo;
            </p>
          </div>
        )}

        {/* Card Footer Actions */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            {showAiBadge && paper.aiSummary && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                <Sparkles className="h-3 w-3 text-indigo-600" />
                Grounded AI Summary
              </span>
            )}
            {paper.doi && (
              <span className="text-slate-400 font-mono text-[10px] hidden sm:inline">
                DOI: {truncate(paper.doi, 20)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Link href={`/papers/${paper.id}`}>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
              >
                View Paper
                <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
