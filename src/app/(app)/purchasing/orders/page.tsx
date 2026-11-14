import { localIso } from "@/lib/dates";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { Flash } from "@/components/Flash";
import { PageHeader, Table, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

/** POTH — purchase orders and how much of each has arrived. */
export default async function PurchaseOrders({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const [t, u, ts] = await Promise.all([getTranslations("common"), getTranslations("ui"), getTranslations("poStatus")]);
  const rows = await prisma.purchaseOrder.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { supplier: { select: { name: true } }, serviceOrder: { select: { no: true } }, inquiry: { select: { no: true } }, createdBy: { select: { name: true } } } });
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/parts", label: t("nav_scm") }} title={u("purchaseOrders")} badge={<Tag>{rows.length}</Tag>} actions={<><Link href="/purchasing/inquiries" className="text-sm text-blue hover:underline">PRTH →</Link><Link href="/suppliers" className="text-sm text-blue hover:underline">{u("suppliers")} →</Link></>} newHref="/purchasing/orders/new" newLabel={u("newPo")} />
      <Flash ok={ok} error={error} />
      <div className="rounded-xl border bg-white p-2">
        <Table head={["POTH", t("status"), u("supplier"), "PRTH", "QTTH", t("total"), u("received"), u("expectedAt"), t("date")]}>
          {rows.map((r) => { const ls = r.lines as { qty: number; receivedQty: number }[]; const got = ls.reduce((s, l) => s + l.receivedQty, 0), all = ls.reduce((s, l) => s + l.qty, 0); return (
            <tr key={r.id}>
              <td><Link href={`/purchasing/orders/${r.no}`} className="font-mono text-blue hover:underline">{r.no}</Link></td>
              <td><Tag hot={r.status === "SENT" || r.status === "PARTIAL"}>{ts(r.status)}</Tag></td>
              <td>{r.supplier.name}</td>
              <td className="font-mono">{r.inquiry ? <Link href={`/purchasing/inquiries/${r.inquiry.no}`} className="text-blue hover:underline">{r.inquiry.no}</Link> : ""}</td>
              <td className="font-mono">{r.serviceOrder ? <Link href={`/service-orders/${r.serviceOrder.no}`} className="text-blue hover:underline">{r.serviceOrder.no}</Link> : ""}</td>
              <td className="text-right">{r.currency} {Number(r.total).toFixed(2)}</td>
              <td>{got} / {all}</td><td>{localIso(r.expectedAt)?.slice(0, 10) ?? ""}</td><td>{localIso(r.orderedAt)!.slice(0, 10)}</td>
            </tr>); })}
          {rows.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-navy/60">{u("noPos")}</td></tr>}
        </Table>
      </div>
    </div>
  );
}
