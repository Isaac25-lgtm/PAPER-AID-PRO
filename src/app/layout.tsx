import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { Providers } from "@/components/providers";
import { OnboardingDialog } from "@/components/onboarding/onboarding-dialog";
import { siteConfig } from "@/config/site";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [
    "academic research",
    "scientific papers",
    "manuscript analysis",
    "evidence synthesis",
    "scholarly discovery",
    "literature review",
    "verifiable citations",
  ],
  authors: [{ name: "AI Research Hub" }],
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerSession(authOptions);

  return (
    <html lang="en" className="h-full scroll-smooth">
      <body className="flex min-h-full flex-col bg-slate-50/50 text-slate-900 font-sans antialiased">
        <Providers session={session}>
          <AppShell>{children}</AppShell>
          <OnboardingDialog />
        </Providers>
      </body>
    </html>
  );
}

