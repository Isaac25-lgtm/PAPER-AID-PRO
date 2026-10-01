"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reprocessPaper } from "./actions";

export function ReprocessButton({
  paperId,
  paperTitle,
  variant = "outline",
  size = "sm",
}: {
  paperId: string;
  paperTitle?: string;
  variant?: "outline" | "default" | "ghost";
  size?: "sm" | "xs" | "default";
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);
  const [isError, setIsError] = React.useState(false);

  const handleReprocess = () => {
    setMsg(null);
    setIsError(false);

    startTransition(async () => {
      const res = await reprocessPaper(paperId);
      if (!res.success) {
        setIsError(true);
        setMsg(res.error || "Reprocessing failed.");
      } else {
        setMsg(res.message || "Reprocessed successfully.");
        router.refresh();
      }
    });
  };

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button
        variant={variant}
        size={size === "xs" ? "sm" : size}
        onClick={handleReprocess}
        disabled={isPending}
        className="h-7 text-xs gap-1.5"
        title={paperTitle ? `Reprocess ${paperTitle}` : "Reprocess Document"}
      >
        {isPending ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin text-indigo-600" />
            <span>Processing…</span>
          </>
        ) : (
          <>
            <RefreshCw className="h-3 w-3 text-slate-500" />
            <span>Reprocess</span>
          </>
        )}
      </Button>
      {msg && (
        <span
          className={`text-[10px] max-w-xs truncate ${
            isError ? "text-red-600" : "text-emerald-600"
          }`}
        >
          {msg}
        </span>
      )}
    </div>
  );
}
