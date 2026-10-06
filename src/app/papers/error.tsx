"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertCircle, RefreshCw } from "lucide-react";

export default function PapersError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Library page error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 text-center">
      <Card className="p-8 sm:p-12 border-slate-200 bg-white rounded-2xl shadow-sm space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
          <AlertCircle className="h-6 w-6" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">
          Unable to Load Research Library
        </h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          The research database connection timed out or is temporarily busy. Please retry to reconnect.
        </p>
        <div className="pt-2 flex justify-center gap-3">
          <Button onClick={() => reset()} className="bg-indigo-600 hover:bg-indigo-700 text-xs gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Retry Loading Library</span>
          </Button>
        </div>
      </Card>
    </div>
  );
}
