import { NextRequest, NextResponse } from "next/server";
import { getStyleXml, sanitizeStyleId } from "@/lib/citations/csl/style-registry";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const styleId = sanitizeStyleId(params.id);
    const { searchParams } = new URL(req.url);
    const revisionSha = searchParams.get("revision") || undefined;
    const style = await getStyleXml(styleId, revisionSha);

    return NextResponse.json({
      success: true,
      style: {
        id: style.id,
        title: style.title,
        format: style.format,
        xml: style.xml,
        isDependent: style.isDependent,
        parentId: style.parentId,
        revisionSha: style.revisionSha,
        license: "CC BY-SA 3.0 (Citation Style Language)",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load style." },
      { status: 404 }
    );
  }
}
