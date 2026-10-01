import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { SectionHeader } from "@/components/shared/section-header";
import { UnifiedResearchWorkspace } from "@/components/research/unified-research-workspace";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogIn, Layers } from "lucide-react";

export const maxDuration = 300; // Allow long research agent executions up to 5 minutes on Vercel Pro

export const metadata = {
  title: "Research Workspace | AI Research Hub",
  description:
    "Grounded multi-paper synthesis and autonomous research investigations anchored to peer-reviewed manuscripts.",
};

export default async function ResearchPage({
  searchParams,
}: {
  searchParams?: { thread?: string; tab?: string };
}) {
  const session = await getServerSession(authOptions);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <SectionHeader
        badge="Research Workspace"
        title="Evidence-Grounded Research Workspace"
        description="Synthesize findings across your library manuscripts or conduct deep investigations across connected scholarly sources with verified citation anchors."
      />

      {!session?.user ? (
        <Card className="bg-white border-slate-200 p-12 text-center space-y-4 rounded-2xl max-w-xl mx-auto shadow-xs">
          <div className="mx-auto h-12 w-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Layers className="h-6 w-6" />
          </div>
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-slate-900">
              Sign In to Access Research Workspace
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Research synthesis and investigations require an authenticated account to maintain persistent research threads and protect citation history.
            </p>
          </div>
          <div className="pt-2">
            <Link href="/login?callbackUrl=/research">
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
                <LogIn className="h-4 w-4" />
                Sign In to Continue
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <UnifiedResearchWorkspace
          initialThreadId={searchParams?.thread}
          defaultTab={searchParams?.tab === "deep" ? "deep" : "quick"}
        />
      )}
    </div>
  );
}
