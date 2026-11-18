/** 全员加班导出 Excel (H-R68): the same filters as the list. HR and the MD. */
import { overtimeAwaitingHr } from "@/server/payroll";
import { NextResponse } from "next/server";
import { hasRole } from "@/lib/caps";
import { OT_MULTIPLIER } from "@/lib/overtime";
import { buildXlsx, type Cell } from "@/lib/xlsx";
import { currentEmployee } from "@/server/auth";
import { allOvertime } from "@/server/overtime";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const me = await currentEmployee();
  if (!hasRole(me, "MD", "HR", "FINANCE")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const rows = await allOvertime(me.entityId, { month: sp.get("om") ?? undefined, status: sp.get("os") ?? undefined, code: sp.get("oe") ?? undefined });
  const awaiting = await overtimeAwaitingHr(me.entityId, rows.filter((r) => r.status === "APPROVED" && !r.payMonth).map((r) => r.workDate.toISOString().slice(0, 7)));
  const head: Cell[] = ["Employee", "Name", "Date", "From", "To", "Hours", "Kind", "×", "Status", "Approver", "Paid in / carried to", "Source", "Reason"];
  const body = rows.map((r) => [r.employee.code, r.employee.name, r.workDate.toISOString().slice(0, 10), r.actualStart ?? r.startTime, r.actualEnd ?? r.endTime, Number(r.actualHours ?? r.hours), r.kind, OT_MULTIPLIER[r.kind], r.status, r.approver?.name ?? "", r.payMonth?.month ?? (awaiting.has(r.id) ? `waits for HR: recount into ${awaiting.get(r.id)} or carry over` : r.payNotBefore ?? ""), r.origin === "SITE" ? r.sourceNo ?? "SITE" : "", r.reason] as Cell[]);
  return new NextResponse(new Uint8Array(buildXlsx([{ name: "Overtime", widths: [14, 22, 12, 8, 8, 8, 16, 6, 12, 18, 16, 18, 40], rows: [head, ...body] }])), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="overtime${sp.get("om") ? `-${sp.get("om")}` : ""}.xlsx"`, "cache-control": "no-store" } });
}
