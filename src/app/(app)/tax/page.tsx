import { legacyTail } from "@/server/legacy";
import { OldTag } from "@/components/OldTag";
import { localIso } from "@/lib/dates";
import { fxMark } from "@/lib/fx-label";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { businessClosureOn } from "@/lib/closure";
import { prisma } from "@/lib/db";
import { invoiceState, outstandingOf } from "@/server/to";
import { PageHeader, Table } from "@/components/ui";
import { ReadyOrders } from "@/components/ReadyOrders";
import { currentEmployee } from "@/server/auth";
import { orderScope } from "@/server/scope";

export const dynamic = "force-dynamic";

const day = (d?: Date | null) => localIso(d)?.slice(0, 10) ?? "";
const money = (n: unknown) => Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 税务运营: 请款单 (IVTH / PFTH), 收据 (RCTH), 税务发票 (TITH) — one list each (menu 2026-11-10), newest first. */
import { sortOf } from "@/lib/sort";
import type { Prisma } from "@prisma/client";
export default async function Page({ searchParams }: { searchParams: Promise<{ doc?: string; new?: string; void?: string; sort?: string }> }) {
  const { doc: d, new: isNew, void: withVoid, sort } = await searchParams;
  const showVoid = withVoid === "1"; // 需求清单 v3 P1-29/30: voided documents stay out of the list unless asked for
  const doc = d === "rc" || d === "ti" ? d : "iv";
  // 列表排序 (朱总 2026-11-28): by number, date, customer or amount — the date of each kind of paper is its own
  const so = sortOf<"asc" | "desc">(sort, { date: (x) => x, no: (x) => x, customer: (x) => x, amount: (x) => x, due: (x) => x }, "-date", { doc, void: withVoid });
  const dir = so.desc ? "desc" as const : "asc" as const;
  const me = await currentEmployee();
  const oScope = await orderScope(me); // Sales: the invoices of their own customers only (V4-P0-02)
  const t = await getTranslations("common"), u = await getTranslations("ui");
  const n = await getTranslations("nav");
  const dn = await getTranslations("docs");
  const title = n(doc === "iv" ? "billing" : doc === "rc" ? "receipts" : "taxInvoices");
  const order = (no: string) => <Link href={`/service-orders/${no}`} className="font-mono text-blue hover:underline">{no}</Link>;
  // the old system's papers follow this system's own in the same table (朱总 2026-11-24), read-only, under their old numbers
  const old = (await legacyTail(me, [doc === "ti" ? "TAX_INVOICE" : doc === "rc" ? "RECEIPT" : "BILLING"], { page: 1, size: 400, liveTotal: 0 })).rows;
  const oldNo = (x: (typeof old)[number]) => <td className="whitespace-nowrap font-mono"><Link href={x.href} className="text-blue hover:underline">{x.no}</Link><OldTag /></td>;
  const num = (v: string) => (v && !Number.isNaN(Number(v)) ? money(v) : "");
  let body: React.ReactNode;
  if (doc === "iv") {
    const rows = await prisma.invoice.findMany({ where: { AND: [{ serviceOrder: oScope }, showVoid ? {} : { cancelledAt: null }] }, orderBy: (so.field === "no" ? { no: dir } : so.field === "customer" ? { serviceOrder: { customer: { name: dir } } } : so.field === "amount" ? { amountDue: dir } : so.field === "due" ? { dueAt: { sort: dir, nulls: "last" } } : { issuedAt: dir }) as Prisma.InvoiceOrderByWithRelationInput, take: 200, include: { serviceOrder: { include: { customer: true } }, taxInvoice: true } });
    body = (
      <Table head={[so.th("no", n("billing")), "TITH", "QTTH", so.th("customer", t("customer")), so.th("due", t("due")), <span key="a" className="block text-right">{so.th("amount", t("amount"))}</span>, <span key="p" className="block text-right">{t("paid")}</span>, <span key="w" className="block text-right">{t("wht")}</span>, <span key="o" className="block text-right">{t("outstandingCol")}</span>, t("status")]}>
        {rows.map((i) => <tr key={i.id} className={i.cancelledAt ? "text-navy/40 line-through" : ""}><td className="font-mono">{i.no}</td><td className="font-mono">{i.taxInvoice?.no ?? ""}</td><td>{order(i.serviceOrder.no)}</td><td>{i.serviceOrder.customer.name}</td><td className="whitespace-nowrap">{day(i.dueAt)}</td><td className="text-right">{i.currency} {money(i.amountDue)}</td><td className="text-right">{money(i.paidAmount)}</td><td className="text-right">{money(i.whtAmount)}</td><td className="text-right font-medium">{money(outstandingOf(i))}</td><td className="whitespace-nowrap no-underline">{t(`invState_${invoiceState(i)}`)}</td></tr>)}
        {old.map((x) => <tr key={x.id}>{oldNo(x)}<td></td><td></td><td>{x.customer}</td><td className="whitespace-nowrap">{x.date}</td><td className="whitespace-nowrap text-right">{x.amount != null ? `${x.currency} ${money(x.amount)}` : ""}</td><td></td><td className="text-right">{num(x.field("预扣税"))}</td><td></td><td className="text-[13px] text-navy/70">{x.title}</td></tr>)}
        {rows.length + old.length === 0 && <tr><td colSpan={10} className="py-6 text-center text-navy/60">{t("noInvoices")}</td></tr>}
      </Table>
    );
  } else if (doc === "rc") {
    const rows = await prisma.receipt.findMany({ where: { AND: [{ invoice: { serviceOrder: oScope } }, showVoid ? {} : { voidedAt: null }] }, orderBy: (so.field === "no" ? { no: dir } : so.field === "customer" ? { invoice: { serviceOrder: { customer: { name: dir } } } } : so.field === "amount" ? { cashAmount: dir } : { receivedAt: dir }) as Prisma.ReceiptOrderByWithRelationInput, take: 200, include: { invoice: { include: { serviceOrder: { include: { customer: true } } } } } });
    body = (
      <Table head={[so.th("no", n("receipts")), "IVTH", "TITH", "QTTH", so.th("customer", t("customer")), so.th("date", t("date")), <span key="a" className="block text-right">{so.th("amount", t("amount"))}</span>, <span key="w" className="block text-right">{t("wht")}</span>]}>
        {rows.map((r) => <tr key={r.id} className={r.voidedAt ? "text-navy/40 line-through" : ""}><td className="font-mono">{r.no}</td><td className="font-mono">{r.invoice.no}</td><td className="font-mono">{r.taxInvoiceNo ?? ""}</td><td>{order(r.invoice.serviceOrder.no)}</td><td>{r.invoice.serviceOrder.customer.name}</td><td className="whitespace-nowrap">{day(r.receivedAt)}</td><td className="text-right">{r.currency} {money(r.cashAmount)}</td><td className="text-right">{money(r.whtAmount)}</td></tr>)}
        {old.map((x) => <tr key={x.id}>{oldNo(x)}<td></td><td></td><td className="font-mono text-[13px]">{x.field("选择报价单")}</td><td>{x.customer}</td><td className="whitespace-nowrap">{x.date}</td><td className="whitespace-nowrap text-right">{x.amount != null ? `${x.currency} ${money(x.amount)}` : ""}</td><td className="text-right">{num(x.field("预扣税（WHT）", "预扣税"))}</td></tr>)}
        {rows.length + old.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-navy/60">{t("noInvoices")}</td></tr>}
      </Table>
    );
  } else {
    const rows = await prisma.taxInvoice.findMany({ where: { AND: [{ serviceOrder: oScope }, showVoid ? {} : { voidedAt: null }] }, orderBy: (so.field === "no" ? { no: dir } : so.field === "customer" ? { serviceOrder: { customer: { name: dir } } } : so.field === "amount" ? { total: dir } : { issuedAt: dir }) as Prisma.TaxInvoiceOrderByWithRelationInput, take: 200, include: { serviceOrder: { include: { customer: true } } } });
    body = (
      <Table head={[so.th("no", n("taxInvoices")), "QTTH", so.th("customer", t("customer")), so.th("date", t("date")), <span key="s" className="block text-right">{t("subtotal")}</span>, <span key="v" className="block text-right">VAT</span>, <span key="a" className="block text-right">{so.th("amount", t("amount"))}</span>, <span key="c" className="block text-right">CNY</span>, t("status")]}>
        {rows.map((x) => <tr key={x.id} className={x.voidedAt ? "text-navy/40 line-through" : ""}><td className="font-mono">{x.no}</td><td>{order(x.serviceOrder.no)}</td><td>{x.serviceOrder.customer.name}</td><td className="whitespace-nowrap">{day(x.issuedAt)}</td><td className="text-right">{x.currency} {money(x.subtotal)}</td><td className="text-right">{money(x.vatAmount)}</td><td className="text-right">{money(x.total)}</td><td className="text-right">{money(x.totalCny)}<span className="block whitespace-nowrap text-[11px] text-navy/60">@{Number(x.fxRateToCny).toFixed(4)} {fxMark(u, x.fxSource, x.fxRateDate, x.fxBy)}</span></td><td className="whitespace-nowrap">{t(x.voidedAt ? "invState_VOID" : x.voidStatus === "REQUESTED" ? "invState_VOIDASKED" : "invState_LIVE")}</td></tr>)}
        {old.map((x) => <tr key={x.id}>{oldNo(x)}<td className="font-mono text-[13px]">{x.field("报价单号")}</td><td>{x.customer}</td><td className="whitespace-nowrap">{x.date}</td><td className="whitespace-nowrap text-right">{x.amount != null ? `${x.currency} ${num(x.field("小计"))}` : ""}</td><td className="text-right">{x.amount != null ? num(x.field("增值税（VAT）", "增值税")) : ""}</td><td className="whitespace-nowrap text-right">{x.amount != null ? `${x.currency} ${money(x.amount)}` : ""}</td><td></td><td className="text-[13px] text-navy/70">{x.title}</td></tr>)}
        {rows.length + old.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-navy/60">{t("noInvoices")}</td></tr>}
      </Table>
    );
  }
  return (
    <div className="space-y-4">
      <PageHeader title={title} newHref={businessClosureOn() ? `/tax?doc=${doc}&new=1` : undefined} newLabel={dn("new", { name: title })} />
      {isNew && <ReadyOrders type={doc === "iv" ? "IV" : doc === "rc" ? "RC" : "TI"} title={title} />}
      {body}
      <p className="text-sm"><Link href={`/tax?doc=${doc}${showVoid ? "" : "&void=1"}`} className="text-blue hover:underline">{t(showVoid ? "hideVoided" : "showVoided")}</Link></p>
    </div>
  );
}
