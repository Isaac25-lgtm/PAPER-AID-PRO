import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { citedEvidenceClient } from "@/lib/citedevidence/client";
import { verifyCitation } from "@/lib/citations/verification-engine";
import { CitationVerificationRequest } from "@/lib/citations/verification-types";

const MAX_PAYLOAD_SIZE = 50 * 1024; // 50 KB ceiling

/**
 * POST /api/citations/verify
 *
 * Verifies academic citations and persistent identifiers (DOIs, PMIDs)
 * against authoritative scholarly registries (Crossref, PubMed, OpenAlex, CEDOA).
 *
 * Enforces:
 * 1. NextAuth user authentication (fail-closed, 401 for anonymous).
 * 2. 50 KB payload ceiling (413).
 * 3. Deterministic classification into VERIFIED, MISMATCHED, NOT FOUND, or UNVERIFIABLE.
 * 4. Provider-wide and per-user sliding-window rate limiting.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Authentication Check (fail-closed)
    let session = null;
    try {
      session = await getServerSession(authOptions);
    } catch {
      session = null;
    }

    if (!session || !session.user) {
      return NextResponse.json(
        { error: "Authentication required to verify citations against academic registries." },
        { status: 401 }
      );
    }

    // 2. Service configuration check
    if (!citedEvidenceClient.isConfigured()) {
      return NextResponse.json(
        { error: "Citation verification service is not configured on the server." },
        { status: 503 }
      );
    }

    // 3. Payload size check
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_SIZE) {
      return NextResponse.json(
        { error: "Payload too large. Maximum request size is 50KB." },
        { status: 413 }
      );
    }

    let rawText = "";
    try {
      rawText = await req.text();
    } catch {
      rawText = "";
    }

    if (rawText.length > MAX_PAYLOAD_SIZE) {
      return NextResponse.json(
        { error: "Payload too large. Maximum request size is 50KB." },
        { status: 413 }
      );
    }

    let requestBody: CitationVerificationRequest = {};
    if (rawText.trim()) {
      try {
        requestBody = JSON.parse(rawText);
      } catch {
        return NextResponse.json(
          { error: "Invalid JSON request body." },
          { status: 400 }
        );
      }
    }

    // 4. Derive user identity for rate-limiting
    const userId = (session.user as any).id || session.user.email || "authenticated_user";

    // 5. Execute deterministic citation verification
    const result = await verifyCitation(requestBody, { userId });

    return NextResponse.json(result);
  } catch (err: any) {
    const isRateLimit =
      err?.status === 429 ||
      err?.message?.includes("429") ||
      err?.message?.includes("rate limit");
    const isAuth = err?.status === 401 || err?.message?.includes("401");

    return NextResponse.json(
      { error: err?.message || "Citation verification failed." },
      { status: isRateLimit ? 429 : isAuth ? 401 : 500 }
    );
  }
}
