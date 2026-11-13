import clsx from "clsx";
import { BookOpen, FileText, FlaskConical, LibraryBig, LogOut, Menu, Quote, Search, Shield, UserRound, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router";

import { useAuth } from "@/lib/auth";
import { Alert, Button, Spinner } from "./ui";

const NAV = [
  { to: "/discover", label: "Discover", icon: Search, auth: false },
  { to: "/papers", label: "Catalog", icon: BookOpen, auth: false },
  { to: "/library", label: "Library", icon: LibraryBig, auth: true },
  { to: "/documents", label: "Documents", icon: FileText, auth: true },
  { to: "/research", label: "Research", icon: FlaskConical, auth: true },
  { to: "/tools/citations", label: "Citations", icon: Quote, auth: false },
];

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold text-slate-900">
      <img src="/favicon.svg" alt="" className="h-7 w-7" />
      <span>
        PaperAid <span className="text-brand-700">Pro</span>
      </span>
    </Link>
  );
}

export function Layout() {
  const { user, signOut, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const links = NAV.filter((item) => !item.auth || user);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <Logo />
          <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Main">
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  clsx("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium", isActive ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-100")
                }
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </NavLink>
            ))}
            {user?.role === "admin" && (
              <NavLink to="/admin" className={({ isActive }) => clsx("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium", isActive ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-100")}>
                <Shield className="h-4 w-4" aria-hidden /> Admin
              </NavLink>
            )}
          </nav>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            {loading ? null : user ? (
              <>
                <Link to="/account" className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-slate-700 hover:bg-slate-100">
                  <UserRound className="h-4 w-4" aria-hidden />
                  {user.name || user.email}
                </Link>
                <Button variant="ghost" size="sm" onClick={() => void signOut()} aria-label="Sign out">
                  <LogOut className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Link to="/login" className="px-3 py-1.5 text-sm font-medium text-slate-700 hover:text-slate-900">
                  Sign in
                </Link>
                <Link to="/register" className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800">
                  Create account
                </Link>
              </>
            )}
          </div>
          <button className="ml-auto rounded p-2 md:hidden" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {open && (
          <nav className="border-t border-slate-200 px-4 py-2 md:hidden" aria-label="Mobile">
            {links.map(({ to, label }) => (
              <NavLink key={to} to={to} onClick={() => setOpen(false)} className="block rounded px-2 py-2 text-sm text-slate-700">
                {label}
              </NavLink>
            ))}
            {user ? (
              <>
                <NavLink to="/account" onClick={() => setOpen(false)} className="block rounded px-2 py-2 text-sm text-slate-700">
                  Account
                </NavLink>
                <button className="block w-full px-2 py-2 text-left text-sm text-slate-700" onClick={() => void signOut()}>
                  Sign out
                </button>
              </>
            ) : (
              <NavLink to="/login" onClick={() => setOpen(false)} className="block rounded px-2 py-2 text-sm text-slate-700">
                Sign in
              </NavLink>
            )}
          </nav>
        )}
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-slate-500">
          <span>© {new Date().getFullYear()} PaperAid Pro · Silver</span>
          <span className="flex gap-4">
            <Link to="/privacy" className="hover:text-slate-800">
              Privacy
            </Link>
            <a href="https://openalex.org" className="hover:text-slate-800" target="_blank" rel="noreferrer">
              Metadata: OpenAlex, Crossref, PubMed, Semantic Scholar, arXiv
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("mx-auto w-full max-w-7xl px-4 py-8", className)}>{children}</div>;
}

/** Route guard: signed in AND email verified (the API enforces the same rule). */
export function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user, firebaseUser, loading, resendVerification, refresh } = useAuth();
  const location = useLocation();
  const [sent, setSent] = useState(false);
  if (loading) return <Spinner />;
  if (!firebaseUser) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (!firebaseUser.emailVerified) {
    return (
      <Container className="max-w-xl">
        <Alert kind="warning" title="Verify your email to continue">
          We sent a verification link to <strong>{firebaseUser.email}</strong>. Open it, then click “I’ve verified”.
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => void refresh()}>
              I’ve verified
            </Button>
            <Button size="sm" variant="secondary" disabled={sent} onClick={() => void resendVerification().then(() => setSent(true))}>
              {sent ? "Email sent" : "Resend email"}
            </Button>
          </div>
        </Alert>
      </Container>
    );
  }
  if (!user) return <Spinner label="Loading your account" />;
  if (admin && user.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}
