import { localIso } from "@/lib/dates";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { businessClosureOn } from "@/lib/closure";
import { prisma } from "@/lib/db";
import { PageHeader, Table } from "@/components/ui";
import { ReadyOrders } from "@/components/ReadyOrders";

export const dynamic = "force-dynamic";

const day = (d?: Date | null) => localIso(d)?.slice(0, 10) ?? "";
const money = (n: unknown) => Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 税务运营: 请款单 (IVTH / PFTH), 收据 (RCTH), 税务发票 (TITH) — one list each (menu 2026-11-10), newest first. */
export default async function Page({ searchParams }: { searchParams: Promise<{ doc?: string; new?: string }> }) {
  const { doc: d, new: isNew } = await searchParams;
  const doc = d === "rc" || d === "ti" ? d : "iv";
  const t = await getTranslations("common");
  const n = await getTranslations("nav");
  const dn = await getTranslations("docs");
  const title = n(doc === "iv" ? "billing" : doc === "rc" ? "receipts" : "taxInvoices");
  const order = (no: string) => <Link href={`/service-orders/${no}`} className="font-mono text-blue hover:underline">{no}</Link>;
  let body: React.ReactNode;
  if (doc === "iv") {
    const rows = await prisma.invoice.findMany({ orderBy: { issuedAt: "desc" }, take: 200, include: { serviceOrder: { include: { customer: true } }, taxInvoice: true } });
    body = (
      <Table head={[n("billing"), "TITH", "QTTH", t("customer"), t("due"), <span key="a" className="block text-right">{t("amount")}</span>, <span key="p" className="block text-right">{t("paid")}</span>, <span key="w" className="block text-right">{t("wht")}</span>]}>
        {rows.map((i) => <tr key={i.id} className={i.cancelledAt ? "text-navy/40 line-through" : ""}><td className="font-mono">{i.no}</td><td className="font-mono">{i.taxInvoice?.no ?? ""}</td><td>{order(i.serviceOrder.no)}</td><td>{i.serviceOrder.customer.name}</td><td className="whitespace-nowrap">{day(i.dueAt)}</td><td className="text-right">{i.currency} {money(i.amountDue)}</td><td className="text-right">{money(i.paidAmount)}</td><td className="text-right">{money(i.whtAmount)}</td></tr>)}
        {rows.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-navy/60">{t("noInvoices")}</td></tr>}
      </Table>
    );
  } else if (doc === "rc") {
    const rows = await prisma.receipt.findMany({ orderBy: { receivedAt: "desc" }, take: 200, include: { invoice: { include: { serviceOrder: { include: { customer: true } } } } } });
    body = (
      <Table head={[n("receipts"), "IVTH", "TITH", "QTTH", t("customer"), t("date"), <span key="a" className="block text-right">{t("amount")}</span>, <span key="w" className="block text-right">{t("wht")}</span>]}>
        {rows.map((r) => <tr key={r.id}><td className="font-mono">{r.no}</td><td className="font-mono">{r.invoice.no}</td><td className="font-mono">{r.taxInvoiceNo ?? ""}</td><td>{order(r.invoice.serviceOrder.no)}</td><td>{r.invoice.serviceOrder.customer.name}</td><td className="whitespace-nowrap">{day(r.receivedAt)}</td><td className="text-right">{r.currency} {money(r.cashAmount)}</td><td className="text-right">{money(r.whtAmount)}</td></tr>)}
        {rows.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-navy/60">{t("noInvoices")}</td></tr>}
      </Table>
    );
  } else {
    const rows = await prisma.taxInvoice.findMany({ orderBy: { issuedAt: "desc" }, take: 200, include: { serviceOrder: { include: { customer: true } } } });
    body = (
      <Table head={[n("taxInvoices"), "QTTH", t("customer"), t("date"), <span key="s" className="block text-right">{t("subtotal")}</span>, <span key="v" className="block text-right">VAT</span>, <span key="a" className="block text-right">{t("amount")}</span>, <span key="c" className="block text-right">CNY</span>]}>
        {rows.map((x) => <tr key={x.id} className={x.voidedAt ? "text-navy/40 line-through" : ""}><td className="font-mono">{x.no}</td><td>{order(x.serviceOrder.no)}</td><td>{x.serviceOrder.customer.name}</td><td className="whitespace-nowrap">{day(x.issuedAt)}</td><td className="text-right">{x.currency} {money(x.subtotal)}</td><td className="text-right">{money(x.vatAmount)}</td><td className="text-right">{money(x.total)}</td><td className="text-right">{money(x.totalCny)}</td></tr>)}
        {rows.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-navy/60">{t("noInvoices")}</td></tr>}
      </Table>
    );
  }
  return (
    <div className="space-y-4">
      <PageHeader title={title} newHref={businessClosureOn() ? `/tax?doc=${doc}&new=1` : undefined} newLabel={dn("new", { name: title })} />
      {isNew && <ReadyOrders type={doc === "iv" ? "IV" : doc === "rc" ? "RC" : "TI"} title={title} />}
      {body}
    </div>
  );
}
