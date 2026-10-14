import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getResearchDocument } from "@/lib/editor/document-service";
import { EditorClient } from "./editor-client";

export const dynamic = "force-dynamic";

interface EditorPageProps {
  params: {
    id: string;
  };
}

export async function generateMetadata({ params }: EditorPageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { title: "Research Editor | AI Research Hub" };
  }

  try {
    const document = await getResearchDocument(session.user.id, params.id);
    return {
      title: `${document.title} | AI Research Editor`,
      description: "Interactive research editor with verified citations and AI assistance.",
    };
  } catch {
    return { title: "Research Editor | AI Research Hub" };
  }
}

export default async function EditorDocumentPage({ params }: EditorPageProps) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/editor/${params.id}`);
  }

  try {
    const document = await getResearchDocument(session.user.id, params.id);
    return <EditorClient initialDocument={document} />;
  } catch (err: any) {
    console.error(`Document access error for user ${session.user.id}, doc ${params.id}:`, err);
    notFound();
  }
}
