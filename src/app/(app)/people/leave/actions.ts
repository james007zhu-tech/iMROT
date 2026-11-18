"use server";
/** 请假 (server/leave.ts): ask, decide, withdraw. */
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { cancelLeave, decideLeave, requestLeave } from "@/server/leave";

const BACK = "/people/leave";
export async function requestAction(f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const r = await requestLeave({ actorCode: me.code, employeeCode: String(f.get("employeeCode") ?? "").trim() || undefined, type: String(f.get("type") ?? ""), from: String(f.get("from") ?? ""), to: String(f.get("to") ?? "").trim() || undefined, half: String(f.get("half") ?? "") || null, reason: String(f.get("reason") ?? ""), attachments: JSON.parse(String(f.get("attachments") || "[]")) });
    return { ok: `${r.fromDate.toISOString().slice(0, 10)} · ${Number(r.days)}`, to: BACK };
  }, BACK);
}
export async function decideAction(id: string, f: FormData) {
  await guarded(async () => { const me = await currentEmployee(); const approve = f.get("decision") === "yes"; await decideLeave({ id, actorCode: me.code, approve, note: String(f.get("note") ?? "") }); return approve ? "leaveApproved" : "leaveRefused"; }, BACK);
}
export async function cancelAction(id: string) {
  await guarded(async () => { const me = await currentEmployee(); await cancelLeave({ id, actorCode: me.code }); return "leaveCancelled"; }, BACK);
}
