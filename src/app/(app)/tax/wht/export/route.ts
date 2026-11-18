/** ภ.ง.ด.3 / ภ.ง.ด.53 of a month as a workbook: the certificates issued (payment confirmed) in that month, in the order of the form's attachment (ใบแนบ). Finance and the MD. */
import { NextResponse } from "next/server";
import { hasRole } from "@/lib/caps";
import { localIso } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { WHT_TH, pndOf, taxId13, type WhtType } from "@/lib/wht";
import { buildXlsx, type Cell } from "@/lib/xlsx";
import { currentEmployee } from "@/server/auth";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const me = await currentEmployee();
  if (!hasRole(me, "MD", "FINANCE")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams, month = /^\d{4}-\d{2}$/.test(sp.get("month") ?? "") ? sp.get("month")! : new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7), pnd = sp.get("pnd") === "3" ? "3" : "53";
  const from = new Date(new Date(`${month}-01T00:00:00Z`).getTime() - 7 * 3600_000), to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1) - 7 * 3600_000);
  const rows = (await prisma.supplierPayment.findMany({ where: { entityId: me.entityId, status: "PAID", whtCertNo: { not: null }, paidAt: { gte: from, lt: to } }, orderBy: { paidAt: "asc" }, include: { supplierInvoice: { select: { subtotal: true, total: true, supplier: true } } } }))
    .filter((p) => pndOf(p.supplierInvoice.supplier.nameLocal ?? p.supplierInvoice.supplier.name) === pnd);
  const base = (p: (typeof rows)[number]) => Math.round(Number(p.gross ?? 0) * (Number(p.supplierInvoice.total) > 0 ? Number(p.supplierInvoice.subtotal) / Number(p.supplierInvoice.total) : 1) * 100) / 100;
  const head: Cell[] = ["ลำดับที่", "เลขประจำตัวผู้เสียภาษีอากร", "สาขา", "ชื่อผู้มีเงินได้", "ที่อยู่", "วัน เดือน ปี ที่จ่าย", "ประเภทเงินได้", "อัตราภาษี %", "จำนวนเงินที่จ่าย", "ภาษีที่หักและนำส่ง", "เงื่อนไข", "เลขที่ 50 ทวิ", "PVTH"];
  const body = rows.map((p, i) => { const s = p.supplierInvoice.supplier, d = localIso(p.paidAt)!.slice(0, 10).split("-"); return [i + 1, taxId13(s.taxId), s.branchCode ?? "", s.nameLocal ?? s.name, s.address ?? "", `${d[2]}/${d[1]}/${Number(d[0]) + 543}`, WHT_TH[(p.whtType ?? "SERVICE") as WhtType], Number(p.whtRate ?? 0) * 100, base(p), Number(p.whtAmount), 1, p.whtCertNo, p.no] as Cell[]; });
  const total: Cell[] = ["", "", "", "", "", "", "", "รวม", rows.reduce((a, p) => a + base(p), 0), rows.reduce((a, p) => a + Number(p.whtAmount), 0)];
  return new NextResponse(new Uint8Array(buildXlsx([{ name: `ภ.ง.ด.${pnd} ${month}`, widths: [8, 20, 8, 34, 40, 14, 26, 10, 16, 16, 9, 18, 16], rows: [head, ...body, total] }])), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="PND${pnd}-${month}.xlsx"`, "cache-control": "no-store" } });
}
