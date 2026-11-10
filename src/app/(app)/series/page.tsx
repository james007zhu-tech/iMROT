import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { listSeries } from "@/server/knowledge";
import { Flash } from "@/components/Flash";
import { PageHeader, Table, Tag, btnGhost } from "@/components/ui";

export const dynamic = "force-dynamic";

/** 产品系列 — the data dictionary (mockup v0.1 screen 2): per series its models, machines on file and fault codes. */
export default async function SeriesList({ searchParams }: { searchParams: Promise<{ brand?: string; all?: string; ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const [brands, rows] = await Promise.all([prisma.brand.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }), listSeries({ brandId: sp.brand, all: sp.all === "1" })]);
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-sm ${on ? "border-blue bg-tint font-semibold text-navy" : "border-navy/25 bg-white text-navy/80"}`;
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/assets", label: t("nav_alm") }} title={u("kbSeriesTitle")} badge={<Tag>{u("kbDictionary")}</Tag>}
        actions={<><Link href="/fault-codes" className={btnGhost}>{u("kbLibrary")}</Link><Link href="/models" className={btnGhost}>{u("modelLibrary")}</Link></>}
        newHref="/series/new" newLabel={u("kbNewSeries")} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="flex flex-wrap gap-2 rounded-xl border bg-white p-3">
        <Link href="/series" className={chip(!sp.brand)}>{u("kbAllBrands")}</Link>
        {brands.map((b) => <Link key={b.id} href={`/series?brand=${b.id}`} className={chip(sp.brand === b.id)}>{b.name}</Link>)}
        <Link href={sp.all === "1" ? "/series" : "/series?all=1"} className="ml-auto text-sm text-blue">{sp.all === "1" ? u("kbHideInactive") : u("kbShowInactive")}</Link>
      </div>
      <div className="rounded-xl border bg-white p-2">
        <Table head={[u("kbBrand"), u("kbSeriesCode"), u("kbSeriesName"), u("kbCategory"), u("kbLifecycle"), u("kbModels"), u("kbAssets"), u("kbCodesCol")]}>
          {rows.map((s) => (
            <tr key={s.id} className={s.active ? "" : "opacity-50"}>
              <td>{s.brand.name}</td>
              <td className="font-mono"><Link href={`/series/${s.id}`} className="text-blue hover:underline">{s.code}</Link></td>
              <td><Link href={`/series/${s.id}`} className="hover:underline">{s.name}</Link></td>
              <td>{s.category?.nameZh ?? "—"}</td>
              <td>{s.lifecycle === "DISCONTINUED" ? <Tag hot>{u("kbLife_DISCONTINUED")}{s.successor ? ` → ${s.successor.name}` : ""}</Tag> : <Tag>{u(`kbLife_${s.lifecycle}`)}</Tag>}</td>
              <td className="text-right">{s._count.models}</td>
              <td className="text-right">{s.assets}</td>
              <td className="text-right"><Link href={`/series/${s.id}?tab=codes`} className="hover:underline">{s.codes.total} · {s.codes.approved} / {s.codes.isPublic}</Link></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-navy/60">{u("kbNoSeries")}</td></tr>}
        </Table>
        <p className="px-2 pt-1 text-xs text-navy/60">{u("kbCodesColHint")}</p>
      </div>
    </div>
  );
}
