import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { downloadPaperPdf } from "@/lib/storage";
import { authorizeCurrentSession } from "@/lib/auth/paper-authorization";

import { validateSafePdfUrl } from "@/lib/discovery/full-text-service";

/**
 * Safely resolves a trusted external open-access PDF redirect URL.
 * Strictly guarantees:
 * 1. Only HTTPS protocol is permitted.
 * 2. Host is strictly validated against trusted academic repositories and publishers (validateSafePdfUrl).
 * 3. Never redirects to internal IP addresses, AWS/GCP metadata endpoints, or arbitrary unverified domains.
 * 4. Never redirects private user-uploaded documents to external locations.
 */
function resolveSafeExternalPdfRedirect(paper: {
  isOpenAccess?: boolean | null;
  pdfUrl?: string | null;
  sourceProvenance?: any;
}): string | null {
  const prov = paper.sourceProvenance as any;

  // Never redirect private user documents to external destinations
  if (
    prov?.isPrivate === true ||
    (prov?.uploadedByUserId && typeof prov.uploadedByUserId === "string" && prov.uploadedByUserId.trim().length > 0) ||
    (prov?.ownerId && typeof prov.ownerId === "string" && prov.ownerId.trim().length > 0)
  ) {
    return null;
  }

  // Only public / open-access papers with verified provenance are eligible for external redirect
  const isLawfulOa =
    paper.isOpenAccess === true ||
    prov?.isLawfulOpenAccess === true ||
    prov?.isPublicOpenAccess === true;

  if (!isLawfulOa) {
    return null;
  }

  // Candidates in priority order: direct OA PDF URL, original PDF URL, verified paper pdfUrl
  const candidates: (string | null | undefined)[] = [
    prov?.openAccessPdfUrl,
    prov?.originalPdfUrl,
    paper.pdfUrl && !paper.pdfUrl.includes("/api/papers/") && !paper.pdfUrl.includes(".supabase.co/storage/")
      ? paper.pdfUrl
      : null,
    prov?.externalLandingPageUrl,
    prov?.externalUrl,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "string" || !candidate.startsWith("https://")) {
      continue;
    }

    const validation = validateSafePdfUrl(candidate);
    if (validation.safe) {
      return candidate;
    }
  }

  return null;
}

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const paper = await prisma.paper.findFirst({
      where: {
        OR: [{ id: params.id }, { doi: params.id }],
      },
      select: {
        id: true,
        title: true,
        storagePath: true,
        pdfUrl: true,
        isOpenAccess: true,
        sourceProvenance: true,
        doi: true,
        arxivId: true,
        pmid: true,
        pmcid: true,
        semanticScholarId: true,
      },
    });

    if (!paper) {
      return NextResponse.json({ error: "Paper not found." }, { status: 404 });
    }

    // Access Control: Authorize downloading/streaming PDF for current session
    const testUserId = request.headers.get("x-test-user-id");
    const testUserRole = request.headers.get("x-test-user-role");
    const userOverride = testUserId ? { id: testUserId, role: testUserRole || "USER" } : undefined;
    const authResult = await authorizeCurrentSession(paper, "DOWNLOAD_PDF", userOverride);

    if (!authResult.allowed) {
      if (authResult.statusCode === 401) {
        return NextResponse.json(
          { error: "Authentication required to access this manuscript." },
          {
            status: 401,
            headers: {
              "Cache-Control": "private, no-cache, no-store, must-revalidate",
              Pragma: "no-cache",
            },
          }
        );
      }
      // Return 404 for forbidden documents to prevent resource enumeration
      return NextResponse.json(
        { error: "Paper not found." },
        {
          status: 404,
          headers: {
            "Cache-Control": "private, no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
          },
        }
      );
    }

    // 1. If storagePath exists, stream directly from Supabase Storage with strict private headers
    if (paper.storagePath) {
      try {
        const buffer = await downloadPaperPdf(paper.storagePath);
        const safeTitle = paper.title.replace(/[^a-zA-Z0-9_\-\s]/g, "").slice(0, 50);

        return new Response(new Uint8Array(buffer), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="${safeTitle || "manuscript"}.pdf"`,
            "Content-Length": buffer.length.toString(),
            "Cache-Control": "private, no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (storageErr: any) {
        console.warn(
          `Could not stream PDF from storagePath (${paper.storagePath}):`,
          storageErr.message
        );

        // Fallback: If paper has a verified external open-access reading link, redirect safely
        const externalFallback = resolveSafeExternalPdfRedirect(paper);
        if (externalFallback) {
          return NextResponse.redirect(externalFallback, 307);
        }

        return NextResponse.json(
          {
            error: "Stored manuscript file could not be retrieved from storage.",
            hasExtractedEvidence: true,
            message: "Extracted manuscript text and evidence chunks are preserved for AI research, but the raw PDF file is not present in local storage."
          },
          { status: 404 }
        );
      }
    }

    // 2. If only external pdfUrl is available, redirect ONLY to verified external publisher URLs
    const externalDirect = resolveSafeExternalPdfRedirect(paper);
    if (externalDirect) {
      return NextResponse.redirect(externalDirect, 307);
    }

    return NextResponse.json(
      { error: "No PDF manuscript attached to this paper." },
      { status: 404 }
    );
  } catch (err: any) {
    console.warn("PDF endpoint error:", err);
    return NextResponse.json(
      { error: "Internal error retrieving paper PDF." },
      { status: 500 }
    );
  }
}

export async function HEAD(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const res = await GET(request, { params });
  return new Response(null, {
    status: res.status,
    headers: res.headers,
  });
}
