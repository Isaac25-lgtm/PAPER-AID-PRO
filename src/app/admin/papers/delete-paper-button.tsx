"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deletePaper } from "./actions";

export function DeletePaperButton({
  paperId,
  paperTitle,
}: {
  paperId: string;
  paperTitle: string;
}) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = React.useState(false);

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${paperTitle}"? This action cannot be undone.`)) {
      return;
    }

    setIsDeleting(true);
    try {
      const res = await deletePaper(paperId);
      if (res.success) {
        router.refresh();
      } else {
        alert(res.error || "Failed to delete manuscript.");
      }
    } catch (err: any) {
      console.error("Delete button error:", err);
      alert(err?.message || "An unexpected error occurred while deleting the manuscript. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleDelete}
      disabled={isDeleting}
      className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
      title="Delete paper"
    >
      {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </Button>
  );
}
