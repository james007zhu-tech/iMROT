import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { errorCode } from "@/lib/errors";
import { currentEmployee } from "@/server/auth";
import { prisma } from "@/lib/db";
import { renderSalaryLetter } from "@/server/salary-letter";

/**
 * GET /api/people/:code/salary/:id/letter?format=pdf|docx — 调薪通知单 (template 32), STRICTLY CONFIDENTIAL.
 * MD only, rendered fresh every time, never cached; each render is audited (SALARY_LETTER).
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string; id: string }> }) {
  const me = await currentEmployee().catch(() => null);
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (me.role !== "MD") return NextResponse.json({ error: "not found" }, { status: 404 });
  const { code, id } = await ctx.params;
  const rec = await prisma.salaryRecord.findFirst({ where: { id, employee: { code } } });
  if (!rec) return NextResponse.json({ error: "not found" }, { status: 404 });
  let r: Awaited<ReturnType<typeof renderSalaryLetter>> | undefined;
  try {
    r = await renderSalaryLetter(me.code, id);
    const pdf = new URL(req.url).searchParams.get("format") === "pdf" && r.pdfPath;
    const file = pdf ? r.pdfPath! : r.docxPath, ext = pdf ? ".pdf" : ".docx";
    const local = `${r.fileBase.split("_")[0]}_调薪通知单${ext}`;
    return new NextResponse(new Uint8Array(await readFile(file)), { headers: {
      "content-type": pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${r.fileBase}${ext}"; filename*=UTF-8''${encodeURIComponent(local)}`,
      "cache-control": "no-store, private",
      "x-unfilled-placeholders": r.unfilled.join(","),
    } });
  } catch (e) {
    return NextResponse.json({ error: errorCode(e) }, { status: 400 });
  } finally {
    await r?.cleanup();
  }
}
