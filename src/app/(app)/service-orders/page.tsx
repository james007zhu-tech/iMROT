import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { OrderStatusBadge } from "@/components/StatusBadge";
import { ORDER_STATUSES } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const t = await getTranslations("common");
  const ts = await getTranslations("orderStatus");
  const locale = await getLocale();
  const orders = await prisma.serviceOrder.findMany({
    where: { status: ORDER_STATUSES.includes(status as never) ? (status as never) : undefined },
    include: { customer: { select: { name: true } }, assignee: { select: { name: true } }, assets: { include: { asset: { select: { code: true } } } } },
    orderBy: { reportedAt: "desc" }, take: 200,
  });
  const fmt = (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">{t("serviceOrders")}</h1>
        <form className="ml-auto flex gap-2">
          <select name="status" defaultValue={status ?? ""} className="rounded border px-2 py-1.5 text-sm"><option value="">{t("all")}</option>{ORDER_STATUSES.map((s) => <option key={s} value={s}>{ts(s)}</option>)}</select>
          <button className="rounded bg-blue px-3 py-1.5 text-sm text-white">{t("search")}</button>
        </form>
        <Link href="/service-orders/new" className="rounded bg-navy px-3 py-1.5 text-sm text-white">{t("reportIssue")}</Link>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr><th className="px-3 py-2">QTTH</th><th className="px-3 py-2">{t("customer")}</th><th className="px-3 py-2">{t("assets")}</th><th className="px-3 py-2">{t("kind")}</th><th className="px-3 py-2">{t("reportedAt")}</th><th className="px-3 py-2">{t("assignee")}</th><th className="px-3 py-2">{t("status")}</th><th className="px-3 py-2 text-right">{t("total")}</th></tr></thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-t hover:bg-slate-50">
                <td className="px-3 py-2 font-mono"><Link href={`/service-orders/${o.no}`} className="text-blue underline">{o.no}</Link></td>
                <td className="px-3 py-2">{o.customer.name}</td>
                <td className="px-3 py-2 font-mono">{o.assets.map((a) => a.asset.code).join(", ")}</td>
                <td className="px-3 py-2">{t(o.kind)}</td>
                <td className="px-3 py-2">{fmt(o.reportedAt)}</td>
                <td className="px-3 py-2">{o.assignee?.name ?? t("none")}</td>
                <td className="px-3 py-2"><OrderStatusBadge status={o.status} /></td>
                <td className="px-3 py-2 text-right">{o.total != null ? `${o.currency} ${Number(o.total).toFixed(2)}` : t("none")}</td>
              </tr>
            ))}
            {orders.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">{t("none")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
