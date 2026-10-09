"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle, RefreshCw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("Admin portal error caught by boundary:", error);
  }, [error]);

  return (
    <div className="max-w-xl mx-auto py-12 px-4">
      <Card className="p-8 text-center bg-white shadow-sm border-slate-200 space-y-5">
        <div className="h-12 w-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto">
          <AlertCircle className="h-6 w-6" />
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-bold text-slate-900">
            Administrative Action Failed
          </h2>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            An unexpected error occurred while communicating with the database or storage services.
          </p>
          {error.message && (
            <div className="mt-3 p-3 rounded-lg bg-slate-50 border border-slate-200 text-left font-mono text-xs text-slate-700 max-h-32 overflow-y-auto">
              {error.message}
            </div>
          )}
          {error.digest && (
            <p className="text-[11px] font-mono text-slate-400 mt-1">
              Error Digest: {error.digest}
            </p>
          )}
        </div>

        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            size="sm"
            onClick={() => reset()}
            className="bg-indigo-600 hover:bg-indigo-700 text-xs gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry Action
          </Button>
          <Link href="/admin/papers">
            <Button size="sm" variant="outline" className="text-xs gap-1.5">
              <ArrowLeft className="h-3.5 w-3.5" />
              Return to Catalog
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
