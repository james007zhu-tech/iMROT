import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Parts() {
  const t = await getTranslations("common");
  const parts = await prisma.part.findMany({ orderBy: { sku: "asc" }, include: { brand: true, _count: { select: { bomLines: true } } } });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t("nav_scm")} · {t("parts")}</h1>
      <div className="rounded-lg border bg-white"><table className="w-full text-sm"><thead className="bg-slate-100 text-left"><tr><th className="px-3 py-2">{t("sku")}</th><th className="px-3 py-2">{t("name")}</th><th className="px-3 py-2">{t("brand")}</th><th className="px-3 py-2">{t("inBoms")}</th><th className="px-3 py-2">{t("lastCost")}</th></tr></thead>
        <tbody>{parts.map((p) => <tr key={p.id} className="border-t"><td className="px-3 py-2 font-mono"><Link href={`/parts/${p.sku}`} className="text-blue underline">{p.sku}</Link></td><td className="px-3 py-2">{p.name}</td><td className="px-3 py-2">{p.brand?.name ?? ""}</td><td className="px-3 py-2">{p._count.bomLines}</td><td className="px-3 py-2">{p.lastCost != null ? `${p.lastCostCurrency} ${Number(p.lastCost).toFixed(2)}` : ""}</td></tr>)}{parts.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-slate-500">{t("noParts")}</td></tr>}</tbody></table></div>
    </div>
  );
}
