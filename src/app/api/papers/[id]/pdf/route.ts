import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { downloadPaperPdf } from "@/lib/storage";

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
      },
    });

    if (!paper) {
      return NextResponse.json({ error: "Paper not found." }, { status: 404 });
    }

    // 1. If storagePath exists, stream directly from Supabase Storage
    if (paper.storagePath) {
      try {
        const buffer = await downloadPaperPdf(paper.storagePath);
        const safeTitle = paper.title.replace(/[^a-zA-Z0-9_\-\s]/g, "").slice(0, 50);

        return new Response(new Uint8Array(buffer), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="${safeTitle || "manuscript"}.pdf"`,
            "Cache-Control": "public, max-age=3600, s-maxage=3600",
          },
        });
      } catch (storageErr: any) {
        console.warn(
          `Could not stream PDF from storagePath (${paper.storagePath}):`,
          storageErr.message
        );
        // Fall back to external pdfUrl if available
        if (paper.pdfUrl && paper.pdfUrl.startsWith("http")) {
          return NextResponse.redirect(paper.pdfUrl, 307);
        }
        return NextResponse.json(
          { error: "Stored manuscript file could not be retrieved." },
          { status: 502 }
        );
      }
    }

    // 2. If only external pdfUrl is available, redirect to it
    if (paper.pdfUrl && paper.pdfUrl.startsWith("http")) {
      return NextResponse.redirect(paper.pdfUrl, 307);
    }

    return NextResponse.json(
      { error: "No PDF manuscript attached to this paper." },
      { status: 404 }
    );
  } catch (err: any) {
    console.error("PDF endpoint error:", err);
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

