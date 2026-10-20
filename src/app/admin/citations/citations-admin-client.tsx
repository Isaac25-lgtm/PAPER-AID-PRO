"use client";

import React, { useState } from "react";
import {
  RefreshCw,
  GitCommit,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  BookOpen,
  Calendar,
  Layers,
  ShieldCheck,
} from "lucide-react";
import { CslCatalogRevision } from "@/lib/citations/csl/updater/types";

interface CitationsAdminClientProps {
  initialActiveRevision: CslCatalogRevision;
  initialRevisions: CslCatalogRevision[];
}

export function CitationsAdminClient({
  initialActiveRevision,
  initialRevisions,
}: CitationsAdminClientProps) {
  const [activeRevision, setActiveRevision] = useState<CslCatalogRevision>(initialActiveRevision);
  const [revisions, setRevisions] = useState<CslCatalogRevision[]>(initialRevisions);
  const [isLoading, setIsLoading] = useState(false);
  const [syncOutcome, setSyncOutcome] = useState<{
    status: string;
    message: string;
    addedCount?: number;
    modifiedCount?: number;
    removedCount?: number;
    validationErrors?: Array<{ styleId: string; error: string }>;
  } | null>(null);

  const handleSync = async (dryRun = false) => {
    setIsLoading(true);
    setSyncOutcome(null);

    try {
      const res = await fetch("/api/citations/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun, forceCheck: true }),
      });

      const data = await res.json();
      setSyncOutcome({
        status: data.status,
        message: data.message,
        addedCount: data.addedCount,
        modifiedCount: data.modifiedCount,
        removedCount: data.removedCount,
        validationErrors: data.validationErrors,
      });

      // Refresh list
      const getRes = await fetch("/api/citations/sync");
      if (getRes.ok) {
        const getData = await getRes.json();
        if (getData.activeRevision) setActiveRevision(getData.activeRevision);
        if (getData.recentRevisions) setRevisions(getData.recentRevisions);
      }
    } catch (err: any) {
      setSyncOutcome({
        status: "ERROR",
        message: err.message || "Failed to communicate with sync endpoint.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRollback = async (targetSha: string) => {
    if (!confirm(`Are you sure you want to rollback active catalog to revision ${targetSha.slice(0, 7)}?`)) {
      return;
    }
    setIsLoading(true);
    try {
      // In-client simulation or direct call
      const res = await fetch("/api/citations/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rollbackSha: targetSha }),
      });
      // Refresh
      const getRes = await fetch("/api/citations/sync");
      if (getRes.ok) {
        const getData = await getRes.json();
        if (getData.activeRevision) setActiveRevision(getData.activeRevision);
        if (getData.recentRevisions) setRevisions(getData.recentRevisions);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Active Revision */}
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>Active Revision</span>
            <GitCommit className="w-4 h-4 text-indigo-600" />
          </div>
          <p className="font-mono text-sm font-semibold text-slate-900 truncate">
            {activeRevision.gitSha.slice(0, 12)}
          </p>
          <p className="text-[11px] text-slate-400">Branch: {activeRevision.branch}</p>
        </div>

        {/* Total Indexed Styles */}
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>Total Styles</span>
            <BookOpen className="w-4 h-4 text-indigo-600" />
          </div>
          <p className="text-xl font-bold text-slate-900">
            {activeRevision.totalStyles.toLocaleString()}
          </p>
          <p className="text-[11px] text-slate-400">
            {activeRevision.independentCount} indep / {activeRevision.dependentCount} dep
          </p>
        </div>

        {/* Status */}
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>Catalog Status</span>
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-sm font-semibold text-emerald-700 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {activeRevision.status}
          </p>
          <p className="text-[11px] text-slate-400">
            Activated: {activeRevision.activatedAt ? new Date(activeRevision.activatedAt).toLocaleDateString() : "Baseline"}
          </p>
        </div>

        {/* Upstream Schedule */}
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>Sync Policy</span>
            <Calendar className="w-4 h-4 text-indigo-600" />
          </div>
          <p className="text-sm font-semibold text-slate-900">Weekly Scheduled</p>
          <p className="text-[11px] text-slate-400">Rate-limit safe (ETag conditional)</p>
        </div>
      </div>

      {/* Action Bar */}
      <div className="p-4 rounded-xl border border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Upstream Synchronization Controls</h3>
          <p className="text-xs text-slate-500">
            Check for new styles, validate definitions in sandbox, and promote revisions atomically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleSync(true)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Dry-Run Check</span>
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleSync(false)}
            className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>Check Now & Update</span>
          </button>
        </div>
      </div>

      {/* Sync Outcome Banner */}
      {syncOutcome && (
        <div
          className={`p-4 rounded-xl border text-xs flex items-start gap-3 ${
            syncOutcome.status === "ERROR" || syncOutcome.status === "VALIDATION_FAILED"
              ? "bg-rose-50 border-rose-200 text-rose-800"
              : "bg-emerald-50 border-emerald-200 text-emerald-800"
          }`}
        >
          {syncOutcome.status === "ERROR" || syncOutcome.status === "VALIDATION_FAILED" ? (
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-600" />
          ) : (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-600" />
          )}
          <div className="space-y-1">
            <p className="font-semibold">{syncOutcome.message}</p>
            {syncOutcome.validationErrors && syncOutcome.validationErrors.length > 0 && (
              <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-rose-700">
                {syncOutcome.validationErrors.map((err, i) => (
                  <li key={i}>
                    <strong>{err.styleId}</strong>: {err.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Revision History Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
            Catalog Revisions History ({revisions.length})
          </h3>
          <span className="text-[11px] text-slate-400">Archived for non-destructive reproducibility</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 font-medium">Git SHA</th>
                <th className="px-4 py-2.5 font-medium">Branch</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Styles Count</th>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {revisions.map((rev) => {
                const isCurrent = rev.gitSha === activeRevision.gitSha;
                return (
                  <tr key={rev.id || rev.gitSha} className={isCurrent ? "bg-indigo-50/30" : "hover:bg-slate-50"}>
                    <td className="px-4 py-3 font-mono text-[11px] font-semibold text-slate-900">
                      {rev.gitSha.slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{rev.branch}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          isCurrent
                            ? "bg-emerald-100 text-emerald-800"
                            : rev.status === "FAILED"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {isCurrent ? "ACTIVE" : rev.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {rev.totalStyles.toLocaleString()} styles
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-[11px]">
                      {new Date(rev.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isCurrent && rev.status !== "FAILED" ? (
                        <button
                          type="button"
                          onClick={() => handleRollback(rev.gitSha)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Rollback to this</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400">Active</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
