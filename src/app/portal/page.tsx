import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentContact, signOutContact } from "@/server/auth";
import { AssetStatusBadge, OrderStatusBadge } from "@/components/StatusBadge";
import { redirect } from "next/navigation";
import { ScanButton } from "@/components/ScanButton";

export const dynamic = "force-dynamic";

export default async function PortalHome() {
  const me = await currentContact();
  const t = await getTranslations("common");
  const locale = await getLocale();
  const [orders, assets] = await Promise.all([
    prisma.serviceOrder.findMany({ where: { customerId: me.customerId }, orderBy: { reportedAt: "desc" }, take: 20, include: { assets: { include: { asset: { select: { code: true, location: true } } } } } }),
    prisma.asset.findMany({ where: { customerId: me.customerId, status: { not: "RETIRED" } }, orderBy: { code: "asc" }, include: { model: { include: { series: { include: { brand: true } } } } } }),
  ]);
  const fmt = (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d);
  async function out() { "use server"; await signOutContact(); redirect("/portal/login"); }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><div><div className="font-bold">{me.customer.name}</div><div className="text-sm text-slate-500">{me.name}</div></div><form action={out}><button className="text-sm text-blue">{t("signOut")}</button></form></div>
      <Link href="/portal/report" className="block rounded-lg bg-blue py-4 text-center text-lg font-bold text-white">{t("reportIssue")}</Link>
      <ScanButton label={t("scanQr")} />
      <section>
        <h2 className="mb-2 font-bold text-navy">{t("serviceOrders")}</h2>
        <ul className="space-y-2">{orders.map((o) => <li key={o.id}><Link href={`/portal/orders/${o.no}`} className="block rounded-lg border bg-white p-3"><div className="flex items-center justify-between"><span className="font-mono">{o.no}</span><OrderStatusBadge status={o.status} /></div><div className="text-sm text-slate-600">{o.assets.map((a) => a.asset.code).join(", ")} · {fmt(o.reportedAt)}</div>{o.reportedSymptom && <div className="truncate text-sm">{o.reportedSymptom}</div>}</Link></li>)}{orders.length === 0 && <li className="text-sm text-slate-500">{t("none")}</li>}</ul>
      </section>
      <section>
        <h2 className="mb-2 font-bold text-navy">{t("assets")}</h2>
        <ul className="space-y-2">{assets.map((a) => <li key={a.id} className="rounded-lg border bg-white p-3"><div className="flex items-center justify-between"><span className="font-mono">{a.code}</span><AssetStatusBadge status={a.status} /></div><div className="text-sm text-slate-600">{a.model ? `${a.model.series.brand.name} ${a.model.code}` : t(a.type)} · {a.location ?? ""}</div><Link href={`/portal/report?asset=${a.code}`} className="text-sm text-blue">{t("reportIssue")} →</Link></li>)}</ul>
      </section>
    </div>
  );
}
