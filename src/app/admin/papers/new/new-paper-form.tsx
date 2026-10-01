"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  Users,
  Layers,
  Sparkles,
  Link as LinkIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Calendar,
  BookOpen,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createPaper } from "../actions";

interface CategoryOption {
  id: string;
  name: string;
  slug: string;
}

export function NewPaperForm({ categories }: { categories: CategoryOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  // Form states
  const [selectedCategories, setSelectedCategories] = React.useState<string[]>([]);

  const toggleCategory = (catId: string) => {
    setSelectedCategories((prev) =>
      prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
    );
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const formData = new FormData(form);

    // Append chosen categories
    selectedCategories.forEach((catId) => {
      formData.append("categoryIds", catId);
    });

    startTransition(async () => {
      const res = await createPaper(formData);
      if (!res.success) {
        setError(res.error || "Failed to create paper.");
      } else {
        setSuccess(true);
        setTimeout(() => {
          router.push(`/papers/${res.paperId}`);
          router.refresh();
        }, 1000);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-xs sm:text-sm text-red-700 shadow-xs">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs sm:text-sm text-emerald-800 shadow-xs">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>Manuscript published successfully! Redirecting to paper view...</span>
        </div>
      )}

      {/* 1. Core Metadata Card */}
      <Card className="bg-white p-6 sm:p-8 space-y-6">
        <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
          <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">
            1
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Bibliographic Metadata</h2>
            <p className="text-xs text-slate-500">Core publication credentials and external DOI / arXiv anchors</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="title" className="text-xs font-semibold text-slate-700">
              Paper Title <span className="text-red-500">*</span>
            </label>
            <Input
              id="title"
              name="title"
              placeholder="e.g. Attention Is All You Need"
              required
              disabled={isPending}
              className="text-sm font-medium"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="journal" className="text-xs font-semibold text-slate-700">
                Journal / Conference
              </label>
              <Input
                id="journal"
                name="journal"
                placeholder="e.g. NeurIPS, Nature, Physical Review A"
                disabled={isPending}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="publicationDate" className="text-xs font-semibold text-slate-700">
                Publication Date
              </label>
              <Input
                id="publicationDate"
                name="publicationDate"
                type="date"
                defaultValue={new Date().toISOString().split("T")[0]}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="doi" className="text-xs font-semibold text-slate-700">
                DOI Identifier
              </label>
              <Input
                id="doi"
                name="doi"
                placeholder="10.1038/s41586-024-..."
                disabled={isPending}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="arxivId" className="text-xs font-semibold text-slate-700">
                arXiv ID (Optional)
              </label>
              <Input
                id="arxivId"
                name="arxivId"
                placeholder="e.g. 1706.03762"
                disabled={isPending}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="citationCount" className="text-xs font-semibold text-slate-700">
                Initial Citation Count
              </label>
              <Input
                id="citationCount"
                name="citationCount"
                type="number"
                defaultValue="0"
                min="0"
                disabled={isPending}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div className="space-y-1.5">
              <label htmlFor="pdfFile" className="text-xs font-semibold text-slate-700">
                Upload PDF Manuscript (Supabase Storage)
              </label>
              <Input
                id="pdfFile"
                name="pdfFile"
                type="file"
                accept=".pdf,application/pdf"
                disabled={isPending}
                className="text-xs file:mr-3 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
              />
              <p className="text-[11px] text-slate-400">
                Direct PDF upload (max 30 MB). Triggers storage in <code>research-papers/</code> and deterministic text extraction.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="pdfUrl" className="text-xs font-semibold text-slate-700">
                External PDF Link (Optional Reference)
              </label>
              <div className="relative">
                <LinkIcon className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  id="pdfUrl"
                  name="pdfUrl"
                  type="url"
                  placeholder="https://arxiv.org/pdf/1706.03762.pdf"
                  className="pl-9"
                  disabled={isPending}
                />
              </div>
              <p className="text-[11px] text-slate-400">
                Direct public web link (arXiv, DOI resolver, or publisher repository)
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* 2. Abstract & Keywords */}
      <Card className="bg-white p-6 sm:p-8 space-y-6">
        <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
          <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">
            2
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Abstract &amp; Taxonomy</h2>
            <p className="text-xs text-slate-500">The author's original manuscript abstract and keyword indexing</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="abstract" className="text-xs font-semibold text-slate-700">
              Abstract <span className="text-red-500">*</span>
            </label>
            <textarea
              id="abstract"
              name="abstract"
              rows={5}
              placeholder="Paste the author's original verbatim abstract here..."
              required
              disabled={isPending}
              className="w-full rounded-md border border-slate-300 p-3 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="keywords" className="text-xs font-semibold text-slate-700">
              Keywords (Comma-separated)
            </label>
            <Input
              id="keywords"
              name="keywords"
              placeholder="Transformer, Self-Attention, Deep Learning, Translation"
              disabled={isPending}
            />
          </div>

          {/* Categories Selector */}
          <div className="space-y-2 pt-2">
            <label className="text-xs font-semibold text-slate-700 block">
              Disciplinary Categories
            </label>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => {
                const isSelected = selectedCategories.includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => toggleCategory(cat.id)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                      isSelected
                        ? "bg-indigo-600 border-indigo-600 text-white font-semibold shadow-xs"
                        : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {cat.name}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-400">Click to select all applicable domains</p>
          </div>
        </div>
      </Card>

      {/* 3. Authors & Affiliations */}
      <Card className="bg-white p-6 sm:p-8 space-y-6">
        <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
          <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">
            3
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Authors &amp; Institutions</h2>
            <p className="text-xs text-slate-500">
              Enter authors separated by semicolons. Specify institution in parentheses if available.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="authors" className="text-xs font-semibold text-slate-700">
            Author List
          </label>
          <textarea
            id="authors"
            name="authors"
            rows={3}
            placeholder="Ashish Vaswani (Google Brain); Noam Shazeer (Google Brain); Niki Parmar (Google Research)"
            disabled={isPending}
            className="w-full rounded-md border border-slate-300 p-3 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
          />
          <p className="text-[11px] text-slate-400">
            Format: <code>Author Name (Institution)</code> separated by semicolons (;) or new lines. The first author will be marked corresponding by default.
          </p>
        </div>
      </Card>

      {/* 4. Verbatim Manuscript Extracted Content (Zero-Hallucination Grounding) */}
      <Card className="bg-white p-6 sm:p-8 space-y-6">
        <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
          <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">
            4
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Manuscript Structured Sections (Verbatim Grounding)
            </h2>
            <p className="text-xs text-slate-500">
              Directly extracted text from author manuscript sections (NOT synthetic AI summaries)
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="researchQuestion" className="text-xs font-semibold text-slate-700">
              Research Question / Core Hypothesis
            </label>
            <textarea
              id="researchQuestion"
              name="researchQuestion"
              rows={2}
              placeholder="What core scientific problem or hypothesis does this manuscript investigate?"
              disabled={isPending}
              className="w-full rounded-md border border-slate-300 p-2.5 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="methodology" className="text-xs font-semibold text-slate-700">
              Methodology &amp; Experimental Architecture
            </label>
            <textarea
              id="methodology"
              name="methodology"
              rows={3}
              placeholder="Summary of empirical setup, model parameters, datasets, or lab procedures..."
              disabled={isPending}
              className="w-full rounded-md border border-slate-300 p-2.5 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="results" className="text-xs font-semibold text-slate-700">
              Empirical Results &amp; Key Findings
            </label>
            <textarea
              id="results"
              name="results"
              rows={3}
              placeholder="Numerical benchmarks, p-values, BLEU scores, or experimental outcomes..."
              disabled={isPending}
              className="w-full rounded-md border border-slate-300 p-2.5 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="limitations" className="text-xs font-semibold text-slate-700">
                Stated Limitations
              </label>
              <textarea
                id="limitations"
                name="limitations"
                rows={2}
                placeholder="Boundaries, compute constraints, or edge cases noted by authors..."
                disabled={isPending}
                className="w-full rounded-md border border-slate-300 p-2.5 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="conclusion" className="text-xs font-semibold text-slate-700">
                Author Conclusion
              </label>
              <textarea
                id="conclusion"
                name="conclusion"
                rows={2}
                placeholder="Primary takeaway and forward-looking scientific outlook..."
                disabled={isPending}
                className="w-full rounded-md border border-slate-300 p-2.5 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isPending}
          className="text-xs"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isPending}
          className="bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold px-6 shadow-sm"
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Publishing Manuscript…
            </>
          ) : (
            <>
              Publish to Catalog
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
