import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { localIso } from "@/lib/dates";
import { can } from "@/lib/caps";
import { currentEmployee } from "@/server/auth";
import { mayOpenOrder } from "@/server/scope";
import { Card, PageHeader, Table, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * 出库单 OBTH / 入库单 IBTH — one stock document (N-28, 东升 2026-11-18): its lines, the service order (QTTH) it was
 * issued for and the machine (ATH) the parts went into. Opened from the part's movements, the order's document chain
 * and the search. Cost is shown only to those who may see it.
 */
export default async function Movement({ params }: { params: Promise<{ no: string }> }) {
  const no = decodeURIComponent((await params).no);
  const [t, u, n, me] = await Promise.all([getTranslations("common"), getTranslations("ui"), getTranslations("nav"), currentEmployee()]);
  const rows = await prisma.stockMovement.findMany({ where: { no }, orderBy: { lineNo: "asc" }, include: { part: { select: { sku: true, name: true, nameLocal: true, unit: true } }, asset: { select: { code: true, serialNumber: true, model: { select: { code: true } } } }, serviceOrder: { select: { id: true, no: true, status: true, customer: { select: { code: true, name: true } } } } } });
  if (!rows.length) notFound();
  const head = rows[0], out = head.direction === "OUT", order = rows.find((r) => r.serviceOrder)?.serviceOrder ?? null;
  const orderOpen = order ? can.allOrders(me) || (await mayOpenOrder(me, order.id)) : false;
  const doc = await prisma.document.findUnique({ where: { no }, select: { createdBy: { select: { code: true, name: true } }, voidedAt: true } });
  const assets = [...new Map(rows.filter((r) => r.asset).map((r) => [r.asset!.code, r.asset!])).values()];
  const cost = can.cost(me);
  // 派修单 v5 P2-3 (MD Q5): an issue carries no cost of its own — purchasing, finance and the MD see what the part came in
  // at: the latest receipt (IBTH) before the issue, else the part's last purchase cost. Engineers see no cost column.
  const inCost = new Map<string, { c: number; from: string }>();
  if (cost) for (const r of rows) if (r.unitCost == null && r.partId) {
    const rec = await prisma.stockMovement.findFirst({ where: { partId: r.partId, direction: "IN", unitCost: { not: null }, movedAt: { lte: r.movedAt } }, orderBy: { movedAt: "desc" }, select: { unitCost: true, no: true } });
    const last = rec ? null : await prisma.part.findUnique({ where: { id: r.partId }, select: { lastCost: true } });
    if (rec) inCost.set(r.id, { c: Number(rec.unitCost), from: rec.no }); else if (last?.lastCost != null) inCost.set(r.id, { c: Number(last.lastCost), from: "" });
  }
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: `/documents?type=${out ? "OB" : "IB"}`, label: n(out ? "stockOut" : "stockIn") }} title={no} badge={<Tag>{n(out ? "stockOut" : "stockIn")}</Tag>} />
      <Card>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-navy/60">{t("date")}</dt><dd>{localIso(head.movedAt)!.slice(0, 16).replace("T", " ")}</dd>
          <dt className="text-navy/60">{u("mvWarehouse")}</dt><dd>{head.warehouse}</dd>
          {doc?.createdBy && <><dt className="text-navy/60">{u("mvBy")}</dt><dd><span className="font-mono text-xs">{doc.createdBy.code}</span> {doc.createdBy.name}</dd></>}
          <dt className="text-navy/60">{u("mvOrder")}</dt><dd>{order ? <>{orderOpen ? <Link href={`/service-orders/${order.no}`} className="font-mono text-blue hover:underline">{order.no}</Link> : <span className="font-mono">{order.no}</span>}{can.customerNames(me) ? ` · ${order.customer.name}` : ` · ${order.customer.code}`}</> : "—"}</dd>
          <dt className="text-navy/60">{u("mvAsset")}</dt><dd>{assets.length ? assets.map((a) => <span key={a.code} className="mr-3 whitespace-nowrap"><Link href={`/assets/${a.code}`} className="font-mono text-blue hover:underline">{a.code}</Link> {a.model?.code} {a.serialNumber}</span>) : "—"}</dd>
        </dl>
      </Card>
      <div className="rounded-xl border bg-white p-2">
        <Table head={["#", u("partSku"), u("mvPart"), t("qty"), u("uom"), u("mvInto"), ...(cost ? [u("unitCost")] : []), u("mvNote")]}>
          {rows.map((r) => <tr key={r.id}>
            <td>{r.lineNo}</td>
            <td className="whitespace-nowrap">{r.part ? <Link href={`/parts/${r.part.sku}`} className="font-mono text-blue hover:underline">{r.part.sku}</Link> : <span className="text-navy/60">{r.kind}</span>}</td>
            <td>{r.part ? `${r.part.name}${r.part.nameLocal ? ` · ${r.part.nameLocal}` : ""}` : ""}</td>
            <td className="font-semibold tabular-nums">{out ? "−" : "+"}{Number(r.qty)}</td><td>{r.part?.unit ?? ""}</td>
            <td className="whitespace-nowrap">{r.asset ? <Link href={`/assets/${r.asset.code}`} className="font-mono text-blue hover:underline">{r.asset.code}</Link> : ""}</td>
            {cost && <td className="whitespace-nowrap tabular-nums">{r.unitCost != null ? Number(r.unitCost).toFixed(2) : inCost.get(r.id) ? <>{inCost.get(r.id)!.c.toFixed(2)}{inCost.get(r.id)!.from ? <Link href={`/parts/movement/${inCost.get(r.id)!.from}`} className="ml-1 font-mono text-xs text-blue hover:underline">{inCost.get(r.id)!.from}</Link> : null}</> : "—"}</td>}
            <td className="text-xs text-navy/70">{[r.batch, r.oldPartDisposition].filter(Boolean).join(" · ")}</td>
          </tr>)}
        </Table>
      </div>
    </div>
  );
}
