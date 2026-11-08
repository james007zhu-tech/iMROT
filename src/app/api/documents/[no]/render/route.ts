import { readFile } from "node:fs/promises";
import { getTranslations } from "next-intl/server";
import { errorCode } from "@/lib/errors";
import { NextResponse } from "next/server";
import { canReadDocument, sessionScope } from "@/server/api-auth";
import { renderDocument } from "@/server/reports";
import { reportFileName } from "@/lib/report-name";

/**
 * GET /api/documents/:no/render?format=pdf|docx&template=09 — fill the DCiT template from event data and download.
 * Rendered fresh on every request and never cached, so a report always shows the current data and template.
 * File name: number + report, e.g. QTTH261108004_报价建议书.pdf (ASCII fallback QTTH261108004_Repair_Service_Proposal.pdf).
 */
export async function GET(req: Request, ctx: { params: Promise<{ no: string }> }) {
  const scope = await sessionScope();
  if (!scope) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { no } = await ctx.params;
  const u = new URL(req.url);
  // Portal contacts may only download their own customer's documents.
  if (!(await canReadDocument(scope, no))) return NextResponse.json({ error: "not found" }, { status: 404 });
  let r: Awaited<ReturnType<typeof renderDocument>> | undefined;
  try {
    r = await renderDocument(no, u.searchParams.get("template") ?? undefined);
    const wantPdf = u.searchParams.get("format") === "pdf";
    const file = wantPdf && r.pdfPath ? r.pdfPath : r.docxPath;
    const ext = file.endsWith(".pdf") ? ".pdf" : ".docx";
    const body = await readFile(file);
    const t = await getTranslations("ui");
    const local = reportFileName(no, t.has(`rpt${r.template}`) ? t(`rpt${r.template}`) : "", ext);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "content-type": ext === ".pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="${r.fileBase}${ext}"; filename*=UTF-8''${encodeURIComponent(local)}`,
        "cache-control": "no-store",
        "x-unfilled-placeholders": r.unfilled.join(","),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: errorCode(e) }, { status: 400 });
  } finally {
    await r?.cleanup();
  }
}
