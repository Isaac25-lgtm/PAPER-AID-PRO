import * as React from "react";
import Link from "next/link";
import { ShieldCheck, Lock, Eye, Cloud, FileText, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Privacy & Data Handling | AI Research Hub",
  description: "Plain-language overview of how manuscript data, AI processing, and research history are handled during the private beta.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2 text-slate-600 hover:text-slate-900 mb-4">
              <ArrowLeft className="h-4 w-4" />
              Back to Workspace
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 border border-indigo-200 rounded-xl text-indigo-700">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
                Privacy &amp; Data Handling
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                Private Beta Data Practices • Plain Language Transparency
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-8">
          {/* Introduction */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Lock className="h-5 w-5 text-indigo-600" />
              Our Commitment to Scientific Integrity &amp; Privacy
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              AI Research Hub is built specifically for academic scholars, clinicians, and research investigators.
              During our private beta, we operate with transparent, plain-language data principles. We do not sell your research data,
              and we do not use your uploaded manuscripts to train public foundation models.
            </p>
          </section>

          <hr className="border-slate-100" />

          {/* Section 1: Uploaded Papers */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <FileText className="h-5 w-5 text-indigo-600" />
              1. What Uploaded Papers Are Used For
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              When you upload a manuscript or retrieve an open-access PDF:
            </p>
            <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1.5 leading-relaxed">
              <li>
                <strong>Storage:</strong> The PDF file is stored securely in your private cloud storage bucket accessible only to your authenticated account session.
              </li>
              <li>
                <strong>Processing:</strong> The document is parsed locally by our ingestion engine to extract plain text and organize it into page- and section-referenced passages.
              </li>
              <li>
                <strong>Evidence Anchors:</strong> Extracted passages are indexed so that any generated findings can be anchored directly back to exact page numbers and verbatim excerpts.
              </li>
              <li>
                <strong>Isolation:</strong> Your private manuscript files and chunks are never shared with or made readable by other researchers on the platform.
              </li>
            </ul>
          </section>

          <hr className="border-slate-100" />

          {/* Section 2: AI Processing */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Eye className="h-5 w-5 text-indigo-600" />
              2. What AI Processing Occurs
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              When you use AI analysis features (such as generating an AI understanding summary, asking a question about a paper, or conducting multi-paper research):
            </p>
            <ul className="list-disc pl-5 text-sm text-slate-600 space-y-2 leading-relaxed">
              <li>
                <strong>Selected Manuscript Text:</strong> When AI analysis is requested, selected manuscript text and research questions may be sent to OpenAI&apos;s API for processing. Complete PDF files are never transmitted to OpenAI.
              </li>
              <li>
                <strong>No Response Storage:</strong> The application explicitly configures supported Responses API inference requests not to store response objects for later retrieval (<code>store: false</code>).
              </li>
              <li>
                <strong>Model Training Policy:</strong> OpenAI states that API inputs and outputs are not used to train its models by default unless an organization explicitly opts in to data sharing.
              </li>
              <li>
                <strong>Service &amp; Abuse Monitoring:</strong> OpenAI&apos;s applicable abuse-monitoring and service data-retention policies may still apply according to its standard platform terms. We do not claim zero data retention or enterprise endpoints.
              </li>
              <li>
                <strong>Evidence Anchors:</strong> All AI calls enforce structured outputs and require verified evidence chunk IDs, preventing claims from being detached from original manuscript sources.
              </li>
            </ul>
          </section>

          <hr className="border-slate-100" />

          {/* Section 3: Research History */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Cloud className="h-5 w-5 text-indigo-600" />
              3. What Research History Is Stored
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              To allow you to resume investigations across sessions, we store the following in your account:
            </p>
            <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1.5 leading-relaxed">
              <li>Your research questions and conversation history threads.</li>
              <li>Generated research briefs, synthesis notes, and cited manuscript anchors.</li>
              <li>Saved bookmarks and personal library collections.</li>
            </ul>
            <p className="text-sm text-slate-600 leading-relaxed">
              You can delete saved papers, bookmarks, and research history entries at any time from your account workspace.
            </p>
          </section>

          <hr className="border-slate-100" />

          {/* Section 4: External Services */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-indigo-600" />
              4. External Scholarly Services
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              When discovering literature, queries are dispatched to external public scholarly APIs:
            </p>
            <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1.5 leading-relaxed">
              <li><strong>PubMed / NCBI:</strong> National Library of Medicine biomedical database.</li>
              <li><strong>Crossref:</strong> Academic publisher DOI registration agency.</li>
              <li><strong>Semantic Scholar:</strong> Academic graph engine from the Allen Institute for AI.</li>
            </ul>
            <p className="text-sm text-slate-600 leading-relaxed">
              Only your research search terms are transmitted to these academic providers. No personal researcher information, account identifiers, or private manuscript files are ever transmitted to external discovery APIs.
            </p>
          </section>

          <hr className="border-slate-100" />

          {/* Beta Notice */}
          <section className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-4 text-xs text-amber-900 leading-relaxed">
            <strong>Private Beta Notice:</strong> AI Research Hub is currently in private research beta. While we follow strict academic data isolation and server-side encryption practices, this beta service is intended for open scientific research, preprint analysis, and academic literature synthesis. Do not upload classified, proprietary commercial secrets, or identifying patient health data.
          </section>
        </div>
      </div>
    </div>
  );
}
