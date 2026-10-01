"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bookmark, BookmarkCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toggleBookmarkAction } from "@/app/papers/bookmark-actions";

interface SavePaperButtonProps {
  paperId: string;
  initialSaved?: boolean;
  className?: string;
  size?: "default" | "sm" | "lg" | "icon";
}

export function SavePaperButton({
  paperId,
  initialSaved = false,
  className = "",
  size = "sm",
}: SavePaperButtonProps) {
  const router = useRouter();
  const [isSaved, setIsSaved] = React.useState(initialSaved);
  const [isPending, startTransition] = React.useTransition();

  // Sync state if initialSaved changes
  React.useEffect(() => {
    setIsSaved(initialSaved);
  }, [initialSaved]);

  const handleToggle = () => {
    startTransition(async () => {
      const result = await toggleBookmarkAction(paperId);
      if (result.unauthorized) {
        router.push(`/login?callbackUrl=/papers/${paperId}`);
        return;
      }
      if (result.success) {
        setIsSaved(result.isBookmarked);
      }
    });
  };

  return (
    <Button
      type="button"
      size={size}
      variant={isSaved ? "secondary" : "outline"}
      onClick={handleToggle}
      disabled={isPending}
      title={isSaved ? "Remove from saved papers" : "Save to my research library"}
      className={`gap-1.5 text-xs font-semibold transition-all ${
        isSaved
          ? "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100"
          : "text-slate-700 hover:text-indigo-600 hover:border-indigo-200"
      } ${className}`}
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
      ) : isSaved ? (
        <BookmarkCheck className="h-3.5 w-3.5 text-amber-600 fill-amber-500/20" />
      ) : (
        <Bookmark className="h-3.5 w-3.5" />
      )}
      <span>{isSaved ? "Saved" : "Save Paper"}</span>
    </Button>
  );
}
