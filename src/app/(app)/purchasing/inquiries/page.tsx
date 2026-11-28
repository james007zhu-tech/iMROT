import { can } from "@/lib/caps";
import { currentEmployee } from "@/server/auth";
import { orderScope } from "@/server/scope";
import { localIso } from "@/lib/dates";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { Flash } from "@/components/Flash";
import { PageHeader, Table, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

/** PRTH — purchase inquiries: what we asked suppliers to quote, and where each one stands. */
import { sortOf } from "@/lib/sort";
import type { Prisma } from "@prisma/client";
export default async function Inquiries({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; sort?: string }> }) {
  const { ok, error, sort } = await searchParams;
  const so = sortOf<Prisma.PurchaseInquiryOrderByWithRelationInput>(sort, { date: (d) => ({ createdAt: d }), no: (d) => ({ no: d }), status: (d) => ({ status: d }) }, "-date");
  const [t, u, ts] = await Promise.all([getTranslations("common"), getTranslations("ui"), getTranslations("inquiryStatus")]);
  const me = await currentEmployee();
  const seeCost = can.cost(me);
  // 采购申请: the shop floor sees its own requests and those of its orders; supplier prices only for those who see cost
  const own = can.allOrders(me) ? {} : { OR: [{ requestedById: me.id }, { serviceOrder: await orderScope(me) }] };
  const rows = await prisma.purchaseInquiry.findMany({ where: own, orderBy: so.orderBy, take: 200, include: { serviceOrder: { select: { no: true } }, requestedBy: { select: { name: true } }, quotes: { select: { id: true, selected: true, subtotal: true, currency: true, supplier: { select: { name: true } } } }, orders: { select: { no: true } } } });
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/parts", label: t("nav_scm") }} title={u("inquiries")} badge={<Tag>{rows.length}</Tag>} actions={<>{can.purchase(me) && <><Link href="/purchasing/orders" className="text-sm text-blue hover:underline">POTH →</Link><Link href="/suppliers" className="text-sm text-blue hover:underline">{u("suppliers")} →</Link></>}</>} newHref="/purchasing/inquiries/new" newLabel={u("newInquiry")} />
      <Flash ok={ok} error={error} />
      <div className="rounded-xl border bg-white p-2">
        <Table head={[so.th("no", "PRTH"), so.th("status", t("status")), "QTTH", u("lines"), u("quotesReceived"), u("selectedQuote"), "POTH", u("requestedBy"), so.th("date", t("date"))]}>
          {rows.map((r) => { const sel = r.quotes.find((q) => q.selected); return (
            <tr key={r.id}>
              <td><Link href={`/purchasing/inquiries/${r.no}`} className="font-mono text-blue hover:underline">{r.no}</Link></td>
              <td><Tag hot={r.status === "OPEN"}>{ts(r.status)}</Tag></td>
              <td>{r.serviceOrder ? <Link href={`/service-orders/${r.serviceOrder.no}`} className="font-mono text-blue hover:underline">{r.serviceOrder.no}</Link> : ""}</td>
              <td>{(r.lines as unknown[]).length}</td><td>{r.quotes.length}</td>
              <td>{sel ? (seeCost ? `${sel.supplier.name} · ${sel.currency} ${Number(sel.subtotal).toFixed(2)}` : "✓") : ""}</td>
              <td className="font-mono">{r.orders.map((o) => <Link key={o.no} href={`/purchasing/orders/${o.no}`} className="text-blue hover:underline">{o.no}</Link>)}</td>
              <td>{r.requestedBy.name}</td><td>{localIso(r.createdAt)!.slice(0, 10)}</td>
            </tr>); })}
          {rows.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-navy/60">{u("noInquiries")}</td></tr>}
        </Table>
      </div>
    </div>
  );
}
