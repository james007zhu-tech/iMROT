import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { publicSeries } from "@/server/knowledge";
import { publicLang, publicT } from "@/lib/kb-public";
import { PublicShell } from "../shell";

export const dynamic = "force-dynamic";

export default async function FaultsBrand({ params, searchParams }: { params: Promise<{ brand: string }>; searchParams: Promise<{ lang?: string }> }) {
  const [{ brand }, sp] = await Promise.all([params, searchParams]);
  const lang = publicLang(sp.lang, (await headers()).get("accept-language"));
  const t = publicT(lang);
  const series = await publicSeries(brand);
  if (!series.length) notFound();
  return (
    <PublicShell lang={lang} path={`/faults/${brand}`} crumbs={[{ href: `/faults?lang=${lang}`, label: t("home") }]}>
      <h1 className="text-xl font-bold">{brand.toUpperCase()}</h1>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {series.map((s) => <li key={s.slug}><Link href={`/faults/${brand}/${s.slug}?lang=${lang}`} className="flex items-center justify-between rounded-xl border border-navy/15 px-4 py-3 hover:bg-tint"><span><span className="font-semibold">{s.name}</span>{s.category && <span className="ml-2 text-xs text-navy/60">{s.category}</span>}</span><span className="text-sm text-navy/60">{t("codesN", { n: s.codes })}</span></Link></li>)}
      </ul>
    </PublicShell>
  );
}
