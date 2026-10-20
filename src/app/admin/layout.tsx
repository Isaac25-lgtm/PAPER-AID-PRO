import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Upload,
  Cpu,
  ShieldAlert,
  ArrowLeft,
} from "lucide-react";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Layer 2 Backend Authorization: Verify session & ADMIN role server-side
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login?callbackUrl=/admin");
  }

  if (session.user.role !== "ADMIN") {
    redirect("/?error=unauthorized");
  }
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-900 text-white">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
            <ShieldAlert className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight">Admin Console</h2>
            <p className="text-xs text-slate-400">
              Backend Role-Based Access Control enforced
            </p>
          </div>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Return to Portal
        </Link>
      </div>

      {/* Admin Navigation Bar */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3 text-xs font-medium text-slate-600">
        <Link
          href="/admin"
          className="px-3 py-1.5 rounded-md hover:bg-slate-100 hover:text-slate-900 transition-colors"
        >
          Overview
        </Link>
        <Link
          href="/admin/papers"
          className="px-3 py-1.5 rounded-md hover:bg-slate-100 hover:text-slate-900 transition-colors"
        >
          Manage Papers
        </Link>
        <Link
          href="/admin/papers/new"
          className="px-3 py-1.5 rounded-md hover:bg-slate-100 hover:text-slate-900 transition-colors"
        >
          Upload Paper
        </Link>
        <Link
          href="/admin/processing"
          className="px-3 py-1.5 rounded-md hover:bg-slate-100 hover:text-slate-900 transition-colors"
        >
          Processing Pipeline
        </Link>
        <Link
          href="/admin/citations"
          className="px-3 py-1.5 rounded-md hover:bg-slate-100 hover:text-slate-900 transition-colors"
        >
          Citation Styles
        </Link>
      </div>

      <div>{children}</div>
    </div>
  );
}
