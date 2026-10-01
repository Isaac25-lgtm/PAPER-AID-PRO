import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { SectionHeader } from "@/components/shared/section-header";
import { UnifiedResearchWorkspace } from "@/components/research/unified-research-workspace";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogIn, Bot } from "lucide-react";

export const maxDuration = 300; // Vercel Pro serverless timeout protection for deep research runs

export const metadata = {
  title: "Deep Research | AI Research Hub",
  description:
    "Evidence-grounded scientific research agent with local-first discovery, cross-study empirical comparison, and verified citation validation.",
};

export default async function AgentPage({
  searchParams,
}: {
  searchParams?: { thread?: string };
}) {
  const session = await getServerSession(authOptions);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <SectionHeader
        badge="Deep Research"
        title="Evidence-Grounded Deep Research"
        description="Formulates bounded research plans, evaluates library manuscripts, queries scholarly sources when needed, and extracts empirical comparisons with verified citations."
      />

      {!session?.user ? (
        <Card className="bg-white border-slate-200 p-12 text-center space-y-4 rounded-2xl max-w-xl mx-auto shadow-xs">
          <div className="mx-auto h-12 w-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Bot className="h-6 w-6" />
          </div>
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-slate-900">
              Sign In to Run Deep Research
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Deep research investigations require an authenticated account to maintain persistent research plans, trace telemetry, and citation history.
            </p>
          </div>
          <div className="pt-2">
            <Link href="/login?callbackUrl=/agent">
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
                <LogIn className="h-4 w-4" />
                Sign In to Continue
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <UnifiedResearchWorkspace
          defaultTab="deep"
          initialThreadId={searchParams?.thread}
        />
      )}
    </div>
  );
}
