import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.slice(0, length).trimEnd() + "...";
}

/**
 * Safely decodes common HTML entity representations in academic metadata
 * (e.g. converting "&amp;" to "&" in journal names, publishers, or article titles)
 * so React text nodes render the correct typography without unsafe HTML injection.
 */
export function formatMetadataText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&#8211;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&#8212;/g, "—");
}
