import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { AssetStatusBadge, OrderStatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

/** One box, everything: assets by code/serial/location, orders by number/symptom, customers, parts. */
export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const t = await getTranslations("common");
  const like = { contains: q, mode: "insensitive" as const };
  const [assets, orders, customers, parts] = q ? await Promise.all([
    prisma.asset.findMany({ where: { OR: [{ code: like }, { serialNumber: like }, { location: like }, { customerAssetNo: like }] }, include: { customer: { select: { name: true } }, model: { select: { code: true } } }, take: 20 }),
    prisma.serviceOrder.findMany({ where: { OR: [{ no: like }, { reportedSymptom: like }, { customerRef: like }] }, include: { customer: { select: { name: true } } }, take: 20, orderBy: { reportedAt: "desc" } }),
    prisma.customer.findMany({ where: { OR: [{ code: like }, { name: like }, { nameLocal: like }, { taxId: like }] }, take: 10 }),
    prisma.part.findMany({ where: { OR: [{ sku: like }, { name: like }, { vendorPartNo: like }] }, take: 10 }),
  ]) : [[], [], [], []];
  return (
    <div className="space-y-4">
      <form className="flex gap-2"><input name="q" defaultValue={q} autoFocus placeholder={t("search")} className="w-full rounded border px-3 py-2" /><button className="rounded bg-blue px-4 text-white">{t("search")}</button></form>
      {q && <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">{t("assets")} ({assets.length})</h2><ul className="text-sm">{assets.map((a) => <li key={a.id} className="flex items-center gap-2 border-t py-1"><Link href={`/assets/${a.code}`} className="font-mono text-blue underline">{a.code}</Link><span className="font-mono text-slate-500">{a.serialNumber}</span><span>{a.model?.code}</span><span className="text-slate-500">{a.customer?.name} · {a.location}</span><AssetStatusBadge status={a.status} /></li>)}</ul></section>
        <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">{t("serviceOrders")} ({orders.length})</h2><ul className="text-sm">{orders.map((o) => <li key={o.id} className="flex items-center gap-2 border-t py-1"><Link href={`/service-orders/${o.no}`} className="font-mono text-blue underline">{o.no}</Link><span>{o.customer.name}</span><span className="truncate text-slate-500">{o.reportedSymptom}</span><OrderStatusBadge status={o.status} /></li>)}</ul></section>
        <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">{t("customer")} ({customers.length})</h2><ul className="text-sm">{customers.map((c) => <li key={c.id} className="border-t py-1"><Link href={`/customers/${c.code}`} className="font-mono text-blue underline">{c.code}</Link> {c.name}</li>)}</ul></section>
        <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">{t("parts")} ({parts.length})</h2><ul className="text-sm">{parts.map((p) => <li key={p.id} className="border-t py-1"><Link href={`/parts/${p.sku}`} className="font-mono text-blue underline">{p.sku}</Link> {p.name}</li>)}</ul></section>
      </div>}
    </div>
  );
}
