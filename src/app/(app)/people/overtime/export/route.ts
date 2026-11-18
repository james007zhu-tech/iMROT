import { cookies } from "next/headers";
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
  // H-R79: the sheet speaks the language of the screen it was exported from — headers, kinds and states
  const lang = (await cookies()).get("locale")?.value === "zh" ? "zh" : (await cookies()).get("locale")?.value === "en" ? "en" : "th";
  const W = {
    zh: { head: ["工号", "姓名", "日期", "开始", "结束", "小时", "类型", "倍率", "状态", "审批人", "计入月份 / 挂到", "来源", "事由"], kind: { WORKDAY_OT: "工作日加班", HOLIDAY_WORK: "休息日 / 假日班内", HOLIDAY_OT: "休息日 / 假日班外" } as Record<string, string>, status: { PENDING: "待审批", APPROVED: "已批准", REJECTED: "已驳回", CANCELLED: "已撤回" } as Record<string, string>, wait: (m: string) => `待 HR 选：补算进 ${m} 或挂到下月`, site: "现场报工" },
    th: { head: ["รหัสพนักงาน", "ชื่อ", "วันที่", "เริ่ม", "สิ้นสุด", "ชั่วโมง", "ประเภท", "อัตรา", "สถานะ", "ผู้อนุมัติ", "จ่ายในเดือน / ยกไป", "ที่มา", "เหตุผล"], kind: { WORKDAY_OT: "OT วันทำงาน", HOLIDAY_WORK: "ทำงานวันหยุด", HOLIDAY_OT: "OT วันหยุด" } as Record<string, string>, status: { PENDING: "รออนุมัติ", APPROVED: "อนุมัติแล้ว", REJECTED: "ไม่อนุมัติ", CANCELLED: "ถอนแล้ว" } as Record<string, string>, wait: (m: string) => `รอ HR เลือก: คิดรวม ${m} หรือยกไปเดือนหน้า`, site: "รายงานหน้างาน" },
    en: { head: ["Employee", "Name", "Date", "From", "To", "Hours", "Kind", "×", "Status", "Approver", "Paid in / carried to", "Source", "Reason"], kind: {} as Record<string, string>, status: {} as Record<string, string>, wait: (m: string) => `waits for HR: recount into ${m} or carry over`, site: "SITE" },
  }[lang];
  const head: Cell[] = W.head;
  const body = rows.map((r) => [r.employee.code, r.employee.name, r.workDate.toISOString().slice(0, 10), r.actualStart ?? r.startTime, r.actualEnd ?? r.endTime, Number(r.actualHours ?? r.hours), W.kind[r.kind] ?? r.kind, OT_MULTIPLIER[r.kind], W.status[r.status] ?? r.status, r.approver?.name ?? "", r.payMonth?.month ?? (awaiting.has(r.id) ? W.wait(awaiting.get(r.id)!) : r.payNotBefore ?? ""), r.origin === "SITE" ? r.sourceNo ?? W.site : "", r.reason] as Cell[]);
  return new NextResponse(new Uint8Array(buildXlsx([{ name: "Overtime", widths: [14, 22, 12, 8, 8, 8, 16, 6, 12, 18, 16, 18, 40], rows: [head, ...body] }])), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="overtime${sp.get("om") ? `-${sp.get("om")}` : ""}.xlsx"`, "cache-control": "no-store" } });
}
