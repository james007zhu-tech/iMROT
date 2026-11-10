import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { publicCode } from "@/server/knowledge";
import { publicLang, publicT } from "@/lib/kb-public";
import { lines, manualLabel, type Source } from "@/lib/knowledge";
import { ContactCta, PublicShell } from "../../../shell";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ brand: string; series: string; code: string }>; searchParams: Promise<{ lang?: string }> };

export async function generateMetadata({ params, searchParams }: P) {
  const [{ brand, series, code }, sp] = await Promise.all([params, searchParams]);
  const c = await publicCode(brand, series, decodeURIComponent(code), sp.lang ?? "en");
  return { title: c ? `${c.brand} ${c.series} ${c.code} ${c.title} · DCiT` : "DCiT" };
}

/** One public code: our words, the manual reference, and how to reach DCiT. Never anything internal. */
export default async function FaultsCode({ params, searchParams }: P) {
  const [{ brand, series, code }, sp] = await Promise.all([params, searchParams]);
  const lang = publicLang(sp.lang, (await headers()).get("accept-language"));
  const t = publicT(lang);
  const c = await publicCode(brand, series, decodeURIComponent(code), lang);
  if (!c) notFound();
  const src = (c.source ?? {}) as Source;
  const section = (title: string, body: React.ReactNode) => <section className="mt-4"><h2 className="mb-1 text-sm font-bold text-navy">{title}</h2><div className="text-[15px] leading-relaxed">{body}</div></section>;
  const ol = (xs: string[]) => <ol className="list-decimal space-y-1 pl-5">{xs.map((x, i) => <li key={i}>{x}</li>)}</ol>;
  const manualRef = `${manualLabel(src, false)}${src.page ? ` · ${t("page", { n: src.page })}` : ""}`;
  return (
    <PublicShell lang={lang} path={`/faults/${brand}/${series}/${code}`} crumbs={[{ href: `/faults?lang=${lang}`, label: t("home") }, { href: `/faults/${brand}?lang=${lang}`, label: c.brand }, { href: `/faults/${brand}/${series}?lang=${lang}`, label: c.series }]}>
      <div className="font-mono text-4xl font-bold text-fault">{c.code}</div>
      <h1 className="mt-1 text-xl font-bold">{c.title}</h1>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-tint px-2.5 py-1 font-semibold">{t(`kind_${c.kind}`)}</span>
        <span className={`rounded-full px-2.5 py-1 font-semibold ${c.mustStop === "UNVERIFIED" ? "bg-alert/15 text-alert-ink" : "bg-tint"}`}>{t(`stop_${c.mustStop}`)}</span>
        {c.appliesTo && <span className="rounded-full border border-navy/20 px-2.5 py-1">{t("appliesTo")}: {c.appliesTo}</span>}
      </div>
      {c.lang && c.lang !== lang && <p className="mt-2 rounded bg-navy/5 px-2 py-1 text-xs text-navy/70">{t("fallback", { lang: t(`lang_${c.lang}`) })}</p>}
      {c.others.filter((o) => o !== lang).length > 0 && <p className="mt-2 text-xs text-navy/60">{t("alsoIn")} {c.others.filter((o) => o !== lang).map((o) => <Link key={o} href={`/faults/${brand}/${series}/${code}?lang=${o}`} className="mr-2 text-blue underline">{t(`lang_${o}`)}</Link>)}</p>}
      {c.meaning && section(t("meaning"), <p>{c.meaning}</p>)}
      {c.causes.length > 0 && section(t("causes"), ol(c.causes))}
      {c.checks.length > 0 && section(t("checks"), ol(c.checks))}
      {!c.meaning && !c.checks.length && src.title && section(t("meaningAndChecks"), <p>{t("seeManual")} {src.url ? <a href={src.url} target="_blank" rel="noreferrer" className="text-blue underline">{manualRef}</a> : manualRef}</p>)}
      {c.remedy && section(t("remedy"), <p>{c.remedy}</p>)}
      {c.safety && section(t("safety"), <p className="rounded-lg border border-alert/40 bg-alert/10 px-3 py-2">{c.safety}</p>)}
      {c.prepare && section(t("prepare"), lines(c.prepare).length > 1 ? ol(lines(c.prepare)) : <p>{c.prepare}</p>)}
      {c.related.length > 0 && section(t("related"), <div className="flex flex-wrap gap-2">{c.related.map((r) => <Link key={r} href={`/faults/${brand}/${series}/${encodeURIComponent(r.toLowerCase())}?lang=${lang}`} className="rounded border border-navy/20 px-2 py-0.5 font-mono text-fault">{r}</Link>)}</div>)}
      <ContactCta lang={lang} code={`${c.brand} ${c.series} ${c.code}`} />
      {src.title && <p className="mt-4 text-xs text-navy/60">{t("source")}: {src.url ? <a href={src.url} target="_blank" rel="noreferrer" className="underline">{manualRef}</a> : manualRef} · {t("published", { date: c.publishedAt })}</p>}
    </PublicShell>
  );
}
