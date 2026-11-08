import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ArrowLeft, MessageSquare, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export default async function ConversationThreadPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/conversations/${params.id}`);
  }

  const conversation = await prisma.aIConversation.findUnique({
    where: { id: params.id },
    select: { id: true, userId: true, title: true },
  });

  if (!conversation || conversation.userId !== session.user.id) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-10 space-y-6">
      <Link
        href="/conversations"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to conversations
      </Link>

      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-indigo-600" />
          Research Thread: {conversation.title || params.id}
        </h1>
        <p className="text-xs text-slate-500">
          The conversational RAG interface with citation cards and chunk verification will be implemented in Phase 5.
        </p>
      </div>
    </div>
  );
}
