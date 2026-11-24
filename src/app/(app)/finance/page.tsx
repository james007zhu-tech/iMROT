import { LegacyLink } from "@/components/LegacyLink";
import { legacyTail } from "@/server/legacy";
import { OldTag } from "@/components/OldTag";
import { currentEmployee } from "@/server/auth";
import { localIso } from "@/lib/dates";
import { fxMark } from "@/lib/fx-label";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { invoiceState, outstandingOf } from "@/server/to";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Phase 1 slice: the invoices and payments that belong to service orders. Full module in Phase 2. */
export default async function Page({ searchParams }: { searchParams: Promise<{ void?: string }> }) {
  const showVoid = (await searchParams).void === "1";
  const t = await getTranslations("common"), u = await getTranslations("ui");
  const invoices = await prisma.invoice.findMany({ where: showVoid ? {} : { cancelledAt: null }, orderBy: { issuedAt: "desc" }, take: 100, include: { serviceOrder: { include: { customer: true } }, taxInvoice: true } });
  const me = await currentEmployee();
  // the old system's tax invoices follow this system's invoices in the same table (朱总 2026-11-24); its cash book has no
  // list of its own here yet, so that one stays a link
  const old = (await legacyTail(me, ["TAX_INVOICE"], { page: 1, size: 400, liveTotal: 0 })).rows;
  const num = (v: string) => (v && !Number.isNaN(Number(v)) ? Number(v).toFixed(2) : "");
  return (
    <div className="space-y-4">
      <PageHeader title={`${t("nav_fin")} · ${t("invoices")}`} actions={<span className="flex gap-4"><Link href="/finance/fx" className="text-sm text-blue hover:underline">{u("fxTitle")} →</Link><Link href="/finance/payables" className="text-sm text-blue hover:underline">{t("payablesLink")} →</Link></span>} />
      <LegacyLink me={me} kinds={["LEDGER"]} />
      <div className="rounded-lg border bg-white"><table className="w-full text-sm"><thead className="bg-blue/8 text-left"><tr><th className="px-3 py-2">IVTH</th><th className="px-3 py-2">TITH</th><th className="px-3 py-2">QTTH</th><th className="px-3 py-2">{t("customer")}</th><th className="px-3 py-2">{t("due")}</th><th className="px-3 py-2 text-right">{t("amount")}</th><th className="px-3 py-2 text-right">{t("paid")}</th><th className="px-3 py-2 text-right">{t("wht")}</th><th className="px-3 py-2 text-right">{t("outstandingCol")}</th><th className="px-3 py-2">{t("status")}</th><th className="px-3 py-2 text-right">CNY</th></tr></thead>
        <tbody>{invoices.map((i) => <tr key={i.id} className={`border-t ${i.cancelledAt ? "text-navy/40" : ""}`}><td className="px-3 py-2 font-mono">{i.no}</td><td className="px-3 py-2 font-mono">{i.taxInvoice?.no ?? ""}</td><td className="px-3 py-2 font-mono"><Link href={`/service-orders/${i.serviceOrder.no}`} className="text-blue underline">{i.serviceOrder.no}</Link></td><td className="px-3 py-2">{i.serviceOrder.customer.name}</td><td className="px-3 py-2">{localIso(i.dueAt)?.slice(0, 10) ?? ""}</td><td className="px-3 py-2 text-right">{i.currency} {Number(i.amountDue).toFixed(2)}</td><td className="px-3 py-2 text-right">{Number(i.paidAmount ?? 0).toFixed(2)}</td><td className="px-3 py-2 text-right">{Number(i.whtAmount ?? 0).toFixed(2)}</td><td className="px-3 py-2 text-right font-medium">{outstandingOf(i).toFixed(2)}</td><td className="px-3 py-2 whitespace-nowrap">{t(`invState_${invoiceState(i)}`)}</td><td className="px-3 py-2 text-right">{i.taxInvoice ? <>{Number(i.taxInvoice.totalCny).toFixed(2)}<span className="block whitespace-nowrap text-[11px] text-navy/60">@{Number(i.taxInvoice.fxRateToCny).toFixed(4)} {fxMark(u, i.taxInvoice.fxSource, i.taxInvoice.fxRateDate, i.taxInvoice.fxBy)}</span></> : ""}</td></tr>)}{old.map((x) => <tr key={x.id} className="border-t"><td className="px-3 py-2"></td><td className="whitespace-nowrap px-3 py-2 font-mono"><Link href={x.href} className="text-blue underline">{x.no}</Link><OldTag /></td><td className="px-3 py-2 font-mono text-[13px]">{x.field("报价单号")}</td><td className="px-3 py-2">{x.customer}</td><td className="whitespace-nowrap px-3 py-2">{x.field("到期日").slice(0, 10)}</td><td className="whitespace-nowrap px-3 py-2 text-right">{x.amount != null ? `${x.currency} ${x.amount.toFixed(2)}` : ""}</td><td className="px-3 py-2"></td><td className="px-3 py-2 text-right">{num(x.field("预扣税（WHT）"))}</td><td className="px-3 py-2"></td><td className="whitespace-nowrap px-3 py-2 text-[13px]">{x.field("回款日期").slice(0, 10)}</td><td className="px-3 py-2"></td></tr>)}
        {invoices.length + old.length === 0 && <tr><td colSpan={11} className="px-3 py-4 text-navy/70">{t("noInvoices")}</td></tr>}</tbody></table></div>
      <p className="text-sm"><Link href={showVoid ? "/finance" : "/finance?void=1"} className="text-blue hover:underline">{t(showVoid ? "hideVoided" : "showVoided")}</Link></p>
    </div>
  );
}
