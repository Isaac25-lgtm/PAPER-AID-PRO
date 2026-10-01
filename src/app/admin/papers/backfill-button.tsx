"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Database, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { backfillEmbeddingsAction } from "./actions";

export function BackfillEmbeddingsButton() {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);

  const handleBackfill = () => {
    setMsg(null);
    startTransition(async () => {
      const res = await backfillEmbeddingsAction({ force: false });
      if (res.success) {
        setMsg(res.message || "Backfill complete.");
        setTimeout(() => setMsg(null), 4000);
        router.refresh();
      } else {
        alert(res.error || "Failed to backfill embeddings.");
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span className="text-xs text-emerald-600 font-medium hidden sm:inline">
          {msg}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={handleBackfill}
        className="text-xs gap-1.5 border-slate-300 text-slate-700 hover:bg-slate-50"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-600" />
        ) : (
          <Database className="h-3.5 w-3.5 text-violet-600" />
        )}
        Backfill Embeddings
      </Button>
    </div>
  );
}
