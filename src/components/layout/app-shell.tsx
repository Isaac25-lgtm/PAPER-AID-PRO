"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Navbar } from "./navbar";
import { Footer } from "./footer";
import { WorkspaceShell } from "./workspace-shell";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  // Authentication check
  const isAuthenticated = Boolean(session?.user);

  // Routes that inherently belong to the authenticated workspace
  const isKnownWorkspaceRoute =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/library") ||
    pathname.startsWith("/editor") ||
    pathname.startsWith("/research") ||
    pathname.startsWith("/history") ||
    pathname.startsWith("/conversations") ||
    pathname.startsWith("/account") ||
    pathname.startsWith("/admin");

  // Routes that belong to the persistent authenticated workspace shell
  const isWorkspaceRoute =
    isKnownWorkspaceRoute ||
    (pathname.startsWith("/discover") && isAuthenticated);

  const showWorkspaceShell = isAuthenticated && isWorkspaceRoute;

  if (showWorkspaceShell && session?.user) {
    return <WorkspaceShell user={session.user}>{children}</WorkspaceShell>;
  }

  // Prevent layout shift and marketing navbar flash while session is initializing on workspace routes
  if (status === "loading" && isKnownWorkspaceRoute) {
    return (
      <div className="flex h-screen w-screen overflow-hidden bg-slate-50">
        <aside className="hidden md:flex flex-col border-r border-slate-200/90 h-screen sticky top-0 w-60 bg-white shrink-0 p-4 space-y-4">
          <div className="flex items-center gap-2.5 h-8">
            <div className="h-8 w-8 rounded-lg bg-slate-200 animate-pulse" />
            <div className="h-4 w-28 bg-slate-200 rounded animate-pulse" />
          </div>
          <div className="h-9 w-full bg-slate-100 rounded-xl animate-pulse" />
          <div className="space-y-2 pt-2 flex-1">
            <div className="h-8 w-full bg-slate-100 rounded-xl animate-pulse" />
            <div className="h-8 w-full bg-slate-100 rounded-xl animate-pulse" />
            <div className="h-8 w-full bg-slate-100 rounded-xl animate-pulse" />
            <div className="h-8 w-full bg-slate-100 rounded-xl animate-pulse" />
          </div>
        </aside>
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
          <div className="h-14 border-b border-slate-200 bg-white shrink-0" />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    );
  }

  // Signed-out visitors or public marketing pages
  return (
    <div className="flex min-h-screen flex-col bg-slate-50/50">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
