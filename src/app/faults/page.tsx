import Link from "next/link";
import { headers } from "next/headers";
import { publicBrands, publicSearch } from "@/server/knowledge";
import { publicLang, publicT } from "@/lib/kb-public";
import { PublicShell } from "./shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fault codes · DCiT" };

/** Public home: search by code or words, or browse by brand. */
export default async function FaultsHome({ searchParams }: { searchParams: Promise<{ lang?: string; q?: string }> }) {
  const sp = await searchParams;
  const lang = publicLang(sp.lang, (await headers()).get("accept-language"));
  const t = publicT(lang);
  const [brands, hits] = await Promise.all([publicBrands(), sp.q ? publicSearch(sp.q, { lang }) : Promise.resolve(null)]);
  return (
    <PublicShell lang={lang} path={sp.q ? `/faults?q=${encodeURIComponent(sp.q)}` : "/faults"} q={sp.q}>
      {hits ? (
        <section>
          <h1 className="mb-2 text-lg font-bold">{t("results", { n: hits.items.length, q: sp.q! })}</h1>
          <ul className="divide-y divide-navy/10 rounded-xl border border-navy/15">
            {hits.items.map((h) => <li key={`${h.brandSlug}${h.seriesSlug}${h.code}`}><Link href={`/faults/${h.brandSlug}/${h.seriesSlug}/${encodeURIComponent(h.code.toLowerCase())}?lang=${lang}`} className="flex items-baseline gap-3 px-3 py-2.5"><span className="font-mono font-bold text-fault">{h.code}</span><span className="flex-1">{h.title}</span><span className="text-xs text-navy/60">{h.brand} {h.series}</span></Link></li>)}
            {hits.items.length === 0 && <li className="px-3 py-6 text-center text-sm text-navy/60">{t("noResults")}</li>}
          </ul>
        </section>
      ) : (
        <section>
          <h1 className="text-xl font-bold">{t("homeTitle")}</h1>
          <p className="mt-1 text-sm text-navy/70">{t("homeLead")}</p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {brands.map((b) => <li key={b.slug}><Link href={`/faults/${b.slug}?lang=${lang}`} className="flex items-center justify-between rounded-xl border border-navy/15 px-4 py-3 hover:bg-tint"><span className="font-semibold">{b.name}</span><span className="text-sm text-navy/60">{t("codesN", { n: b.codes })}</span></Link></li>)}
            {brands.length === 0 && <li className="text-sm text-navy/60">{t("empty")}</li>}
          </ul>
        </section>
      )}
    </PublicShell>
  );
}
