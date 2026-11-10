import * as React from "react";
import Link from "next/link";
import { GraduationCap, ShieldCheck, Database, FileText, BookOpen } from "lucide-react";
import { siteConfig } from "@/config/site";

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-slate-900 text-slate-400 text-xs">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8 space-y-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8">
          {/* Col 1: Brand & Mission */}
          <div className="space-y-4">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
                <GraduationCap className="h-4 w-4" />
              </div>
              <span className="text-base font-bold text-white">
                {siteConfig.name}
              </span>
            </Link>
            <p className="text-xs text-slate-400 leading-relaxed">
              A scientific literature and research manuscript platform designed for rigorous scientific inquiry.
              Discover papers, read original manuscripts, and inspect verifiable evidence-grounded analysis.
            </p>
            <div className="flex flex-col gap-2 text-slate-400 pt-1">
              <span className="flex items-center gap-1.5 text-xs text-slate-300 font-medium">
                <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                Grounded in Source Evidence
              </span>
              <span className="flex items-center gap-1.5 text-xs text-slate-300 font-medium">
                <BookOpen className="h-4 w-4 text-indigo-400 shrink-0" />
                Original Manuscript Access
              </span>
            </div>
          </div>

          {/* Col 2: Research Catalog */}
          <div>
            <h4 className="font-semibold text-white text-xs uppercase tracking-wider mb-3">
              Literature Discovery
            </h4>
            <ul className="space-y-2.5">
              <li>
                <Link href="/papers" className="hover:text-white transition-colors">
                  Browse Papers Catalog
                </Link>
              </li>
              <li>
                <Link href="/authors" className="hover:text-white transition-colors">
                  Author Directory
                </Link>
              </li>
              <li>
                <Link href="/categories" className="hover:text-white transition-colors">
                  Research Disciplines
                </Link>
              </li>
              <li>
                <Link href="/papers" className="hover:text-white transition-colors">
                  Preprints &amp; Manuscripts
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 3: Research Workspace */}
          <div>
            <h4 className="font-semibold text-white text-xs uppercase tracking-wider mb-3">
              Personal Workspace
            </h4>
            <ul className="space-y-2.5">
              <li>
                <Link href="/library" className="hover:text-white transition-colors">
                  My Library
                </Link>
              </li>
              <li>
                <Link href="/account" className="hover:text-white transition-colors">
                  Account Settings
                </Link>
              </li>
              <li>
                <Link href="/login" className="hover:text-white transition-colors">
                  Researcher Sign In
                </Link>
              </li>
              <li>
                <Link href="/register" className="hover:text-white transition-colors">
                  Create Free Account
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 4: Academic Integrity */}
          <div>
            <h4 className="font-semibold text-white text-xs uppercase tracking-wider mb-3">
              Scientific Rigor
            </h4>
            <ul className="space-y-2.5">
              <li className="text-slate-400">Verifiable Manuscript Excerpts</li>
              <li className="text-slate-400">Strict Provenance Separation</li>
              <li className="text-slate-400">Page &amp; Section Anchors</li>
              <li>
                <Link href="/#faqs" className="hover:text-white transition-colors">
                  Academic Integrity FAQ
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-slate-500">
          <p>
            © {new Date().getFullYear()} {siteConfig.name}. Designed for academic rigor and verifiable scientific discovery.
          </p>
          <div className="flex items-center gap-6">
            <Link href="/privacy" className="hover:text-slate-300 transition-colors">
              Privacy Policy
            </Link>
            <Link href="/#faqs" className="hover:text-slate-300 transition-colors">
              Terms of Research
            </Link>
            <Link href="/#faqs" className="hover:text-slate-300 transition-colors">
              Citation Ethics
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
