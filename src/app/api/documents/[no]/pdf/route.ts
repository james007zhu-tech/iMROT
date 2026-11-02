import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const OUT = process.env.DOCS_DIR ?? path.join(process.cwd(), "uploads", "documents");

/** GET /api/documents/:no/pdf — the last rendered PDF */
export async function GET(_req: Request, ctx: { params: Promise<{ no: string }> }) {
  const { no } = await ctx.params;
  if (!/^[A-Z]{2}(TH|VN|CN)\d{8,9}$/.test(no)) return NextResponse.json({ error: "bad number" }, { status: 400 });
  try {
    const body = await readFile(path.join(OUT, `${no}.pdf`));
    return new NextResponse(body, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${no}.pdf"` } });
  } catch {
    return NextResponse.json({ error: "not rendered yet" }, { status: 404 });
  }
}
