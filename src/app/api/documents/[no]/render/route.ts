import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { renderDocument } from "@/server/reports";

/** GET /api/documents/:no/render?format=pdf|docx&template=09 — fill the DCiT template from event data and download. */
export async function GET(req: Request, ctx: { params: Promise<{ no: string }> }) {
  const { no } = await ctx.params;
  const u = new URL(req.url);
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
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
