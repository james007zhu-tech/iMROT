"use server";
/** 应付 — the three steps of a payment (server/pay.ts): finance asks, the MD decides, finance confirms with the bank slip. */
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { withdrawSupplierInvoice } from "@/server/srm";
import { confirmPayment, decidePayment, requestPayment, voidPayment } from "@/server/pay";

const BACK = "/finance/payables";

export async function requestAction(f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const amount = String(f.get("amount") ?? "").trim(), payDate = String(f.get("payDate") ?? "").trim();
    const p = await requestPayment({ invoiceId: String(f.get("id")), actorCode: me.code, account: String(f.get("account") ?? ""), amount: amount ? Number(amount) : undefined, whtType: String(f.get("whtType") ?? "") || undefined, whtRate: String(f.get("whtPct") ?? "").trim() === "" ? undefined : Number(f.get("whtPct")) / 100, payDate: payDate ? new Date(payDate) : undefined });
    return { ok: p.no, to: BACK };
  }, BACK);
}
export async function decideAction(f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const approve = f.get("decision") === "yes";
    await decidePayment({ id: String(f.get("id")), actorCode: me.code, approve, note: String(f.get("note") ?? "") });
    return approve ? "payApproved" : "payRefused";
  }, BACK);
}
export async function confirmAction(f: FormData) {
  const id = String(f.get("id"));
  await guarded(async () => {
    const me = await currentEmployee();
    const paidAt = String(f.get("paidAt") ?? "").trim();
    const p = await confirmPayment({ id, actorCode: me.code, paymentRef: String(f.get("paymentRef") ?? ""), slip: JSON.parse(String(f.get("attachments") || "[]")), paidAt: paidAt ? new Date(paidAt) : undefined });
    return { ok: p.no, to: BACK };
  }, `${BACK}/pay/${id}`);
}
export async function voidAction(f: FormData) {
  await guarded(async () => { const me = await currentEmployee(); await voidPayment({ id: String(f.get("id")), actorCode: me.code, reason: String(f.get("reason") ?? "") }); return "payVoided"; }, BACK);
}
export async function withdrawAction(f: FormData) {
  await guarded(async () => { const me = await currentEmployee(); await withdrawSupplierInvoice({ id: String(f.get("id")), actorCode: me.code, reason: String(f.get("reason") ?? "") }); return "withdrawn"; }, BACK);
}
