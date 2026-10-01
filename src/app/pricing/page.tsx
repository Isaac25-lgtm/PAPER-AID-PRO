import type { Metadata } from "next";
import { PricingSection } from "@/components/pricing/pricing-section";
import { FAQsSection } from "@/components/home/faqs-section";
import { Sparkles, ShieldCheck, CheckCircle2, Lock, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Pricing & Plans",
  description:
    "Explore transparent academic pricing for AI Research Hub. Free tier, Scholar plan, Pro Researcher, and institutional lab licenses with verifiable citation guarantees.",
};

export default function PricingPage() {
  return (
    <div className="space-y-16 sm:space-y-24 pb-16">
      {/* 1. PRICING HERO BANNER */}
      <section className="relative overflow-hidden pt-12 sm:pt-20 pb-8 border-b border-slate-200/70 bg-gradient-to-b from-indigo-50/50 via-white to-transparent">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200/80 bg-indigo-50/80 px-3.5 py-1 text-xs font-semibold text-indigo-700 shadow-xs">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Academic Rigor • Grounded in Source Evidence</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 leading-tight">
            Research with Grounded AI.{" "}
            <span className="text-indigo-600 bg-clip-text">Simple, Transparent Pricing.</span>
          </h1>

          <p className="text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
            Choose a plan that fits your research workflow, with verified manuscript citations,
            original PDF access, and personal library management.
          </p>

          {/* Trust Guarantees */}
          <div className="flex flex-wrap items-center justify-center gap-6 pt-4 text-xs font-medium text-slate-600">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              14-Day Money-Back Guarantee
            </span>
            <span className="flex items-center gap-1.5">
              <Lock className="h-4 w-4 text-indigo-600" />
              Cancel or Switch Anytime
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-blue-600" />
              GDPR & IRB Compliant Storage
            </span>
          </div>
        </div>
      </section>

      {/* 2. CORE PRICING CARDS & COMPARISON TABLE */}
      <PricingSection showTitle={false} showComparisonTable={true} />

      {/* 3. HOW CREDITS WORK EXPLAINER */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-8 sm:p-10 space-y-6">
          <div className="max-w-2xl space-y-2">
            <h3 className="text-xl sm:text-2xl font-bold text-slate-900">How Do Research Credits Work?</h3>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Credits represent compute units for document ingestion, section chunking,
              and evidence-grounded AI summarization. Here is how your credits are utilized:
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs space-y-1.5">
              <div className="font-bold text-indigo-600 text-sm">1 Credit</div>
              <div className="font-semibold text-slate-900">Literature Catalog Search</div>
              <p className="text-slate-500">Query papers across titles, abstracts, DOIs, authors, and keywords.</p>
            </div>
            <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs space-y-1.5">
              <div className="font-bold text-indigo-600 text-sm">5 Credits</div>
              <div className="font-semibold text-slate-900">Manuscript Understanding</div>
              <p className="text-slate-500">Evidence-grounded AI analysis of a scientific paper with chunk citations.</p>
            </div>
            <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs space-y-1.5">
              <div className="font-bold text-indigo-600 text-sm">15 Credits</div>
              <div className="font-semibold text-slate-900">Multi-Paper Synthesis (Roadmap)</div>
              <p className="text-slate-500">Consensus extraction and methodology comparison across multiple papers.</p>
            </div>
            <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs space-y-1.5">
              <div className="font-bold text-indigo-600 text-sm">30 Credits</div>
              <div className="font-semibold text-slate-900">Batch Document Ingestion</div>
              <p className="text-slate-500">Processing and chunking of large multi-section manuscripts and dissertations.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. ACADEMIC FAQS */}
      <FAQsSection />

      {/* 5. CALL TO ACTION */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-3xl bg-indigo-600 p-8 sm:p-12 text-center text-white shadow-xl space-y-6">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            Ready to Accelerate Your Scientific Discovery?
          </h2>
          <p className="text-indigo-100 max-w-2xl mx-auto text-sm sm:text-base leading-relaxed">
            Join thousands of professors, postdocs, graduate students, and industry engineers conducting
            verifiable research in minutes.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Button asChild size="lg" className="bg-white text-indigo-600 hover:bg-indigo-50 font-bold shadow-md">
              <Link href="/register">
                Start Exploring Free
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="text-white border-white/30 hover:bg-white/10">
              <Link href="/papers">Browse Indexed Papers</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
