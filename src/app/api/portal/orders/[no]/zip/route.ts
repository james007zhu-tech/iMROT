import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { sessionScope } from "@/server/api-auth";
import { renderDocument } from "@/server/reports";
import { reportsFor } from "@/lib/order-steps";
import { writeZip } from "@/lib/docx/zip";
import { reportFileName } from "@/lib/report-name";

/** All reports of one service, as one ZIP. Portal contacts only get their own customer's orders. */
export async function GET(_: Request, { params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const scope = await sessionScope();
  if (!scope) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const order = await prisma.serviceOrder.findFirst({ where: { no, ...(scope.kind === "portal" ? { customerId: scope.customerId } : {}) }, include: { documents: { where: { voidedAt: null } }, acceptance: true } });
  if (!order) return NextResponse.json({ error: "not found" }, { status: 404 });
  const entries = [];
  const t = await getTranslations("ui");
  const portalTypes = new Set(["QT", "IN", "RP", "PM", "ER", "DN"]); // same set the portal order page lists
  for (const d of order.documents) {
    if (scope.kind === "portal" && !portalTypes.has(d.type)) continue;
    for (const r of reportsFor(d, !!order.acceptance)) {
      try {
        const out = await renderDocument(d.no, r.template);
        try {
          const file = out.pdfPath ?? out.docxPath;
          const label = t.has(`rpt${out.template}`) ? t(`rpt${out.template}`) : out.fileBase.slice(d.no.length + 1);
          entries.push({ name: reportFileName(d.no, label, file.endsWith(".pdf") ? ".pdf" : ".docx"), data: await readFile(file), method: 0 as const });
        } finally { await out.cleanup(); }
      } catch { /* a document without enough data yet is skipped */ }
    }
  }
  return new NextResponse(new Uint8Array(writeZip(entries)), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${no}-reports.zip"`, "cache-control": "no-store" } });
}
