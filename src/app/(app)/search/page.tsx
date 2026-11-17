import { currentEmployee } from "@/server/auth";
import { customerScope, docTypeAllowed, orderScope } from "@/server/scope";
import { DOC_PLACES, DOC_TYPES } from "@/lib/doc-center";
import { can } from "@/lib/caps";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { AssetStatusBadge, OrderStatusBadge } from "@/components/StatusBadge";
import { assetScope } from "@/server/scope";

export const dynamic = "force-dynamic";

/**
 * One box, everything: assets by code/serial/location, orders by number/symptom, customers, parts — and every numbered
 * document by its number or a part of it (PVTH, POTH, TITH, RCTH, IBTH, OBTH …), grouped by kind, one tap to open
 * (派修单 v3 第 15 条). What a role may not see it cannot find: purchasing finds no customer and no customer name,
 * Sales and engineers find no payment voucher; documents of an order follow the person's order scope.
 */
export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim();
  const [t, n] = await Promise.all([getTranslations("common"), getTranslations("nav")]);
  const like = { contains: q, mode: "insensitive" as const };
  const me = await currentEmployee();
  const names = can.customerNames(me);
  const [oScope, cScope] = await Promise.all([orderScope(me), customerScope(me)]);
  const types = DOC_TYPES.filter((ty) => docTypeAllowed(me, ty));
  const [assets, orders, customers, parts, docs] = q ? await Promise.all([
    prisma.asset.findMany({ where: { AND: [await assetScope(me), { OR: [{ code: like }, { serialNumber: like }, { location: like }, { customerAssetNo: like }] }] }, include: { customer: { select: { name: true } }, model: { select: { code: true } } }, take: 20 }),
    prisma.serviceOrder.findMany({ where: { AND: [oScope, { OR: [{ no: like }, { reportedSymptom: like }, { customerRef: like }] }] }, include: { customer: { select: { name: true } } }, take: 20, orderBy: { reportedAt: "desc" } }),
    names ? prisma.customer.findMany({ where: { AND: [cScope, { OR: [{ code: like }, { name: like }, { nameLocal: like }, ...(can.customerMoney(me) ? [{ taxId: like }] : [])] }] }, take: 10 }) : Promise.resolve([]),
    prisma.part.findMany({ where: { OR: [{ sku: like }, { name: like }, { vendorPartNo: like }] }, take: 10 }),
    q.length >= 2 ? prisma.document.findMany({ where: { no: like, type: { in: types as never }, OR: [{ serviceOrderId: null }, { serviceOrder: oScope }] }, select: { no: true, type: true, issuedAt: true, voidedAt: true, serviceOrder: { select: { no: true } } }, orderBy: { issuedAt: "desc" }, take: 60 }) : Promise.resolve([]),
  ]) : [[], [], [], [], []];
  const byType = new Map<string, typeof docs>();
  for (const d of docs) { if (d.type === "QT") continue; byType.set(d.type, [...(byType.get(d.type) ?? []), d]); } // QTTH is the order itself: listed under 业务单
  const box = "rounded-xl border bg-white p-4";
  return (
    <div className="space-y-4">
      <form className="flex gap-2"><input name="q" defaultValue={q} autoFocus placeholder={t("search")} className="w-full min-w-0 rounded border px-3 py-2" /><button className="shrink-0 whitespace-nowrap rounded bg-blue px-4 text-white">{t("search")}</button></form>
      {q && <div className="grid gap-4 md:grid-cols-2">
        {[...byType].map(([ty, rows]) => <section key={ty} className={box}><h2 className="mb-2 font-bold text-navy">{n(DOC_PLACES[ty].nav)} ({rows.length})</h2><ul className="text-sm">{rows.map((d) => <li key={d.no} className="flex items-center gap-2 border-t py-1"><Link href={ty === "PV" ? `/finance/payables?all=1#${d.no}` : DOC_PLACES[ty].open(d.no, d.serviceOrder?.no)} className={`font-mono text-blue underline ${d.voidedAt ? "line-through" : ""}`}>{d.no}</Link><span className="text-navy/70">{d.issuedAt.toISOString().slice(0, 10)}</span>{d.serviceOrder && <span className="font-mono text-xs text-navy/60">{d.serviceOrder.no}</span>}</li>)}</ul></section>)}
        <section className={box}><h2 className="mb-2 font-bold text-navy">{t("assets")} ({assets.length})</h2><ul className="text-sm">{assets.map((a) => <li key={a.id} className="flex flex-wrap items-center gap-2 border-t py-1"><Link href={`/assets/${a.code}`} className="font-mono text-blue underline">{a.code}</Link><span className="font-mono text-navy/70">{a.serialNumber}</span><span>{a.model?.code}</span><span className="text-navy/70">{names ? `${a.customer?.name ?? ""} · ` : ""}{a.location}</span><AssetStatusBadge status={a.status} /></li>)}</ul></section>
        <section className={box}><h2 className="mb-2 font-bold text-navy">{t("serviceOrders")} ({orders.length})</h2><ul className="text-sm">{orders.map((o) => <li key={o.id} className="flex items-center gap-2 border-t py-1"><Link href={`/service-orders/${o.no}`} className="font-mono text-blue underline">{o.no}</Link>{names && <span>{o.customer.name}</span>}<span className="truncate text-navy/70">{o.reportedSymptom}</span><OrderStatusBadge status={o.status} /></li>)}</ul></section>
        {names && <section className={box}><h2 className="mb-2 font-bold text-navy">{t("customer")} ({customers.length})</h2><ul className="text-sm">{customers.map((c) => <li key={c.id} className="border-t py-1"><Link href={`/customers/${c.code}`} className="font-mono text-blue underline">{c.code}</Link> {c.name}</li>)}</ul></section>}
        <section className={box}><h2 className="mb-2 font-bold text-navy">{t("parts")} ({parts.length})</h2><ul className="text-sm">{parts.map((p) => <li key={p.id} className="border-t py-1"><Link href={`/parts/${p.sku}`} className="font-mono text-blue underline">{p.sku}</Link> {p.name}</li>)}</ul></section>
      </div>}
    </div>
  );
}
