import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { citedEvidenceClient } from "@/lib/citedevidence/client";
import { validateToolRequest } from "@/lib/citedevidence/tool-allowlist";
import {
  RateLimitExceededError,
  CircuitBreakerOpenError,
} from "@/lib/citedevidence/safeguards";

interface RouteParams {
  params: {
    toolName: string;
  };
}

/**
 * POST /api/scholar/tools/[toolName]
 * Executes an approved CitedEvidence academic research tool safely on the server.
 * Requires:
 * 1. Valid NextAuth session (fail-closed, HTTP 401 for anonymous).
 * 2. Maximum request body limit of 100 KB (HTTP 413).
 * 3. Strict allowlist verification (HTTP 403 for destructive or unknown tools).
 * 4. Dedicated Zod schema validation of arguments (HTTP 400 for invalid/malformed payloads).
 * 5. Per-user and global rate limiting, bounded concurrency, and circuit breaker protection.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
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
        { error: "Authentication required to execute scholarly research tools." },
        { status: 401 }
      );
    }

    // 2. Request payload size check (< 100 KB)
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > 100 * 1024) {
      return NextResponse.json(
        { error: "Payload too large. Maximum request size is 100KB." },
        { status: 413 }
      );
    }

    const { toolName } = params;

    // 3. Read body safely with size ceiling
    let rawBodyText = "";
    try {
      rawBodyText = await req.text();
    } catch {
      rawBodyText = "";
    }

    if (rawBodyText.length > 100 * 1024) {
      return NextResponse.json(
        { error: "Payload too large. Maximum request size is 100KB." },
        { status: 413 }
      );
    }

    let parsedArgs: unknown = {};
    if (rawBodyText.trim()) {
      try {
        const parsedJson = JSON.parse(rawBodyText);
        parsedArgs = parsedJson.args !== undefined ? parsedJson.args : parsedJson;
      } catch {
        return NextResponse.json(
          { error: "Invalid JSON request body." },
          { status: 400 }
        );
      }
    }

    // 4. Strict allowlist and Zod schema validation
    const validation = validateToolRequest(toolName, parsedArgs);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: validation.status }
      );
    }

    // 5. Check if upstream client is configured
    if (!citedEvidenceClient.isConfigured()) {
      return NextResponse.json(
        { error: "CitedEvidence API is not configured on the server." },
        { status: 503 }
      );
    }

    // 6. User identity for rate limiting
    const userId = (session.user as any).id || session.user.email || "authenticated_user";

    // 7. Execute tool with bounded concurrency and safeguards
    const result = await citedEvidenceClient.executeTool(
      toolName,
      validation.sanitizedArgs || {},
      { userId }
    );

    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json(
        { error: err.message, retryAfterSeconds: err.retryAfterSeconds },
        {
          status: 429,
          headers: { "Retry-After": String(err.retryAfterSeconds) },
        }
      );
    }

    if (err instanceof CircuitBreakerOpenError) {
      return NextResponse.json(
        {
          error:
            "CitedEvidence research service is temporarily unavailable due to upstream rate limiting. Please try again shortly.",
        },
        {
          status: 503,
          headers: { "Retry-After": "60" },
        }
      );
    }

    const isRateLimit =
      err?.status === 429 ||
      err?.message?.includes("429") ||
      err?.message?.includes("rate limit");
    const isAuth = err?.status === 401 || err?.message?.includes("401");
    const isCircuitOpen =
      err?.message?.includes("Circuit breaker is OPEN") || err?.status === 503;

    return NextResponse.json(
      { error: err?.message || "Internal tool execution failure." },
      {
        status: isRateLimit ? 429 : isAuth ? 401 : isCircuitOpen ? 503 : 500,
      }
    );
  }
}
