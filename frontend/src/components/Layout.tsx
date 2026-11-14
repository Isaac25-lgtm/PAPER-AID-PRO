import clsx from "clsx";
import { BookOpen, FileText, FlaskConical, House, LibraryBig, LogOut, Menu, Quote, Search, Shield, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router";
import { DataRightsPanel } from "./DataRights";

import { useAuth } from "@/lib/auth";
import { ConsentGate } from "./Consent";
import { HelpButton, useGuidance } from "./Guidance";
import { ThemeSwitch } from "@/lib/theme";
import { Alert, Button, Spinner } from "./ui";

const NAV = [
  { to: "/dashboard", label: "Home", icon: House, auth: true },
  { to: "/discover", label: "Discover", icon: Search, auth: false },
  { to: "/papers", label: "Catalog", icon: BookOpen, auth: false },
  { to: "/library", label: "Library", icon: LibraryBig, auth: true },
  { to: "/documents", label: "Documents", icon: FileText, auth: true },
  { to: "/research", label: "Research", icon: FlaskConical, auth: true },
  { to: "/tools/citations", label: "Citations", icon: Quote, auth: false },
];

/**
 * Graphite mark: a "P" monogram on an ink tile, with a small signal-orange square where a citation marker sits.
 * Theme-aware: the tile and letter swap in Night mode; the orange marker stays.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={clsx("shrink-0", className ?? "h-7 w-7")}>
      <rect width="32" height="32" rx="8" className="fill-slate-950" />
      <path d="M9.5 7.5h7.25a6.25 6.25 0 0 1 0 12.5H13.5v4.5h-4z M13.5 11v5.5h3.1a2.75 2.75 0 0 0 0-5.5z" fillRule="evenodd" className="fill-white" />
      <rect x="20" y="20.5" width="4.5" height="4.5" rx="1.2" className="fill-brand-500" />
    </svg>
  );
}

export function Logo() {
  const { user } = useAuth();
  return (
    <Link to={user ? "/dashboard" : "/"} className="flex shrink-0 items-center gap-2.5 whitespace-nowrap text-[17px] font-bold tracking-[-0.02em] text-slate-950">
      <LogoMark />
      PaperAid Pro
    </Link>
  );
}

export function Layout() {
  const { user, signOut, loading } = useAuth();
  const { openHelp } = useGuidance();
  const [open, setOpen] = useState(false);
  const links = NAV.filter((item) => !item.auth || user);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Logo />
          <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Main">
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                title={label}
                aria-label={label}
                className={({ isActive }) =>
                  clsx("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition", isActive ? "bg-slate-100 text-slate-950" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900")
                }
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span className="hidden xl:inline">{label}</span>
              </NavLink>
            ))}
            {user?.role === "admin" && (
              <NavLink to="/admin" className={({ isActive }) => clsx("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition", isActive ? "bg-slate-100 text-slate-950" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900")}>
                <Shield className="h-4 w-4" aria-hidden /> <span className="hidden xl:inline">Admin</span>
              </NavLink>
            )}
          </nav>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            <ThemeSwitch compact />
            {loading ? null : user ? (
              <>
                <HelpButton />
                <Link to="/account" title={user.name || user.email} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-sm text-slate-700 hover:bg-slate-100">
                  <UserRound className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="hidden max-w-[9rem] truncate whitespace-nowrap 2xl:inline">{user.name || user.email}</span>
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
                <Link to="/register" className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
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
            <div className="flex items-center justify-between px-2 py-2 text-sm text-slate-600">
              Appearance <ThemeSwitch compact />
            </div>
            {links.map(({ to, label }) => (
              <NavLink key={to} to={to} onClick={() => setOpen(false)} className="block rounded px-2 py-2 text-sm text-slate-700">
                {label}
              </NavLink>
            ))}
            {user ? (
              <>
                <button className="block w-full px-2 py-2 text-left text-sm text-slate-700" onClick={() => { setOpen(false); openHelp(); }}>
                  Help
                </button>
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
          <span className="flex items-center gap-2"><LogoMark className="h-4 w-4" /> © {new Date().getFullYear()} PaperAid Pro · Silver</span>
          <span className="flex gap-4">
            <Link to="/terms" className="hover:text-slate-800">
              Terms
            </Link>
            <Link to="/privacy" className="hover:text-slate-800">
              Privacy
            </Link>
            <Link to="/ai-notice" className="hover:text-slate-800">
              AI notice
            </Link>
            <a href="https://openalex.org" className="hover:text-slate-800" target="_blank" rel="noreferrer">
              Metadata: OpenAlex, Crossref, Semantic Scholar, DOAJ, PubMed, Europe PMC
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
  const { user, firebaseUser, loading, notInvited, accountConflict, profileError, resendVerification, refresh, signOut } = useAuth();
  const location = useLocation();
  const [sent, setSent] = useState(false);
  // Whether this signed-in person's pages have been shown (then consent is asked in an overlay, not by unmounting).
  const workMounted = useRef(false);
  const mountedFor = useRef<string | null>(null);
  if ((user?.id ?? null) !== mountedFor.current) {
    mountedFor.current = user?.id ?? null;
    workMounted.current = false;
  }
  const inertRef = useInert(Boolean(user?.needs_consent));
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
  if (accountConflict) {
    return (
      <Container className="max-w-xl">
        <Alert kind="warning" title="This email is linked to a different sign-in">
          An account for <strong>{firebaseUser.email}</strong> already exists, created with another sign-in method.
          Sign out and sign in the way you originally did, or ask the project owner to re-link your account.
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </Alert>
        <p className="mt-4 text-sm text-slate-600">
          To download or delete the data of your original account, sign in with its original method and use Account,
          or write to the privacy contact on the <Link className="text-brand-700 underline" to="/privacy">Privacy Notice</Link>.
        </p>
      </Container>
    );
  }
  if (notInvited) {
    return (
      <Container className="max-w-xl">
        <Alert kind="info" title="PaperAid Pro is in a private test">
          <strong>{firebaseUser.email}</strong> isn’t on the tester list yet. Ask the project owner to add you.
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </Alert>
        {/* Former testers keep their data rights (the API serves export and deletion to them). */}
        {firebaseUser.email && <DataRightsPanel email={firebaseUser.email} />}
      </Container>
    );
  }
  if (!user) {
    if (profileError) {
      return (
        <Container className="max-w-xl">
          <Alert kind="error" title="We couldn’t load your account">
            Check your connection and try again.
            <div className="mt-3">
              <Button size="sm" onClick={() => void refresh()}>Try again</Button>
            </div>
          </Alert>
        </Container>
      );
    }
    return <Spinner label="Loading your account" />;
  }
  if (user.needs_consent && !workMounted.current) return <ConsentGate />;
  if (admin && user.role !== "admin") return <Navigate to="/" replace />;
  workMounted.current = true;
  // Consent requested mid-session (the policy changed while someone was working): ask in an overlay and keep the
  // page underneath mounted, so unsaved work (e.g. the editor's pending saves) survives and saves after acceptance.
  return (
    <>
      <div ref={inertRef} aria-hidden={user.needs_consent || undefined}>{children}</div>
      {user.needs_consent && (
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/50" role="presentation">
          <ConsentGate />
        </div>
      )}
    </>
  );
}

/** Make the page behind the consent overlay unreachable by keyboard and pointer (the `inert` attribute). */
function useInert(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (active) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [active]);
  return ref;
}
