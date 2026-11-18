import { localIso } from "@/lib/dates";
import { WHT_TYPES, isTaxId13 } from "@/lib/wht";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { Flash } from "@/components/Flash";
import { PageHeader, Table, Tag, btnBlue, btnGhost, inputCls } from "@/components/ui";
import { mismatch } from "@/lib/pay-rules";
import { decideAction, requestAction, taxIdAction, voidAction, withdrawAction } from "./actions";
import { outstandingOf, payAccounts, grossOpenOf } from "@/server/pay";
import { PayStartFields } from "@/components/PayStartFields";
import { can, hasRole } from "@/lib/caps";

export const dynamic = "force-dynamic";

/** 应付 — supplier invoices by due date (TH partners: monthly, 15 days after month end; others per order). Paying issues a PVTH. */
export default async function Payables({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; all?: string }> }) {
  const { ok, error, all } = await searchParams;
  const [t, u, me] = await Promise.all([getTranslations("common"), getTranslations("ui"), currentEmployee()]);
  const rows = await prisma.supplierInvoice.findMany({ where: all ? {} : { status: "OPEN" }, orderBy: [{ status: "asc" }, { dueDate: "asc" }], take: 200, include: { supplier: true, payments: { orderBy: { requestedAt: "asc" } }, purchaseOrder: { select: { no: true, kind: true, serviceOrder: { select: { no: true } } } } } });
  const accounts = await payAccounts(me.entityId), acct = new Map(accounts.map((a) => [a.id, a.label]));
  // what can still be asked for: open, minus what is already on its way
  const openOf = (r: (typeof rows)[number]) => grossOpenOf(r, r.payments); // 应付 still uncovered, VAT included, before withholding
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const mayPay = hasRole(me, "FINANCE"), md = hasRole(me, "MD");
  const openTotal = rows.filter((r) => r.status === "OPEN").reduce((s, r) => s + outstandingOf(r), 0);
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/finance", label: t("nav_fin") }} title={u("payables")} badge={<Tag>{u("openPayables", { amount: openTotal.toFixed(2) })}</Tag>}
        actions={<Link href={all ? "/finance/payables" : "/finance/payables?all=1"} className="text-sm text-blue hover:underline">{all ? u("openOnly") : u("showAll")}</Link>} />
      <Flash ok={ok} error={error} />
      <div className="rounded-xl border bg-white p-2">
        <Table head={[u("dueDate"), u("supplier"), u("supplierInvoiceNo"), "POTH", t("subtotal"), t("vat"), t("wht"), u("payableAmount"), t("status"), ""]}>
          {rows.map((r) => {
            const overdue = r.status === "OPEN" && r.dueDate < today;
            return <tr key={r.id} id={`inv-${r.id}`} className="scroll-mt-24 target:bg-tint target:outline target:outline-2 target:outline-blue">
              <td className={overdue ? "font-semibold text-alert-ink" : ""}>{localIso(r.dueDate)!.slice(0, 10)}</td>
              <td><Link href={`/suppliers/${r.supplier.code}`} className="text-blue hover:underline">{r.supplier.name}</Link><span className="block text-xs text-navy/60">{u(`pay_${r.supplier.paymentMode}`)}</span></td>
              <td className="font-mono">{r.accrued ? <Link href={`/purchasing/orders/${r.purchaseOrder.no}`} className="font-sans text-blue hover:underline">{u("accrued")} · {u("registerSupplierInvoice")} →</Link> : r.invoiceNo}</td>
              <td><Link href={r.purchaseOrder.serviceOrder && r.purchaseOrder.kind === "SUBCONTRACT" ? `/service-orders/${r.purchaseOrder.serviceOrder.no}/partner` : `/purchasing/orders/${r.purchaseOrder.no}`} className="font-mono text-blue hover:underline">{r.purchaseOrder.no}</Link></td>
              <td className="text-right">{Number(r.subtotal).toFixed(2)}</td><td className="text-right">{Number(r.vatAmount).toFixed(2)}</td>
              <td className="text-right">{Number(r.whtAmount).toFixed(2)}{Number(r.whtRate) > 0 ? <span className="block text-xs text-navy/60">{(Number(r.whtRate) * 100).toFixed(0)}%</span> : null}</td>
              <td className="text-right font-semibold">{r.currency} {Number(r.payable).toFixed(2)}</td>
              <td><Tag hot={overdue}>{r.accrued ? u("accruedWaits") : u(`payable_${r.status}`)}</Tag>{!r.accrued && r.matchDiff != null && mismatch(Number(r.matchDiff), Number(r.subtotal) - Number(r.matchDiff)) && !r.mdApprovedAt ? <span className="ml-1 text-xs font-semibold text-alert-ink">{u("matchOff", { diff: Number(r.matchDiff).toFixed(2) })}</span> : null}{r.paymentNo ? <span className="ml-1 font-mono text-xs">{r.paymentNo}</span> : null}</td>
              <td className="min-w-64 space-y-1 text-xs">
                {/* 付款三步、两人 (MD 2026-11-17): 发起 → MD 批准 → 上传回单确认。一步点击不再记成已付。 */}
                {!r.accrued && Number(r.paidAmount) > 0 && <div className="text-navy/80">{u("payPaidOpen", { paid: Number(r.paidAmount).toFixed(2), open: outstandingOf(r).toFixed(2) })}</div>}
                {r.payments.map((p) => <div key={p.id} id={p.no} className={`scroll-mt-24 rounded-lg border p-1.5 target:border-blue target:bg-tint target:ring-2 target:ring-blue ${p.status === "VOID" || p.status === "REJECTED" ? "text-navy/50 line-through decoration-navy/30" : ""}`}>
                  <span className="font-mono">{p.no}</span> · {u("payNet")} {r.currency} {Number(p.amount).toFixed(2)}{Number(p.whtAmount) > 0 ? ` · ${u("payWhtAmount")} ${Number(p.whtAmount).toFixed(2)}` : ""} · {acct.get(p.account) ?? (p.account === "before-rule" ? "—" : p.account)} · <b className="no-underline">{u(`payState_${p.status}`)}</b>
                  {p.whtCertNo && p.status !== "VOID" && p.status !== "REJECTED" ? <> · <Link href={`/finance/payables/wht/${p.id}`} className="whitespace-nowrap rounded-full border border-blue/50 px-1.5 text-[11px] font-semibold text-blue hover:bg-tint">WHT {Number(p.whtAmount).toFixed(2)} · {p.status === "PAID" ? p.whtCertNo : u("whtPreview")}</Link></> : null}
                  {p.decisionNote ? <span className="block">{p.decisionNote}</span> : null}{p.voidReason ? <span className="block">{u("payVoidWhy")}: {p.voidReason}</span> : null}
                  {p.status === "REQUESTED" && md && p.requestedBy !== me.code && <form action={decideAction} className="mt-1 flex flex-wrap gap-1"><input type="hidden" name="id" value={p.id} /><input name="note" placeholder={u("poDecideNotePh")} className={`${inputCls} w-40`} /><button name="decision" value="yes" className={btnBlue}>{u("poApprove")}</button><button name="decision" value="no" className={btnGhost}>{u("payRefuse")}</button></form>}
                  {p.status === "REQUESTED" && !md && <span className="block font-semibold text-alert-ink">{u("payWaitsMd")}</span>}
                  {p.status === "APPROVED" && mayPay && <Link href={`/finance/payables/pay/${p.id}`} className={`${btnBlue} mt-1 inline-flex whitespace-nowrap`}>{u("payConfirmGo")} →</Link>}
                  {p.status === "APPROVED" && !mayPay && <span className="block text-navy/70">{u("payWaitsFinance")}</span>}
                  {(p.status === "REQUESTED" || p.status === "APPROVED" || p.status === "PAID") && can.finance(me) && <details className="mt-1"><summary className="cursor-pointer text-blue">{u("payVoid")}</summary><form action={voidAction} className="mt-1 flex flex-wrap gap-1"><input type="hidden" name="id" value={p.id} /><input name="reason" required placeholder={u("payVoidPh")} className={`${inputCls} w-44`} /><button className={btnGhost}>{u("payVoid")}</button></form></details>}
                </div>)}
                {r.status === "OPEN" && !r.accrued && mayPay && openOf(r) > 0.005 && <details open={r.payments.every((p) => p.status === "VOID" || p.status === "REJECTED")}><summary className="cursor-pointer font-semibold text-blue">{u("payStart")}</summary>
                  <form action={requestAction} className="mt-1 grid grid-cols-1 gap-1"><input type="hidden" name="id" value={r.id} />
                    <select name="account" required defaultValue="" className={inputCls}><option value="" disabled>{u("payAccountPh")}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
                    <PayStartFields open={openOf(r)} baseShare={Number(r.total) > 0 ? Number(r.subtotal) / Number(r.total) : 1} rate={Number(r.whtRate)} currency={r.currency} cls={inputCls} taxIdOk={isTaxId13(r.supplier.taxId)} labels={{ gross: u("payGross"), rate: u("payWhtRate"), wht: u("payWhtAmount"), net: u("payNet"), date: t("date"), type: u("whtType"), types: Object.fromEntries(WHT_TYPES.map((k) => [k, u(`whtType_${k}`)])), draft: u("whtDraftNote"), noTaxId: u("whtNoTaxId") }} />
                    <input name="payDate" type="date" defaultValue={localIso(new Date())!.slice(0, 10)} className={`${inputCls} w-36`} />
                    <button className={`${btnBlue} whitespace-nowrap`}>{u("payStartBtn")}</button>
                  </form>
                  {!isTaxId13(r.supplier.taxId) && <details className="mt-1 rounded-md bg-[#FDECEC] px-2 py-1"><summary className="cursor-pointer font-semibold text-[#C0392B]">{u("whtNoTaxId")} · <span className="underline">{u("taxIdGo")}</span></summary>
                    <form action={taxIdAction} data-nodraft className="mt-1 grid grid-cols-1 gap-1"><input type="hidden" name="supplierId" value={r.supplierId} />
                      <input name="taxId" required inputMode="numeric" pattern="[0-9 -]{13,17}" placeholder={u("taxId13Ph")} className={inputCls} />
                      <input name="branchCode" inputMode="numeric" defaultValue="00000" placeholder={u("branchPh")} className={inputCls} /><span className="text-[11px] text-navy/70">{u("branchHint")}</span>
                      <button className={`${btnGhost} whitespace-nowrap`}>{u("taxIdSave")}</button></form></details>}
                  </details>}
                {r.status === "OPEN" && !r.accrued && can.finance(me) && Number(r.paidAmount) === 0 && r.payments.every((p) => p.status === "VOID" || p.status === "REJECTED") && <details><summary className="cursor-pointer text-blue">{u("withdrawBtn")}</summary><form action={withdrawAction} className="mt-1 flex flex-wrap gap-1"><input type="hidden" name="id" value={r.id} /><input name="reason" required placeholder={u("withdrawReason")} className={`${inputCls} w-44`} /><button className={btnGhost}>{u("withdrawBtn")}</button></form></details>}
              </td>
            </tr>;
          })}
          {rows.length === 0 && <tr><td colSpan={10} className="py-6 text-center text-navy/60">{u("noPayables")}</td></tr>}
        </Table>
      </div>
      <p className="text-xs text-navy/70">{u("payablesHint")} {u("payRule3")}</p>
    </div>
  );
}
