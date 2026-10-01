import * as React from "react";
import { Sparkles, ShieldCheck, AlertCircle, FileText, CheckCircle2, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CitationAnchorPill } from "./citation-anchor-pill";
import { StructuredCitationsPayload, CitationAnchor } from "@/lib/ai/schemas";

interface AISummaryProps {
  paperTitle: string;
  summary: {
    summary: string;
    keyFindings: string[];
    methodologySummary: string | null;
    limitations: string | null;
    conclusion: string | null;
    modelUsed: string;
    promptVersion: string | null;
    citations?: any;
    updatedAt: Date | string;
  };
}

export function AISummaryView({ paperTitle, summary }: AISummaryProps) {
  const citations = (summary.citations as StructuredCitationsPayload) || null;

  return (
    <div className="space-y-6">
      {/* Container Card with visual differentiation: Distinct Indigo Border & Academic Slate Gradient Header */}
      <div className="rounded-2xl border-2 border-indigo-200/90 bg-gradient-to-b from-indigo-50/40 via-white to-white p-6 sm:p-8 shadow-xs space-y-6">
        {/* Header Ribbon */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-indigo-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm shrink-0">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                  AI-Generated Scientific Summary
                </h2>
                <Badge variant="academic" className="text-[10px] bg-indigo-100 text-indigo-800 border-indigo-200">
                  Grounded Evidence
                </Badge>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Model: <span className="font-mono text-slate-700">{summary.modelUsed}</span> · Prompt:{" "}
                <span className="font-mono text-slate-700">{summary.promptVersion || "v1"}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold shrink-0">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>Grounded in Source Evidence</span>
          </div>
        </div>

        {/* Academic Integrity Notice */}
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/70 p-3.5 text-xs text-amber-900">
          <Info className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="leading-relaxed">
            <span className="font-semibold">Academic Integrity Notice:</span> This synthesis was generated using OpenAI Structured Outputs anchored exclusively to verbatim manuscript chunks. Statements are mapped to verified page and section citation anchors. Always cross-reference critical empirical claims against the original author manuscript.
          </p>
        </div>

        {/* Section 1: Executive Overview */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-900 flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-indigo-600" />
            Executive Synthesis &amp; Scientific Objective
          </h3>
          <p className="text-xs sm:text-sm text-slate-800 leading-relaxed font-normal bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs whitespace-pre-line">
            {summary.summary}
          </p>
        </div>

        {/* Section 2: Key Findings with Page/Section Anchors */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-900 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            Key Empirical Findings &amp; Benchmark Takeaways
          </h3>

          {summary.keyFindings.length === 0 ? (
            <div className="p-4 rounded-xl bg-white border border-slate-200/80 text-xs text-slate-500 italic">
              No empirical key findings met the strict evidence-grounding threshold for this manuscript.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {summary.keyFindings.map((findingText, idx) => {
                // Retrieve corresponding citations from citations payload if available
                const findingCitations = citations?.keyFindings?.[idx]?.citations || [];

                return (
                  <div
                    key={idx}
                    className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-2xs space-y-2 hover:border-indigo-200 transition-colors"
                  >
                    <div className="flex items-start gap-2.5 text-xs sm:text-sm text-slate-800 leading-relaxed">
                      <span className="h-5 w-5 rounded-full bg-indigo-50 text-indigo-700 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                        {idx + 1}
                      </span>
                      <span className="font-medium">{findingText}</span>
                    </div>

                    {findingCitations.length > 0 && (
                      <div className="pl-7.5 flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[11px] text-slate-400 font-medium">Source Evidence:</span>
                        {findingCitations.map((c, cIdx) => (
                          <CitationAnchorPill
                            key={cIdx}
                            citation={c}
                            paperTitle={paperTitle}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Section 3: Methodology Breakdown */}
        {summary.methodologySummary && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-900">
                Methodology &amp; Empirical Setup
              </h3>
              {citations?.methodology?.citations?.length ? (
                <div className="flex flex-wrap gap-1">
                  {citations.methodology.citations.map((c, i) => (
                    <CitationAnchorPill key={i} citation={c} paperTitle={paperTitle} />
                  ))}
                </div>
              ) : null}
            </div>
            <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-2xs text-xs sm:text-sm text-slate-700 leading-relaxed">
              {summary.methodologySummary}
            </div>
          </div>
        )}

        {/* Section 4 & 5: Limitations and Conclusion Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {summary.limitations && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Reported Limitations
                </h3>
                {citations?.limitations?.citations?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {citations.limitations.citations.slice(0, 2).map((c, i) => (
                      <CitationAnchorPill key={i} citation={c} paperTitle={paperTitle} />
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-2xs text-xs sm:text-sm text-slate-700 leading-relaxed">
                {summary.limitations}
              </div>
            </div>
          )}

          {summary.conclusion && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Synthesized Conclusion
                </h3>
                {citations?.conclusion?.citations?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {citations.conclusion.citations.slice(0, 2).map((c, i) => (
                      <CitationAnchorPill key={i} citation={c} paperTitle={paperTitle} />
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-2xs text-xs sm:text-sm text-slate-700 leading-relaxed">
                {summary.conclusion}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
