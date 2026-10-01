import { Metadata } from "next";
import { DiscoveryInterface } from "@/components/discovery/discovery-interface";

export const metadata: Metadata = {
  title: "Scholarly Discovery | AI Research Hub",
  description:
    "Discover global scientific literature across PubMed, Crossref, and Semantic Scholar with automated deduplication and controlled evidence import.",
};

export default function DiscoverPage() {
  return <DiscoveryInterface />;
}
