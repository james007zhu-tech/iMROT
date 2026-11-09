import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { OrderStatusBadge } from "@/components/StatusBadge";
import { ORDER_STATUSES } from "@/lib/lifecycle";
import type { Prisma } from "@prisma/client";
import { MODES } from "@/lib/modes";
import { FaultText, PAGE_SIZE, PageHeader, Pager, Table, btnGhost, inputCls, filterCls } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string; mode?: string }> }) {
  const { status, q, page, mode } = await searchParams;
  const p = Math.max(1, Number(page) || 1);
  const [t, u, ts, locale] = await Promise.all([getTranslations("common"), getTranslations("ui"), getTranslations("orderStatus"), getLocale()]);
  const where = {
    status: ORDER_STATUSES.includes(status as never) ? (status as never) : undefined,
    mode: MODES.includes(mode as never) ? (mode as never) : undefined,
    OR: q ? [{ no: { contains: q, mode: "insensitive" } }, { customerRef: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }, { assets: { some: { asset: { code: { contains: q, mode: "insensitive" } } } } }] : undefined,
  } satisfies Prisma.ServiceOrderWhereInput;
  const [orders, total] = await Promise.all([
    prisma.serviceOrder.findMany({
      where,
      include: { customer: { select: { name: true } }, assignee: { select: { name: true } }, assets: { include: { asset: { select: { code: true } } } } },
      orderBy: { reportedAt: "desc" }, skip: (p - 1) * PAGE_SIZE, take: PAGE_SIZE,
    }),
    prisma.serviceOrder.count({ where }),
  ]);
  const qs = (n: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), ...(mode ? { mode } : {}), page: String(n) })}`;
  const fmt = new Intl.DateTimeFormat(locale, { year: "2-digit", month: "2-digit", day: "2-digit" });
  return (
    <div className="space-y-4">
      <PageHeader title={t("serviceOrders")} newHref="/service-orders/new" newLabel={u("newServiceOrder")} />
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder={u("searchOrders")} className={`${inputCls} max-w-sm`} />
        <select name="mode" defaultValue={mode ?? ""} className={filterCls}><option value="">{u("businessMode")} ▾</option>{MODES.map((m) => <option key={m} value={m}>{u(`mode_${m}`)}</option>)}</select>
        <select name="status" defaultValue={status ?? ""} className={filterCls}><option value="">{t("status")} ▾</option>{ORDER_STATUSES.map((s) => <option key={s} value={s}>{ts(s)}</option>)}</select>
        <button className={btnGhost}>{t("search")}</button>
      </form>
      <div className="rounded-xl border bg-white p-2">
        <Table head={["QTTH", t("customer"), t("assets"), t("symptom"), u("businessMode"), t("reportedAt"), t("assignee"), t("status"), t("total")]}>
          {orders.map((o) => (
            <tr key={o.id}>
              <td><Link href={`/service-orders/${o.no}`} className="font-mono text-blue hover:underline">{o.no}</Link>{o.customerRef ? <span className="block font-mono text-xs text-navy/60">{o.customerRef}</span> : null}</td>
              <td>{o.customer.name}</td>
              <td className="font-mono">{o.assets.map((a) => a.asset.code).join(", ")}</td>
              <td className="max-w-xs">{o.reportedSymptom ? <FaultText>{o.reportedSymptom}{o.reportedAlarm ? ` ${o.reportedAlarm}` : ""}</FaultText> : ""}</td>
              <td className="whitespace-nowrap">{u(`mode_${o.mode}`)}{o.mode === "MAINTENANCE" ? <span className="block text-xs text-navy/60">{t(o.kind)}</span> : null}</td>
              <td>{fmt.format(o.reportedAt)}</td>
              <td>{o.assignee?.name ?? "—"}</td>
              <td><OrderStatusBadge status={o.status} /></td>
              <td className="text-right">{o.total != null ? `${o.currency} ${Number(o.total).toFixed(2)}` : "—"}</td>
            </tr>
          ))}
          {orders.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-navy/60">{t("none")}</td></tr>}
        </Table>
        <Pager page={p} total={total} href={qs} prev={u("prevPage")} next={u("nextPage")} />
      </div>
    </div>
  );
}
