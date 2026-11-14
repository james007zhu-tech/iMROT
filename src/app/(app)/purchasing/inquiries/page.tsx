import { localIso } from "@/lib/dates";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { Flash } from "@/components/Flash";
import { PageHeader, Table, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

/** PRTH — purchase inquiries: what we asked suppliers to quote, and where each one stands. */
export default async function Inquiries({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const [t, u, ts] = await Promise.all([getTranslations("common"), getTranslations("ui"), getTranslations("inquiryStatus")]);
  const rows = await prisma.purchaseInquiry.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { serviceOrder: { select: { no: true, customer: { select: { name: true } } } }, requestedBy: { select: { name: true } }, quotes: { select: { id: true, selected: true, subtotal: true, currency: true, supplier: { select: { name: true } } } }, orders: { select: { no: true } } } });
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/parts", label: t("nav_scm") }} title={u("inquiries")} badge={<Tag>{rows.length}</Tag>} actions={<><Link href="/purchasing/orders" className="text-sm text-blue hover:underline">POTH →</Link><Link href="/suppliers" className="text-sm text-blue hover:underline">{u("suppliers")} →</Link></>} newHref="/purchasing/inquiries/new" newLabel={u("newInquiry")} />
      <Flash ok={ok} error={error} />
      <div className="rounded-xl border bg-white p-2">
        <Table head={["PRTH", t("status"), "QTTH", u("lines"), u("quotesReceived"), u("selectedQuote"), "POTH", u("requestedBy"), t("date")]}>
          {rows.map((r) => { const sel = r.quotes.find((q) => q.selected); return (
            <tr key={r.id}>
              <td><Link href={`/purchasing/inquiries/${r.no}`} className="font-mono text-blue hover:underline">{r.no}</Link></td>
              <td><Tag hot={r.status === "OPEN"}>{ts(r.status)}</Tag></td>
              <td>{r.serviceOrder ? <Link href={`/service-orders/${r.serviceOrder.no}`} className="font-mono text-blue hover:underline">{r.serviceOrder.no}</Link> : ""}{r.serviceOrder ? <span className="block text-xs text-navy/70">{r.serviceOrder.customer.name}</span> : null}</td>
              <td>{(r.lines as unknown[]).length}</td><td>{r.quotes.length}</td>
              <td>{sel ? `${sel.supplier.name} · ${sel.currency} ${Number(sel.subtotal).toFixed(2)}` : ""}</td>
              <td className="font-mono">{r.orders.map((o) => <Link key={o.no} href={`/purchasing/orders/${o.no}`} className="text-blue hover:underline">{o.no}</Link>)}</td>
              <td>{r.requestedBy.name}</td><td>{localIso(r.createdAt)!.slice(0, 10)}</td>
            </tr>); })}
          {rows.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-navy/60">{u("noInquiries")}</td></tr>}
        </Table>
      </div>
    </div>
  );
}
