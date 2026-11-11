import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { AssetStatusBadge } from "@/components/StatusBadge";
import { ASSET_STATUSES } from "@/lib/lifecycle";
import { PageHeader, Table, Tag, btnGhost, inputCls, filterCls } from "@/components/ui";
import { AGE_BANDS, ageBand, ageRange } from "@/lib/asset-board";
import { AssetType } from "@prisma/client";

export const dynamic = "force-dynamic";
const PAGE = 20;

export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; customerId?: string; brand?: string; type?: string; age?: string; page?: string }> }) {
  const { q, status, customerId, brand, type, age, page } = await searchParams;
  const [t, u, ts, te, locale] = await Promise.all([getTranslations("common"), getTranslations("ui"), getTranslations("assetStatus"), getTranslations("eventType"), getLocale()]);
  const p = Math.max(1, Number(page) || 1);
  const where = {
    status: ASSET_STATUSES.includes(status as never) ? (status as never) : undefined,
    customerId: customerId || undefined,
    model: brand === "-" ? { is: null } : brand ? { series: { brand: { code: brand } } } : undefined,
    type: type && type in AssetType ? (type as AssetType) : undefined,
    installedAt: ageRange(age ?? ""),
    OR: q ? [{ code: { contains: q, mode: "insensitive" as const } }, { serialNumber: { contains: q, mode: "insensitive" as const } }, { location: { contains: q, mode: "insensitive" as const } }, { customer: { name: { contains: q, mode: "insensitive" as const } } }] : undefined,
  };
  const [assets, total, byStatus, customers, brands, all] = await Promise.all([
    prisma.asset.findMany({ where, include: { model: { include: { series: { include: { brand: true } } } }, customer: { select: { name: true } }, plant: { select: { code: true } }, events: { orderBy: { occurredAt: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" }, skip: (p - 1) * PAGE, take: PAGE }),
    prisma.asset.count({ where }),
    prisma.asset.groupBy({ by: ["status"], _count: true }),
    prisma.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
    // 看板: every machine still with us (retired ones leave the board), counted three ways
    prisma.asset.findMany({ where: { status: { not: "RETIRED" } }, select: { type: true, installedAt: true, model: { select: { series: { select: { brand: { select: { code: true, name: true } } } } } } } }),
  ]);
  const tally = <K extends string>(keys: K[]) => { const m = new Map<K, number>(); for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1); return m; };
  const brandOf = new Map(all.map((a) => [a.model?.series.brand.code ?? "-", a.model?.series.brand.name ?? u("boardNoBrand")]));
  const byBrand = [...tally(all.map((a) => a.model?.series.brand.code ?? "-"))].sort((a, b) => b[1] - a[1]);
  const byType = [...tally(all.map((a) => a.type as string))].sort((a, b) => b[1] - a[1]);
  const ages = tally(all.map((a) => ageBand(a.installedAt)));
  const byAge = AGE_BANDS.map((b) => [b, ages.get(b) ?? 0] as [string, number]).filter(([, n]) => n > 0);
  const filter = (k: string, v: string) => { const cur = { q, status, customerId, brand, type, age }[k]; const next = { ...(q ? { q } : {}), ...(status ? { status } : {}), ...(customerId ? { customerId } : {}), ...(brand ? { brand } : {}), ...(type ? { type } : {}), ...(age ? { age } : {}) } as Record<string, string>; if (cur === v) delete next[k]; else next[k] = v; const s = new URLSearchParams(next).toString(); return s ? `/assets?${s}` : "/assets"; };
  const Panel = ({ title, rows, k, active, label }: { title: string; rows: [string, number][]; k: string; active?: string; label: (key: string) => string }) => {
    const max = Math.max(1, ...rows.map(([, n]) => n));
    return (
      <div className="rounded-xl border bg-white p-3">
        <div className="mb-2 text-sm font-semibold text-navy">{title}</div>
        <ul className="space-y-1">
          {rows.slice(0, 8).map(([key, n]) => (
            <li key={key}><Link href={filter(k, key)} className={`grid grid-cols-[7rem_1fr_2.5rem] items-center gap-2 rounded px-1 py-0.5 text-[13px] hover:bg-tint ${active === key ? "bg-tint font-semibold" : ""}`}>
              <span className="truncate">{label(key)}</span>
              <span className="h-2.5 rounded-full bg-navy/10"><span className={`block h-2.5 rounded-full ${active === key ? "bg-navy" : "bg-blue"}`} style={{ width: `${Math.max(4, (n / max) * 100)}%` }} /></span>
              <span className="text-right tabular-nums">{n}</span>
            </Link></li>
          ))}
          {rows.length === 0 && <li className="text-[13px] text-navy/60">{t("none")}</li>}
          {rows.length > 8 && <li className="px-1 text-xs text-navy/60">{u("boardMore", { n: rows.length - 8 })}</li>}
        </ul>
      </div>
    );
  };
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0;
  const fmt = new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit" });
  const qs = (n: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), ...(customerId ? { customerId } : {}), ...(brand ? { brand } : {}), ...(type ? { type } : {}), ...(age ? { age } : {}), page: String(n) })}`;
  return (
    <div className="space-y-4">
      <PageHeader title={t("assets")} badge={<Tag>{ts("IN_SERVICE")} {count("IN_SERVICE")} · {u("underService")} {count("REPAIR") + count("MAINTENANCE") + count("OVERHAUL") + count("ACCEPTANCE")} · {ts("SPARE")} {count("SPARE")}</Tag>}
        actions={<><Link href="/series" className={btnGhost}>{u("kbSeriesTitle")}</Link><Link href="/fault-codes" className={btnGhost}>{u("kbLibrary")}</Link><Link href="/models" className={btnGhost}>{u("modelLibrary")}</Link></>} newHref="/assets/new" newLabel={u("newAsset")} />
      <div className="grid gap-3 md:grid-cols-3">
        <Panel title={u("boardByBrand")} rows={byBrand} k="brand" active={brand} label={(k) => brandOf.get(k) ?? k} />
        <Panel title={u("boardByAge")} rows={byAge} k="age" active={age} label={(k) => u(`age_${k}`)} />
        <Panel title={u("boardByType")} rows={byType} k="type" active={type} label={(k) => t(k)} />
      </div>
      {(brand || age || type) && <div className="flex flex-wrap items-center gap-2 text-[13px]"><span className="text-navy/70">{u("boardFiltered", { n: total })}</span><Link href="/assets" className="text-blue hover:underline">{u("boardClear")}</Link></div>}
      <form className="flex flex-wrap gap-2">
        {type && <input type="hidden" name="type" value={type} />}{age && <input type="hidden" name="age" value={age} />}
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
