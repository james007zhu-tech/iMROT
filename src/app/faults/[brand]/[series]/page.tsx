import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { publicCodes, publicSeries } from "@/server/knowledge";
import { publicLang, publicT } from "@/lib/kb-public";
import { PublicShell } from "../../shell";

export const dynamic = "force-dynamic";

/** One series: its public codes, filtered by kind, 50 a page. */
export default async function FaultsSeries({ params, searchParams }: { params: Promise<{ brand: string; series: string }>; searchParams: Promise<{ lang?: string; kind?: string; page?: string }> }) {
  const [{ brand, series }, sp] = await Promise.all([params, searchParams]);
  const lang = publicLang(sp.lang, (await headers()).get("accept-language"));
  const t = publicT(lang);
  const [list, meta] = await Promise.all([publicCodes(brand, series, { kind: sp.kind, page: Number(sp.page) || 1, lang }), publicSeries(brand)]);
  const s = meta.find((x) => x.slug === series);
  if (!s) notFound();
  const base = `/faults/${brand}/${series}`;
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-sm ${on ? "border-blue bg-tint font-semibold" : "border-navy/20 text-navy/70"}`;
  const pages = Math.ceil(list.total / list.pageSize);
  return (
    <PublicShell lang={lang} path={`${base}${sp.kind ? `?kind=${sp.kind}` : ""}`} crumbs={[{ href: `/faults?lang=${lang}`, label: t("home") }, { href: `/faults/${brand}?lang=${lang}`, label: brand.toUpperCase() }]}>
      <h1 className="text-xl font-bold">{s.name}</h1>
      <p className="text-sm text-navy/60">{t("codesN", { n: s.codes })}</p>
      <div className="my-3 flex flex-wrap gap-2">
        <Link href={`${base}?lang=${lang}`} className={chip(!sp.kind)}>{t("all")}</Link>
        {["FAULT", "WARNING", "EVENT"].map((k) => <Link key={k} href={`${base}?lang=${lang}&kind=${k}`} className={chip(sp.kind === k)}>{t(`kind_${k}`)}</Link>)}
      </div>
      <ul className="divide-y divide-navy/10 rounded-xl border border-navy/15">
        {list.items.map((c) => <li key={c.code}><Link href={`${base}/${encodeURIComponent(c.code.toLowerCase())}?lang=${lang}`} className="flex items-baseline gap-3 px-3 py-2.5 hover:bg-tint"><span className="w-14 font-mono font-bold text-fault">{c.code}</span><span className="flex-1">{c.title}</span><span className="text-xs text-navy/50">{t(`kind_${c.kind}`)}</span></Link></li>)}
      </ul>
      {pages > 1 && <div className="mt-3 flex flex-wrap gap-1 text-sm">{Array.from({ length: pages }, (_, i) => i + 1).map((p) => <Link key={p} href={`${base}?lang=${lang}${sp.kind ? `&kind=${sp.kind}` : ""}&page=${p}`} className={`rounded px-2.5 py-1 ${p === list.page ? "bg-navy text-white" : "border border-navy/20"}`}>{p}</Link>)}</div>}
    </PublicShell>
  );
}
