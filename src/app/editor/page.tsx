import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { listResearchDocuments } from "@/lib/editor/document-service";
import { DocumentsDashboard } from "./documents-dashboard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI Research Editor | AI Research Hub",
  description:
    "Compose scientific research manuscripts with inline AI autocomplete, verified citations, and evidence grounding.",
};

export default async function EditorDashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/editor");
  }

  const documents = await listResearchDocuments(session.user.id);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <DocumentsDashboard
        initialDocuments={documents}
        user={session.user}
      />
    </div>
  );
}
