import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getUserLibraryItems } from "@/lib/library/user-library-service";
import { getUserCollections } from "@/lib/library/collections-service";
import {
  DashboardView,
  DashboardDocumentItem,
  DashboardLibraryItem,
  DashboardConversationItem,
} from "@/components/dashboard/dashboard-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Research Workspace | AI Research Hub",
  description:
    "Evidence-grounded researcher dashboard for managing active manuscripts, library sources, and grounded synthesis.",
};

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard");
  }

  const userId = session.user.id;

  // Parallel server-side data fetching scoped strictly to authenticated user
  const [
    recentDocuments,
    totalDocuments,
    libraryItems,
    collections,
    recentConversations,
    totalConversations,
  ] = await Promise.all([
    // 1. Recent research documents
    prisma.researchDocument.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 4,
      select: {
        id: true,
        title: true,
        docType: true,
        version: true,
        textContent: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            citations: true,
            linkedPapers: true,
          },
        },
      },
    }),

    // 2. Total document count
    prisma.researchDocument.count({
      where: { userId },
    }),

    // 3. User library items (uploads + saved papers)
    getUserLibraryItems(userId).catch(() => []),

    // 4. User collections
    getUserCollections(userId).catch(() => []),

    // 5. Recent research synthesis threads
    prisma.aIConversation.findMany({
      where: {
        userId,
        NOT: { title: { startsWith: "__SYSTEM_" } },
      },
      orderBy: { updatedAt: "desc" },
      take: 4,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        paper: {
          select: {
            id: true,
            title: true,
            journal: true,
          },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: {
            content: true,
            role: true,
            createdAt: true,
          },
        },
      },
    }),

    // 6. Total conversation count
    prisma.aIConversation.count({
      where: {
        userId,
        NOT: { title: { startsWith: "__SYSTEM_" } },
      },
    }),
  ]);

  // Format library items for dashboard
  const formattedLibraryItems: DashboardLibraryItem[] = libraryItems.map((item) => ({
    id: item.id,
    title: item.title,
    abstract: item.abstract,
    authors: item.authors || [],
    institution: item.institution,
    journal: item.journal,
    publicationDate: item.publicationDate,
    isPrivate: item.isPrivate,
    documentType: item.documentType,
    status: item.status,
    chunksCount: item.chunkCount ?? (item as any).chunksCount ?? 0,
  }));

  // Format conversations for dashboard
  const formattedConversations: DashboardConversationItem[] = recentConversations.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt,
    paper: c.paper,
    messages: c.messages,
  }));

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <DashboardView
        user={{
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          role: session.user.role,
        }}
        documents={recentDocuments as DashboardDocumentItem[]}
        totalDocuments={totalDocuments}
        libraryItems={formattedLibraryItems}
        totalLibraryItems={libraryItems.length}
        collectionsCount={collections.length}
        conversations={formattedConversations}
        totalConversations={totalConversations}
      />
    </div>
  );
}
