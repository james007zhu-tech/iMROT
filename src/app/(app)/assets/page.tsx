import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { AssetStatusBadge } from "@/components/StatusBadge";
import { ASSET_STATUSES } from "@/lib/lifecycle";
import { PageHeader, Table, Tag, btnGhost, inputCls, filterCls } from "@/components/ui";

export const dynamic = "force-dynamic";
const PAGE = 20;

export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; customerId?: string; brand?: string; page?: string }> }) {
  const { q, status, customerId, brand, page } = await searchParams;
  const [t, u, ts, te, locale] = await Promise.all([getTranslations("common"), getTranslations("ui"), getTranslations("assetStatus"), getTranslations("eventType"), getLocale()]);
  const p = Math.max(1, Number(page) || 1);
  const where = {
    status: ASSET_STATUSES.includes(status as never) ? (status as never) : undefined,
    customerId: customerId || undefined,
    model: brand ? { series: { brand: { code: brand } } } : undefined,
    OR: q ? [{ code: { contains: q, mode: "insensitive" as const } }, { serialNumber: { contains: q, mode: "insensitive" as const } }, { location: { contains: q, mode: "insensitive" as const } }, { customer: { name: { contains: q, mode: "insensitive" as const } } }] : undefined,
  };
  const [assets, total, byStatus, customers, brands] = await Promise.all([
    prisma.asset.findMany({ where, include: { model: { include: { series: { include: { brand: true } } } }, customer: { select: { name: true } }, plant: { select: { code: true } }, events: { orderBy: { occurredAt: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" }, skip: (p - 1) * PAGE, take: PAGE }),
    prisma.asset.count({ where }),
    prisma.asset.groupBy({ by: ["status"], _count: true }),
    prisma.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
  ]);
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0;
  const fmt = new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit" });
  const qs = (n: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), ...(customerId ? { customerId } : {}), ...(brand ? { brand } : {}), page: String(n) })}`;
  return (
    <div className="space-y-4">
      <PageHeader title={t("assets")} badge={<Tag>{ts("IN_SERVICE")} {count("IN_SERVICE")} · {u("underService")} {count("REPAIR") + count("MAINTENANCE") + count("OVERHAUL") + count("ACCEPTANCE")} · {ts("SPARE")} {count("SPARE")}</Tag>}
        actions={<Link href="/models" className={btnGhost}>{u("modelLibrary")}</Link>} newHref="/assets/new" newLabel={u("newAsset")} />
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder={u("searchAssetsLong")} className={`${inputCls} max-w-sm`} />
        <select name="customerId" defaultValue={customerId ?? ""} className={filterCls}><option value="">{t("customer")} ▾</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select name="status" defaultValue={status ?? ""} className={filterCls}><option value="">{t("status")} ▾</option>{ASSET_STATUSES.map((s) => <option key={s} value={s}>{ts(s)}</option>)}</select>
        <select name="brand" defaultValue={brand ?? ""} className={filterCls}><option value="">{t("brand")} ▾</option>{brands.map((b) => <option key={b.id} value={b.code}>{b.name}</option>)}</select>
        <button className={btnGhost}>{t("search")}</button>
      </form>
      <div className="rounded-xl border bg-white p-2">
        <Table head={[t("assetCode"), t("type"), u("brandSeriesModel"), t("serial"), u("customerPlant"), t("location"), t("status"), u("latestEvent")]}>
          {assets.map((a) => (
            <tr key={a.id}>
              <td><Link href={`/assets/${a.code}`} className="font-mono text-blue hover:underline">{a.code}</Link></td>
              <td>{t(a.type)}</td>
              <td>{a.model ? `${a.model.series.brand.name} · ${a.model.series.name} · ${a.model.code}` : "—"}</td>
              <td className="font-mono">{a.serialNumber}</td>
              <td>{a.customer?.name ?? "—"}{a.plant ? ` · ${a.plant.code}` : ""}</td>
              <td>{a.location ?? "—"}</td>
              <td><AssetStatusBadge status={a.status} /></td>
              <td className="text-xs">{a.events[0] ? <>{fmt.format(a.events[0].occurredAt)} {te(a.events[0].type)}</> : ""}</td>
            </tr>
          ))}
          {assets.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-navy/60">{t("none")}</td></tr>}
        </Table>
        <div className="flex items-center gap-2 px-2 pt-2 text-[13px] text-navy/70">
          <span>{total === 0 ? 0 : (p - 1) * PAGE + 1}–{Math.min(p * PAGE, total)} / {total}</span>
          <span className="ml-auto" />
          {p > 1 && <Link href={qs(p - 1)} className={btnGhost}>{u("prevPage")}</Link>}
          {p * PAGE < total && <Link href={qs(p + 1)} className={btnGhost}>{u("nextPage")}</Link>}
        </div>
      </div>
    </div>
  );
}
