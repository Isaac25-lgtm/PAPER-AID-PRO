import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  Cpu,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileText,
  ExternalLink,
  Layers,
  ArrowRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReprocessButton } from "./reprocess-button";
import { formatDate } from "@/lib/utils";

export const metadata = {
  title: "Processing Pipeline | Admin Portal",
};

export default async function ProcessingPage() {
  const jobs = await prisma.processingJob.findMany({
    include: {
      paper: {
        select: {
          id: true,
          title: true,
          doi: true,
          status: true,
          storagePath: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const totalJobs = jobs.length;
  const completedJobs = jobs.filter((j) => j.status === "COMPLETED").length;
  const runningJobs = jobs.filter((j) => j.status === "RUNNING").length;
  const failedJobs = jobs.filter((j) => j.status === "FAILED").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Cpu className="h-5 w-5 text-indigo-600" />
            Document Ingestion &amp; Chunking Pipeline
          </h1>
          <p className="text-xs text-slate-500">
            Real-time telemetry for PDF downloads, deterministic text extraction, page-aware chunking, and retry orchestration.
          </p>
        </div>
        <Link href="/admin/papers/new">
          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-xs">
            Ingest New Manuscript
          </Button>
        </Link>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4 bg-white shadow-xs">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Total Jobs
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{totalJobs}</div>
        </Card>

        <Card className="p-4 bg-white shadow-xs">
          <div className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider">
            Completed
          </div>
          <div className="text-2xl font-bold text-emerald-700 mt-1">{completedJobs}</div>
        </Card>

        <Card className="p-4 bg-white shadow-xs">
          <div className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wider">
            In Progress
          </div>
          <div className="text-2xl font-bold text-indigo-700 mt-1">{runningJobs}</div>
        </Card>

        <Card className="p-4 bg-white shadow-xs">
          <div className="text-[11px] font-semibold text-red-600 uppercase tracking-wider">
            Failed / Errors
          </div>
          <div className="text-2xl font-bold text-red-700 mt-1">{failedJobs}</div>
        </Card>
      </div>

      {/* Jobs Table */}
      {jobs.length === 0 ? (
        <Card className="bg-white p-12 text-center border-dashed space-y-3">
          <FileText className="mx-auto h-8 w-8 text-slate-400" />
          <div className="text-sm font-semibold text-slate-800">
            No processing jobs recorded yet
          </div>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Upload a PDF manuscript through the admin portal to initiate deterministic extraction and chunking.
          </p>
          <div className="pt-2">
            <Link href="/admin/papers/new">
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-xs">
                Upload First Manuscript
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
                <tr>
                  <th className="py-3 px-4">Manuscript &amp; Storage Path</th>
                  <th className="py-3 px-4">Current Stage</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Attempt</th>
                  <th className="py-3 px-4">Execution Time</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.map((job) => {
                  const durationSec =
                    job.startedAt && job.completedAt
                      ? ((job.completedAt.getTime() - job.startedAt.getTime()) / 1000).toFixed(1)
                      : null;

                  return (
                    <tr key={job.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Manuscript */}
                      <td className="py-3 px-4 max-w-xs">
                        <Link
                          href={`/papers/${job.paperId}`}
                          className="font-bold text-slate-900 hover:text-indigo-600 transition-colors line-clamp-1"
                        >
                          {job.paper.title}
                        </Link>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate">
                          {job.paper.storagePath || "No Supabase storagePath"}
                        </div>
                      </td>

                      {/* Stage */}
                      <td className="py-3 px-4">
                        <Badge
                          variant="secondary"
                          className="text-[10px] font-mono py-0.5 px-2 bg-slate-100 text-slate-700"
                        >
                          {job.stage}
                        </Badge>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4">
                        <Badge
                          variant={
                            job.status === "COMPLETED"
                              ? "success"
                              : job.status === "FAILED"
                              ? "destructive"
                              : "default"
                          }
                          className="text-[10px] font-semibold"
                        >
                          {job.status}
                        </Badge>
                        {job.errorMessage && (
                          <div className="text-[11px] text-red-600 mt-1 max-w-xs break-words font-medium">
                            {job.errorMessage}
                          </div>
                        )}
                      </td>

                      {/* Attempt */}
                      <td className="py-3 px-4 font-mono text-slate-600">
                        #{job.attempt} / {job.maxAttempts}
                      </td>

                      {/* Execution Time */}
                      <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                        <div>
                          {job.startedAt ? formatDate(job.startedAt.toISOString()) : "—"}
                        </div>
                        {durationSec && (
                          <div className="text-[10px] text-slate-400 font-mono">
                            Duration: {durationSec}s
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <ReprocessButton
                            paperId={job.paperId}
                            paperTitle={job.paper.title}
                            size="xs"
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
