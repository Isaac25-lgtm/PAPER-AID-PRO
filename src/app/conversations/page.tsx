import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  MessageSquare,
  Sparkles,
  Clock,
  ArrowRight,
  BookOpen,
  FileText,
  Search,
  Bot,
  Layers,
  Compass,
} from "lucide-react";
import { SectionHeader } from "@/components/shared/section-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/utils";

export const metadata = {
  title: "Research History | AI Research Hub",
  description: "Reopen previous manuscript Q&A threads, multi-paper research synthesis, and deep investigations.",
};

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams?: { type?: string };
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/history");
  }

  const typeFilter = searchParams?.type || "all";

  const allConversations = await prisma.aIConversation.findMany({
    where: {
      userId: session.user.id,
    },
    include: {
      paper: {
        select: {
          id: true,
          title: true,
          journal: true,
          citationCount: true,
        },
      },
      messages: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: {
          role: true,
          content: true,
          createdAt: true,
        },
      },
      _count: {
        select: { messages: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Categorize conversation items
  const categorized = allConversations.map((convo) => {
    if (convo.paperId !== null) {
      return {
        ...convo,
        itemType: "qa" as const,
        typeLabel: "Paper Q&A",
        badgeVariant: "secondary" as const,
        badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200",
        displayTitle: convo.title || "Manuscript Q&A",
        resumeUrl: `/papers/${convo.paperId}?conversationId=${convo.id}#ask-paper`,
        actionLabel: "Resume Q&A Thread",
        icon: MessageSquare,
      };
    }
    if (convo.title.startsWith("[Agent]")) {
      return {
        ...convo,
        itemType: "deep" as const,
        typeLabel: "Deep Research",
        badgeVariant: "default" as const,
        badgeClass: "bg-purple-50 text-purple-700 border-purple-200",
        displayTitle: convo.title.replace(/^\[Agent\]\s*/, ""),
        resumeUrl: `/research?tab=deep&thread=${convo.id}`,
        actionLabel: "Open Deep Research",
        icon: Bot,
      };
    }
    return {
      ...convo,
      itemType: "quick" as const,
      typeLabel: "Quick Research",
      badgeVariant: "default" as const,
      badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-200",
      displayTitle: convo.title || "Literature Synthesis",
      resumeUrl: `/research?tab=quick&thread=${convo.id}`,
      actionLabel: "Open Synthesis",
      icon: Sparkles,
    };
  });

  // Apply type filter
  const filtered = typeFilter === "all"
    ? categorized
    : categorized.filter((c) => c.itemType === typeFilter);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <SectionHeader
        badge="Workspace History"
        title="Research History"
        description="Revisit past manuscript questions, literature syntheses, and deep research investigations with verifiable evidence."
        action={
          <div className="flex items-center gap-2">
            <Link href="/papers">
              <Button size="sm" variant="outline" className="text-xs gap-1.5 border-slate-300">
                <BookOpen className="h-4 w-4 text-slate-500" />
                <span>Explore Library</span>
              </Button>
            </Link>
            <Link href="/research">
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-xs gap-1.5">
                <Layers className="h-4 w-4" />
                <span>New Research</span>
              </Button>
            </Link>
          </div>
        }
      />

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100/80 rounded-xl text-xs font-semibold w-fit">
        <Link href="/history">
          <button
            type="button"
            className={`px-3 py-1.5 rounded-lg transition-all ${
              typeFilter === "all"
                ? "bg-white text-indigo-700 shadow-2xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            All History ({categorized.length})
          </button>
        </Link>
        <Link href="/history?type=qa">
          <button
            type="button"
            className={`px-3 py-1.5 rounded-lg transition-all ${
              typeFilter === "qa"
                ? "bg-white text-indigo-700 shadow-2xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Paper Q&amp;A ({categorized.filter((c) => c.itemType === "qa").length})
          </button>
        </Link>
        <Link href="/history?type=quick">
          <button
            type="button"
            className={`px-3 py-1.5 rounded-lg transition-all ${
              typeFilter === "quick"
                ? "bg-white text-emerald-800 shadow-2xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Quick Research ({categorized.filter((c) => c.itemType === "quick").length})
          </button>
        </Link>
        <Link href="/history?type=deep">
          <button
            type="button"
            className={`px-3 py-1.5 rounded-lg transition-all ${
              typeFilter === "deep"
                ? "bg-white text-purple-700 shadow-2xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Deep Research ({categorized.filter((c) => c.itemType === "deep").length})
          </button>
        </Link>
      </div>

      {filtered.length === 0 ? (
        <Card className="bg-white border-dashed border-2 border-slate-300 p-12 text-center space-y-4 rounded-2xl">
          <div className="mx-auto h-12 w-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Clock className="h-6 w-6" />
          </div>
          <div className="max-w-md mx-auto space-y-2">
            <h3 className="text-base font-semibold text-slate-900">
              {typeFilter === "all"
                ? "Your Research Investigations Will Appear Here"
                : "No Past Work In This Category"}
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
              {typeFilter === "all"
                ? "Ask questions on individual manuscripts, synthesize evidence across multiple papers, or formulate deep research runs. All past work is saved here for later reference."
                : "Try switching to another tab or starting a new research inquiry in the workspace."}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link href="/papers">
              <Button size="sm" variant="outline" className="text-xs">
                Browse Research Papers
              </Button>
            </Link>
            <Link href="/research">
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-xs">
                Start Research
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((convo) => {
            const lastMessage = convo.messages[0];
            const ItemIcon = convo.icon;

            return (
              <Card
                key={convo.id}
                className="bg-white border border-slate-200/80 p-5 rounded-2xl hover:border-indigo-300 hover:shadow-xs transition-all flex flex-col justify-between space-y-4 group"
              >
                <div className="space-y-3">
                  {/* Top Bar: Type Pill & Updated Date */}
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${convo.badgeClass}`}
                    >
                      <ItemIcon className="h-3 w-3" />
                      <span>{convo.typeLabel}</span>
                    </span>

                    <span className="inline-flex items-center gap-1 text-slate-500 font-medium">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      {formatDate(convo.updatedAt.toISOString())}
                    </span>
                  </div>

                  {/* Thread Title */}
                  <Link href={convo.resumeUrl}>
                    <h3 className="text-base font-bold text-slate-900 group-hover:text-indigo-600 transition-colors line-clamp-2">
                      {convo.displayTitle}
                    </h3>
                  </Link>

                  {/* Associated Paper if single-paper */}
                  {convo.paper && (
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-2">
                      <FileText className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800 line-clamp-1">
                          {convo.paper.title}
                        </div>
                        {convo.paper.journal && (
                          <div className="text-[11px] text-slate-500 italic">
                            {convo.paper.journal}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Recent Message Preview */}
                  {lastMessage && (
                    <div className="text-xs text-slate-600 line-clamp-2 italic bg-slate-50/50 p-2.5 rounded-xl border border-slate-100">
                      <span className="font-semibold not-italic text-slate-700">
                        {lastMessage.role === "USER" ? "Question: " : "Evidence: "}
                      </span>
                      &ldquo;{lastMessage.content}&rdquo;
                    </div>
                  )}
                </div>

                {/* Card Action */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">
                    {convo._count.messages} {convo._count.messages === 1 ? "entry" : "entries"}
                  </span>
                  <Link href={convo.resumeUrl}>
                    <Button size="sm" variant="ghost" className="h-8 text-xs text-indigo-600 hover:text-indigo-800 font-semibold gap-1">
                      <span>{convo.actionLabel}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
