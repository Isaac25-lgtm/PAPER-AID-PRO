import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  BookOpen,
  CircleHelp,
  FileText,
  FlaskConical,
  House,
  LibraryBig,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Quote,
  Search,
  Shield,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ComponentType } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ThemeSwitch } from "@/lib/theme";
import type { DocumentSummary, Progress } from "@/lib/types";
import { useGuidance } from "./Guidance";
import { useDialogFocus } from "./ui";
import { Logo, LogoMark } from "./Layout";

/**
 * The signed-in workspace: a left sidebar that is always there (New document, your recent documents, the
 * workspace sections, help, appearance and account), with the page beside it. It folds to an icon rail on wide
 * screens (remembered in this browser) and becomes a slide-out drawer on phones. Signed-out visitors keep the
 * public header.
 */

const COLLAPSE_KEY = "paperaid.sidebar.collapsed";
const RECENT = 6;

type Item = { to: string; label: string; icon: ComponentType<{ className?: string }>; count?: number; end?: boolean };

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function useWorkspaceData() {
  const { user } = useAuth();
  // Nothing private is fetched until this account's consent is current (the consent screen owns the page).
  const ready = Boolean(user && !user.needs_consent);
  const documents = useQuery({ queryKey: ["documents"], queryFn: () => api.get<DocumentSummary[]>("/documents"), enabled: ready });
  const progress = useQuery({ queryKey: ["progress"], queryFn: () => api.get<Progress>("/me/progress"), enabled: ready });
  return { documents, progress };
}

