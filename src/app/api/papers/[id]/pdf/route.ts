import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { downloadPaperPdf } from "@/lib/storage";
import { authorizeCurrentSession } from "@/lib/auth/paper-authorization";

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
    const authResult = await authorizeCurrentSession(paper, "DOWNLOAD_PDF");

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
        return NextResponse.json(
          { error: "Stored manuscript file could not be retrieved from storage." },
          { status: 404 }
        );
      }
    }

    // 2. If only external pdfUrl is available, redirect ONLY to verified external publisher URLs
    // (Never redirect to internal Supabase Storage direct CDN URLs)
    if (
      paper.pdfUrl &&
      paper.pdfUrl.startsWith("http") &&
      !paper.pdfUrl.includes(".supabase.co/storage/")
    ) {
      return NextResponse.redirect(paper.pdfUrl, 307);
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
