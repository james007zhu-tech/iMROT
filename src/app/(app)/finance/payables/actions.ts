"use server";
/** 应付 — pay a supplier invoice (issues a PVTH). */
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { approvePayment, paySupplierInvoice, withdrawSupplierInvoice } from "@/server/srm";

export async function payAction(f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const paidAt = String(f.get("paidAt") ?? "").trim();
    const inv = await paySupplierInvoice({ id: String(f.get("id")), actorCode: me.code, paidAt: paidAt ? new Date(paidAt) : undefined, paymentRef: String(f.get("paymentRef") ?? "").trim() || undefined });
    return inv.paymentNo ?? "paid";
  }, "/finance/payables");
}

export async function releaseAction(id: string) {
  await guarded(async () => { const me = await currentEmployee(); await approvePayment({ id, actorCode: me.code }); }, "/finance/payables");
}

export async function withdrawAction(f: FormData) {
  await guarded(async () => { const me = await currentEmployee(); await withdrawSupplierInvoice({ id: String(f.get("id")), actorCode: me.code, reason: String(f.get("reason") ?? "") }); return "withdrawn"; }, "/finance/payables");
}