function Sidebar({ collapsed, onToggle, onNavigate }: { collapsed: boolean; onToggle?: () => void; onNavigate?: () => void }) {
  const { user, signOut } = useAuth();
  const { openHelp } = useGuidance();
  const navigate = useNavigate();
  const { documents, progress } = useWorkspaceData();
  // Unique per sidebar instance: the desktop sidebar and the phone drawer can both be in the page.
  const uid = useId();
  const recent = [...(documents.data ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, RECENT);
  const items: Item[] = [
    { to: "/dashboard", label: "Home", icon: House, end: true },
    { to: "/documents", label: "Documents", icon: FileText, count: progress.data?.documents, end: true },
    { to: "/library", label: "Library", icon: LibraryBig, count: progress.data?.library },
    { to: "/research", label: "Research", icon: FlaskConical },
    { to: "/tools/citations", label: "Citations", icon: Quote },
    { to: "/discover", label: "Discover", icon: Search },
    { to: "/papers", label: "Catalog", icon: BookOpen },
    ...(user?.role === "admin" ? [{ to: "/admin", label: "Admin", icon: Shield }] : []),
  ];
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    clsx(
      "flex items-center gap-2.5 rounded-lg text-sm transition",
      collapsed ? "justify-center p-2" : "px-2.5 py-1.5",
      isActive ? "bg-slate-100 font-medium text-slate-950" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
    );
  return (
    <div className="flex h-full flex-col">
      <div className={clsx("flex h-14 shrink-0 items-center", collapsed ? "justify-center" : "justify-between px-4")}>
        {collapsed ? (
          <Link to="/dashboard" aria-label="PaperAid Pro home" onClick={onNavigate}>
            <LogoMark />
          </Link>
        ) : (
          <Logo />
        )}
        {onToggle && !collapsed && (
          <button type="button" onClick={onToggle} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Collapse sidebar" title="Collapse sidebar">
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className={clsx("shrink-0", collapsed ? "px-2" : "px-3")}>
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            navigate("/documents?new=1");
          }}
          className={clsx(
            "flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white transition hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
            collapsed ? "h-10" : "h-10 px-3",
          )}
          aria-label="New document"
          title="New document"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {!collapsed && "New document"}
        </button>
      </div>

      <nav className={clsx("mt-4 min-h-0 flex-1 overflow-y-auto", collapsed ? "px-2" : "px-3")} aria-label="Workspace">
        {!collapsed && (
          <section aria-labelledby={`${uid}-recent`} className="mb-4">
            <div className="mb-1 flex items-center justify-between px-2.5">
              <h2 id={`${uid}-recent`} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Recent documents</h2>
            </div>
            {documents.isLoading && <p className="px-2.5 py-1.5 text-xs text-slate-500">Loading…</p>}
            {documents.data?.length === 0 && <p className="px-2.5 py-1.5 text-xs text-slate-500">Your documents will appear here.</p>}
            <ul>
              {recent.map((doc) => (
                <li key={doc.id}>
                  <Link
                    to={`/documents/${doc.id}`}
                    onClick={onNavigate}
                    title={doc.title}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                    <span className="min-w-0 truncate">{doc.title || "Untitled document"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section aria-labelledby={collapsed ? undefined : `${uid}-workspace`} aria-label={collapsed ? "Workspace" : undefined}>
          {!collapsed && (
            <h2 id={`${uid}-workspace`} className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Workspace</h2>
          )}
          <ul className="space-y-0.5">
            {items.map(({ to, label, icon: Icon, count, end }) => (
              <li key={to}>
                <NavLink to={to} end={end} onClick={onNavigate} className={linkClass} title={collapsed ? label : undefined} aria-label={collapsed ? label : undefined}>
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
                  {!collapsed && count !== undefined && count > 0 && <span className="font-mono text-[11px] tabular-nums text-slate-500">{count.toLocaleString()}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </section>
      </nav>

      <div className={clsx("shrink-0 space-y-1 border-t border-slate-200 py-3", collapsed ? "px-2" : "px-3")}>
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            openHelp();
          }}
          className={clsx("flex w-full items-center gap-2.5 rounded-lg text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900", collapsed ? "justify-center p-2" : "px-2.5 py-1.5")}
          aria-label="Help"
          title="Help"
        >
          <CircleHelp className="h-4 w-4 shrink-0" aria-hidden />
          {!collapsed && "Help"}
        </button>
        {!collapsed && (
          <div className="flex items-center justify-between px-2.5 py-1 text-sm text-slate-600">
            Appearance <ThemeSwitch compact />
          </div>
        )}
        <div className={clsx("flex items-center", collapsed ? "flex-col gap-1" : "gap-1")}>
          <NavLink to="/account" onClick={onNavigate} className={({ isActive }) => clsx(linkClass({ isActive }), !collapsed && "min-w-0 flex-1")} title={user?.name || user?.email} aria-label={collapsed ? "Account" : undefined}>
            <UserRound className="h-4 w-4 shrink-0" aria-hidden />
            {!collapsed && <span className="min-w-0 truncate">{user?.name || user?.email}</span>}
          </NavLink>
          <button type="button" onClick={() => void signOut()} className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900" aria-label="Sign out" title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        {onToggle && collapsed && (
          <button type="button" onClick={onToggle} className="flex w-full justify-center rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Expand sidebar" title="Expand sidebar">
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export function WorkspaceShell() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  useEffect(() => setDrawer(false), [location.pathname]);
  // The phone drawer is a modal: focus moves into it, Tab stays inside, Escape closes it and focus returns to the
  // menu button; the page behind is inert meanwhile (workspace audit).
  const drawerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  useDialogFocus(drawerRef, drawer, () => setDrawer(false));
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    if (drawer) page.setAttribute("inert", "");
    else page.removeAttribute("inert");
  }, [drawer]);
  const toggle = () =>
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, value ? "0" : "1");
      } catch {
        /* storage unavailable: the choice lasts for this visit */
      }
      return !value;
    });

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Wide screens: the sidebar sits beside the page and stays in view while it scrolls. */}
      <aside
        className={clsx("sticky top-0 hidden h-screen shrink-0 border-r border-slate-200 bg-white transition-[width] duration-200 lg:block", collapsed ? "w-16" : "w-64")}
        aria-label="Sidebar"
      >
        <Sidebar collapsed={collapsed} onToggle={toggle} />
      </aside>

      {/* Phones and tablets: a top bar with a menu that opens the same sidebar as a drawer. */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" aria-hidden onClick={() => setDrawer(false)} />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            tabIndex={-1}
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-slate-200 bg-white shadow-xl"
          >
            <button type="button" className="absolute right-3 top-3.5 rounded-md p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => setDrawer(false)} aria-label="Close menu">
              <X className="h-4 w-4" />
            </button>
            <Sidebar collapsed={false} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <div ref={pageRef} className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur-md lg:hidden">
          <button type="button" className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer}>
            <Menu className="h-5 w-5" />
          </button>
          <Logo />
        </header>
        <main className="flex-1">
          <Outlet />
        </main>
        <footer className="border-t border-slate-200">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 text-xs text-slate-500">
            <span>© {new Date().getFullYear()} PaperAid Pro · Silver</span>
            <Link to="/terms" className="hover:text-slate-800">Terms</Link>
            <Link to="/privacy" className="hover:text-slate-800">Privacy</Link>
            <Link to="/ai-notice" className="hover:text-slate-800">AI notice</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
