"use client";

import * as React from "react";
import Link from "next/link";
import {
  Check,
  Sparkles,
  Zap,
  Building2,
  ShieldCheck,
  HelpCircle,
  ArrowRight,
  Cpu,
  Layers,
} from "lucide-react";
import { siteConfig, PricingPlan } from "@/config/site";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface PricingSectionProps {
  showTitle?: boolean;
  showComparisonTable?: boolean;
}

export function PricingSection({
  showTitle = true,
  showComparisonTable = true,
}: PricingSectionProps) {
  const [isAnnual, setIsAnnual] = React.useState(true);
  const [showTable, setShowTable] = React.useState(false);

  return (
    <section id="pricing" className="py-16 sm:py-24 relative overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-12">
        {/* Section Header */}
        {showTitle && (
          <div className="text-center space-y-4 max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200/80 bg-indigo-50/80 px-3.5 py-1 text-xs font-semibold text-indigo-700 shadow-xs">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Transparent Academic Pricing</span>
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900">
              Pick the Right Plan for Your Research
            </h2>
            <p className="text-base sm:text-lg text-slate-600 leading-relaxed">
              Every tier includes our grounded AI citation engine. Upgrade anytime as your literature
              and publication pipeline expands.
            </p>

            {/* Billing Interval Switcher */}
            <div className="pt-4 flex items-center justify-center">
              <div className="inline-flex items-center rounded-full bg-slate-100 p-1 border border-slate-200/80 shadow-xs">
                <button
                  type="button"
                  onClick={() => setIsAnnual(false)}
                  className={cn(
                    "rounded-full px-5 py-2 text-xs sm:text-sm font-semibold transition-all",
                    !isAnnual
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  Monthly Billing
                </button>
                <button
                  type="button"
                  onClick={() => setIsAnnual(true)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-5 py-2 text-xs sm:text-sm font-semibold transition-all",
                    isAnnual
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  <span>Annual Billing</span>
                  <span
                    className={cn(
                      "text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full",
                      isAnnual
                        ? "bg-indigo-500 text-white"
                        : "bg-emerald-100 text-emerald-700"
                    )}
                  >
                    Save 25%
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Pricing Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
          {siteConfig.pricingPlans.map((plan: PricingPlan) => {
            const price = isAnnual ? plan.annualPrice : plan.monthlyPrice;

            return (
              <Card
                key={plan.id}
                className={cn(
                  "relative flex flex-col justify-between transition-all duration-300 hover:translate-y-[-4px]",
                  plan.popular
                    ? "border-indigo-500 ring-2 ring-indigo-500/20 shadow-xl bg-gradient-to-b from-indigo-50/50 via-white to-white"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-lg"
                )}
              >
                {plan.popular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-3 py-1 text-xs font-bold text-white shadow-sm">
                      <Zap className="h-3 w-3 fill-current" />
                      Most Popular
                    </span>
                  </div>
                )}

                <CardHeader className="p-6 pb-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-slate-900">{plan.name}</h3>
                    <Badge variant={plan.popular ? "default" : "secondary"} className="text-[11px]">
                      {plan.creditsPerMonth.toLocaleString()} credits/mo
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 min-h-[32px]">{plan.description}</p>

                  {/* Price */}
                  <div className="pt-4 pb-2 border-b border-slate-100">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-extrabold tracking-tight text-slate-900">
                        ${price}
                      </span>
                      <span className="text-xs text-slate-500 font-medium">/ month</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {isAnnual
                        ? price === 0
                          ? "Always free"
                          : `Billed annually ($${price * 12}/year)`
                        : price === 0
                        ? "Always free"
                        : "Billed monthly, cancel anytime"}
                    </p>
                  </div>
                </CardHeader>

                <CardContent className="p-6 pt-0 space-y-6 flex-1">
                  {/* Credit Allowance Matrix */}
                  <div className="rounded-lg bg-slate-50/80 p-3 border border-slate-100 space-y-2 text-xs">
                    <div className="font-semibold text-slate-700 text-[11px] uppercase tracking-wider">
                      Quota Highlights
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Search & Index:</span>
                      <span className="font-medium text-slate-900">{plan.creditBreakdown.searches}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>PDF Analysis:</span>
                      <span className="font-medium text-slate-900">{plan.creditBreakdown.pdfChats}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Thesis/Proposal:</span>
                      <span className="font-medium text-slate-900">{plan.creditBreakdown.thesisGeneration}</span>
                    </div>
                  </div>

                  {/* Features List */}
                  <div className="space-y-2.5">
                    <div className="text-xs font-semibold text-slate-800">Everything included:</div>
                    <ul className="space-y-2 text-xs text-slate-600">
                      {plan.features.map((feature, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>

                <CardFooter className="p-6 pt-2 border-t border-slate-100">
                  <Button
                    asChild
                    className={cn(
                      "w-full font-semibold shadow-xs",
                      plan.popular
                        ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                        : "bg-slate-900 hover:bg-slate-800 text-white"
                    )}
                  >
                    <Link href="/register">
                      {plan.ctaText}
                      <ArrowRight className="ml-1.5 h-4 w-4" />
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>

        {/* Institution / Team Enterprise Banner */}
        <div className="rounded-2xl border border-indigo-200/80 bg-gradient-to-r from-indigo-900 via-slate-900 to-indigo-950 p-8 text-white shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-2 text-center md:text-left">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-indigo-300">
              <Building2 className="h-3.5 w-3.5" />
              <span>University & Enterprise Licensing</span>
            </div>
            <h3 className="text-2xl font-bold tracking-tight">Need Campus-Wide or Custom Lab Access?</h3>
            <p className="text-sm text-slate-300 max-w-2xl">
              We offer centralized university IP authentication, single sign-on (SSO), unlimited batch PDF processing,
              and dedicated Scholar API & MCP endpoints for research institutions.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <Button asChild variant="outline" className="bg-white/10 hover:bg-white/20 text-white border-white/20">
              <Link href="/tools#mcp">Explore Scholar MCP</Link>
            </Button>
            <Button asChild className="bg-indigo-500 hover:bg-indigo-600 text-white">
              <a href="mailto:contact@research-hub.ai?subject=Institutional%20License%20Inquiry">
                Request Campus License
              </a>
            </Button>
          </div>
        </div>

        {/* Interactive Comparison Table Toggle */}
        {showComparisonTable && (
          <div className="pt-8 text-center space-y-6">
            <Button
              variant="outline"
              onClick={() => setShowTable(!showTable)}
              className="gap-2 text-sm text-slate-700 font-semibold"
            >
              <Layers className="h-4 w-4 text-indigo-600" />
              {showTable ? "Hide Detailed Feature Comparison" : "Compare All Features & Capabilities"}
            </Button>

            {showTable && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm p-4 text-left transition-all">
                <table className="w-full text-xs text-slate-700 border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70">
                      <th className="p-3 font-bold text-slate-900">Feature</th>
                      <th className="p-3 font-bold text-slate-900 text-center">Explorer (Free)</th>
                      <th className="p-3 font-bold text-slate-900 text-center">Scholar ($10)</th>
                      <th className="p-3 font-bold text-indigo-600 text-center bg-indigo-50/50">Pro ($25)</th>
                      <th className="p-3 font-bold text-slate-900 text-center">Lab ($85)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="p-3 font-medium">Monthly AI Credits</td>
                      <td className="p-3 text-center">100</td>
                      <td className="p-3 text-center">500</td>
                      <td className="p-3 text-center font-bold text-indigo-600 bg-indigo-50/30">1,500</td>
                      <td className="p-3 text-center font-bold">12,000</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-medium">Literature Catalog Search</td>
                      <td className="p-3 text-center text-emerald-600 font-bold">✓</td>
                      <td className="p-3 text-center text-emerald-600 font-bold">✓</td>
                      <td className="p-3 text-center text-emerald-600 font-bold bg-indigo-50/30">✓</td>
                      <td className="p-3 text-center text-emerald-600 font-bold">✓</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-medium">Evidence-Grounded AI Analysis</td>
                      <td className="p-3 text-center text-slate-400">—</td>
                      <td className="p-3 text-center text-emerald-600 font-bold">✓</td>
                      <td className="p-3 text-center text-emerald-600 font-bold bg-indigo-50/30">Priority</td>
                      <td className="p-3 text-center text-emerald-600 font-bold">Unlimited</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-medium">Original PDF Reading &amp; Chunk View</td>
                      <td className="p-3 text-center">3 papers / mo</td>
                      <td className="p-3 text-center">50 papers / mo</td>
                      <td className="p-3 text-center font-bold text-indigo-600 bg-indigo-50/30">Unlimited</td>
                      <td className="p-3 text-center font-bold">Unlimited (Batch)</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-medium">Personal My Library Bookmarks</td>
                      <td className="p-3 text-center text-emerald-600 font-bold">✓</td>
                      <td className="p-3 text-center text-emerald-600 font-bold">✓</td>
                      <td className="p-3 text-center text-emerald-600 font-bold bg-indigo-50/30">✓</td>
                      <td className="p-3 text-center text-emerald-600 font-bold">✓</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-medium">Systematic Synthesis Tools (Roadmap)</td>
                      <td className="p-3 text-center text-slate-400">—</td>
                      <td className="p-3 text-center text-slate-400">—</td>
                      <td className="p-3 text-center text-emerald-600 font-bold bg-indigo-50/30">Roadmap</td>
                      <td className="p-3 text-center text-emerald-600 font-bold">Roadmap</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-medium">Citation Formats &amp; Exports</td>
                      <td className="p-3 text-center text-emerald-600 font-bold">✓</td>
                      <td className="p-3 text-center text-emerald-600 font-bold">✓</td>
                      <td className="p-3 text-center text-emerald-600 font-bold bg-indigo-50/30">✓</td>
                      <td className="p-3 text-center text-emerald-600 font-bold">✓</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-medium">Reference Manager Sync (Roadmap)</td>
                      <td className="p-3 text-center text-slate-400">—</td>
                      <td className="p-3 text-center text-emerald-600 font-bold">Roadmap</td>
                      <td className="p-3 text-center text-emerald-600 font-bold bg-indigo-50/30">Roadmap</td>
                      <td className="p-3 text-center text-emerald-600 font-bold">Roadmap</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-medium">Programmatic API Access (Roadmap)</td>
                      <td className="p-3 text-center text-slate-400">—</td>
                      <td className="p-3 text-center text-slate-400">—</td>
                      <td className="p-3 text-center text-slate-400 bg-indigo-50/30">—</td>
                      <td className="p-3 text-center text-emerald-600 font-bold">Roadmap</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-medium">Team Member Seats</td>
                      <td className="p-3 text-center">1</td>
                      <td className="p-3 text-center">1</td>
                      <td className="p-3 text-center bg-indigo-50/30">1</td>
                      <td className="p-3 text-center font-bold">Up to 5 seats</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
