"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  ArrowRight,
  Info,
  Sparkles,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CitationVerificationResult,
  CitationVerificationStatus,
  RegisteredMetadata,
} from "@/lib/citations/verification-types";

interface CitationVerifierProps {
  currentPaper: {
    title: string;
    authors: string[];
    year: number | string;
    journal: string;
    doi: string;
    volume?: string;
    issue?: string;
    pages?: string;
  };
  onApplyVerifiedMetadata?: (metadata: RegisteredMetadata) => void;
}

export function CitationVerifier({
  currentPaper,
  onApplyVerifiedMetadata,
}: CitationVerifierProps) {
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<CitationVerificationResult | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = React.useState(false);

  // Clear previous result when the selected paper changes
  React.useEffect(() => {
    setResult(null);
    setErrorMsg(null);
    setNeedsAuth(false);
  }, [currentPaper.doi, currentPaper.title]);

  const handleVerify = async () => {
    setLoading(true);
    setErrorMsg(null);
    setNeedsAuth(false);

    try {
      const res = await fetch("/api/citations/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: currentPaper.doi,
          title: currentPaper.title,
          authors: currentPaper.authors,
          year: currentPaper.year,
          journal: currentPaper.journal,
        }),
      });

      if (res.status === 401) {
        setNeedsAuth(true);
        setLoading(false);
        return;
      }

      if (res.status === 429) {
        setErrorMsg("Verification quota reached. Please wait a moment before verifying again.");
        setLoading(false);
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error || `Verification failed with HTTP ${res.status}`);
        setLoading(false);
        return;
      }

      const verificationData: CitationVerificationResult = await res.json();
      setResult(verificationData);
    } catch (err: any) {
      setErrorMsg(err?.message || "Network error while connecting to verification service.");
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: CitationVerificationStatus) => {
    switch (status) {
      case "VERIFIED":
        return (
          <Badge className="bg-emerald-50 text-emerald-800 border-emerald-300 gap-1.5 py-1 px-3">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <span className="font-bold">VERIFIED</span>
          </Badge>
        );
      case "MISMATCHED":
        return (
          <Badge className="bg-amber-50 text-amber-800 border-amber-300 gap-1.5 py-1 px-3">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
            <span className="font-bold">MISMATCHED</span>
          </Badge>
        );
      case "NOT FOUND":
        return (
          <Badge className="bg-rose-50 text-rose-800 border-rose-300 gap-1.5 py-1 px-3">
            <XCircle className="h-3.5 w-3.5 text-rose-600" />
            <span className="font-bold">NOT FOUND</span>
          </Badge>
        );
      case "UNVERIFIABLE":
        return (
          <Badge className="bg-slate-100 text-slate-800 border-slate-300 gap-1.5 py-1 px-3">
            <HelpCircle className="h-3.5 w-3.5 text-slate-500" />
            <span className="font-bold">UNVERIFIABLE</span>
          </Badge>
        );
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
      {/* Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-indigo-600" />
            Registry Citation Verifier
          </h3>
          <p className="text-xs text-slate-500">
            Cross-check identifier and metadata against the CitedEvidence Scholar catalog (covering CEDOA, OpenAlex, and indexed open scholarly records).
          </p>
        </div>

        <Button
          onClick={handleVerify}
          disabled={loading}
          size="sm"
          className="gap-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold shadow-xs"
        >
          {loading ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Verifying Registry...
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5" />
              Verify Reference
            </>
          )}
        </Button>
      </div>

      {/* Authentication Prompt */}
      {needsAuth && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-indigo-900">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-indigo-600 shrink-0" />
            <span>
              <strong>Authentication Required:</strong> Please sign in to verify citations against authoritative scholarly registries. Citation formatting and copying remain fully active.
            </span>
          </div>
          <Link
            href="/login"
            className="inline-flex items-center gap-1 font-bold text-indigo-700 hover:text-indigo-900 underline shrink-0"
          >
            Sign In <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}

      {/* Error / Rate-Limit Alert */}
      {errorMsg && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3.5 text-xs text-rose-800 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Verification Results Panel */}
      {result && (
        <div className="space-y-4 animate-in fade-in-50 duration-200">
          {/* Status Banner */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {getStatusBadge(result.status)}
                {result.registeredMetadata?.sourceRegistry && (
                  <span className="text-xs text-slate-500 font-medium">
                    via {result.registeredMetadata.sourceRegistry}
                  </span>
                )}
              </div>
              {result.resolvedIdentifier?.canonicalUrl && (
                <a
                  href={result.resolvedIdentifier.canonicalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold inline-flex items-center gap-1"
                >
                  View in Registry <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            <p className="text-xs text-slate-700 leading-relaxed font-medium">
              {result.statusDetails}
            </p>

            {/* Field Comparison Accounting */}
            {result.comparedFields && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] font-semibold text-slate-500 mr-1">Field Comparison:</span>
                {result.comparedFields.matched.map((f) => (
                  <span
                    key={`matched-${f}`}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200"
                  >
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                    {f.charAt(0).toUpperCase() + f.slice(1)} (matched)
                  </span>
                ))}
                {result.comparedFields.conflicting.map((f) => (
                  <span
                    key={`conflicting-${f}`}
                    className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 border border-amber-200"
                  >
                    <AlertTriangle className="h-3 w-3 text-amber-600" />
                    {f.charAt(0).toUpperCase() + f.slice(1)} (conflict)
                  </span>
                ))}
                {result.comparedFields.notSupplied.map((f) => (
                  <span
                    key={`omitted-${f}`}
                    className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 border border-slate-200"
                  >
                    <span className="text-slate-400 font-bold">—</span>
                    {f.charAt(0).toUpperCase() + f.slice(1)} (not supplied)
                  </span>
                ))}
              </div>
            )}

            {result.versionNotice && (
              <div className="text-xs text-slate-600 flex items-center gap-1.5 bg-white p-2.5 rounded-lg border border-slate-200 leading-relaxed">
                <Info className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                <span>{result.versionNotice}</span>
              </div>
            )}
          </div>

          {/* Mismatch Discrepancy Table */}
          {result.status === "MISMATCHED" && result.discrepancies && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                  Field-Level Discrepancies Detected
                </h4>
                {onApplyVerifiedMetadata && result.registeredMetadata && (
                  <Button
                    onClick={() => onApplyVerifiedMetadata(result.registeredMetadata!)}
                    size="sm"
                    variant="outline"
                    className="text-xs border-amber-300 text-amber-900 hover:bg-amber-100 gap-1 h-7"
                  >
                    <Sparkles className="h-3 w-3 text-amber-600" />
                    Use Verified Registry Metadata
                  </Button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-amber-200 text-amber-900 font-semibold">
                      <th className="py-1.5 px-2">Field</th>
                      <th className="py-1.5 px-2">Submitted in Citation</th>
                      <th className="py-1.5 px-2">Official Registry Record</th>
                      <th className="py-1.5 px-2 text-right">Alignment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100 text-slate-700">
                    {result.discrepancies.title && (
                      <tr className={cn(!result.discrepancies.title.matches && "bg-amber-100/40")}>
                        <td className="py-2 px-2 font-semibold">Title</td>
                        <td className="py-2 px-2">{result.discrepancies.title.submitted}</td>
                        <td className="py-2 px-2 font-medium text-slate-900">
                          {result.discrepancies.title.registered}
                        </td>
                        <td className="py-2 px-2 text-right font-bold">
                          {result.discrepancies.title.matches ? (
                            <span className="text-emerald-700">Matched</span>
                          ) : (
                            <span className="text-amber-700">Conflict</span>
                          )}
                        </td>
                      </tr>
                    )}
                    {result.discrepancies.authors && (
                      <tr className={cn(!result.discrepancies.authors.matches && "bg-amber-100/40")}>
                        <td className="py-2 px-2 font-semibold">Authors</td>
                        <td className="py-2 px-2">
                          {result.discrepancies.authors.submitted.join(", ")}
                        </td>
                        <td className="py-2 px-2 font-medium text-slate-900">
                          {result.discrepancies.authors.registered.slice(0, 4).join(", ")}
                          {result.discrepancies.authors.registered.length > 4 && " et al."}
                        </td>
                        <td className="py-2 px-2 text-right font-bold">
                          {result.discrepancies.authors.matches ? (
                            <span className="text-emerald-700">Matched</span>
                          ) : (
                            <span className="text-amber-700">Conflict</span>
                          )}
                        </td>
                      </tr>
                    )}
                    {result.discrepancies.year && (
                      <tr className={cn(!result.discrepancies.year.matches && "bg-amber-100/40")}>
                        <td className="py-2 px-2 font-semibold">Year</td>
                        <td className="py-2 px-2">{result.discrepancies.year.submitted}</td>
                        <td className="py-2 px-2 font-medium text-slate-900">
                          {result.discrepancies.year.registered}
                        </td>
                        <td className="py-2 px-2 text-right font-bold">
                          {result.discrepancies.year.matches ? (
                            <span className="text-emerald-700">Matched</span>
                          ) : (
                            <span className="text-amber-700">Conflict</span>
                          )}
                        </td>
                      </tr>
                    )}
                    {result.discrepancies.venue && (
                      <tr className={cn(!result.discrepancies.venue.matches && "bg-amber-100/40")}>
                        <td className="py-2 px-2 font-semibold">Venue</td>
                        <td className="py-2 px-2">{result.discrepancies.venue.submitted}</td>
                        <td className="py-2 px-2 font-medium text-slate-900">
                          {result.discrepancies.venue.registered}
                        </td>
                        <td className="py-2 px-2 text-right font-bold">
                          {result.discrepancies.venue.matches ? (
                            <span className="text-emerald-700">Matched</span>
                          ) : (
                            <span className="text-amber-700">Notice</span>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Option to adopt registry metadata for VERIFIED citations if needed */}
          {result.status === "VERIFIED" && onApplyVerifiedMetadata && result.registeredMetadata && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-emerald-800 bg-emerald-50/60 p-3 rounded-xl border border-emerald-200">
              <span className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>
                  {result.comparedFields?.matched.length === 0
                    ? `Identifier verified in ${result.registeredMetadata.sourceRegistry}. Authoritative metadata is ready to import.`
                    : `Metadata verified against official registry record (${result.registeredMetadata.sourceRegistry}).`}
                </span>
              </span>
              <Button
                onClick={() => onApplyVerifiedMetadata(result.registeredMetadata!)}
                size="sm"
                variant="outline"
                className="text-xs border-emerald-300 text-emerald-900 hover:bg-emerald-100 gap-1 h-7 font-semibold shrink-0"
              >
                <Sparkles className="h-3 w-3 text-emerald-600" />
                {result.comparedFields?.matched.length === 0
                  ? "Populate Reference from Registry"
                  : "Sync with Registry"}
              </Button>
            </div>
          )}

          {/* Mandatory Academic Integrity Notice */}
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-[11px] text-slate-500 leading-normal flex items-start gap-2">
            <Info className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
            <span>
              <strong>Academic Integrity Notice:</strong> {result.academicIntegrityNotice}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
