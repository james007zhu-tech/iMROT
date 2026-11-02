import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Parts() {
  const parts = await prisma.part.findMany({ orderBy: { sku: "asc" }, include: { brand: true, _count: { select: { bomLines: true } } } });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">SCM · Parts</h1>
      <div className="rounded-lg border bg-white"><table className="w-full text-sm"><thead className="bg-slate-100 text-left"><tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Brand</th><th className="px-3 py-2">In BOMs</th><th className="px-3 py-2">Last cost</th></tr></thead>
        <tbody>{parts.map((p) => <tr key={p.id} className="border-t"><td className="px-3 py-2 font-mono"><Link href={`/parts/${p.sku}`} className="text-blue underline">{p.sku}</Link></td><td className="px-3 py-2">{p.name}</td><td className="px-3 py-2">{p.brand?.name ?? ""}</td><td className="px-3 py-2">{p._count.bomLines}</td><td className="px-3 py-2">{p.lastCost != null ? `${p.lastCostCurrency} ${Number(p.lastCost).toFixed(2)}` : ""}</td></tr>)}{parts.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-slate-500">no parts yet</td></tr>}</tbody></table></div>
    </div>
  );
}
