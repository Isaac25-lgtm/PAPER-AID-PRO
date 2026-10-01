import Link from "next/link";
import { FileText, Cpu, AlertCircle, CheckCircle2, Upload } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function AdminOverviewPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Platform Overview</h1>
          <p className="text-xs text-slate-500">
            System health, paper ingestion status, and processing queue.
          </p>
        </div>
        <Link href="/admin/papers/new">
          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 gap-1.5">
            <Upload className="h-3.5 w-3.5" />
            Upload New Paper
          </Button>
        </Link>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-white p-5">
          <div className="text-xs text-slate-500 font-medium">Total Ingested</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">12,400</div>
          <div className="text-[11px] text-emerald-600 mt-1 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Active & Searchable
          </div>
        </Card>
        <Card className="bg-white p-5">
          <div className="text-xs text-slate-500 font-medium">Currently In Queue</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">3</div>
          <div className="text-[11px] text-indigo-600 mt-1 flex items-center gap-1">
            <Cpu className="h-3 w-3" />
            Extracting text & chunks
          </div>
        </Card>
        <Card className="bg-white p-5">
          <div className="text-xs text-slate-500 font-medium">Processing Failures</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">0</div>
          <div className="text-[11px] text-slate-400 mt-1">Retry system ready</div>
        </Card>
      </div>
    </div>
  );
}
