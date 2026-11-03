import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { OrderStatusBadge } from "@/components/StatusBadge";
import { ORDER_STATUSES } from "@/lib/lifecycle";
import { FaultText, PageHeader, Table, btnGhost, inputCls, filterCls } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { status, q } = await searchParams;
  const [t, u, ts, locale] = await Promise.all([getTranslations("common"), getTranslations("ui"), getTranslations("orderStatus"), getLocale()]);
  const orders = await prisma.serviceOrder.findMany({
    where: {
      status: ORDER_STATUSES.includes(status as never) ? (status as never) : undefined,
      OR: q ? [{ no: { contains: q, mode: "insensitive" } }, { customerRef: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }, { assets: { some: { asset: { code: { contains: q, mode: "insensitive" } } } } }] : undefined,
    },
    include: { customer: { select: { name: true } }, assignee: { select: { name: true } }, assets: { include: { asset: { select: { code: true } } } } },
    orderBy: { reportedAt: "desc" }, take: 200,
  });
  const fmt = new Intl.DateTimeFormat(locale, { year: "2-digit", month: "2-digit", day: "2-digit" });
  return (
    <div className="space-y-4">
      <PageHeader title={t("serviceOrders")} newHref="/service-orders/new" newLabel={u("newServiceOrder")} />
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder={u("searchOrders")} className={`${inputCls} max-w-sm`} />
        <select name="status" defaultValue={status ?? ""} className={filterCls}><option value="">{t("status")} ▾</option>{ORDER_STATUSES.map((s) => <option key={s} value={s}>{ts(s)}</option>)}</select>
        <button className={btnGhost}>{t("search")}</button>
      </form>
      <div className="rounded-xl border bg-white p-2">
        <Table head={["QTTH", t("customer"), t("assets"), t("symptom"), t("kind"), t("reportedAt"), t("assignee"), t("status"), t("total")]}>
          {orders.map((o) => (
            <tr key={o.id}>
              <td><Link href={`/service-orders/${o.no}`} className="font-mono text-blue hover:underline">{o.no}</Link>{o.customerRef ? <span className="block font-mono text-xs text-navy/60">{o.customerRef}</span> : null}</td>
              <td>{o.customer.name}</td>
              <td className="font-mono">{o.assets.map((a) => a.asset.code).join(", ")}</td>
              <td className="max-w-xs">{o.reportedSymptom ? <FaultText>{o.reportedSymptom}{o.reportedAlarm ? ` ${o.reportedAlarm}` : ""}</FaultText> : ""}</td>
              <td>{t(o.kind)}</td>
              <td>{fmt.format(o.reportedAt)}</td>
              <td>{o.assignee?.name ?? "—"}</td>
              <td><OrderStatusBadge status={o.status} /></td>
              <td className="text-right">{o.total != null ? `${o.currency} ${Number(o.total).toFixed(2)}` : "—"}</td>
            </tr>
          ))}
          {orders.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-navy/60">{t("none")}</td></tr>}
        </Table>
      </div>
    </div>
  );
}
