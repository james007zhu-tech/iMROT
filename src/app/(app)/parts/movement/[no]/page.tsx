import { fifoOf } from "@/server/fifo";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { localIso } from "@/lib/dates";
import { can, hasRole } from "@/lib/caps";
import { currentEmployee } from "@/server/auth";
import { mayOpenOrder } from "@/server/scope";
import { Alert, btnGhost, Card, inputCls, PageHeader, Table, Tag } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { guarded } from "@/lib/action-result";
import { voidStockDoc } from "@/server/scm";

export const dynamic = "force-dynamic";

/**
 * 出库单 OBTH / 入库单 IBTH — one stock document (N-28, 东升 2026-11-18): its lines, the service order (QTTH) it was
 * issued for and the machine (ATH) the parts went into. Opened from the part's movements, the order's document chain
 * and the search. Cost is shown only to those who may see it.
 */
export default async function Movement({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const no = decodeURIComponent((await params).no);
  const { ok, error } = await searchParams;
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
  // N-41: the cost of an issue is what its batches cost, first in first out; a return shows what it gave back
  const fifo = cost ? await fifoOf([...new Set(rows.filter((r) => r.partId).map((r) => r.partId!))]) : new Map();
  const inCost = new Map<string, { c: number; from: string; split: string }>();
  if (cost) for (const r of rows) if (r.unitCost == null && r.partId) {
    const f = fifo.get(r.partId), o = f?.out.get(r.id) ?? f?.back.get(r.id);
    if (o) inCost.set(r.id, { c: o.unit, from: o.alloc.length === 1 ? o.alloc[0].inNo ?? "" : "", split: o.alloc.length > 1 ? o.alloc.map((a: { inNo: string | null; qty: number; cost: number }) => `${a.inNo ?? "—"} ${a.qty} × ${a.cost.toFixed(2)}`).join(" + ") : "" });
  }
  // N-42 作废: the opposite movements under a new number; both stay in the ledger. 采购 and the MD only.
  const dead = head.reversedBy ?? null, undoOf = head.reversalOf ?? null, parts = rows.every((r) => r.kind === "PART");
  const mayVoid = parts && !dead && !undoOf && hasRole(me, "MD", "PURCHASING");
  const mayReturn = out && parts && !dead && !undoOf && !!order && hasRole(me, "MD", "PURCHASING", "ENGINEER");
  async function voidIt(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const r = await voidStockDoc({ no, actorCode: me.code, reason: String(f.get("reason") ?? "") });
      return { ok: `stockVoided:${r.no}`, to: `/parts/movement/${no}` };
    }, `/parts/movement/${no}`);
  }
  return (
    <div className="space-y-4">
      <Flash ok={ok?.startsWith("stockVoided") ? u("stockVoided", { no: ok.split(":")[1] ?? "" }) : ok} error={error} />
      {dead && <Alert>{u("stockVoidedBy")} <Link href={`/parts/movement/${dead}`} className="font-mono font-semibold underline">{dead}</Link>{head.voidReason ? ` · ${head.voidReason}` : ""}</Alert>}
      {undoOf && <Alert>{u("stockVoidOf")} <Link href={`/parts/movement/${undoOf}`} className="font-mono font-semibold underline">{undoOf}</Link>{head.voidReason ? ` · ${head.voidReason}` : ""}</Alert>}
      {head.refNo && parts && <p className="text-sm text-navy">{u("returnOf")} <Link href={`/parts/movement/${head.refNo}`} className="font-mono text-blue hover:underline">{head.refNo}</Link></p>}
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
            {cost && <td className="whitespace-nowrap tabular-nums">{r.unitCost != null ? Number(r.unitCost).toFixed(2) : inCost.get(r.id) ? <>{inCost.get(r.id)!.c.toFixed(2)}{inCost.get(r.id)!.from ? <Link href={`/parts/movement/${inCost.get(r.id)!.from}`} className="ml-1 font-mono text-xs text-blue hover:underline">{inCost.get(r.id)!.from}</Link> : null}{inCost.get(r.id)!.split ? <span className="block text-xs text-navy/60">{inCost.get(r.id)!.split}</span> : null}</> : "—"}</td>}
            <td className="text-xs text-navy/70">{[r.batch, r.oldPartDisposition].filter(Boolean).join(" · ")}</td>
          </tr>)}
        </Table>
      </div>
      {(mayVoid || mayReturn) && <div className="flex flex-wrap items-start gap-4 rounded-xl border bg-white p-4">
        {mayReturn && <Link href={`/parts/movement?direction=IN&order=${order!.no}&ref=${no}`} className={btnGhost}>{u("returnFromThis")}</Link>}
        {mayVoid && <details className="min-w-0 flex-1"><summary className="cursor-pointer text-sm font-semibold text-alert-ink">{u("stockVoid")}</summary>
          <form action={voidIt} className="mt-2 space-y-2"><p className="text-[13px] text-navy/80">{u(out ? "stockVoidHintOut" : "stockVoidHintIn")}</p>
            <input name="reason" required minLength={2} placeholder={u("stockVoidReason")} className={inputCls} /><button className={btnGhost}>{u("stockVoidDo")}</button></form></details>}
      </div>}
    </div>
  );
}
