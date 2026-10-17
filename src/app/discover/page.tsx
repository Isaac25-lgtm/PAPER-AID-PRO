import { Metadata } from "next";
import { Suspense } from "react";
import { DiscoveryInterface } from "@/components/discovery/discovery-interface";

export const metadata: Metadata = {
  title: "Scholarly Discovery | AI Research Hub",
  description:
    "Discover global scientific literature across PubMed, Crossref, and Semantic Scholar with automated deduplication and controlled evidence import.",
};

export default function DiscoverPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-64 bg-slate-200 rounded" />
            <div className="h-4 w-96 bg-slate-200 rounded" />
            <div className="h-14 w-full bg-slate-200 rounded-lg mt-6" />
          </div>
        </div>
      }
    >
      <DiscoveryInterface />
    </Suspense>
  );
}
