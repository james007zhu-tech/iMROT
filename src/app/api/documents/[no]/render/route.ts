import { readFile } from "node:fs/promises";
import { errorCode } from "@/lib/errors";
import { NextResponse } from "next/server";
import { canReadDocument, sessionScope } from "@/server/api-auth";
import { renderDocument } from "@/server/reports";

/** GET /api/documents/:no/render?format=pdf|docx&template=09 — fill the DCiT template from event data and download. */
export async function GET(req: Request, ctx: { params: Promise<{ no: string }> }) {
  const scope = await sessionScope();
  if (!scope) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { no } = await ctx.params;
  const u = new URL(req.url);
  // Portal contacts may only download their own customer's documents.
  if (!(await canReadDocument(scope, no))) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const r = await renderDocument(no, u.searchParams.get("template") ?? undefined);
    const wantPdf = u.searchParams.get("format") === "pdf";
    const file = wantPdf && r.pdfPath ? r.pdfPath : r.docxPath;
    const body = await readFile(file);
    return new NextResponse(body, {
      headers: {
        "content-type": file.endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="${no}${file.endsWith(".pdf") ? ".pdf" : ".docx"}"`,
        "x-unfilled-placeholders": r.unfilled.join(","),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: errorCode(e) }, { status: 400 });
  }
}
