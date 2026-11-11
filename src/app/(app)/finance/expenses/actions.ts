"use server";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { cancelExpense, decideExpense, fileExpense, payExpense } from "@/server/expense";

const str = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v || undefined; };
const BACK = "/finance/expenses";

export async function fileAction(f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const atts = (() => { try { return JSON.parse(String(f.get("attachments") || "[]")) as { name: string; url: string }[]; } catch { return []; } })();
    const c = await fileExpense({
      actorCode: me.code, employeeCode: str(f, "employeeCode"), spentOn: new Date(String(f.get("spentOn"))), category: String(f.get("category")), description: String(f.get("description") ?? ""),
      vendor: str(f, "vendor"), vendorTaxId: str(f, "vendorTaxId"), receiptNo: str(f, "receiptNo"), currency: str(f, "currency") ?? "THB", amount: Number(f.get("amount")),
      vatAmount: str(f, "vatAmount") ? Number(str(f, "vatAmount")) : undefined, paidBy: (str(f, "paidBy") ?? "SELF") as "SELF", serviceOrderNo: str(f, "serviceOrderNo"), receipts: atts.map(({ name, url }) => ({ name, url })),
    });
    return { ok: `${c.no} · ${c.currency} ${Number(c.amount).toFixed(2)}`, to: BACK };
  }, `${BACK}/new`);
}
export async function decideAction(id: string, f: FormData) {
  await guarded(async () => { const me = await currentEmployee(); await decideExpense({ id, actorCode: me.code, decision: f.get("decision") === "REJECTED" ? "REJECTED" : "APPROVED", note: str(f, "note") }); }, BACK);
}
export async function cancelAction(id: string) {
  await guarded(async () => { const me = await currentEmployee(); await cancelExpense({ id, actorCode: me.code }); }, BACK);
}
export async function payAction(id: string, f: FormData) {
  await guarded(async () => { const me = await currentEmployee(); await payExpense({ id, actorCode: me.code, paidRef: str(f, "paidRef") }); }, BACK);
}
