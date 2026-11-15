import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { LIFECYCLES, listSeries } from "@/server/knowledge";
import { Flash } from "@/components/Flash";
import { PageHeader, Table, Tag, btnGhost } from "@/components/ui";

export const dynamic = "force-dynamic";

/** 产品系列 — the data dictionary (mockup v0.1 screen 2): per series its models, machines on file and fault codes. */
export default async function SeriesList({ searchParams }: { searchParams: Promise<{ brand?: string; all?: string; q?: string; life?: string; ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const [brands, rows] = await Promise.all([prisma.brand.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }), listSeries({ brandId: sp.brand, all: sp.all === "1", q: sp.q?.trim() || undefined, lifecycle: sp.life })]);
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-sm ${on ? "border-blue bg-tint font-semibold text-navy" : "border-navy/25 bg-white text-navy/80"}`;
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/assets", label: t("nav_alm") }} title={u("kbSeriesTitle")} badge={<Tag>{u("kbDictionary")}</Tag>}
        actions={<><Link href="/fault-codes" className={btnGhost}>{u("kbLibrary")}</Link><Link href="/models" className={btnGhost}>{u("modelLibrary")}</Link></>}
        newHref="/series/new" newLabel={u("kbNewSeries")} />
      <Flash ok={sp.ok} error={sp.error} />
      {/* eighty brands do not fit as chips: brand, status and a search box in one row */}
      <form className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3 text-sm">
        <input name="q" defaultValue={sp.q ?? ""} placeholder={u("kbSeriesSearch")} className="w-full min-w-0 rounded-md border px-3 py-2 md:w-auto md:max-w-xs md:flex-1" />
        <select name="brand" defaultValue={sp.brand ?? ""} className="w-full min-w-0 rounded-md border px-2 py-2 md:w-auto md:max-w-[16rem]"><option value="">{u("kbAllBrands")}</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.nameZh ? ` ${b.nameZh}` : ""}</option>)}</select>
        <select name="life" defaultValue={sp.life ?? ""} className="rounded-md border px-2 py-2"><option value="">{u("kbLifecycle")}</option>{LIFECYCLES.map((l) => <option key={l} value={l}>{u(`kbLife_${l}`)}</option>)}</select>
        {sp.all === "1" && <input type="hidden" name="all" value="1" />}
        <button className={btnGhost}>{t("search")}</button>
        <span className="text-navy/60">{u("kbSeriesCount", { n: rows.length, base: rows.reduce((a, r) => a + (r.installedBase ?? 0), 0) })}</span>
        <Link href={sp.all === "1" ? "/series" : "/series?all=1"} className="ml-auto text-blue">{sp.all === "1" ? u("kbHideInactive") : u("kbShowInactive")}</Link>
      </form>
      <div className="overflow-x-auto rounded-xl border bg-white p-2">
        <div className="min-w-[760px]"><Table head={[u("kbBrand"), u("kbSeriesName"), u("kbCategory"), u("kbLifecycle"), u("kbInstalled"), u("kbModels"), u("kbAssets"), u("kbCodesCol")]}>
          {rows.map((s) => (
            <tr key={s.id} className={s.active ? "" : "opacity-50"}>
              <td>{s.brand.name}{s.brand.nameZh ? <span className="ml-1 text-xs text-navy/60">{s.brand.nameZh}</span> : null}</td>
              <td><Link href={`/series/${s.id}`} className="text-blue hover:underline">{s.name}</Link>{s.masterNo ? <span className="ml-1.5 font-mono text-[11px] text-navy/50">{s.masterNo}</span> : null}</td>
              <td>{s.category?.nameZh ?? "—"}</td>
              <td className="whitespace-nowrap">
                <Tag hot={s.lifecycle === "DISCONTINUED" || s.lifecycle === "DECLINING"}>{u(`kbLife_${s.lifecycle}`)}</Tag>
                {s.lifecycleGrade ? <span className="ml-1 text-xs text-navy/60" title={u("kbGradeHint")}>{s.lifecycleGrade}</span> : null}
                {s.successor || s.successorNote ? <div className="max-w-[16rem] truncate whitespace-normal text-xs text-navy/70">→ {s.successor?.name ?? s.successorNote}</div> : null}
              </td>
              <td className="text-right">{s.installedBase ?? "—"}</td>
              <td className="text-right">{s._count.models}</td>
              <td className="text-right">{s.assets}</td>
              <td className="text-right"><Link href={`/series/${s.id}?tab=codes`} className="hover:underline">{s.codes.total} · {s.codes.approved} / {s.codes.isPublic}</Link></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-navy/60">{u("kbNoSeries")}</td></tr>}
        </Table></div>
        <p className="px-2 pt-1 text-xs text-navy/60">{u("kbCodesColHint")}</p>
      </div>
    </div>
  );
}
