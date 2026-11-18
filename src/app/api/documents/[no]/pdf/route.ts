import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { documentRefusalResponse, sessionScope } from "@/server/api-auth";

const OUT = process.env.DOCS_DIR ?? path.join(process.cwd(), "uploads", "documents");

/** GET /api/documents/:no/pdf — the last rendered PDF */
export async function GET(_req: Request, ctx: { params: Promise<{ no: string }> }) {
  const scope = await sessionScope();
  if (!scope) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { no } = await ctx.params;
  if (!/^(TEST-)?[A-Z]{2}(TH|VN|CN)\d{8,9}(-(th|zh|en))?$/.test(no)) return NextResponse.json({ error: "bad number" }, { status: 400 });
  // Was open to any portal contact for any number — check the document's customer (the -th/-zh/-en suffix is the same document).
  const refused = await documentRefusalResponse(scope, no.replace(/-(th|zh|en)$/, "")); // 403 with the reason for staff, 404 only when there is no such document (v5 P1-13)
  if (refused) return refused;
  try {
    const body = await readFile(path.join(OUT, `${no}.pdf`));
    return new NextResponse(body, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${no}.pdf"` } });
  } catch {
    return NextResponse.json({ error: "not rendered yet" }, { status: 404 });
  }
}
