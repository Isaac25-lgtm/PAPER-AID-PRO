"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Compass,
  BookOpen,
  FileText,
  Sparkles,
  History,
  HelpCircle,
  Settings,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Plus,
  LogOut,
  GraduationCap,
  X,
} from "lucide-react";
import { useWorkspace } from "./workspace-context";
import { cn } from "@/lib/utils";

interface WorkspaceSidebarProps {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    role?: string;
  };
}

export function WorkspaceSidebar({ user }: WorkspaceSidebarProps) {
  const pathname = usePathname();
  const {
    isSidebarCollapsed,
    toggleSidebarCollapsed,
    isMobileNavOpen,
    closeMobileNav,
    openNewDocumentModal,
    openHelpGuides,
  } = useWorkspace();

  const closeButtonRef = React.useRef<HTMLButtonElement>(null);

  // Focus close button when mobile drawer opens for accessibility
  useEffect(() => {
    if (isMobileNavOpen) {
      const timer = setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isMobileNavOpen]);

  // Close mobile drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isMobileNavOpen) {
        closeMobileNav();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobileNavOpen, closeMobileNav]);

  const isAdmin = user.role === "ADMIN";

  // Navigation Items
  const primaryNavItems = [
    {
      title: "Dashboard",
      href: "/dashboard",
      icon: LayoutDashboard,
      isActive: pathname === "/dashboard",
    },
    {
      title: "Find Papers",
      href: "/discover",
      icon: Compass,
      isActive: pathname.startsWith("/discover"),
    },
    {
      title: "My Library",
      href: "/library",
      icon: BookOpen,
      isActive: pathname.startsWith("/library"),
    },
    {
      title: "My Documents",
      href: "/editor",
      icon: FileText,
      isActive: pathname.startsWith("/editor"),
    },
    {
      title: "AI Research Chat",
      href: "/research",
      icon: Sparkles,
      isActive: pathname.startsWith("/research"),
    },
    {
      title: "History",
      href: "/history",
      icon: History,
      isActive: pathname.startsWith("/history") || pathname.startsWith("/conversations"),
    },
  ];

  const sidebarContent = (isMobile: boolean = false) => {
    const collapsed = !isMobile && isSidebarCollapsed;

    return (
      <div className="flex flex-col h-full bg-white select-none">
        {/* Sidebar Brand Header */}
        <div
          className={cn(
            "flex items-center h-16 border-b border-slate-200/80 px-4 shrink-0 transition-all",
            collapsed ? "justify-center" : "justify-between"
          )}
        >
          <Link
            href="/dashboard"
            onClick={isMobile ? closeMobileNav : undefined}
            className="flex items-center gap-2.5 group overflow-hidden"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm shrink-0 transition-transform group-hover:scale-105">
              <GraduationCap className="h-5 w-5" />
            </div>
            {!collapsed && (
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-bold tracking-tight text-slate-900 leading-tight truncate">
                  AI Research Hub
                </span>
                <span className="text-[10px] uppercase font-semibold tracking-wider text-indigo-600 truncate">
                  Research Workspace
                </span>
              </div>
            )}
          </Link>

          {isMobile ? (
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeMobileNav}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label="Close mobile menu"
            >
              <X className="w-5 h-5" />
            </button>
          ) : (
            !collapsed && (
              <button
                type="button"
                onClick={toggleSidebarCollapsed}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )
          )}
        </div>

        {/* Primary Action: New Document Button */}
        <div className={cn("p-3 shrink-0", collapsed && "flex justify-center px-2")}>
          <button
            type="button"
            onClick={() => {
              if (isMobile) closeMobileNav();
              openNewDocumentModal();
            }}
            className={cn(
              "w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-xs transition-all flex items-center justify-center gap-2 group relative",
              collapsed ? "h-10 w-10 p-0" : "py-2.5 px-3"
            )}
            title="Create New Manuscript"
            aria-label="Create New Manuscript"
          >
            <Plus className="w-4 h-4 shrink-0 transition-transform group-hover:rotate-90" />
            {!collapsed && <span>New Document</span>}

            {/* Hover Tooltip when collapsed */}
            {collapsed && (
              <div className="absolute left-full ml-3 px-2.5 py-1 bg-slate-900 text-white text-[11px] font-medium rounded-md whitespace-nowrap shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
                New Document
              </div>
            )}
          </button>
        </div>

        {/* Navigation Links Area */}
        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
          {primaryNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={isMobile ? closeMobileNav : undefined}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all group relative",
                  item.isActive
                    ? "bg-indigo-50 text-indigo-700 font-bold border border-indigo-200/80 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/80",
                  collapsed && "justify-center px-0 h-10 w-10 mx-auto"
                )}
                aria-current={item.isActive ? "page" : undefined}
                title={collapsed ? item.title : undefined}
              >
                <Icon
                  className={cn(
                    "w-4 h-4 shrink-0 transition-colors",
                    item.isActive ? "text-indigo-600" : "text-slate-400 group-hover:text-slate-600"
                  )}
                />
                {!collapsed && <span className="truncate">{item.title}</span>}

                {/* Hover Tooltip when collapsed */}
                {collapsed && (
                  <div className="absolute left-full ml-3 px-2.5 py-1 bg-slate-900 text-white text-[11px] font-medium rounded-md whitespace-nowrap shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
                    {item.title}
                  </div>
                )}
              </Link>
            );
          })}

          {/* Admin Link (Role-restricted) */}
          {isAdmin && (
            <div className={cn("pt-2 mt-2 border-t border-slate-100", collapsed && "pt-1 mt-1")}>
              {!collapsed && (
                <span className="px-3 text-[10px] uppercase font-bold tracking-wider text-amber-700 block mb-1">
                  Administration
                </span>
              )}
              <Link
                href="/admin"
                onClick={isMobile ? closeMobileNav : undefined}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all group relative",
                  pathname.startsWith("/admin")
                    ? "bg-amber-100 text-amber-900 border border-amber-200 shadow-2xs font-bold"
                    : "text-amber-800 bg-amber-50/70 hover:bg-amber-100/90",
                  collapsed && "justify-center px-0 h-10 w-10 mx-auto"
                )}
                title={collapsed ? "Admin Console" : undefined}
              >
                <ShieldCheck className="w-4 h-4 shrink-0 text-amber-600" />
                {!collapsed && <span className="truncate">Admin Console</span>}

                {collapsed && (
                  <div className="absolute left-full ml-3 px-2.5 py-1 bg-slate-900 text-white text-[11px] font-medium rounded-md whitespace-nowrap shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
                    Admin Console
                  </div>
                )}
              </Link>
            </div>
          )}
        </div>

        {/* Footer Utilities: Help & Guides, Settings */}
        <div className="p-2 border-t border-slate-200/80 space-y-1 shrink-0">
          {/* Help & Guides Modal Trigger */}
          <button
            type="button"
            onClick={() => {
              if (isMobile) closeMobileNav();
              openHelpGuides();
            }}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 transition-all group relative",
              collapsed && "justify-center px-0 h-10 w-10 mx-auto"
            )}
            title={collapsed ? "Help & Guides" : undefined}
            aria-label="Help & Guides"
          >
            <HelpCircle className="w-4 h-4 text-slate-400 group-hover:text-slate-600 shrink-0" />
            {!collapsed && <span>Help & Guides</span>}

            {collapsed && (
              <div className="absolute left-full ml-3 px-2.5 py-1 bg-slate-900 text-white text-[11px] font-medium rounded-md whitespace-nowrap shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
                Help & Guides
              </div>
            )}
          </button>

          {/* Settings / Account Link */}
          <Link
            href="/account"
            onClick={isMobile ? closeMobileNav : undefined}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all group relative",
              pathname.startsWith("/account")
                ? "bg-indigo-50 text-indigo-700 font-bold border border-indigo-200/80 shadow-2xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/80",
              collapsed && "justify-center px-0 h-10 w-10 mx-auto"
            )}
            title={collapsed ? "Settings / Account" : undefined}
          >
            <Settings className="w-4 h-4 text-slate-400 group-hover:text-slate-600 shrink-0" />
            {!collapsed && <span>Settings / Account</span>}

            {collapsed && (
              <div className="absolute left-full ml-3 px-2.5 py-1 bg-slate-900 text-white text-[11px] font-medium rounded-md whitespace-nowrap shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
                Settings / Account
              </div>
            )}
          </Link>

          {/* Desktop Expand Toggle when collapsed */}
          {!isMobile && collapsed && (
            <button
              type="button"
              onClick={toggleSidebarCollapsed}
              className="w-10 h-10 mx-auto flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors group relative"
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <ChevronRight className="w-4 h-4" />
              <div className="absolute left-full ml-3 px-2.5 py-1 bg-slate-900 text-white text-[11px] font-medium rounded-md whitespace-nowrap shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
                Expand Sidebar
              </div>
            </button>
          )}

          {/* User Profile Bar */}
          <div
            className={cn(
              "pt-2 mt-2 border-t border-slate-100 flex items-center gap-2 px-1",
              collapsed ? "justify-center" : "justify-between"
            )}
          >
            <Link
              href="/account"
              onClick={isMobile ? closeMobileNav : undefined}
              className="flex items-center gap-2 min-w-0 group"
              title={collapsed ? user.name || user.email || "Account" : undefined}
            >
              <div className="h-7 w-7 rounded-lg bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center shrink-0 group-hover:ring-2 group-hover:ring-indigo-300 transition-all">
                {user.name ? user.name[0].toUpperCase() : "R"}
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-semibold text-slate-800 block truncate group-hover:text-indigo-600 transition-colors">
                    {user.name || "Researcher"}
                  </span>
                  <span className="text-[10px] text-slate-400 block truncate">
                    {user.email}
                  </span>
                </div>
              )}
            </Link>

            {!collapsed && (
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/" })}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col border-r border-slate-200/90 h-screen sticky top-0 transition-all duration-200 z-30 shrink-0",
          isSidebarCollapsed ? "w-16" : "w-60"
        )}
      >
        {sidebarContent(false)}
      </aside>

      {/* Mobile Slide-Out Drawer Overlay */}
      {isMobileNavOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs md:hidden animate-in fade-in"
          onClick={closeMobileNav}
          aria-hidden="true"
        >
          <div
            className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-2xl flex flex-col z-50 animate-in slide-in-from-left duration-200"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation sidebar"
          >
            {sidebarContent(true)}
          </div>
        </div>
      )}
    </>
  );
}
