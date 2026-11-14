"use server";
/** 加班 page actions — nothing bound but ids, so no component scope is serialised. */
import { localIso } from "@/lib/dates";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { cancelOvertime, closeOvertimeMonth, confirmActualHours, decideOvertime, reopenOvertimeMonth, requestOvertime } from "@/server/overtime";

const str = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v || undefined; };
const BACK = "/people/overtime";

export async function requestAction(f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const r = await requestOvertime({ actorCode: me.code, employeeCode: str(f, "employeeCode"), workDate: String(f.get("workDate")), startTime: String(f.get("startTime")), endTime: String(f.get("endTime")), breakMinutes: Number(f.get("breakMinutes") || 0), kind: f.get("kind") as "WORKDAY_OT", reason: String(f.get("reason") ?? ""), serviceOrderNo: str(f, "serviceOrderNo") });
    return `${localIso(r.workDate)!.slice(0, 10)} ${r.startTime}–${r.endTime}`;
  }, BACK);
}
export async function decideAction(id: string, f: FormData) {
  await guarded(async () => { const me = await currentEmployee(); await decideOvertime({ id, actorCode: me.code, decision: f.get("decision") === "REJECTED" ? "REJECTED" : "APPROVED", note: str(f, "note") }); }, BACK);
}
export async function actualAction(id: string, f: FormData) {
  await guarded(async () => { const me = await currentEmployee(); await confirmActualHours({ id, actorCode: me.code, actualStart: String(f.get("actualStart")), actualEnd: String(f.get("actualEnd")), breakMinutes: f.get("breakMinutes") ? Number(f.get("breakMinutes")) : undefined }); }, BACK);
}
export async function cancelAction(id: string) {
  await guarded(async () => { const me = await currentEmployee(); await cancelOvertime({ id, actorCode: me.code }); }, BACK);
}
export async function closeMonthAction(entityId: string, month: string) {
  await guarded(async () => { const me = await currentEmployee(); if (me.role !== "MD") throw new Error("MD_ONLY"); await closeOvertimeMonth({ entityId, month, closedBy: me.code }); return { ok: month, to: `${BACK}/${month}` }; }, BACK);
}
export async function reopenMonthAction(entityId: string, month: string) {
  await guarded(async () => { const me = await currentEmployee(); await reopenOvertimeMonth({ entityId, month, actorCode: me.code }); return { ok: month, to: BACK }; }, `${BACK}/${month}`);
}
