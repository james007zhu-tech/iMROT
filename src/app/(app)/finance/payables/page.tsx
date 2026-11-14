import { localIso } from "@/lib/dates";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { Flash } from "@/components/Flash";
import { PageHeader, Table, Tag, btnBlue, inputCls } from "@/components/ui";
import { payAction } from "./actions";

export const dynamic = "force-dynamic";

/** 应付 — supplier invoices by due date (TH partners: monthly, 15 days after month end; others per order). Paying issues a PVTH. */
export default async function Payables({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; all?: string }> }) {
  const { ok, error, all } = await searchParams;
  const [t, u, me] = await Promise.all([getTranslations("common"), getTranslations("ui"), currentEmployee()]);
  const rows = await prisma.supplierInvoice.findMany({ where: all ? {} : { status: "OPEN" }, orderBy: [{ status: "asc" }, { dueDate: "asc" }], take: 200, include: { supplier: true, purchaseOrder: { select: { no: true, kind: true, serviceOrder: { select: { no: true } } } } } });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const mayPay = ["MD", "FINANCE", "ADMIN"].includes(me.role);
  const openTotal = rows.filter((r) => r.status === "OPEN").reduce((s, r) => s + Number(r.payable), 0);
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/finance", label: t("nav_fin") }} title={u("payables")} badge={<Tag>{u("openPayables", { amount: openTotal.toFixed(2) })}</Tag>}
        actions={<Link href={all ? "/finance/payables" : "/finance/payables?all=1"} className="text-sm text-blue hover:underline">{all ? u("openOnly") : u("showAll")}</Link>} />
      <Flash ok={ok} error={error} />
      <div className="rounded-xl border bg-white p-2">
        <Table head={[u("dueDate"), u("supplier"), u("supplierInvoiceNo"), "POTH", t("subtotal"), t("vat"), t("wht"), u("payableAmount"), t("status"), ""]}>
          {rows.map((r) => {
            const overdue = r.status === "OPEN" && r.dueDate < today;
            return <tr key={r.id}>
              <td className={overdue ? "font-semibold text-alert-ink" : ""}>{localIso(r.dueDate)!.slice(0, 10)}</td>
              <td><Link href={`/suppliers/${r.supplier.code}`} className="text-blue hover:underline">{r.supplier.name}</Link><span className="block text-xs text-navy/60">{u(`pay_${r.supplier.paymentMode}`)}</span></td>
              <td className="font-mono">{r.invoiceNo}</td>
              <td><Link href={r.purchaseOrder.serviceOrder && r.purchaseOrder.kind === "SUBCONTRACT" ? `/service-orders/${r.purchaseOrder.serviceOrder.no}/partner` : `/purchasing/orders/${r.purchaseOrder.no}`} className="font-mono text-blue hover:underline">{r.purchaseOrder.no}</Link></td>
              <td className="text-right">{Number(r.subtotal).toFixed(2)}</td><td className="text-right">{Number(r.vatAmount).toFixed(2)}</td>
              <td className="text-right">{Number(r.whtAmount).toFixed(2)}{Number(r.whtRate) > 0 ? <span className="block text-xs text-navy/60">{(Number(r.whtRate) * 100).toFixed(0)}%</span> : null}</td>
              <td className="text-right font-semibold">{r.currency} {Number(r.payable).toFixed(2)}</td>
              <td><Tag hot={overdue}>{u(`payable_${r.status}`)}</Tag>{r.paymentNo ? <span className="ml-1 font-mono text-xs">{r.paymentNo}</span> : null}</td>
              <td>{r.status === "OPEN" && mayPay && <form action={payAction} className="flex gap-1"><input type="hidden" name="id" value={r.id} /><input name="paymentRef" placeholder={u("paymentRefPh")} className={`${inputCls} w-32`} /><input name="paidAt" type="date" defaultValue={localIso(new Date())!.slice(0, 10)} className={`${inputCls} w-36`} /><button className={btnBlue}>{u("payNow")}</button></form>}</td>
            </tr>;
          })}
          {rows.length === 0 && <tr><td colSpan={10} className="py-6 text-center text-navy/60">{u("noPayables")}</td></tr>}
        </Table>
      </div>
      <p className="text-xs text-navy/70">{u("payablesHint")}</p>
    </div>
  );
}
