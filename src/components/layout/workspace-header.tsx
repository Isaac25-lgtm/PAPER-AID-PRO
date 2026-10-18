"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Menu,
  Search,
  Plus,
  LogOut,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import { useWorkspace } from "./workspace-context";
import { Button } from "@/components/ui/button";

interface WorkspaceHeaderProps {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    role?: string;
  };
}

export function WorkspaceHeader({ user }: WorkspaceHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { openMobileNav, openNewDocumentModal } = useWorkspace();
  const [headerSearch, setHeaderSearch] = useState("");

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (headerSearch.trim()) {
      router.push(`/discover?q=${encodeURIComponent(headerSearch.trim())}`);
      setHeaderSearch("");
    }
  };

  // Human-readable breadcrumb label
  const getSectionTitle = () => {
    if (pathname === "/dashboard") return "Dashboard";
    if (pathname.startsWith("/discover")) return "Scholarly Discovery";
    if (pathname.startsWith("/library")) return "My Research Library";
    if (pathname === "/editor") return "Research Documents";
    if (pathname.startsWith("/research")) return "AI Research Chat";
    if (pathname.startsWith("/history") || pathname.startsWith("/conversations")) return "History";
    if (pathname.startsWith("/account")) return "Account Settings";
    if (pathname.startsWith("/admin")) return "Admin Console";
    return "Workspace";
  };

  return (
    <header className="h-14 border-b border-slate-200/80 bg-white/95 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0 z-20">
      {/* Left: Mobile hamburger & Breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={openMobileNav}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 md:hidden"
          aria-label="Open navigation drawer"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 min-w-0">
          <Link
            href="/dashboard"
            className="hover:text-slate-900 transition-colors hidden sm:inline truncate"
          >
            AI Research Hub
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400 hidden sm:inline shrink-0" />
          <span className="font-bold text-slate-900 truncate">{getSectionTitle()}</span>
        </div>
      </div>

      {/* Center: Global Search Input */}
      <div className="hidden lg:flex items-center max-w-sm flex-1 mx-4">
        <form onSubmit={handleSearchSubmit} className="relative w-full">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="search"
            placeholder="Search papers by DOI, topic, or author..."
            value={headerSearch}
            onChange={(e) => setHeaderSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 focus:bg-white transition-colors"
          />
        </form>
      </div>

      {/* Right: Quick Actions & Profile */}
      <div className="flex items-center gap-2.5 shrink-0">
        <Button
          type="button"
          size="sm"
          onClick={() => openNewDocumentModal()}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs gap-1.5 shadow-2xs h-8 px-2.5 sm:px-3"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">New Document</span>
          <span className="sm:hidden">New</span>
        </Button>

        {user.role === "ADMIN" && (
          <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full">
            <ShieldCheck className="w-3 h-3 text-amber-700" />
            <span>Admin</span>
          </span>
        )}

        <div className="h-4 w-px bg-slate-200 hidden sm:block" />

        <Link
          href="/account"
          className="flex items-center gap-2 p-1 rounded-lg hover:bg-slate-100 transition-colors group"
          title="Account Settings"
        >
          <div className="h-7 w-7 rounded-lg bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center shrink-0 group-hover:ring-2 group-hover:ring-indigo-300 transition-all">
            {user.name ? user.name[0].toUpperCase() : "R"}
          </div>
          <span className="text-xs font-semibold text-slate-700 hidden md:inline max-w-[120px] truncate group-hover:text-slate-900">
            {user.name || "Account"}
          </span>
        </Link>

        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/" })}
          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
