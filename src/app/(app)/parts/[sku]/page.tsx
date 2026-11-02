import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { assetsUsingPart, stockOnHand } from "@/server/scm";
import { AssetStatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

/** The shared-spare view: one part, its stock, and every asset across all customers that uses it. */
export default async function PartPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const part = await prisma.part.findUnique({ where: { sku }, include: { brand: true, movements: { orderBy: { movedAt: "desc" }, take: 30, include: { asset: { select: { code: true } } } } } });
  if (!part) notFound();
  const [onHand, assets] = await Promise.all([stockOnHand(sku), assetsUsingPart(sku)]);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3"><Link href="/parts" className="text-sm text-blue">← SCM</Link><h1 className="font-mono text-2xl font-bold">{part.sku}</h1><span>{part.name}</span><span className="rounded bg-slate-100 px-2 py-0.5 text-sm">on hand {onHand}</span>{part.lastCost != null && <span className="text-sm text-slate-500">last cost {part.lastCostCurrency} {Number(part.lastCost).toFixed(2)}</span>}</div>
      <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">Used by ({assets.length})</h2>
        <ul className="grid gap-1 text-sm md:grid-cols-2">{assets.map((a) => <li key={a.code} className="flex items-center gap-2"><Link href={`/assets/${a.code}`} className="font-mono text-blue underline">{a.code}</Link><span>{a.customer?.name}</span><span className="text-slate-500">{a.model?.code}</span><AssetStatusBadge status={a.status} /></li>)}</ul>
      </section>
      <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">Movements</h2>
        <ul className="text-sm">{part.movements.map((m) => <li key={m.id}><span className="font-mono">{m.no}</span> · {m.direction} {Number(m.qty)} · {m.movedAt.toISOString().slice(0, 10)}{m.asset ? ` → ${m.asset.code}` : ""}{m.oldPartDisposition ? ` · old: ${m.oldPartDisposition}` : ""}</li>)}</ul>
      </section>
    </div>
  );
}
