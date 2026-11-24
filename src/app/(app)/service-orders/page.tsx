import { legacyTail } from "@/server/legacy";
import { OldTag } from "@/components/OldTag";
import type { LegacyKindKey } from "@/lib/legacy";
import { currentEmployee } from "@/server/auth";
import { orderScope } from "@/server/scope";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { OrderStatusBadge } from "@/components/StatusBadge";
import { ORDER_STATUSES } from "@/lib/lifecycle";
import type { Prisma } from "@prisma/client";
import { MODES } from "@/lib/modes";
import { FaultText, PAGE_SIZE, PageHeader, Pager, Table, btnGhost, inputCls, filterCls } from "@/components/ui";

import { can } from "@/lib/caps";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string; mode?: string }> }) {
  const { status, q, page, mode } = await searchParams;
  const p = Math.max(1, Number(page) || 1);
  const [t, u, ts, locale] = await Promise.all([getTranslations("common"), getTranslations("ui"), getTranslations("orderStatus"), getLocale()]);
  const me = await currentEmployee();
  const seePrice = can.price(me); // 工程师、主管不看金额 (统一角色权限表)
  const where = {
    AND: [await orderScope(me)], // 只看派给自己的 (工程师) / 本组的 (主管)
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
  // the old system's quotes follow in the same list (朱总 2026-11-24) — not under a status filter: they have no status here
  const oldKinds: LegacyKindKey[] = status ? [] : !mode ? ["QUOTE", "TRADE_QUOTE"] : /TRADE/.test(mode) ? ["TRADE_QUOTE"] : mode === "REPAIR" ? ["QUOTE"] : [];
  const old = await legacyTail(me, oldKinds, { q: q?.trim() || undefined, page: p, size: PAGE_SIZE, liveTotal: total });
  const lg = await getTranslations("legacy");
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
        <Table head={["QTTH", t("customer"), t("assets"), t("symptom"), u("businessMode"), t("reportedAt"), t("assignee"), t("status"), ...(seePrice ? [t("total")] : [])]}>
          {orders.map((o) => (
            <tr key={o.id}>
              <td><Link href={`/service-orders/${o.no}`} className="font-mono text-blue hover:underline">{o.no}</Link>{o.customerRef ? <span className="block font-mono text-xs text-navy/60">{o.customerRef}</span> : null}</td>
              <td>{can.customerNames(me) ? o.customer.name : "—"}</td>
              <td className="font-mono">{o.assets.map((a) => a.asset.code).join(", ")}</td>
              <td className="max-w-xs">{o.reportedSymptom ? <FaultText>{o.reportedSymptom}{o.reportedAlarm ? ` ${o.reportedAlarm}` : ""}</FaultText> : ""}</td>
              <td className="whitespace-nowrap">{u(`mode_${o.mode}`)}{o.mode === "MAINTENANCE" ? <span className="block text-xs text-navy/60">{t(o.kind)}</span> : null}</td>
              <td>{fmt.format(o.reportedAt)}</td>
              <td>{o.assignee?.name ?? "—"}</td>
              <td><OrderStatusBadge status={o.status} /></td>
              {seePrice && <td className="text-right">{o.total != null ? `${o.currency} ${Number(o.total).toFixed(2)}` : "—"}</td>}
            </tr>
          ))}
          {old.rows.map((x) => (
            <tr key={x.id}>
              <td className="whitespace-nowrap"><Link href={x.href} className="font-mono text-blue hover:underline">{x.no}</Link><OldTag /></td>
              <td>{x.customer}</td>
              <td></td>
              <td className="max-w-xs">{x.title}</td>
              <td className="whitespace-nowrap">{lg(`k_${x.kind}`)}</td>
              <td>{x.date ? fmt.format(new Date(x.date)) : ""}</td>
              <td>{x.field("业务经理") || x.by}</td>
              <td></td>
              {seePrice && <td className="whitespace-nowrap text-right">{x.amount != null ? `${x.currency} ${x.amount.toFixed(2)}` : "—"}</td>}
            </tr>
          ))}
          {orders.length + old.rows.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-navy/60">{t("none")}</td></tr>}
        </Table>
        <Pager page={p} total={total + old.total} href={qs} prev={u("prevPage")} next={u("nextPage")} />
      </div>
    </div>
  );
}
