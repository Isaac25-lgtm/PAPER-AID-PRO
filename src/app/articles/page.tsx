import Link from "next/link";
import { BookOpen, Calendar, ArrowRight, Sparkles } from "lucide-react";
import { SectionHeader } from "@/components/shared/section-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const articles = [
  {
    id: "art-1",
    title: "Understanding Hallucination Mitigation in Retrieval-Augmented Generation",
    excerpt: "An architectural overview of how dense vector retrieval and strict context conditioning keep LLM answers tethered to factual literature.",
    date: "Feb 12, 2024",
    author: "AI Research Hub Editorial",
    category: "AI Methodologies",
  },
  {
    id: "art-2",
    title: "The Evolution of Biomolecular Prediction: From AlphaFold 1 to Multimodal AlphaFold 3",
    excerpt: "Examining the transition from MSA-driven evoformers to full diffusion generative networks in protein-nucleic acid complex modeling.",
    date: "Jan 28, 2024",
    author: "Computational Biology Review",
    category: "Structural Biology",
  },
];

export default function ArticlesPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <SectionHeader
        badge="Insights & Reviews"
        title="Research Articles"
        description="In-depth meta-analyses, methodology syntheses, and state-of-the-art overviews."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {articles.map((article) => (
          <Card key={article.id} className="bg-white hover:border-indigo-300 transition-all p-6 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <Badge variant="academic">{article.category}</Badge>
                <span>{article.date}</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 leading-snug">
                {article.title}
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                {article.excerpt}
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>By {article.author}</span>
              <span className="text-indigo-600 font-medium inline-flex items-center gap-1">
                Read article <ArrowRight className="h-3 w-3" />
              </span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
