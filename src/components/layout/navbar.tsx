"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  Search,
  Menu,
  X,
  Sparkles,
  GraduationCap,
  Bookmark,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function Navbar() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      window.location.href = `/papers?q=${encodeURIComponent(searchQuery.trim())}`;
    }
  };

  const navLinks = [
    { title: "Home", href: "/" },
    { title: "Discover", href: "/discover" },
    ...(session?.user
      ? [{ title: "My Library", href: "/library" }]
      : [{ title: "Catalog", href: "/papers" }]),
    { title: "Research", href: "/research" },
    { title: "History", href: "/history" },
  ];

  const isLinkActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200/80 bg-white/85 backdrop-blur-md transition-all">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <div className="flex items-center gap-6 lg:gap-8">
          <Link href="/" className="flex items-center gap-2.5 group shrink-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm transition-transform group-hover:scale-105">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="text-base font-bold tracking-tight text-slate-900 leading-tight">
                AI Research Hub
              </span>
              <span className="text-[10px] uppercase font-semibold tracking-wider text-indigo-600">
                Academic Intelligence
              </span>
            </div>
          </Link>

          {/* Desktop Primary Navigation */}
          <nav className="hidden md:flex items-center gap-1 text-sm font-medium">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-md px-3 py-1.5 transition-colors",
                  isLinkActive(link.href)
                    ? "bg-slate-100 font-semibold text-indigo-600"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                {link.title}
              </Link>
            ))}

            {/* Admin Link (Only for ADMIN role) */}
            {session?.user?.role === "ADMIN" && (
              <Link
                href="/admin"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-colors ml-1",
                  pathname.startsWith("/admin")
                    ? "bg-amber-100 text-amber-900"
                    : "text-amber-800 bg-amber-50 hover:bg-amber-100"
                )}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Admin</span>
              </Link>
            )}
          </nav>
        </div>

        {/* Global Search Bar */}
        <div className="hidden lg:flex items-center gap-4 flex-1 max-w-xs ml-4 mr-4">
          <form onSubmit={handleSearchSubmit} className="relative w-full">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input
              type="search"
              placeholder="Search papers, DOIs, authors..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 h-8 w-full bg-slate-50 border-slate-200 focus:bg-white text-xs"
            />
          </form>
        </div>

        {/* Right Auth / User Area */}
        <div className="hidden md:flex items-center gap-3 shrink-0">
          {status === "loading" ? (
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-slate-100 animate-pulse" />
              <div className="h-4 w-16 bg-slate-100 rounded animate-pulse" />
            </div>
          ) : session?.user ? (
            <div className="flex items-center gap-3">
              <Link href="/account" title="Account Settings" className="flex items-center gap-2 group">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs group-hover:ring-2 group-hover:ring-indigo-300 transition-all cursor-pointer">
                  {session.user.name ? session.user.name[0].toUpperCase() : "U"}
                </div>
                <span className="text-xs font-medium text-slate-700 group-hover:text-slate-900 max-w-[120px] truncate">
                  {session.user.name || "My Account"}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/" })}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-md hover:bg-slate-100 transition-colors"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm" className="text-xs text-slate-700 font-semibold">
                  Sign In
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold gap-1.5 shadow-xs">
                  <Sparkles className="h-3.5 w-3.5" />
                  Explore Free
                </Button>
              </Link>
            </>
          )}
        </div>

        {/* Mobile Hamburger Button */}
        <div className="flex md:hidden items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-b border-slate-200 bg-white px-4 py-4 space-y-4">
          <nav className="flex flex-col space-y-1 text-sm font-medium">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "px-3 py-2 rounded-md transition-colors",
                  isLinkActive(link.href)
                    ? "bg-slate-100 font-semibold text-indigo-600"
                    : "text-slate-700 hover:bg-slate-50"
                )}
              >
                {link.title}
              </Link>
            ))}

            {session?.user?.role === "ADMIN" && (
              <Link
                href="/admin"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-900 text-sm font-semibold flex items-center justify-between"
              >
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4" />
                  <span>Admin Console</span>
                </span>
                <span className="text-[10px] uppercase font-bold bg-amber-200 px-1.5 py-0.5 rounded">Admin</span>
              </Link>
            )}
          </nav>

          <div className="pt-2 border-t border-slate-100 flex flex-col gap-2">
            {status === "loading" ? (
              <div className="flex items-center gap-2 p-2">
                <div className="h-8 w-8 rounded-full bg-slate-100 animate-pulse" />
                <div className="h-4 w-24 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : session?.user ? (
              <>
                <Link
                  href="/account"
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2 rounded-md hover:bg-slate-50 text-slate-700 text-sm font-medium flex items-center justify-between"
                >
                  <span>Account Settings</span>
                  <span className="text-xs text-slate-400">{session.user.name || session.user.email}</span>
                </Link>
                <Button
                  variant="outline"
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="w-full text-xs font-semibold mt-2"
                >
                  Sign Out
                </Button>
              </>
            ) : (
              <>
                <Link href="/login" onClick={() => setMobileMenuOpen(false)}>
                  <Button variant="outline" className="w-full text-xs font-semibold">
                    Sign In
                  </Button>
                </Link>
                <Link href="/register" onClick={() => setMobileMenuOpen(false)}>
                  <Button className="w-full bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold">
                    Explore Free
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
