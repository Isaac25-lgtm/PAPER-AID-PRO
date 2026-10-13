import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUserLibraryItems } from "@/lib/library/user-library-service";
import { getUserCollections } from "@/lib/library/collections-service";
import { LibraryView } from "./library-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "My Research Library | AI Research Hub",
  description:
    "Manage your personal research papers, collections, theses, and saved literature with evidence-grounded AI analysis.",
};

export default async function MyLibraryPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/library");
  }

  const [items, collections] = await Promise.all([
    getUserLibraryItems(session.user.id),
    getUserCollections(session.user.id),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <LibraryView
        initialItems={items}
        initialCollections={collections}
        user={session.user}
      />
    </div>
  );
}
