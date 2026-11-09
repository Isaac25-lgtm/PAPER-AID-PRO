import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { exportResearchDocument } from "@/lib/editor/document-service";
import { MAX_PDF_PAYLOAD_BYTES } from "@/lib/editor/pdf-exporter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * AI RESEARCH HUB — AUTHENTICATED MANUSCRIPT PDF DOWNLOAD ROUTE
 *
 * Provides a bounded, authenticated direct PDF download endpoint.
 *
 * Guarantees:
 * 1. Strict NextAuth session verification.
 * 2. Strict document ownership verification via document-service.
 * 3. Content-Type: application/pdf with attachment disposition.
 * 4. Cache-Control: private, no-store (zero caching of private academic drafts).
 * 5. Read-only operation: zero database mutations or version increments.
 * 6. Non-streaming payload size enforcement: rejects payloads exceeding 4 MiB serverless limit (HTTP 413).
 */

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
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

    const documentId = params.id;
    if (!documentId) {
      return new NextResponse("Invalid document ID", { status: 400 });
    }

    if (req.signal.aborted) {
      return new NextResponse(null, { status: 499 });
    }

    const result = await exportResearchDocument(session.user.id, documentId, "pdf");
    const buffer = Buffer.from(result.content, "base64");

    if (buffer.length > MAX_PDF_PAYLOAD_BYTES) {
      return new NextResponse(
        "Exported manuscript PDF exceeds the 4 MiB serverless transport limit. Consider exporting individual sections.",
        { status: 413 }
      );
    }

    const safeFilename = result.filename.replace(/[^\w.-]/g, "_");

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch (err: any) {
    if (err.message?.includes("not found") || err.message?.includes("Unauthorized")) {
      return new NextResponse("Access denied or document not found.", { status: 403 });
    }
    return new NextResponse("Manuscript PDF export failed.", { status: 500 });
  }
}

