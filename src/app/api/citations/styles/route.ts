import { NextRequest, NextResponse } from "next/server";
import { searchStyles } from "@/lib/citations/csl/style-registry";
import { CslCitationFormat } from "@/lib/citations/csl/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "";
    const format = (searchParams.get("format") || "all") as "all" | CslCitationFormat;
    const limit = parseInt(searchParams.get("limit") || "30", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const result = searchStyles({
      q,
      format,
      limit: isNaN(limit) ? 30 : limit,
      offset: isNaN(offset) ? 0 : offset,
    });

    const { CslCatalogManager } = await import("@/lib/citations/csl/updater/catalog-storage");
    const activeRev = await CslCatalogManager.getAdapter().getActiveRevision();

    return NextResponse.json({
      success: true,
      activeRevision: activeRev?.gitSha || "v1.0.2-baseline-catalog",
      styles: result.styles,
      total: result.total,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to search styles." },
      { status: 500 }
    );
  }
}
