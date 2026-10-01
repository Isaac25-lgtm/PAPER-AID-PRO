"use client";

import * as React from "react";
import { ChevronDown, HelpCircle, ShieldCheck, Sparkles } from "lucide-react";
import { siteConfig, FAQItem } from "@/config/site";
import { cn } from "@/lib/utils";

export function FAQsSection() {
  const [openIndex, setOpenIndex] = React.useState<number | null>(0);
  const [activeCategory, setActiveCategory] = React.useState<string>("all");

  const categories = [
    { id: "all", label: "All Questions" },
    { id: "discovery", label: "Literature Discovery" },
    { id: "integrity", label: "Evidence Grounding" },
    { id: "library", label: "Library & PDFs" },
  ];

  const filteredFaqs =
    activeCategory === "all"
      ? siteConfig.academicFaqs
      : siteConfig.academicFaqs.filter((f) => f.category === activeCategory);

  const toggleAccordion = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section id="faqs" className="py-16 sm:py-20 relative">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 space-y-10">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200/80 bg-indigo-50/80 px-3.5 py-1 text-xs font-semibold text-indigo-700 shadow-xs">
            <HelpCircle className="h-3.5 w-3.5" />
            <span>Frequently Asked Questions</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            Clear Answers for Academics & Researchers
          </h2>
          <p className="text-sm sm:text-base text-slate-600 max-w-xl mx-auto">
            Everything you need to know about literature discovery, manuscript evidence grounding,
            PDF reading, and organizing your research.
          </p>
        </div>

        {/* Category Filter Pills */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => {
                setActiveCategory(cat.id);
                setOpenIndex(0);
              }}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-semibold transition-all",
                activeCategory === cat.id
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Accordion List */}
        <div className="space-y-3">
          {filteredFaqs.map((faq: FAQItem, index: number) => {
            const isOpen = openIndex === index;

            return (
              <div
                key={index}
                className={cn(
                  "rounded-xl border transition-all duration-200 overflow-hidden",
                  isOpen
                    ? "border-indigo-200 bg-white shadow-sm ring-1 ring-indigo-500/10"
                    : "border-slate-200 bg-white/70 hover:border-slate-300"
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleAccordion(index)}
                  className="flex w-full items-center justify-between gap-4 p-5 text-left font-semibold text-sm sm:text-base text-slate-900 focus:outline-none"
                >
                  <span className="flex-1">{faq.question}</span>
                  <div
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 transition-transform duration-200",
                      isOpen && "rotate-180 bg-indigo-50 text-indigo-600"
                    )}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </div>
                </button>

                {isOpen && (
                  <div className="px-5 pb-5 pt-1 text-xs sm:text-sm text-slate-600 leading-relaxed border-t border-slate-100/60">
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Support Callout */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-center text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-center gap-2">
          <span>Have an institutional query or research question?</span>
          <a
            href="mailto:support@research-hub.ai"
            className="font-semibold text-indigo-600 hover:underline"
          >
            Contact our Academic Support Team →
          </a>
        </div>
      </div>
    </section>
  );
}
