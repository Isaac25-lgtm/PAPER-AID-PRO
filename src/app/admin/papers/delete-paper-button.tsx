"use client";

import * as React from "react";
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
  const [isPending, startTransition] = React.useTransition();

  const handleDelete = () => {
    if (confirm(`Are you sure you want to delete "${paperTitle}"? This action cannot be undone.`)) {
      startTransition(async () => {
        const res = await deletePaper(paperId);
        if (!res.success) {
          alert(res.error || "Failed to delete paper.");
        }
      });
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleDelete}
      disabled={isPending}
      className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
      title="Delete paper"
    >
      {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </Button>
  );
}
