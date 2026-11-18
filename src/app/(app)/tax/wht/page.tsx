import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { localIso } from "@/lib/dates";
import { currentEmployee } from "@/server/auth";
import { WHT_TYPES, pndOf, type WhtType } from "@/lib/wht";
import { PageHeader, Table, Tag, btnGhost, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";

/** 50 ทวิ WTTH — every withholding certificate: number, day, payee, kind of income, amount, tax, its PVTH, state; the month exports for ภ.ง.ด.3 / ภ.ง.ด.53 (派修单 v4 A). Finance and the MD. */
export default async function WhtList({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const [u, me] = await Promise.all([getTranslations("ui"), currentEmployee()]);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);
  const from = new Date(new Date(`${month}-01T00:00:00Z`).getTime() - 7 * 3600_000), to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1) - 7 * 3600_000);
  const rows = await prisma.supplierPayment.findMany({ where: { entityId: me.entityId, whtCertNo: { not: null }, payDate: { gte: from, lt: to } }, orderBy: { whtCertNo: "desc" }, include: { supplierInvoice: { select: { invoiceNo: true, subtotal: true, total: true, supplier: { select: { name: true, nameLocal: true } } } } } });
  const state = (s: string) => (s === "PAID" ? "issued" : s === "VOID" || s === "REJECTED" ? "void" : "draft");
  const base = (p: (typeof rows)[number]) => Math.round(Number(p.gross ?? 0) * (Number(p.supplierInvoice.total) > 0 ? Number(p.supplierInvoice.subtotal) / Number(p.supplierInvoice.total) : 1) * 100) / 100;
  const m = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="space-y-4">
      <PageHeader title="50 ทวิ WTTH" badge={<Tag>{month}</Tag>} actions={<span className="flex gap-2">{(["3", "53"] as const).map((k) => <a key={k} href={`/tax/wht/export?month=${month}&pnd=${k}`} className={btnGhost}>{u("whtExport", { form: `ภ.ง.ด.${k}` })}</a>)}</span>} />
      <form className="flex items-end gap-2"><label className="text-xs text-navy/70">{u("leaveMonth")}<input name="month" type="month" defaultValue={month} className={`${inputCls} mt-1 block`} /></label><button className={btnGhost}>{u("auditShow")}</button></form>
      <div className="rounded-xl border bg-white p-2">
        <Table head={[u("whtNo"), u("auditDay"), u("whtPayee"), u("whtType"), u("whtBase"), u("payWhtAmount"), "PVTH", u("whtForm"), u("whtStateCol")]}>
          {rows.map((p) => <tr key={p.id} className={state(p.status) === "void" ? "text-navy/50 line-through" : ""}>
            <td className="whitespace-nowrap"><Link href={`/finance/payables/wht/${p.id}`} className="font-mono text-blue hover:underline">{p.whtCertNo}</Link></td>
            <td className="whitespace-nowrap font-mono text-xs">{localIso(p.paidAt ?? p.payDate)!.slice(0, 10)}</td>
            <td>{p.supplierInvoice.supplier.nameLocal ?? p.supplierInvoice.supplier.name}</td>
            <td className="whitespace-nowrap">{(WHT_TYPES as readonly string[]).includes(p.whtType ?? "") ? u(`whtType_${p.whtType as WhtType}`) : u("whtType_SERVICE")} {Number(p.whtRate ?? 0) * 100}%</td>
            <td className="text-right tabular-nums">{m(base(p))}</td><td className="text-right font-semibold tabular-nums">{m(Number(p.whtAmount))}</td>
            <td className="whitespace-nowrap"><Link href={`/finance/payables?all=1#${p.no}`} className="font-mono text-xs text-blue hover:underline">{p.no}</Link></td>
            <td className="whitespace-nowrap text-xs">ภ.ง.ด.{pndOf(p.supplierInvoice.supplier.nameLocal ?? p.supplierInvoice.supplier.name)}</td>
            <td><Tag hot={state(p.status) !== "issued"}>{u(`whtState_${state(p.status)}`)}</Tag></td>
          </tr>)}
          {!rows.length && <tr><td colSpan={9} className="py-4 text-center text-navy/60">{u("whtNone")}</td></tr>}
        </Table>
      </div>
      <p className="text-xs text-navy/60">{u("whtListNote")}</p>
    </div>
  );
}
