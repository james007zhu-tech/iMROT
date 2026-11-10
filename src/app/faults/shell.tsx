import Link from "next/link";
import { CONTACT, PUBLIC_LANGS, publicT, type PublicLang } from "@/lib/kb-public";

/** Header (logo, search, language), breadcrumbs and footer shared by every public page. */
export function PublicShell({ lang, path, crumbs, q, children }: { lang: PublicLang; path: string; crumbs?: { href: string; label: string }[]; q?: string; children: React.ReactNode }) {
  const t = publicT(lang);
  const L = { th: "ไทย", zh: "中文", en: "EN" } as const;
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-navy/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2">
          <Link href={`/faults?lang=${lang}`} aria-label="DCiT"><img src="/brand/dcit-logo.png" alt="DCiT" className="h-8 w-auto" /></Link>
          <span className="hidden text-sm font-semibold text-navy/80 sm:inline">{t("siteName")}</span>
          <nav className="ml-auto flex gap-1 text-xs">{PUBLIC_LANGS.map((l) => <Link key={l} href={`${path}${path.includes("?") ? "&" : "?"}lang=${l}`} className={`rounded px-2 py-1 ${l === lang ? "bg-navy text-white" : "text-navy/70"}`}>{L[l]}</Link>)}</nav>
        </div>
        <form action="/faults" className="mx-auto flex max-w-3xl gap-2 px-4 pb-2">
          <input type="hidden" name="lang" value={lang} />
          <input name="q" defaultValue={q} placeholder={t("searchPh")} className="w-full rounded-lg border border-navy/25 px-3 py-2 text-base" />
          <button className="shrink-0 whitespace-nowrap rounded-lg bg-blue px-4 text-sm font-semibold text-white">{t("search")}</button>
        </form>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-4">
        {crumbs && crumbs.length > 0 && <div className="mb-2 text-xs text-navy/60">{crumbs.map((c, i) => <span key={c.href}>{i > 0 && " › "}<Link href={c.href} className="hover:underline">{c.label}</Link></span>)}</div>}
        {children}
      </main>
      <footer className="mx-auto mt-8 max-w-3xl border-t border-navy/10 px-4 py-5 text-xs leading-relaxed text-navy/60">
        <p>{t("disclaimer")}</p>
        <p className="mt-2">{CONTACT.name} · <a href={CONTACT.phoneHref} className="text-blue">{CONTACT.phone}</a> · {CONTACT.website}</p>
      </footer>
    </>
  );
}

/** Call first (people at a stopped machine phone); e-mail with the code in the subject as the second way. */
export function ContactCta({ lang, code }: { lang: PublicLang; code?: string }) {
  const t = publicT(lang);
  return (
    <div className="mt-5">
      <a href={CONTACT.phoneHref} className="block rounded-xl bg-blue px-4 py-3 text-center font-semibold text-white">
        {t("cta")}<span className="mt-0.5 block text-sm font-normal opacity-90">☎ {CONTACT.phone}</span>
      </a>
      <a href={`mailto:${CONTACT.email}?subject=${encodeURIComponent(`${t("ctaSubject")} ${code ?? ""}`.trim())}`} className="mt-2 block text-center text-sm text-blue underline">{CONTACT.email}</a>
    </div>
  );
}
