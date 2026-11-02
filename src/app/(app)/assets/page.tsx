import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { AssetStatusBadge } from "@/components/StatusBadge";
import { ASSET_STATUSES } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; customerId?: string }> }) {
  const { q, status, customerId } = await searchParams;
  const t = await getTranslations("common");
  const ts = await getTranslations("assetStatus");
  const assets = await prisma.asset.findMany({
    where: {
      status: ASSET_STATUSES.includes(status as never) ? (status as never) : undefined,
      customerId: customerId || undefined,
      OR: q ? [{ code: { contains: q, mode: "insensitive" } }, { serialNumber: { contains: q, mode: "insensitive" } }, { location: { contains: q, mode: "insensitive" } }] : undefined,
    },
    include: { model: { include: { series: { include: { brand: true } } } }, customer: { select: { code: true, name: true } }, plant: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">{t("assets")}</h1>
        <form className="ml-auto flex gap-2">
          <input name="q" defaultValue={q} placeholder={t("searchAssets")} className="w-64 rounded border px-3 py-1.5 text-sm" />
          <select name="status" defaultValue={status ?? ""} className="rounded border px-2 py-1.5 text-sm">
            <option value="">{t("all")}</option>
            {ASSET_STATUSES.map((s) => <option key={s} value={s}>{ts(s)}</option>)}
          </select>
          <button className="rounded bg-blue px-3 py-1.5 text-sm text-white">{t("search")}</button>
        </form>
        <Link href="/assets/new" className="rounded bg-navy px-3 py-1.5 text-sm text-white">{t("onboard")}</Link>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr>
            <th className="px-3 py-2">{t("assetCode")}</th><th className="px-3 py-2">{t("type")}</th><th className="px-3 py-2">{t("model")}</th>
            <th className="px-3 py-2">{t("serial")}</th><th className="px-3 py-2">{t("customer")}</th><th className="px-3 py-2">{t("location")}</th><th className="px-3 py-2">{t("status")}</th>
          </tr></thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id} className="border-t hover:bg-slate-50">
                <td className="px-3 py-2 font-mono"><Link href={`/assets/${a.code}`} className="text-blue underline">{a.code}</Link></td>
                <td className="px-3 py-2">{t(a.type)}</td>
                <td className="px-3 py-2">{a.model ? `${a.model.series.brand.name} ${a.model.series.name} ${a.model.code}` : t("none")}</td>
                <td className="px-3 py-2 font-mono">{a.serialNumber}</td>
                <td className="px-3 py-2">{a.customer?.name ?? t("none")}{a.plant ? ` · ${a.plant.name}` : ""}</td>
                <td className="px-3 py-2">{a.location ?? t("none")}</td>
                <td className="px-3 py-2"><AssetStatusBadge status={a.status} /></td>
              </tr>
            ))}
            {assets.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">{t("none")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
