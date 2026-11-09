/**
 * AI RESEARCH HUB — PHASE 8B: CSL SYNCHRONIZATION ENDPOINT
 *
 * Requirements:
 * 1. Supports scheduled weekly checks (Vercel Cron / VPS worker) and on-demand Admin triggers.
 * 2. Authenticated server-side execution:
 *    - Validates Bearer CRON_SECRET header for scheduled jobs.
 *    - Validates NextAuth session with UserRole.ADMIN for admin triggers.
 * 3. Never publicly exposed.
 * 4. Supports dryRun=true mode for non-destructive inspection.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/auth/admin-guard";
import { CslSyncOrchestrator } from "@/lib/citations/csl/updater/sync-orchestrator";
import { CslCatalogManager } from "@/lib/citations/csl/updater/catalog-storage";

export const dynamic = "force-dynamic";

/**
 * Checks if request is authorized via CRON_SECRET or Admin session (verified against PostgreSQL).
 */
async function authorizeSyncRequest(request: NextRequest): Promise<{ authorized: boolean; reason?: string }> {
  // 1. Check CRON_SECRET header
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && cronSecret.trim().length > 0 && authHeader === `Bearer ${cronSecret.trim()}`) {
    return { authorized: true };
  }

  // 2. Check Admin NextAuth session with authoritative PostgreSQL role verification
  try {
    await verifyAdminSession();
    return { authorized: true };
  } catch (err: any) {
    // Session lookup or DB admin role verification failed
  }

  return { authorized: false, reason: "Authentication required. Valid CRON_SECRET or Admin role required." };
}

/**
 * GET: Returns current catalog telemetry and active revision.
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeSyncRequest(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }

  try {
    const active = await CslCatalogManager.getAdapter().getActiveRevision();
    const revisions = await CslCatalogManager.getAdapter().listRevisions();

    return NextResponse.json({
      activeRevision: active,
      historyCount: revisions.length,
      recentRevisions: revisions.slice(0, 5),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST: Triggers catalog synchronization or dry-run inspection.
 */
export async function POST(request: NextRequest) {
  const auth = await authorizeSyncRequest(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = Boolean(body.dryRun);
    const forceCheck = Boolean(body.forceCheck);
    const branch = body.branch || process.env.CSL_UPSTREAM_BRANCH || "v1.0.2";

    const outcome = await CslSyncOrchestrator.executeSync({
      branch,
      dryRun,
      forceCheck,
    });

    return NextResponse.json(outcome, { status: outcome.success ? 200 : 422 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
