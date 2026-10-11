import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { citedEvidenceClient } from "@/lib/citedevidence/client";
import { APPROVED_RESEARCH_TOOLS } from "@/lib/citedevidence/tool-allowlist";

/**
 * GET /api/scholar/tools
 * Protected route: Lists approved CitedEvidence academic research tools.
 * Requires an authenticated user session (fail-closed).
 */
export async function GET() {
  try {
    // 1. Authentication check (fail-closed)
    let session = null;
    try {
      session = await getServerSession(authOptions);
    } catch {
      session = null;
    }

    if (!session || !session.user) {
      return NextResponse.json(
        { error: "Authentication required to access scholarly research tools." },
        { status: 401 }
      );
    }

    if (!citedEvidenceClient.isConfigured()) {
      return NextResponse.json(
        { error: "CitedEvidence API is not configured on the server." },
        { status: 503 }
      );
    }

    const allTools = await citedEvidenceClient.listTools();
    // Strictly filter to approved read-only tools
    const approvedTools = allTools.filter((t) =>
      APPROVED_RESEARCH_TOOLS.includes(t.name as any)
    );

    return NextResponse.json({ tools: approvedTools });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to retrieve tools catalog." },
      { status: 500 }
    );
  }
}
