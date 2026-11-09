import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { exportDocumentRevision } from "@/lib/editor/revision-service";
import { MAX_PDF_PAYLOAD_BYTES } from "@/lib/editor/pdf-exporter";
import { ManuscriptExportFormat } from "@/lib/editor/document-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * AI RESEARCH HUB — AUTHENTICATED DOCUMENT REVISION EXPORT ROUTE
 *
 * Provides a read-only, authenticated export endpoint for historical document snapshots.
 * Guarantees zero database mutations, strict user ownership verification, and secure headers.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; revisionId: string } }
) {
  try {
    let session = null;
    try {
      session = await getServerSession(authOptions);
    } catch {
      session = null;
    }
    if (!session?.user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { id: documentId, revisionId } = params;
    if (!documentId || !revisionId) {
      return new NextResponse("Invalid document or revision ID", { status: 400 });
    }

    const searchParams = req.nextUrl.searchParams;
    const format = (searchParams.get("format") || "markdown") as ManuscriptExportFormat;

    const result = await exportDocumentRevision(session.user.id, documentId, revisionId, format);
    const safeFilename = result.filename.replace(/[^\w.-]/g, "_");

    if (result.isBinary) {
      const buffer = Buffer.from(result.content, "base64");
      if (format === "pdf" && buffer.length > MAX_PDF_PAYLOAD_BYTES) {
        return new NextResponse(
          "Exported revision PDF exceeds the 4 MiB serverless transport limit.",
          { status: 413 }
        );
      }
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": result.mimeType,
          "Content-Disposition": `attachment; filename="${safeFilename}"`,
          "Cache-Control": "private, no-store, max-age=0, must-revalidate",
          "Pragma": "no-cache",
          "X-Content-Type-Options": "nosniff",
          "Content-Length": buffer.length.toString(),
        },
      });
    }

    return new NextResponse(result.content, {
      status: 200,
      headers: {
        "Content-Type": result.mimeType,
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err: any) {
    if (err.message?.includes("not found") || err.message?.includes("Unauthorized")) {
      return new NextResponse("Access denied or revision not found.", { status: 403 });
    }
    return new NextResponse("Revision export failed.", { status: 500 });
  }
}

