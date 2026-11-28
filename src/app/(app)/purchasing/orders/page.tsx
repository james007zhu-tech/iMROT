import { can } from "@/lib/caps";
import { currentEmployee } from "@/server/auth";
import { localIso } from "@/lib/dates";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { Flash } from "@/components/Flash";
import { PageHeader, Table, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

/** POTH — purchase orders and how much of each has arrived. */
import { sortOf } from "@/lib/sort";
import type { Prisma } from "@prisma/client";
export default async function PurchaseOrders({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; st?: string; sort?: string }> }) {
  const { ok, error, st, sort } = await searchParams;
  const so = sortOf<Prisma.PurchaseOrderOrderByWithRelationInput>(sort, { date: (d) => ({ createdAt: d }), no: (d) => ({ no: d }), status: (d) => ({ status: d }), supplier: (d) => ({ supplier: { name: d } }) }, "-date", { st });
  const [t, u, ts] = await Promise.all([getTranslations("common"), getTranslations("ui"), getTranslations("poStatus")]);
  const me = await currentEmployee();
  const seeCost = can.cost(me); // 单价、金额 only for those who see cost; the rest see what has arrived
  // 派修单 v5 P2-1: one state for the badge, the list filter and the banner — 草稿 → 待 MD 批准 → 已批准 → 已发供应商 → 部分收货 / 已收货
  const stage = (r: { status: string; approvalAskedAt: Date | null; approvedAt: Date | null }) => (r.status !== "DRAFT" ? r.status : r.approvedAt ? "APPROVED" : r.approvalAskedAt ? "WAIT_MD" : "DRAFT");
  const label = (k: string) => (k === "WAIT_MD" || k === "APPROVED" ? u(`poStage_${k}`) : ts(k));
  const all = await prisma.purchaseOrder.findMany({ orderBy: so.orderBy, take: 200, include: { supplier: { select: { name: true } }, serviceOrder: { select: { no: true } }, inquiry: { select: { no: true } }, createdBy: { select: { name: true } } } });
  const rows = st ? all.filter((r) => stage(r) === st) : all;
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/parts", label: t("nav_scm") }} title={u("purchaseOrders")} badge={<Tag>{rows.length}</Tag>} actions={<><Link href="/purchasing/inquiries" className="text-sm text-blue hover:underline">PRTH →</Link><Link href="/suppliers" className="text-sm text-blue hover:underline">{u("suppliers")} →</Link></>} newHref="/purchasing/orders/new" newLabel={u("newPo")} />
      <Flash ok={ok} error={error} />
      <div className="flex flex-wrap gap-2 text-sm">{["", "DRAFT", "WAIT_MD", "APPROVED", "SENT", "PARTIAL", "RECEIVED", "CANCELLED"].map((k) => <Link key={k} href={k ? `/purchasing/orders?st=${k}` : "/purchasing/orders"} className={`whitespace-nowrap rounded-full border px-3 py-1 ${(st ?? "") === k ? "border-navy bg-navy text-white" : "border-navy/30 bg-white text-navy"}`}>{k ? label(k) : t("all")} · {k ? all.filter((r) => stage(r) === k).length : all.length}</Link>)}</div>
      <div className="rounded-xl border bg-white p-2">
        <Table head={[so.th("no", "POTH"), so.th("status", t("status")), so.th("supplier", u("supplier")), "PRTH", "QTTH", ...(seeCost ? [t("total")] : []), u("received"), u("expectedAt"), t("date")]}>
          {rows.map((r) => { const ls = r.lines as { qty: number; receivedQty: number }[]; const got = ls.reduce((s, l) => s + l.receivedQty, 0), all = ls.reduce((s, l) => s + l.qty, 0); return (
            <tr key={r.id}>
              <td><Link href={`/purchasing/orders/${r.no}`} className="font-mono text-blue hover:underline">{r.no}</Link></td>
              <td><Tag hot={["SENT", "PARTIAL", "WAIT_MD"].includes(stage(r))}>{label(stage(r))}</Tag></td>
              <td>{r.supplier.name}</td>
              <td className="font-mono">{r.inquiry ? <Link href={`/purchasing/inquiries/${r.inquiry.no}`} className="text-blue hover:underline">{r.inquiry.no}</Link> : ""}</td>
              <td className="font-mono">{r.serviceOrder ? <Link href={`/service-orders/${r.serviceOrder.no}`} className="text-blue hover:underline">{r.serviceOrder.no}</Link> : ""}</td>
              {seeCost && <td className="text-right">{r.currency} {Number(r.total).toFixed(2)}</td>}
              <td>{got} / {all}</td><td>{localIso(r.expectedAt)?.slice(0, 10) ?? ""}</td><td>{localIso(r.orderedAt)!.slice(0, 10)}</td>
            </tr>); })}
          {rows.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-navy/60">{u("noPos")}</td></tr>}
        </Table>
      </div>
    </div>
  );
}
